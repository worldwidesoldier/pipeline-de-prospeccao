import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EnricherService } from './enricher.service';

@Processor('enrichment_queue')
export class EnricherProcessor {
  private readonly logger = new Logger(EnricherProcessor.name);

  constructor(private enricherService: EnricherService) {}

  @Process('enrich_lead')
  async handleEnrichLead(job: Job<{ leadId: string }>) {
    this.logger.log(`Enriquecendo lead ${job.data.leadId}...`);
    await this.enricherService.enrichLead(job.data.leadId);
    return { ok: true };
  }
}
