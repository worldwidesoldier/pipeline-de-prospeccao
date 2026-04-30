import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WaTesterService } from './wa-tester.service';

@Processor('mystery_shop_queue')
export class WaTesterProcessor {
  private readonly logger = new Logger(WaTesterProcessor.name);

  constructor(private waTesterService: WaTesterService) {}

  @Process('send_m1')
  async handleSendM1(job: Job<{ leadId: string; templateId?: string }>) {
    this.logger.log(`Enviando M1 para lead ${job.data.leadId}`);
    await this.waTesterService.sendM1(job.data.leadId, job.data.templateId);
    return { ok: true };
  }
}

@Processor('webhook_queue')
export class WebhookProcessor {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private waTesterService: WaTesterService) {}

  @Process('process_webhook')
  async handleWebhook(job: Job<{ body: any }>) {
    await this.waTesterService.handleWebhook(job.data.body);
    return { ok: true };
  }
}
