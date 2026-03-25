import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FollowupService } from './followup.service';

@Processor('followup_queue')
export class FollowupProcessor {
  private readonly logger = new Logger(FollowupProcessor.name);

  constructor(private followupService: FollowupService) {}

  @Process('followup')
  async handleFollowup(job: Job<{ leadId: string; msgNumber: number }>) {
    const { leadId, msgNumber } = job.data;
    this.logger.log(`Processando follow-up ${msgNumber} para lead ${leadId}`);
    await this.followupService.processFollowUp(leadId, msgNumber);
    return { ok: true };
  }
}
