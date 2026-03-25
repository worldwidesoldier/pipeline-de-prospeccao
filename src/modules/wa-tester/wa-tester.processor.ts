import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WaTesterService } from './wa-tester.service';

@Processor('wa_test_queue')
export class WaTesterProcessor {
  private readonly logger = new Logger(WaTesterProcessor.name);

  constructor(private waTesterService: WaTesterService) {}

  @Process('test_whatsapp')
  async handleTestWhatsApp(job: Job<{ leadId: string }>) {
    this.logger.log(`Testando WA do lead ${job.data.leadId}`);
    await this.waTesterService.sendTestMessage(job.data.leadId);
    return { ok: true };
  }
}
