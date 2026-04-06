import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import OpenAI from 'openai';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// ── Outreach Template Store ──────────────────────────────────────
export interface OutreachTemplates {
  v1: { nome: string; texto: string };
  v2: { nome: string; texto: string };
  v3: { nome: string; texto: string };
}

const OUTREACH_TEMPLATES_FILE = path.join(process.cwd(), 'data', 'outreach-templates.json');

const DEFAULT_OUTREACH_TEMPLATES: OutreachTemplates = {
  v1: {
    nome: 'V1 — Resposta lenta',
    texto: `Oi, tudo bem?
Semana passada mandei uma mensagem sobre câmbio de dólar — demorou [X horas] pra ter resposta. Nesse tempo já tinha fechado com outra casa.
Somos da Fair Assist — bot pra WhatsApp que responde cotações na hora, 24h, qualifica o lead e passa pro humano na hora certa.
7 dias grátis, sem contrato. Posso mostrar funcionando em 15 minutos?`,
  },
  v2: {
    nome: 'V2 — Sem resposta',
    texto: `Oi, tudo bem?
Mandei uma mensagem sobre câmbio de dólar e não recebi resposta. Cada mensagem sem retorno é um cliente que foi pra concorrência.
Somos da Fair Assist — bot que responde na hora, 24h, qualifica o lead e passa pro humano certo. 7 dias grátis. Posso mostrar em 15 minutos?`,
  },
  v3: {
    nome: 'V3 — Resposta ruim',
    texto: `Oi, tudo bem?
Semana passada entrei em contato sobre câmbio — demorou [X horas] e a resposta não foi o que o cliente esperava.
Somos da Fair Assist — bot no WhatsApp que responde cotações na hora, tira dúvidas e qualifica o lead antes de passar pra você. 7 dias grátis. Topa ver uma demo rápida?`,
  },
};

export class OutreachTemplateStore {
  static load(): OutreachTemplates {
    try {
      fs.mkdirSync(path.dirname(OUTREACH_TEMPLATES_FILE), { recursive: true });
      return JSON.parse(fs.readFileSync(OUTREACH_TEMPLATES_FILE, 'utf8'));
    } catch {
      return DEFAULT_OUTREACH_TEMPLATES;
    }
  }
  static save(templates: OutreachTemplates): void {
    fs.mkdirSync(path.dirname(OUTREACH_TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(OUTREACH_TEMPLATES_FILE, JSON.stringify(templates, null, 2));
  }
  static get(): OutreachTemplates { return this.load(); }
  static updateVariant(variant: 'v1' | 'v2' | 'v3', nome: string, texto: string): OutreachTemplates {
    const t = this.load();
    t[variant] = { nome, texto };
    this.save(t);
    return t;
  }
}

@Injectable()
export class OutreachService {
  private readonly logger = new Logger(OutreachService.name);
  private readonly openai: OpenAI;
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;

  constructor(
    @InjectQueue('followup_queue') private followupQueue: Queue,
    private crmService: CrmService,
  ) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async sendFirstMessage(leadId: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`Lead ${leadId} sem WhatsApp para outreach`);
      return;
    }

    const waTest = await this.crmService.getLatestWaTestByLeadId(leadId);
    const mensagem = this.selecionarTemplate(lead, waTest);

    await this.sendEvolutionMessage(lead.whatsapp, mensagem);

    const outreach = await this.crmService.getOutreachByLeadId(leadId);
    if (outreach) {
      await this.crmService.updateOutreach(outreach.id, {
        msg1_enviada_em: new Date().toISOString(),
      });
    }

    const DAY_MS = 24 * 60 * 60 * 1000;

    await this.followupQueue.add('followup', { leadId, msgNumber: 2 }, {
      delay: 2 * DAY_MS,
      attempts: 3,
    });

    await this.followupQueue.add('followup', { leadId, msgNumber: 3 }, {
      delay: 5 * DAY_MS,
      attempts: 3,
    });

    await this.followupQueue.add('followup', { leadId, msgNumber: 4 }, {
      delay: 7 * DAY_MS,
      attempts: 3,
    });

    await this.crmService.updateLead(leadId, { status: 'outreach' });
    this.logger.log(`Outreach enviado para ${lead.nome}. Follow-ups agendados.`);
  }

  async handleResponse(leadId: string, responseText: string) {
    const outreach = await this.crmService.getOutreachByLeadId(leadId);
    if (!outreach) return;

    const interesse = await this.avaliarInteresse(responseText);

    await this.crmService.updateOutreach(outreach.id, {
      respondeu: true,
      respondeu_em: new Date().toISOString(),
      interesse_nivel: interesse,
    });

    this.logger.log(`Resposta de lead ${leadId} — interesse: ${interesse.toUpperCase()}`);
  }

  private selecionarTemplate(lead: any, waTest: any): string {
    const templates = OutreachTemplateStore.get();
    const nome = lead.nome.split(' ')[0];

    let texto: string;

    if (!waTest || !waTest.respondeu) {
      // V2: não respondeu
      texto = templates.v2.texto;
    } else {
      const qualidade = waTest.qualidade_resposta ?? 100;
      if (qualidade < 60) {
        // V3: respondeu mas com qualidade ruim
        texto = templates.v3.texto;
      } else {
        // V1: respondeu mas demorou
        texto = templates.v1.texto;
      }
    }

    const horas = waTest?.tempo_resposta_min
      ? Math.round(waTest.tempo_resposta_min / 60)
      : 0;
    const horasStr = horas === 1 ? '1 hora' : `${horas} horas`;

    return texto
      .replace(/\[Nome\]/g, nome)
      .replace(/\[X horas\]/g, horasStr);
  }

  async sendFollowUp(leadId: string, msgNumber: number) {
    const lead = await this.crmService.getLeadById(leadId);
    const outreach = await this.crmService.getOutreachByLeadId(leadId);

    if (!lead || !outreach) return;

    if (outreach.respondeu) {
      this.logger.log(`Lead ${lead.nome} já respondeu, cancelando follow-up ${msgNumber}`);
      return;
    }

    const nome = lead.nome.split(' ')[0];
    let mensagem = '';

    if (msgNumber === 2) {
      mensagem = `Oi ${nome}! Só passando pra ver se você viu minha mensagem anterior.\n\nA gente atende casas de câmbio no Sul e os clientes adoraram — o bot responde enquanto a equipe dorme. 😄\n\nTopa testar 7 dias grátis?`;
    } else if (msgNumber === 3) {
      mensagem = `Oi ${nome}, última tentativa da minha parte!\n\nSe tiver interesse em automatizar o atendimento do WhatsApp de vocês, é só me responder aqui.\n\n7 dias grátis, sem cartão, sem compromisso.`;
    } else if (msgNumber === 4) {
      mensagem = `Tudo bem ${nome}! Vou deixar você em paz depois dessa. 😊\n\nSe um dia quiser ver como o bot funciona na prática, é só chamar.\n\nAbraço, Vitor — Fair Assist`;
    }

    if (!mensagem) return;

    await this.sendEvolutionMessage(lead.whatsapp, mensagem);

    const updateField: any = {};
    updateField[`msg${msgNumber}_enviada_em`] = new Date().toISOString();
    await this.crmService.updateOutreach(outreach.id, updateField);

    this.logger.log(`Follow-up ${msgNumber} enviado para ${lead.nome}`);
  }

  private async sendEvolutionMessage(numero: string, texto: string) {
    const formattedNumber = this.formatNumber(numero);
    await axios.post(
      `${this.evolutionUrl}/message/sendText/${this.instance}`,
      { number: formattedNumber, text: texto },
      {
        headers: { 'apikey': this.evolutionKey, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );
  }

  private async avaliarInteresse(text: string): Promise<'alto' | 'medio' | 'baixo'> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Classifique o nível de interesse desta resposta de um potencial cliente a uma proposta de vendas. Responda APENAS com uma das palavras: alto, medio, baixo. Mensagem: "${text.substring(0, 300)}"`,
        }],
        max_tokens: 10,
        temperature: 0,
      });
      const result = response.choices[0].message.content?.trim().toLowerCase() || 'medio';
      if (['alto', 'medio', 'baixo'].includes(result)) {
        return result as 'alto' | 'medio' | 'baixo';
      }
      return 'medio';
    } catch {
      return this.avaliarInteresseFallback(text);
    }
  }

  private avaliarInteresseFallback(text: string): 'alto' | 'medio' | 'baixo' {
    const t = text.toLowerCase();
    const alto = ['sim', 'quero', 'interessei', 'manda', 'como funciona', 'quanto custa', 'agendar', 'testar'];
    const baixo = ['não', 'nao', 'obrigado mas', 'ja temos', 'não preciso', 'remove'];
    if (alto.some(w => t.includes(w))) return 'alto';
    if (baixo.some(w => t.includes(w))) return 'baixo';
    return 'medio';
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1) + '@s.whatsapp.net';
    if (cleaned.startsWith('55')) return cleaned + '@s.whatsapp.net';
    return '55' + cleaned + '@s.whatsapp.net';
  }
}
