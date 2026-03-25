import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { OutreachService } from './outreach.service';

@Processor('outreach_queue')
export class OutreachProcessor {
  private readonly logger = new Logger(OutreachProcessor.name);

  constructor(private outreachService: OutreachService) {}

  @Process('send_outreach')
  async handleSendOutreach(job: Job<{ leadId: string }>) {
    this.logger.log(`Enviando outreach para lead ${job.data.leadId}`);
    await this.outreachService.sendFirstMessage(job.data.leadId);
    return { ok: true };
  }
}
