import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import axios from 'axios';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ── Template store (persisted to disk) ──────────────────────────
export interface WaTemplate { id: string; nome: string; texto: string; criado_em: string; }

const TEMPLATES_FILE = path.join(process.cwd(), 'data', 'templates.json');

export class TemplateStore {
  private static load(): WaTemplate[] {
    try {
      fs.mkdirSync(path.dirname(TEMPLATES_FILE), { recursive: true });
      return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    } catch { return []; }
  }
  private static save(list: WaTemplate[]) {
    fs.mkdirSync(path.dirname(TEMPLATES_FILE), { recursive: true });
    fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(list, null, 2));
  }
  static list(): WaTemplate[] { return this.load(); }
  static get(id: string): string | null {
    return this.load().find(t => t.id === id)?.texto ?? null;
  }
  static create(nome: string, texto: string): WaTemplate {
    const list = this.load();
    const t: WaTemplate = { id: randomUUID(), nome, texto, criado_em: new Date().toISOString() };
    list.push(t);
    this.save(list);
    return t;
  }
  static delete(id: string): boolean {
    const list = this.load();
    const next = list.filter(t => t.id !== id);
    if (next.length === list.length) return false;
    this.save(next);
    return true;
  }
  static update(id: string, nome: string, texto: string): WaTemplate | null {
    const list = this.load();
    const t = list.find(t => t.id === id);
    if (!t) return null;
    t.nome = nome; t.texto = texto;
    this.save(list);
    return t;
  }
}

@Injectable()
export class WaTesterService {
  private readonly logger = new Logger(WaTesterService.name);
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Map para rastrear testes em andamento: numero → { leadId, waTestId, enviado_em }
  private pendingTests = new Map<string, { leadId: string; waTestId: string; enviadoEm: Date }>();

  constructor(
    @InjectQueue('scoring_queue') private scoringQueue: Queue,
    private crmService: CrmService,
  ) {}

  private isBusinessHours(): boolean {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=Sun, 6=Sat
    return day >= 1 && day <= 5 && hour >= 8 && hour < 22;
  }

  async sendTestMessage(leadId: string, templateId?: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`Lead ${leadId} sem WhatsApp, pulando teste`);
      await this.scoringQueue.add('score_lead', { leadId });
      return;
    }

    if (!this.isBusinessHours()) {
      this.logger.log(`Fora do horário comercial — reagendando lead ${lead.nome} para amanhã 8h`);
      const now = new Date();
      const next = new Date(now);
      next.setDate(now.getDate() + (now.getDay() === 5 ? 3 : now.getDay() === 6 ? 2 : 1));
      next.setHours(8, 0, 0, 0);
      const delay = next.getTime() - now.getTime();
      await this.scoringQueue.add('score_lead', { leadId }, { delay });
      return;
    }

    const mensagem = templateId
      ? (TemplateStore.get(templateId) ?? await this.gerarMensagemTeste())
      : await this.gerarMensagemTeste();
    const numero = this.formatNumber(lead.whatsapp);

    this.logger.log(`Enviando teste para ${lead.nome} (${numero})`);

    try {
      const waTest = await this.crmService.createWaTest({
        lead_id: leadId,
        numero_testado: numero,
        mensagem_enviada: mensagem,
        enviado_em: new Date().toISOString(),
        respondeu: false,
      });

      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        { number: numero, text: mensagem },
        {
          headers: {
            'apikey': this.evolutionKey,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

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
      }, 4 * 60 * 60 * 1000);

      await this.crmService.updateLead(leadId, { status: 'tested' });
      this.logger.log(`Mensagem de teste enviada para ${lead.nome}: "${mensagem}"`);

    } catch (err) {
      this.logger.error(`Erro ao enviar teste para ${lead.nome}: ${err.message}`);
      await this.scoringQueue.add('score_lead', { leadId });
    }
  }

  async handleWebhook(data: any) {
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

    const qualidade = await this.avaliarQualidadeResposta(messageText);

    await this.crmService.updateWaTest(pending.waTestId, {
      respondeu: true,
      respondido_em: respondidoEm.toISOString(),
      tempo_resposta_min: tempoMin,
      qualidade_resposta: qualidade,
      resposta_texto: messageText.substring(0, 500),
    });

    await this.scoringQueue.add('score_lead', { leadId: pending.leadId });
  }

  private async gerarMensagemTeste(): Promise<string> {
    const fallbacks = [
      'Oi, tudo bem? Queria saber o valor do dólar hoje pra compra. Obrigado!',
      'Boa tarde! Qual o câmbio do dólar agora? Preciso comprar alguns.',
      'Olá! Qual a taxa do dólar de vocês hoje?',
      'Oi! Estou querendo comprar dólar, qual é o valor de hoje?',
      'Olá, boa tarde! Qual o valor do dólar para turismo?',
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Gere UMA mensagem curta e natural de WhatsApp de uma pessoa querendo saber o câmbio do dólar numa casa de câmbio. A mensagem deve:
- Soar como uma pessoa real, informal
- Ser diferente cada vez (varie o horário, a razão — viagem, compra online, etc.)
- Ter entre 1 e 2 frases
- Estar em português brasileiro
- NÃO usar emojis excessivos
Retorne APENAS a mensagem, sem aspas ou explicações.`,
        }],
        max_tokens: 80,
        temperature: 1.0,
      });
      const msg = completion.choices[0].message.content?.trim();
      return msg || fallbacks[Math.floor(Math.random() * fallbacks.length)];
    } catch {
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  private async handleNoResponse(leadId: string, waTestId: string) {
    this.logger.log(`Sem resposta após 4h para lead ${leadId}`);
    await this.crmService.updateWaTest(waTestId, {
      respondeu: false,
      tempo_resposta_min: 240,
    });
    await this.scoringQueue.add('score_lead', { leadId });
  }

  private async avaliarQualidadeResposta(texto: string): Promise<number> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Avalie a qualidade desta resposta de uma casa de câmbio para a pergunta sobre cotação do dólar. Responda APENAS com um número de 0 a 100 (sem texto extra), onde: 0=sem resposta, 30=resposta muito vaga, 60=resposta com alguma informação, 80=resposta com cotação e informações úteis, 100=resposta completa com cotação, horário e contato. Resposta recebida: "${texto}"`,
        }],
      });
      const num = parseInt(response.choices[0].message.content?.trim().match(/\d+/)?.[0] || '50');
      return Math.min(100, Math.max(0, num));
    } catch {
      return 50;
    }
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1) + '@s.whatsapp.net';
    if (cleaned.startsWith('55')) return cleaned + '@s.whatsapp.net';
    return '55' + cleaned + '@s.whatsapp.net';
  }
}
