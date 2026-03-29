import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectQueue('outreach_queue') private outreachQueue: Queue,
    private crmService: CrmService,
  ) {}

  async getStats(): Promise<any> {
    return this.crmService.getTodayStats();
  }

  async getPipelineCounts(): Promise<any> {
    const statuses = ['novo', 'enriched', 'tested', 'scored', 'pending_approval', 'approved', 'outreach', 'descartado'];
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
    const leads = await this.crmService.getLeadsByStatus('pending_approval');
    const result = await Promise.all(
      leads.map(async (lead) => {
        const [enrichment, waTest, score] = await Promise.all([
          this.crmService.getEnrichmentByLeadId(lead.id),
          this.crmService.getLatestWaTestByLeadId(lead.id),
          this.crmService.getScoreByLeadId(lead.id),
        ]);
        return { lead, enrichment, waTest, score };
      })
    );
    return result;
  }

  async getLeads(status?: string, search?: string, page = 1, limit = 20): Promise<any> {
    const [leads, total] = await Promise.all([
      this.crmService.getLeadsFiltered({ status, search }, page, limit),
      this.crmService.countLeads({ status, search }),
    ]);
    return { leads, total, page, limit };
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
