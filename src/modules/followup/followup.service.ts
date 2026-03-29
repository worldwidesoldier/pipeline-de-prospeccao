import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { OutreachService } from '../outreach/outreach.service';

@Injectable()
export class FollowupService {
  private readonly logger = new Logger(FollowupService.name);

  constructor(
    @InjectQueue('followup_queue') private followupQueue: Queue,
    private crmService: CrmService,
    private outreachService: OutreachService,
  ) {}

  async processFollowUp(leadId: string, msgNumber: number) {
    const outreach = await this.crmService.getOutreachByLeadId(leadId);

    if (outreach?.respondeu) {
      this.logger.log(`Lead ${leadId} já respondeu. Follow-up ${msgNumber} cancelado.`);
      return;
    }

    if (outreach?.status === 'perdido' || outreach?.status === 'convertido') {
      this.logger.log(`Lead ${leadId} com status ${outreach.status}. Follow-up ${msgNumber} cancelado.`);
      return;
    }

    await this.outreachService.sendFollowUp(leadId, msgNumber);
  }

  async handleLeadResponse(leadId: string, responseText: string) {
    this.logger.log(`Resposta recebida do lead ${leadId} durante outreach`);
    await this.cancelPendingFollowUps(leadId);
    await this.outreachService.handleResponse(leadId, responseText);
  }

  private async cancelPendingFollowUps(leadId: string) {
    try {
      const jobs = await this.followupQueue.getDelayed();
      for (const job of jobs) {
        if (job.data?.leadId === leadId) {
          await job.remove();
          this.logger.log(`Job follow-up ${job.id} cancelado para lead ${leadId}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Erro ao cancelar follow-ups: ${err.message}`);
    }
  }
}
