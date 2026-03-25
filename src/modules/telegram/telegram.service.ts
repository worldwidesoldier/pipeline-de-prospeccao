import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';
import * as TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private readonly chatId = process.env.TELEGRAM_CHAT_ID;

  constructor(
    @InjectQueue('outreach_queue') private outreachQueue: Queue,
    private crmService: CrmService,
  ) {}

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN não configurado. Bot inativo.');
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });
    this.logger.log('Telegram Bot iniciado');

    // Listener para callbacks dos botões InlineKeyboard
    this.bot.on('callback_query', async (query) => {
      const [action, leadId] = (query.data || '').split(':');

      if (action === 'approve') {
        await this.handleApproval(leadId, query);
      } else if (action === 'discard') {
        await this.handleDiscard(leadId, query);
      }
    });
  }

  async sendApprovalRequest(leadId: string, scoreTotal: number, isAutomatic: boolean) {
    if (!this.bot || !this.chatId) {
      this.logger.warn('Bot não inicializado, pulando aprovação Telegram');
      if (isAutomatic) {
        // Auto-aprovar se bot não disponível
        await this.approveAndQueue(leadId);
      }
      return;
    }

    const lead = await this.crmService.getLeadById(leadId);
    const enrichment = await this.crmService.getEnrichmentByLeadId(leadId);
    const waTest = await this.crmService.getLatestWaTestByLeadId(leadId);
    const score = await this.crmService.getScoreByLeadId(leadId);

    if (!lead) return;

    // Formatar tempo de resposta
    let tempoResposta = 'Não testado';
    if (waTest) {
      if (!waTest.respondeu) {
        tempoResposta = 'Não respondeu em 4h';
      } else {
        const h = Math.floor(waTest.tempo_resposta_min / 60);
        const m = waTest.tempo_resposta_min % 60;
        tempoResposta = h > 0 ? `${h}h ${m}min` : `${m}min`;
      }
    }

    // Emoji de calor baseado no score
    const heatEmoji = scoreTotal >= 70 ? '🔥' : scoreTotal >= 50 ? '⚡' : '❄️';
    const autoTag = isAutomatic ? ' (AUTO)' : ' (MANUAL)';

    const msg = [
      `🏦 *${this.esc(lead.nome)}* — ${this.esc(lead.cidade || '')}/${this.esc(lead.estado || '')}`,
      `📊 Score: *${scoreTotal}/100* ${heatEmoji}${autoTag}`,
      ``,
      `⏱ WhatsApp: ${tempoResposta}`,
      `🌐 Site: ${enrichment?.tem_site ? (enrichment.site_resumo || 'Existe') : 'Sem site'}`,
      `📸 Instagram: ${enrichment?.ig_username ? `@${enrichment.ig_username} (${enrichment.ig_ultimo_post_dias ?? '?'} dias sem post, ${enrichment.ig_followers ?? 0} seg)` : 'Sem Instagram'}`,
      `⭐ Google: ${lead.google_rating ? `${lead.google_rating}★ (${lead.google_reviews} avaliações)` : 'Sem avaliações'}`,
      `📞 Número: ${lead.whatsapp || lead.telefone_google || 'Desconhecido'}`,
    ].join('\n');

    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Aprovar e Enviar', callback_data: `approve:${leadId}` },
        { text: '❌ Descartar', callback_data: `discard:${leadId}` },
      ]],
    };

    await this.bot.sendMessage(this.chatId, msg, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  private async handleApproval(leadId: string, query: TelegramBot.CallbackQuery) {
    await this.bot.answerCallbackQuery(query.id, { text: '✅ Aprovado! Enviando mensagem...' });

    // Editar mensagem para remover botões
    if (query.message) {
      await this.bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );
      await this.bot.sendMessage(
        query.message.chat.id,
        `✅ Lead aprovado e na fila de outreach!`
      );
    }

    await this.approveAndQueue(leadId);
  }

  private async approveAndQueue(leadId: string) {
    await this.crmService.createOutreach({
      lead_id: leadId,
      aprovado_por: 'vitor',
      aprovado_em: new Date().toISOString(),
      status: 'em_andamento',
    });

    await this.crmService.updateLead(leadId, { status: 'approved' });

    await this.outreachQueue.add('send_outreach', { leadId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  private async handleDiscard(leadId: string, query: TelegramBot.CallbackQuery) {
    await this.bot.answerCallbackQuery(query.id, { text: '❌ Lead descartado.' });

    if (query.message) {
      await this.bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      );
    }

    await this.crmService.updateLead(leadId, { status: 'descartado' });
  }

  async sendMessage(text: string) {
    if (!this.bot || !this.chatId) return;
    await this.bot.sendMessage(this.chatId, text, { parse_mode: 'Markdown' });
  }

  @Cron('0 21 * * *') // Todos os dias às 21h
  async sendDailyReport() {
    const stats = await this.crmService.getTodayStats();
    const hoje = new Date().toLocaleDateString('pt-BR');

    const msg = [
      `📊 *Relatório Fair Assist Prospecção — ${hoje}*`,
      ``,
      `🔍 Prospectados hoje: ${stats.prospectados}`,
      `✅ Enriquecidos: ${stats.enriquecidos}`,
      `📱 Testados no WA: ${stats.testados}`,
      `🔥 Aprovados: ${stats.aprovados}`,
      `📤 Mensagens enviadas: ${stats.enviados}`,
      `💬 Responderam: ${stats.respostas}`,
      `👀 Interessados: ${stats.interessados}`,
      `🎯 Convertidos total: ${stats.convertidos}`,
    ].join('\n');

    await this.sendMessage(msg);

    // Salvar no Supabase
    await this.crmService.saveRelatorio({
      data: new Date().toISOString().split('T')[0],
      leads_prospectados: stats.prospectados,
      leads_enriquecidos: stats.enriquecidos,
      leads_testados: stats.testados,
      leads_aprovados: stats.aprovados,
      mensagens_enviadas: stats.enviados,
      respostas_recebidas: stats.respostas,
      interessados: stats.interessados,
      convertidos: stats.convertidos,
    });

    this.logger.log('Relatório diário enviado');
  }

  private esc(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }
}
