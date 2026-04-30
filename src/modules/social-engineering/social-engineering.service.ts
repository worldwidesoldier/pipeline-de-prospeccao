import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
import { WaTesterService } from '../wa-tester/wa-tester.service';
import axios from 'axios';
import OpenAI from 'openai';

// ── Template store para mensagens de engenharia social ──────────
import * as fs from 'fs';
import * as path from 'path';

const SOC_ENG_TEMPLATES_FILE = path.join(process.cwd(), 'data', 'social-eng-templates.json');

export interface SocEngTemplates {
  v1: { nome: string; texto: string };
  v2: { nome: string; texto: string };
  v3: { nome: string; texto: string };
}

const DEFAULT_TEMPLATES: SocEngTemplates = {
  v1: {
    nome: 'Engenharia Social V1',
    texto: `Oi [NOME]! Você me ajudou muito agora. Tenho um cliente grande querendo fechar operação de câmbio mas meu chefe precisa ligar diretamente pro responsável pra confirmar as condições. Qual o número do dono ou gerente pra eu passar pra ele? Obrigado!`,
  },
  v2: {
    nome: 'Engenharia Social V2',
    texto: `Oi [NOME]! Desculpa incomodar de novo. Meu diretor quer fechar a operação essa semana mas insiste em falar com o responsável da casa antes. Consegue me passar um número direto do gestor?`,
  },
  v3: {
    nome: 'Engenharia Social V3',
    texto: `[NOME], última tentativa — meu cliente aprovou o orçamento hoje e quer fechar mas o compliance dele exige falar com o decisor da casa de câmbio. Se puder passar o contato do responsável eu consigo fechar ainda hoje.`,
  },
};

export class SocEngTemplateStore {
  static get(): SocEngTemplates {
    try {
      fs.mkdirSync(path.dirname(SOC_ENG_TEMPLATES_FILE), { recursive: true });
      return JSON.parse(fs.readFileSync(SOC_ENG_TEMPLATES_FILE, 'utf8'));
    } catch { return DEFAULT_TEMPLATES; }
  }

  static updateVariant(variant: 'v1' | 'v2' | 'v3', nome: string, texto: string): SocEngTemplates {
    const current = this.get();
    current[variant] = { nome, texto };
    fs.mkdirSync(path.dirname(SOC_ENG_TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(SOC_ENG_TEMPLATES_FILE, JSON.stringify(current, null, 2));
    return current;
  }
}

@Injectable()
export class SocialEngineeringService {
  private readonly logger = new Logger(SocialEngineeringService.name);
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;

  constructor(
    @InjectQueue('social_eng_queue') private socialEngQueue: Queue,
    @InjectQueue('briefing_queue') private briefingQueue: Queue,
    private crmService: CrmService,
    private activity: ActivityService,
    private waTesterService: WaTesterService,
  ) {}

  async send(leadId: string, variacao: 1 | 2 | 3): Promise<void> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`SocialEng: lead ${leadId} não encontrado ou sem WhatsApp`);
      return;
    }

    // Se já recebeu o número do gestor, não envia mais
    if (lead.status_numero === 'RECEBIDO') {
      this.logger.log(`Lead ${lead.nome} já tem gestor_phone — pulando engenharia`);
      return;
    }

    const templates = SocEngTemplateStore.get();
    const varKey = `v${variacao}` as 'v1' | 'v2' | 'v3';
    const template = templates[varKey];

    // Personaliza com nome do atendente (ou nome da empresa) e cidade
    const nomeAtendente = lead.tom_atendente && !lead.tom_atendente.includes('não identificado')
      ? lead.nome.split(' ')[0]  // primeiro nome da empresa
      : lead.nome.split(' ')[0];
    const mensagem = template.texto
      .replace(/\[NOME\]/g, nomeAtendente)
      .replace(/\[CIDADE\]/g, lead.cidade || '');

    const cleanPhone = this.formatNumber(lead.whatsapp);
    const phase = `ENG_V${variacao}` as 'ENG_V1' | 'ENG_V2' | 'ENG_V3';

    this.logger.log(`Enviando engenharia social ${phase} para ${lead.nome}`);

    try {
      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        { number: cleanPhone, text: mensagem },
        { headers: { 'apikey': this.evolutionKey, 'Content-Type': 'application/json' }, timeout: 30000 },
      );
    } catch (err: any) {
      this.logger.warn(`Falha ao enviar engenharia para ${lead.nome}: ${err?.message}`);
      // Re-agenda com delay de 10 min
      await this.socialEngQueue.add('send_social_eng', { leadId, variacao }, {
        delay: 10 * 60 * 1000,
        attempts: 2,
        backoff: { type: 'fixed', delay: 10 * 60 * 1000 },
      });
      return;
    }

    await this.crmService.saveMysteryMessage(leadId, phase, 'SENT', mensagem);
    await this.crmService.updateLead(leadId, {
      status: `eng_v${variacao}`,
      engenharia_social_sent_at: new Date().toISOString(),
      engenharia_social_variacao: variacao,
      status_numero: 'AGUARDANDO',
    });

    // Registra no WaTesterService para receber respostas via webhook
    this.waTesterService.registerSocialEngEntry(cleanPhone, lead.nome, leadId, phase);

    // Agenda retry com 6h úteis (via BullMQ delay — sobrevive a restarts)
    const delayMs = this.waTesterService.calcBusinessHoursDelay(new Date(), 6);
    await this.socialEngQueue.add('retry_social_eng', { leadId, variacao }, {
      delay: delayMs,
      attempts: 1,
      jobId: `retry_soc_eng_${leadId}_v${variacao}`, // garante unicidade
    });

    this.activity.log('social_eng', `Engenharia social ${phase} enviada para ${lead.nome}`, lead.nome);
  }

  async retry(leadId: string, variacao: 1 | 2 | 3): Promise<void> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return;

    // Se já recebeu o número, não precisa mais
    if (lead.status_numero !== 'AGUARDANDO') {
      this.logger.log(`Lead ${lead.nome} status_numero=${lead.status_numero} — retry desnecessário`);
      return;
    }

    const nextVariacao = (variacao + 1) as 1 | 2 | 3;

    if (nextVariacao > 3) {
      // Esgotou as 3 variações sem resposta → MORTO
      this.logger.log(`Lead ${lead.nome} ignorou todas as 3 variações de engenharia → MORTO`);
      await this.crmService.updateLead(leadId, {
        status: 'morto',
        tag_final: 'MORTO',
        status_numero: 'NEGADO',
      });
      this.activity.log('no_response', `${lead.nome} ignorou engenharia social V1+V2+V3 → MORTO`, lead.nome);
      return;
    }

    await this.send(leadId, nextVariacao);
  }

  // Gera briefing quando gestor_phone é recebido (chamado via job generate_briefing_from_eng)
  async dispatchBriefing(leadId: string): Promise<void> {
    await this.briefingQueue.add('generate_briefing', { leadId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });
    this.logger.log(`Briefing disparado para lead ${leadId}`);
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1);
    if (cleaned.startsWith('55')) return cleaned;
    return '55' + cleaned;
  }
}
