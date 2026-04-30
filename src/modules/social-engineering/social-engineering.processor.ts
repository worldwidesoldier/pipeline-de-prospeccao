import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SocialEngineeringService } from './social-engineering.service';

@Processor('social_eng_queue')
export class SocialEngineeringProcessor {
  private readonly logger = new Logger(SocialEngineeringProcessor.name);

  constructor(private socialEngineeringService: SocialEngineeringService) {}

  @Process('send_social_eng')
  async handleSend(job: Job<{ leadId: string; variacao: 1 | 2 | 3 }>) {
    this.logger.log(`Enviando engenharia social V${job.data.variacao} para lead ${job.data.leadId}`);
    await this.socialEngineeringService.send(job.data.leadId, job.data.variacao);
    return { ok: true };
  }

  @Process('retry_social_eng')
  async handleRetry(job: Job<{ leadId: string; variacao: 1 | 2 | 3 }>) {
    this.logger.log(`Retry engenharia social V${job.data.variacao} para lead ${job.data.leadId}`);
    await this.socialEngineeringService.retry(job.data.leadId, job.data.variacao);
    return { ok: true };
  }

  @Process('generate_briefing_from_eng')
  async handleBriefingFromEng(job: Job<{ leadId: string }>) {
    this.logger.log(`Disparando briefing para lead ${job.data.leadId} (via engenharia)`);
    await this.socialEngineeringService.dispatchBriefing(job.data.leadId);
    return { ok: true };
  }
}
