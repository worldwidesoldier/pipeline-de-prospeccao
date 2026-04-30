import { Injectable, Logger } from '@nestjs/common';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
import OpenAI from 'openai';

@Injectable()
export class BriefingService {
  private readonly logger = new Logger(BriefingService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    private crmService: CrmService,
    private activity: ActivityService,
  ) {}

  async generate(leadId: string): Promise<void> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) {
      this.logger.warn(`Briefing: lead ${leadId} não encontrado`);
      return;
    }

    const conversations = await this.crmService.getMysteryConversation(leadId);
    const historico = conversations
      .map(c => `[${c.direction === 'SENT' ? 'MYSTERY SHOPPER' : 'ATENDENTE'}] ${c.message}`)
      .join('\n');

    this.logger.log(`Gerando briefing para ${lead.nome}`);

    const pontosFragosStr = Array.isArray(lead.pontos_fracos)
      ? lead.pontos_fracos.join(', ')
      : '';
    const pontosFortesStr = Array.isArray(lead.pontos_fortes)
      ? lead.pontos_fortes.join(', ')
      : '';

    let briefing = '';
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'system',
          content: `Você é um especialista em vendas B2B para o mercado de câmbio brasileiro.
Crie briefings de vendas precisos e acionáveis para abordagem telefônica.`,
        }, {
          role: 'user',
          content: `Gere um briefing de vendas completo para abordagem manual (ligação telefônica) para esta casa de câmbio.

DADOS DA EMPRESA:
- Nome: ${lead.nome}
- Cidade: ${lead.cidade || 'Não informado'}, ${lead.estado || ''}
- WhatsApp: ${lead.whatsapp || 'Não informado'}
- Número do gestor: ${lead.gestor_phone || 'Não informado'}
- Google Rating: ${lead.google_rating || 'N/A'} (${lead.google_reviews || 0} avaliações)

ANÁLISE DO MYSTERY SHOPPING:
- Tipo de atendimento: ${lead.tipo_atendimento || 'Não analisado'}
- Qualidade da resposta: ${lead.qualidade_resposta || 'Não avaliado'}
- Perfil de dor: ${lead.dor_perfil || 'Não identificado'}
- Tom do atendente: ${lead.tom_atendente || 'Não identificado'}
- Taxa oferecida: ${lead.taxa_oferecida || 'Não informada'}
- Tempo de resposta M1: ${lead.tempo_resposta_m1 ? `${Math.round(lead.tempo_resposta_m1 / 60)} min` : 'Não registrado'}
- Pontos fracos: ${pontosFragosStr || 'Nenhum identificado'}
- Pontos fortes: ${pontosFortesStr || 'Nenhum identificado'}

HISTÓRICO DA CONVERSA:
${historico}

O briefing deve incluir:
1. **Resumo executivo** (2-3 frases sobre o perfil da empresa)
2. **Angle de abordagem** (como abrir a conversa com base nos pontos fracos)
3. **Principais dores a explorar** (bullets com evidências da conversa)
4. **Proposta de valor** (como a Fair Assist resolve as dores identificadas)
5. **Objeções prováveis e respostas** (máx 3)
6. **Próximo passo sugerido** (o que pedir na ligação)

Seja direto, acionável e específico para esta empresa. Máx 400 palavras.`,
        }],
        max_tokens: 800,
      });

      briefing = completion.choices[0].message.content?.trim() || '';
    } catch (err: any) {
      this.logger.error(`Erro ao gerar briefing para ${lead.nome}: ${err.message}`);
      briefing = `Briefing automático indisponível. Dor: ${lead.dor_perfil || 'N/A'}. Tipo: ${lead.tipo_atendimento || 'N/A'}. Pontos fracos: ${pontosFragosStr || 'N/A'}.`;
    }

    await this.crmService.updateLead(leadId, {
      briefing_gerado: briefing,
      status: 'briefing_done',
    });

    this.logger.log(`Briefing gerado para ${lead.nome} (${briefing.length} chars)`);
    this.activity.log('briefing', `Briefing gerado para ${lead.nome} — pronto pra ligar!`, lead.nome);
  }
}
