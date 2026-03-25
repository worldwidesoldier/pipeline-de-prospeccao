import { Controller, Post, Body, Headers, Logger, HttpCode } from '@nestjs/common';
import { WaTesterService } from './wa-tester.service';

@Controller('webhook')
export class WaTesterController {
  private readonly logger = new Logger(WaTesterController.name);

  constructor(private waTesterService: WaTesterService) {}

  @Post('evolution')
  @HttpCode(200)
  async handleEvolutionWebhook(
    @Body() body: any,
    @Headers() headers: any,
  ) {
    // Filtrar apenas mensagens recebidas (não enviadas)
    if (body?.event === 'messages.upsert' && body?.data?.key?.fromMe === false) {
      this.logger.log('Webhook Evolution: mensagem recebida');
      await this.waTesterService.handleWebhook(body);
    }
    return { ok: true };
  }

  @Post('evolution/notify')
  @HttpCode(200)
  async handleNotify(@Body() body: any) {
    // Endpoint alternativo para notificações
    if (body?.data?.key?.fromMe === false) {
      await this.waTesterService.handleWebhook(body);
    }
    return { ok: true };
  }
}
