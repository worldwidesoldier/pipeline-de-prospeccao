import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TelegramService } from './telegram.service';

@Processor('approval_queue')
export class TelegramProcessor {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(private telegramService: TelegramService) {}

  @Process('request_approval')
  async handleApprovalRequest(job: Job<{ leadId: string; scoreTotal: number; isAutomatic: boolean }>) {
    const { leadId, scoreTotal, isAutomatic } = job.data;
    this.logger.log(`Enviando aprovação para lead ${leadId} (score ${scoreTotal})`);
    await this.telegramService.sendApprovalRequest(leadId, scoreTotal, isAutomatic);
    return { ok: true };
  }
}
