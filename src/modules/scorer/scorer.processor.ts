import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScorerService } from './scorer.service';

@Processor('scoring_queue')
export class ScorerProcessor {
  private readonly logger = new Logger(ScorerProcessor.name);

  constructor(private scorerService: ScorerService) {}

  @Process('score_lead')
  async handleScoreLead(job: Job<{ leadId: string }>) {
    this.logger.log(`Calculando score do lead ${job.data.leadId}`);
    await this.scorerService.scoreLead(job.data.leadId);
    return { ok: true };
  }
}
