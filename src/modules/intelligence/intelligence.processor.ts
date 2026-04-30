import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { IntelligenceService } from './intelligence.service';

@Processor('intelligence_queue')
export class IntelligenceProcessor {
  private readonly logger = new Logger(IntelligenceProcessor.name);

  constructor(private intelligenceService: IntelligenceService) {}

  @Process('run_intelligence')
  async handleRunIntelligence(job: Job<{ leadId: string }>) {
    this.logger.log(`Rodando intelligence para lead ${job.data.leadId}`);
    await this.intelligenceService.analyze(job.data.leadId);
    return { ok: true };
  }
}
