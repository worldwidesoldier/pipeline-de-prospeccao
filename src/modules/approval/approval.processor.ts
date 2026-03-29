import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bullmq';
import { CrmService } from '../crm/crm.service';

@Processor('approval_queue')
export class ApprovalProcessor {
  private readonly logger = new Logger(ApprovalProcessor.name);

  constructor(
    @InjectQueue('outreach_queue') private outreachQueue: Queue,
    private crmService: CrmService,
  ) {}

  @Process('request_approval')
  async handleApprovalRequest(job: Job<{ leadId: string; scoreTotal: number; isAutomatic: boolean }>) {
    const { leadId, scoreTotal, isAutomatic } = job.data;

    if (isAutomatic) {
      this.logger.log(`Auto-aprovando lead ${leadId} (score ${scoreTotal})`);
      await this.crmService.createOutreach({
        lead_id: leadId,
        aprovado_por: 'sistema',
        aprovado_em: new Date().toISOString(),
        status: 'em_andamento',
      });
      await this.crmService.updateLead(leadId, { status: 'approved' });
      await this.outreachQueue.add('send_outreach', { leadId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      this.logger.log(`Lead ${leadId} auto-aprovado e na fila de outreach`);
    } else {
      this.logger.log(`Lead ${leadId} aguardando aprovação manual no dashboard (score ${scoreTotal})`);
      await this.crmService.updateLead(leadId, { status: 'pending_approval' });
    }
  }
}
