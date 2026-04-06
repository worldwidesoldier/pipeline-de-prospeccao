import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { WaTesterService } from './wa-tester.service';

@Controller('webhook')
export class WaTesterController {
  private readonly logger = new Logger(WaTesterController.name);

  constructor(
    private waTesterService: WaTesterService,
    @InjectQueue('webhook_queue') private webhookQueue: Queue,
  ) {}

  @Post('evolution')
  @HttpCode(200)
  async handleEvolutionWebhook(@Body() body: any) {
    // Filtrar apenas mensagens recebidas (não enviadas)
    if (body?.event === 'messages.upsert' && body?.data?.key?.fromMe === false) {
      this.logger.log('Webhook Evolution: mensagem recebida — enfileirando para processamento');
      await this.webhookQueue.add('process_webhook', { body }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      });
    }
    return { ok: true };
  }

  @Post('evolution/notify')
  @HttpCode(200)
  async handleNotify(@Body() body: any) {
    // Endpoint alternativo para notificações
    if (body?.data?.key?.fromMe === false) {
      await this.webhookQueue.add('process_webhook', { body }, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      });
    }
    return { ok: true };
  }

  @Post('replay-responses')
  @HttpCode(200)
  async replayResponses() {
    const replayed = await this.waTesterService.replayResponses();
    return { replayed };
  }
}
