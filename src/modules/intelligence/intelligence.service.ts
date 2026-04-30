import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
import OpenAI from 'openai';

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectQueue('social_eng_queue') private socialEngQueue: Queue,
    private crmService: CrmService,
    private activity: ActivityService,
  ) {}

  async analyze(leadId: string): Promise<void> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) {
      this.logger.warn(`Intelligence: lead ${leadId} não encontrado`);
      return;
    }

    const conversations = await this.crmService.getMysteryConversation(leadId);
    if (!conversations.length) {
      this.logger.warn(`Intelligence: lead ${lead.nome} sem mystery_conversations`);
      return;
    }

    // Monta histórico da conversa
    const historico = conversations
      .map(c => `[${c.direction === 'SENT' ? 'CLIENTE (mystery shopper)' : 'ATENDENTE'}] ${c.message}`)
      .join('\n');

    this.logger.log(`Analisando conversa de ${lead.nome} (${conversations.length} msgs)`);

    let resultado: {
      tipo_atendimento: string;
      qualidade_resposta: string;
      dor_perfil: 'INEFICIENCIA' | 'OPORTUNIDADE';
      pontos_fracos: string[];
      pontos_fortes: string[];
      tom_atendente: string;
      tempo_resposta_m1_segundos: number;
      taxa_oferecida: string;
    };

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `Você é um analista especializado em avaliação de atendimento de casas de câmbio no Brasil.
Analise conversas de mystery shopping e retorne insights estruturados em JSON.`,
        }, {
          role: 'user',
          content: `Analise esta conversa de WhatsApp de mystery shopping numa casa de câmbio.

CONVERSA:
${historico}

Retorne JSON com exatamente estes campos:
{
  "tipo_atendimento": "BOT" ou "HUMANO",
  "qualidade_resposta": "RUIM" | "MEDIANA" | "BOA" | "EXCELENTE",
  "dor_perfil": "INEFICIENCIA" (atendimento lento/robótico/sem informação) ou "OPORTUNIDADE" (atende bem mas pode ser melhorado com tech),
  "pontos_fracos": ["lista de até 3 pontos fracos observados"],
  "pontos_fortes": ["lista de até 3 pontos fortes observados"],
  "tom_atendente": descrição breve do tom (ex: "formal e direto", "amigável e detalhado", "robótico"),
  "tempo_resposta_m1_segundos": número estimado em segundos até primeira resposta (0 se não identificado),
  "taxa_oferecida": "a taxa de câmbio mencionada (ex: '5.42') ou '' se não mencionada"
}`,
        }],
        response_format: { type: 'json_object' },
        max_tokens: 500,
      });

      resultado = JSON.parse(completion.choices[0].message.content || '{}');
    } catch (err: any) {
      this.logger.error(`Erro na análise de ${lead.nome}: ${err.message}`);
      // Fallback mínimo para não bloquear o pipeline
      resultado = {
        tipo_atendimento: 'HUMANO',
        qualidade_resposta: 'MEDIANA',
        dor_perfil: 'OPORTUNIDADE',
        pontos_fracos: [],
        pontos_fortes: [],
        tom_atendente: 'não identificado',
        tempo_resposta_m1_segundos: 0,
        taxa_oferecida: '',
      };
    }

    // Salva campos no lead
    await this.crmService.updateLead(leadId, {
      status: 'intelligence_done',
      tipo_atendimento: resultado.tipo_atendimento,
      qualidade_resposta: resultado.qualidade_resposta,
      dor_perfil: resultado.dor_perfil,
      pontos_fracos: resultado.pontos_fracos || [],
      pontos_fortes: resultado.pontos_fortes || [],
      tom_atendente: resultado.tom_atendente,
      tempo_resposta_m1: resultado.tempo_resposta_m1_segundos || 0,
      taxa_oferecida: resultado.taxa_oferecida || '',
    });

    this.logger.log(`Intelligence concluída para ${lead.nome}: ${resultado.tipo_atendimento}, ${resultado.dor_perfil}`);
    this.activity.log('intelligence', `Análise concluída para ${lead.nome}: ${resultado.tipo_atendimento} / ${resultado.dor_perfil}`, lead.nome);

    // Disparar engenharia social V1
    await this.socialEngQueue.add('send_social_eng', { leadId, variacao: 1 }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10000 },
    });
  }
}
