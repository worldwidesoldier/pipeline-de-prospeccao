import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import axios from 'axios';

@Injectable()
export class WaTesterService {
  private readonly logger = new Logger(WaTesterService.name);
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'https://evolution-api-fy3c.onrender.com';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;
  private readonly ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  private readonly ollamaModel = process.env.OLLAMA_MODEL || 'llama3';

  // Map para rastrear testes em andamento: numero → { leadId, waTestId, enviado_em }
  private pendingTests = new Map<string, { leadId: string; waTestId: string; enviadoEm: Date }>();

  constructor(
    @InjectQueue('scoring_queue') private scoringQueue: Queue,
    private crmService: CrmService,
  ) {}

  async sendTestMessage(leadId: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`Lead ${leadId} sem WhatsApp, pulando teste`);
      await this.scoringQueue.add('score_lead', { leadId });
      return;
    }

    const mensagem = 'Oi, tudo bem? Queria saber o valor do dólar hoje pra compra. Obrigado!';
    const numero = this.formatNumber(lead.whatsapp);

    this.logger.log(`Enviando teste para ${lead.nome} (${numero})`);

    try {
      // Criar registro do teste
      const waTest = await this.crmService.createWaTest({
        lead_id: leadId,
        numero_testado: numero,
        mensagem_enviada: mensagem,
        enviado_em: new Date().toISOString(),
        respondeu: false,
      });

      // Enviar via Evolution API
      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        {
          number: numero,
          text: mensagem,
        },
        {
          headers: {
            'apikey': this.evolutionKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      // Registrar como teste pendente
      this.pendingTests.set(numero, {
        leadId,
        waTestId: waTest.id,
        enviadoEm: new Date(),
      });

      // Agendar timeout de 4h para registrar não-resposta
      setTimeout(async () => {
        if (this.pendingTests.has(numero)) {
          this.pendingTests.delete(numero);
          await this.handleNoResponse(leadId, waTest.id);
        }
      }, 4 * 60 * 60 * 1000); // 4 horas

      await this.crmService.updateLead(leadId, { status: 'tested' });
      this.logger.log(`Mensagem de teste enviada para ${lead.nome}`);

    } catch (err) {
      this.logger.error(`Erro ao enviar teste para ${lead.nome}: ${err.message}`);
      // Mesmo com erro, manda para scoring (sem dados de WA)
      await this.scoringQueue.add('score_lead', { leadId });
    }
  }

  async handleWebhook(data: any) {
    // Webhook recebe mensagens de resposta via Evolution API
    const fromNumber = data?.data?.key?.remoteJid?.replace('@s.whatsapp.net', '');
    const messageText = data?.data?.message?.conversation ||
                        data?.data?.message?.extendedTextMessage?.text || '';

    if (!fromNumber || !messageText) return;

    const pending = this.pendingTests.get(fromNumber);
    if (!pending) return;

    this.pendingTests.delete(fromNumber);

    const respondidoEm = new Date();
    const tempoMin = Math.round(
      (respondidoEm.getTime() - pending.enviadoEm.getTime()) / 60000
    );

    this.logger.log(`Resposta recebida de ${fromNumber} em ${tempoMin}min`);

    // Avaliar qualidade da resposta com Ollama
    const qualidade = await this.avaliarQualidadeResposta(messageText);

    // Atualizar wa_test
    await this.crmService.updateWaTest(pending.waTestId, {
      respondeu: true,
      respondido_em: respondidoEm.toISOString(),
      tempo_resposta_min: tempoMin,
      qualidade_resposta: qualidade,
      resposta_texto: messageText.substring(0, 500),
    });

    // Avançar para scoring
    await this.scoringQueue.add('score_lead', { leadId: pending.leadId });
  }

  private async handleNoResponse(leadId: string, waTestId: string) {
    this.logger.log(`Sem resposta após 4h para lead ${leadId}`);

    await this.crmService.updateWaTest(waTestId, {
      respondeu: false,
      tempo_resposta_min: 240, // 4h = 240min (não respondeu)
    });

    await this.scoringQueue.add('score_lead', { leadId });
  }

  private async avaliarQualidadeResposta(texto: string): Promise<number> {
    try {
      const response = await axios.post(`${this.ollamaUrl}/api/generate`, {
        model: this.ollamaModel,
        prompt: `Avalie a qualidade desta resposta de uma casa de câmbio para a pergunta sobre cotação do dólar. Responda APENAS com um número de 0 a 100 (sem texto extra), onde: 0=sem resposta, 30=resposta muito vaga, 60=resposta com alguma informação, 80=resposta com cotação e informações úteis, 100=resposta completa com cotação, horário e contato. Resposta recebida: "${texto}"`,
        stream: false,
      }, { timeout: 20000 });

      const num = parseInt(response.data.response.trim().match(/\d+/)?.[0] || '50');
      return Math.min(100, Math.max(0, num));
    } catch {
      return 50; // Score médio em caso de erro
    }
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1) + '@s.whatsapp.net';
    if (cleaned.startsWith('55')) return cleaned + '@s.whatsapp.net';
    return '55' + cleaned + '@s.whatsapp.net';
  }
}
