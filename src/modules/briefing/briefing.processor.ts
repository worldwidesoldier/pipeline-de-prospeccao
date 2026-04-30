import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BriefingService } from './briefing.service';

@Processor('briefing_queue')
export class BriefingProcessor {
  private readonly logger = new Logger(BriefingProcessor.name);

  constructor(private briefingService: BriefingService) {}

  @Process('generate_briefing')
  async handleGenerateBriefing(job: Job<{ leadId: string }>) {
    this.logger.log(`Gerando briefing para lead ${job.data.leadId}`);
    await this.briefingService.generate(job.data.leadId);
    return { ok: true };
  }
}
