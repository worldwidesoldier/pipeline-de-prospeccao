import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import OpenAI from 'openai';
import axios from 'axios';

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

    const enrichment = await this.crmService.getEnrichmentByLeadId(leadId);
    const waTest = await this.crmService.getLatestWaTestByLeadId(leadId);
    const score = await this.crmService.getScoreByLeadId(leadId);

    const mensagem = await this.gerarMensagemPersonalizada(lead, enrichment, waTest, score);

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

  private async gerarMensagemPersonalizada(lead: any, enrichment: any, waTest: any, score: any): Promise<string> {
    const problemasEncontrados = [];

    if (waTest && !waTest.respondeu) {
      problemasEncontrados.push('não tem atendimento automático no WhatsApp (não responderam nossa mensagem de teste em 4 horas)');
    } else if (waTest && waTest.tempo_resposta_min > 60) {
      const h = Math.floor(waTest.tempo_resposta_min / 60);
      problemasEncontrados.push(`demorou ${h}h para responder no WhatsApp`);
    }

    if (!enrichment?.tem_site) {
      problemasEncontrados.push('não tem site');
    } else if (enrichment.site_score < 50) {
      problemasEncontrados.push('tem site mas sem informações de cotação ou contato');
    }

    if (!enrichment?.ig_ativo) {
      problemasEncontrados.push('não tem presença ativa no Instagram');
    }

    const problema = problemasEncontrados.length > 0
      ? problemasEncontrados.join(' e ')
      : 'pode se beneficiar de atendimento automático';

    const prompt = `Gere uma mensagem de WhatsApp de vendas para uma casa de câmbio chamada ${lead.nome}, localizada em ${lead.cidade || lead.estado || 'Brasil'}.

Problema identificado: ${problema}.

A mensagem deve:
- Ser direta, empática e profissional
- Mencionar especificamente o problema identificado (${problema})
- Apresentar o Fair Assist como solução: bot WhatsApp com IA que atende 24/7 respondendo cotações, dúvidas e fazendo handoff para atendente humano
- Oferecer 7 dias grátis sem compromisso
- Máximo 5 linhas
- Tom de conversa real, não de vendedor
- Assinar como "Vitor — Fair Assist"
- NÃO usar emojis excessivos
- NÃO mencionar concorrentes

Retorne APENAS a mensagem, sem explicações.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
      });
      return completion.choices[0].message.content || this.getMensagemFallback(lead.nome);
    } catch (err) {
      this.logger.warn(`Erro OpenAI, usando fallback: ${err.message}`);
      return this.getMensagemFallback(lead.nome);
    }
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

  private getMensagemFallback(nome: string): string {
    return `Oi! Vi que ${nome} ainda não tem atendimento automático no WhatsApp.\n\nSou o Vitor, do Fair Assist — desenvolvemos um bot com IA que atende seus clientes 24h, responde cotações na hora e avisa sua equipe quando precisar de atenção humana.\n\n7 dias grátis, sem compromisso. Posso te mostrar como funciona?\n\nVitor — Fair Assist`;
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1) + '@s.whatsapp.net';
    if (cleaned.startsWith('55')) return cleaned + '@s.whatsapp.net';
    return '55' + cleaned + '@s.whatsapp.net';
  }
}
