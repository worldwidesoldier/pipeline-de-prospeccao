import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';
import { MotorService } from '../motor/motor.service';
import OpenAI from 'openai';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectQueue('outreach_queue') private outreachQueue: Queue,
    @InjectQueue('enrichment_queue') private enrichmentQueue: Queue,
    @InjectQueue('wa_test_queue') private waTestQueue: Queue,
    private crmService: CrmService,
    private motorService: MotorService,
  ) {}

  async getMotorStatus() {
    const maxDaily    = parseInt(process.env.WA_DAILY_LIMIT || '20');
    const todayCount  = await this.crmService.countTodayWaTests();
    const enriched    = await this.crmService.getLeadsByStatus('enriched');
    const pendingCount = enriched.filter((l: any) => l.whatsapp).length;
    return this.motorService.getSnapshot(pendingCount, todayCount, maxDaily);
  }

  async getStats(): Promise<any> {
    return this.crmService.getTodayStats();
  }

  async getPipelineCounts(): Promise<any> {
    const statuses = ['novo', 'enriched', 'tested', 'scored', 'pending_approval', 'approved', 'outreach', 'descartado', 'sem_whatsapp_fixo'];
    const counts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (status) => {
        const leads = await this.crmService.getLeadsByStatus(status);
        counts[status] = leads.length;
      })
    );
    return counts;
  }

  async getPendingApprovals(): Promise<any[]> {
    return this.crmService.getPendingApprovalsData();
  }

  async getLeads(status?: string, search?: string, page = 1, limit = 20, campaign_id?: string): Promise<any> {
    const [leads, total] = await Promise.all([
      this.crmService.getLeadsFiltered({ status, search, campaign_id }, page, limit),
      this.crmService.countLeads({ status, search, campaign_id }),
    ]);
    return { leads, total, page, limit };
  }

  async getCampaigns(): Promise<any[]> {
    return this.crmService.getCampaignStats();
  }

  async approveLead(leadId: string) {
    const existing = await this.crmService.getOutreachByLeadId(leadId);
    if (!existing) {
      await this.crmService.createOutreach({
        lead_id: leadId,
        aprovado_por: 'dashboard',
        aprovado_em: new Date().toISOString(),
        status: 'em_andamento',
      });
    }
    await this.crmService.updateLead(leadId, { status: 'approved' });
    await this.outreachQueue.add('send_outreach', { leadId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    this.logger.log(`Lead ${leadId} aprovado via dashboard`);
    return { ok: true };
  }

  async discardLead(leadId: string) {
    await this.crmService.updateLead(leadId, { status: 'descartado' });
    this.logger.log(`Lead ${leadId} descartado via dashboard`);
    return { ok: true };
  }

  async deleteLead(leadId: string) {
    await this.crmService.deleteLead(leadId);
    return { ok: true };
  }

  async deleteAllLeads() {
    return this.crmService.deleteAllLeads();
  }

  async getLeadById(leadId: string): Promise<any> {
    return this.crmService.getLeadById(leadId);
  }

  async generateColdEmail(leadId: string, context: string): Promise<{ email: string }> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) throw new Error('Lead não encontrado');

    const painPoints = (lead.pain_points as string[] | null) ?? [];
    const summary = lead.ai_summary || 'Sem resumo disponível';

    const prompt = `Você é um especialista em copywriting B2B e cold email.

Escreva um cold email personalizado para a empresa "${lead.nome}", localizada em ${lead.cidade || lead.estado || 'Brasil'}.

Resumo de inteligência sobre o negócio:
${summary}

Principais dores identificadas nas avaliações dos clientes:
${painPoints.length > 0 ? painPoints.map(p => `- ${p}`).join('\n') : '- Nenhuma dor identificada'}

Contexto da proposta (produto/serviço que estamos oferecendo):
${context || 'Fair Assist — bot de WhatsApp para casas de câmbio que responde cotações 24h, qualifica leads e passa para o humano na hora certa.'}

Regras do email:
- Assunto curto e instigante (max 8 palavras)
- Abertura personalizada ligando as dores reais da empresa à nossa solução
- 3 parágrafos no máximo
- CTA claro no final (reunião de 15 minutos)
- Tom direto, sem exageros, sem clichês de marketing
- Em português brasileiro

Retorne APENAS um JSON válido:
{"assunto": "...", "corpo": "..."}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const draft = JSON.stringify(parsed);
      await this.crmService.updateLead(leadId, { cold_email_draft: draft } as any);
      return { email: draft };
    } catch (err) {
      this.logger.error('Erro ao gerar cold email:', err);
      throw err;
    }
  }

  async getKanbanData() {
    return this.crmService.getKanbanLeads();
  }

  async convertLead(leadId: string) {
    const existing = await this.crmService.getOutreachByLeadId(leadId);
    if (existing) {
      await this.crmService.updateOutreach(existing.id, { status: 'convertido' });
    } else {
      await this.crmService.createOutreach({
        lead_id: leadId,
        aprovado_por: 'dashboard_crm',
        aprovado_em: new Date().toISOString(),
        status: 'convertido',
      });
    }
    this.logger.log(`Lead ${leadId} marcado como convertido via CRM`);
    return { ok: true };
  }

  async requeueEnrichedLeads(): Promise<{ queued: number }> {
    // Re-enfileira apenas leads enriquecidos que ainda não foram testados via WA
    // Não toca em leads com pending_approval/scored que já passaram pelo teste
    const statuses = ['enriched', 'tested', 'scored'];
    let queued = 0;

    for (const status of statuses) {
      const leads = await this.crmService.getLeadsByStatus(status);
      for (const lead of leads) {
        if (!lead.whatsapp) continue;

        // Só re-enfileira se não tem wa_test no banco (evita duplicar envios)
        const waTest = await this.crmService.getLatestWaTestByLeadId(lead.id);
        if (waTest) continue;

        await this.crmService.updateLead(lead.id, { status: 'enriched' });
        // Delay incremental de 30s entre leads re-enfileirados — evita burst inicial
        await this.waTestQueue.add('test_whatsapp', { leadId: lead.id }, {
          delay: queued * 30_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        queued++;
      }
    }

    this.logger.log(`Re-enfileirou ${queued} leads direto para wa_test_queue`);
    return { queued };
  }

  async requeueNovoLeads(): Promise<{ queued: number }> {
    const leads = await this.crmService.getLeadsByStatus('novo');
    let queued = 0;
    for (const lead of leads) {
      await this.enrichmentQueue.add('enrich_lead', { leadId: lead.id }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
      queued++;
    }
    this.logger.log(`Re-enfileirou ${queued} leads novo para enrichment_queue`);
    return { queued };
  }

  async reEnrichDiscarded(): Promise<{ queued: number }> {
    // Re-enrich leads with a site that were discarded (may have had no WA found)
    const leads = await this.crmService.getLeadsFiltered({ status: 'descartado' }, 1, 1000);
    const withSite = leads.filter((l: any) => l.site);
    let queued = 0;
    for (const lead of withSite) {
      await this.crmService.updateLead(lead.id, { status: 'novo', whatsapp: null, whatsapp_source: null });
      await this.enrichmentQueue.add('enrich_lead', { leadId: lead.id }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
      queued++;
    }
    this.logger.log(`Re-enriquecendo ${queued} leads descartados`);
    return { queued };
  }

  @Cron('0 21 * * *')
  async saveDailyReport() {
    const stats = await this.crmService.getTodayStats();
    await this.crmService.saveRelatorio({
      data: new Date().toISOString().split('T')[0],
      leads_prospectados: stats.prospectados,
      leads_enriquecidos: stats.enriquecidos,
      leads_testados: stats.testados,
      leads_aprovados: stats.aprovados,
      mensagens_enviadas: stats.enviados,
      respostas_recebidas: stats.respostas,
      interessados: stats.interessados,
      convertidos: stats.convertidos,
    });
    this.logger.log('Relatório diário salvo');
  }
}
