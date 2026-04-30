import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
import { MotorService } from '../motor/motor.service';
import axios from 'axios';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// ── Mystery Shop M2A/M2B config store ───────────────────────────

const MS_CONFIG_FILE = path.join(process.cwd(), 'data', 'mystery-shop-config.json');

export interface MysteryShopConfig {
  m2a_custom: string | null;
  m2b_custom: string | null;
}

export class MysteryShopConfigStore {
  private static load(): MysteryShopConfig {
    try {
      fs.mkdirSync(path.dirname(MS_CONFIG_FILE), { recursive: true });
      return JSON.parse(fs.readFileSync(MS_CONFIG_FILE, 'utf8'));
    } catch { return { m2a_custom: null, m2b_custom: null }; }
  }
  private static save(cfg: MysteryShopConfig) {
    fs.mkdirSync(path.dirname(MS_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(MS_CONFIG_FILE, JSON.stringify(cfg, null, 2));
  }
  static get(): MysteryShopConfig { return this.load(); }
  static setM2A(text: string | null) {
    const cfg = this.load(); cfg.m2a_custom = text; this.save(cfg);
  }
  static setM2B(text: string | null) {
    const cfg = this.load(); cfg.m2b_custom = text; this.save(cfg);
  }
}

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

// ── Types ──────────────────────────────────────────────────────

type MysteryPhase = 'M1' | 'M2A' | 'M2B' | 'ENG_V1' | 'ENG_V2' | 'ENG_V3';

interface MysteryEntry {
  leadId: string;
  phase: MysteryPhase;
  m1SentAt: Date;
  m2bTimer?: ReturnType<typeof setTimeout>;
  mortoTimer?: ReturnType<typeof setTimeout>;
}

@Injectable()
export class WaTesterService implements OnModuleInit {
  private readonly logger = new Logger(WaTesterService.name);
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Map principal: cleanPhone → estado do mystery shop em curso
  private pendingMysteryShop = new Map<string, MysteryEntry>();
  // Lookup secundário para @lid: nome_lower → cleanPhone
  private pendingByName = new Map<string, string>();
  // Cache @lid → cleanPhone (preenchido ao resolver o primeiro match, persiste em disco)
  private lidMap = new Map<string, string>();
  private readonly LID_MAP_FILE = path.join(process.cwd(), 'data', 'lid-map.json');

  constructor(
    @InjectQueue('mystery_shop_queue') private mysteryShopQueue: Queue,
    @InjectQueue('intelligence_queue') private intelligenceQueue: Queue,
    @InjectQueue('social_eng_queue') private socialEngQueue: Queue,
    private crmService: CrmService,
    private activity: ActivityService,
    private motor: MotorService,
  ) {}

  async onModuleInit() {
    // Carrega o mapa persistente @lid → phone do disco
    try {
      fs.mkdirSync(path.dirname(this.LID_MAP_FILE), { recursive: true });
      const raw = JSON.parse(fs.readFileSync(this.LID_MAP_FILE, 'utf8'));
      for (const [lid, phone] of Object.entries(raw)) {
        this.lidMap.set(lid, phone as string);
      }
      this.logger.log(`LidMap carregado: ${this.lidMap.size} entradas`);
    } catch { /* arquivo ainda não existe — ok */ }

    // Reconstrói pendingMysteryShop a partir de leads no banco com status ms_m1_sent/ms_m2b_sent
    const m1Leads = await this.crmService.getLeadsByStatus('ms_m1_sent');
    const m2bLeads = await this.crmService.getLeadsByStatus('ms_m2b_sent');

    let restored = 0;
    for (const lead of [...m1Leads, ...m2bLeads]) {
      if (!lead.whatsapp) continue;
      const cleanPhone = this.formatNumber(lead.whatsapp);
      const phase: MysteryPhase = lead.status === 'ms_m2b_sent' ? 'M2B' : 'M1';

      // Busca o sent_at da ultima mystery_conversation SENT do lead
      const convs = await this.crmService.getMysteryConversation(lead.id);
      const lastSent = convs.filter(c => c.direction === 'SENT').sort((a, b) =>
        new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
      )[0];
      const sentAt = lastSent ? new Date(lastSent.sent_at) : new Date(lead.criado_em);

      const entry: MysteryEntry = { leadId: lead.id, phase, m1SentAt: sentAt };
      this.pendingMysteryShop.set(cleanPhone, entry);
      this.pendingByName.set(lead.nome.toLowerCase().trim(), cleanPhone);

      // Restaura timer MORTO
      const horasMorto = phase === 'M2B' ? 12 : 18;
      const totalDelay = this.calcBusinessHoursDelay(sentAt, horasMorto);
      const elapsed = Date.now() - sentAt.getTime();
      const remaining = totalDelay - elapsed;

      if (remaining <= 0) {
        await this.marcarMorto(lead.id, cleanPhone, `Sem resposta após restart (${phase})`);
      } else {
        entry.mortoTimer = setTimeout(async () => {
          if (this.pendingMysteryShop.has(cleanPhone)) {
            this.removePending(cleanPhone);
            await this.marcarMorto(lead.id, cleanPhone, `Sem resposta após ${horasMorto}h úteis (${phase})`);
          }
        }, remaining);
        restored++;
      }
    }
    if (restored > 0) this.logger.log(`Restaurados ${restored} mystery shops pendentes do banco`);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private addPending(cleanPhone: string, leadNome: string, entry: MysteryEntry) {
    this.pendingMysteryShop.set(cleanPhone, entry);
    this.pendingByName.set(leadNome.toLowerCase().trim(), cleanPhone);
  }

  private removePending(cleanPhone: string) {
    const entry = this.pendingMysteryShop.get(cleanPhone);
    if (entry?.mortoTimer) clearTimeout(entry.mortoTimer);
    if (entry?.m2bTimer) clearTimeout(entry.m2bTimer);
    this.pendingMysteryShop.delete(cleanPhone);
    for (const [k, v] of this.pendingByName) {
      if (v === cleanPhone) { this.pendingByName.delete(k); break; }
    }
  }

  private extractMessageInfo(message: any): { text: string; isInteractive: boolean; isMedia: boolean; messageType: string } {
    const text = (message?.conversation || message?.extendedTextMessage?.text || '') as string;
    const msgType =
      message?.interactiveMessage         ? 'interactiveMessage'         :
      message?.templateButtonReplyMessage  ? 'templateButtonReplyMessage'  :
      message?.buttonsResponseMessage      ? 'buttonsResponseMessage'      :
      message?.listResponseMessage         ? 'listResponseMessage'         :
      message?.imageMessage                ? 'imageMessage'                :
      message?.audioMessage                ? 'audioMessage'                :
      message?.pttMessage                  ? 'pttMessage'                  :
      message?.videoMessage                ? 'videoMessage'                :
      message?.documentMessage             ? 'documentMessage'             :
      'text';
    const isInteractive = ['interactiveMessage', 'templateButtonReplyMessage', 'buttonsResponseMessage', 'listResponseMessage'].includes(msgType);
    const isMedia = ['imageMessage', 'audioMessage', 'pttMessage', 'videoMessage', 'documentMessage'].includes(msgType);
    return { text, isInteractive, isMedia, messageType: msgType };
  }

  private saveLidMap(lidId: string, cleanPhone: string) {
    this.lidMap.set(lidId, cleanPhone);
    try {
      fs.mkdirSync(path.dirname(this.LID_MAP_FILE), { recursive: true });
      const obj: Record<string, string> = {};
      for (const [k, v] of this.lidMap) obj[k] = v;
      fs.writeFileSync(this.LID_MAP_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
      this.logger.warn(`Falha ao salvar lid-map: ${e}`);
    }
  }

  private getBrazilDate(): Date {
    const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
    return new Date(utcMs - 3 * 3600000);
  }

  isBusinessHours(): boolean {
    const br = this.getBrazilDate();
    return br.getDay() >= 1 && br.getDay() <= 5 && br.getHours() >= 5 && br.getHours() < 22;
  }

  private async marcarMorto(leadId: string, cleanPhone: string, reason: string) {
    this.logger.log(`MORTO: lead ${leadId} — ${reason}`);
    this.activity.log('no_response', `Lead marcado como MORTO: ${reason}`);
    await this.crmService.updateLead(leadId, { status: 'morto', tag_final: 'MORTO' });
  }

  // ── Extrai número BR de um texto (para engenharia social) ────

  private extractBrazilPhone(text: string): string | null {
    const match = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/);
    if (!match) return null;
    const cleaned = match[0].replace(/\D/g, '');
    if (/^\d{10,11}$/.test(cleaned) || /^55\d{10,11}$/.test(cleaned)) return cleaned;
    return null;
  }

  // ── Envio de M1 (mystery shop inicial) ───────────────────────

  async sendM1(leadId: string, templateId?: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`Lead ${leadId} sem WhatsApp, pulando mystery shop`);
      return;
    }

    // Deduplicação: não re-envia se já tem mystery shop em curso
    const cleanNumber = this.formatNumber(lead.whatsapp);
    if (this.pendingMysteryShop.has(cleanNumber)) {
      this.logger.log(`Lead ${lead.nome} já tem mystery shop em curso — descartando duplicata`);
      return;
    }
    const skipStatuses = ['ms_m1_sent', 'ms_m2a_sent', 'ms_m2b_sent', 'ativo', 'intelligence_done',
      'eng_v1', 'eng_v2', 'eng_v3', 'briefing_done', 'morto'];
    if (skipStatuses.includes(lead.status)) {
      this.logger.log(`Lead ${lead.nome} já no status ${lead.status} — job descartado`);
      return;
    }

    // Pausa global do motor
    if (await this.motor.isPaused()) {
      this.logger.log(`Motor pausado — ${lead.nome} re-agendado para 2 min`);
      await this.mysteryShopQueue.add('send_m1', { leadId, templateId }, {
        delay: 2 * 60 * 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      return;
    }

    // Limite diário
    const maxDaily = parseInt(process.env.WA_DAILY_LIMIT || '50');
    const todayCount = await this.crmService.countTodayWaTests();
    if (todayCount >= maxDaily) {
      const br = this.getBrazilDate();
      const nextBr = new Date(br);
      nextBr.setDate(br.getDate() + 1);
      nextBr.setHours(0, 30, 0, 0);
      const delay = (nextBr.getTime() + 3 * 3600000) - Date.now();
      this.logger.log(`Limite diário atingido (${todayCount}/${maxDaily}) — reagendando ${lead.nome} para amanhã`);
      await this.mysteryShopQueue.add('send_m1', { leadId, templateId }, { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return;
    }

    // Rate limiting 7-12 min entre envios
    const now = Date.now();
    const minDelay = 7 * 60 * 1000;
    const maxDelay = 12 * 60 * 1000;
    const randomDelay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));
    const lastSentAt = await this.motor.getLastSentAt();
    const sinceLastSend = now - lastSentAt;
    if (lastSentAt > 0 && sinceLastSend < randomDelay) {
      const waitMs = randomDelay - sinceLastSend;
      this.logger.log(`Rate limit: próximo envio para ${lead.nome} em ${Math.round(waitMs / 1000)}s`);
      await this.motor.setNextLead(leadId, lead.nome);
      await this.mysteryShopQueue.add('send_m1', { leadId, templateId }, { delay: waitMs, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return;
    }

    const mensagem = templateId
      ? (TemplateStore.get(templateId) ?? await this.gerarMensagemM1(lead.cidade))
      : await this.gerarMensagemM1(lead.cidade);

    this.logger.log(`Enviando M1 para ${lead.nome} (${cleanNumber})`);
    this.activity.log('sending', `Enviando M1 para ${lead.nome} (${lead.cidade || lead.estado || ''})`, lead.nome);

    try {
      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        { number: cleanNumber, text: mensagem },
        { headers: { 'apikey': this.evolutionKey, 'Content-Type': 'application/json' }, timeout: 30000 },
      );
    } catch (err: any) {
      this.logger.warn(`Evolution API falhou para ${lead.nome}: ${err?.message} — re-agendando em 5 min`);
      this.activity.log('error', `Falha ao enviar M1 para ${lead.nome}: ${err?.message || 'Evolution API indisponível'}`, lead.nome);
      await this.mysteryShopQueue.add('send_m1', { leadId, templateId }, {
        delay: 5 * 60 * 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
      });
      return;
    }

    await this.motor.setLastSentAt(now);
    await this.motor.setLastSentLead(leadId, lead.nome);
    await this.motor.clearNextLead();

    const sentAt = new Date();
    await this.crmService.saveMysteryMessage(leadId, 'M1', 'SENT', mensagem);
    await this.crmService.updateLead(leadId, { status: 'ms_m1_sent' });

    // Também registra na wa_tests para backward compat com countTodayWaTests
    await this.crmService.createWaTest({
      lead_id: leadId,
      numero_testado: cleanNumber,
      mensagem_enviada: mensagem,
      enviado_em: sentAt.toISOString(),
      respondeu: false,
    });

    const entry: MysteryEntry = { leadId, phase: 'M1', m1SentAt: sentAt };
    this.addPending(cleanNumber, lead.nome, entry);

    // Timer M2B: [WA_M2B_DELAY_MIN] minutos sem resposta ao M1 → envia M2B
    const m2bDelayMin = parseInt(process.env.WA_M2B_DELAY_MIN || '45');
    entry.m2bTimer = setTimeout(async () => {
      const current = this.pendingMysteryShop.get(cleanNumber);
      if (current && current.phase === 'M1') {
        // Ainda sem resposta → envia M2B
        clearTimeout(current.m2bTimer);
        current.m2bTimer = undefined;
        await this.sendM2B(leadId, cleanNumber, lead.nome, lead.cidade);
      }
    }, m2bDelayMin * 60 * 1000);

    // Timer MORTO M2A: 18h úteis sem resposta ao M2A (sobrescreve se M2A chegar)
    // Será substituído por timer de 18h quando M2A for enviado.
    // Aqui configuramos timer de fallback apenas para caso M2B não seja enviado.

    this.logger.log(`M1 enviado para ${lead.nome} — aguardando resposta (M2B em ${m2bDelayMin}min)`);
    this.activity.log('sent', `M1 enviado — aguardando resposta de ${lead.nome}`, lead.nome);
  }

  // ── Envio de M2A (pergunta técnica difícil) ──────────────────

  private async sendM2A(leadId: string, cleanPhone: string, leadNome: string, cidade?: string) {
    const mensagem = await this.gerarMensagemM2A(cidade);
    this.logger.log(`Enviando M2A para ${leadNome}`);

    try {
      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        { number: cleanPhone, text: mensagem },
        { headers: { 'apikey': this.evolutionKey, 'Content-Type': 'application/json' }, timeout: 30000 },
      );
    } catch (err: any) {
      this.logger.warn(`Falha ao enviar M2A para ${leadNome}: ${err?.message}`);
      return;
    }

    const sentAt = new Date();
    await this.crmService.saveMysteryMessage(leadId, 'M2A', 'SENT', mensagem);
    await this.crmService.updateLead(leadId, { status: 'ms_m2a_sent' });

    // Atualiza phase e configura timer MORTO de 18h úteis
    const entry = this.pendingMysteryShop.get(cleanPhone);
    if (entry) {
      entry.phase = 'M2A';
      if (entry.mortoTimer) clearTimeout(entry.mortoTimer);
      entry.mortoTimer = setTimeout(async () => {
        if (this.pendingMysteryShop.has(cleanPhone)) {
          this.removePending(cleanPhone);
          await this.marcarMorto(leadId, cleanPhone, 'Sem resposta ao M2A após 18h úteis');
        }
      }, this.calcBusinessHoursDelay(sentAt, 18));
    }

    this.activity.log('sent', `M2A enviado para ${leadNome}`, leadNome);
  }

  // ── Envio de M2B (cobrança simples após 45min sem resposta) ──

  private async sendM2B(leadId: string, cleanPhone: string, leadNome: string, cidade?: string) {
    const mensagem = await this.gerarMensagemM2B();
    this.logger.log(`Enviando M2B para ${leadNome} (sem resposta ao M1)`);

    try {
      await axios.post(
        `${this.evolutionUrl}/message/sendText/${this.instance}`,
        { number: cleanPhone, text: mensagem },
        { headers: { 'apikey': this.evolutionKey, 'Content-Type': 'application/json' }, timeout: 30000 },
      );
    } catch (err: any) {
      this.logger.warn(`Falha ao enviar M2B para ${leadNome}: ${err?.message}`);
      return;
    }

    const sentAt = new Date();
    await this.crmService.saveMysteryMessage(leadId, 'M2B', 'SENT', mensagem);
    await this.crmService.updateLead(leadId, { status: 'ms_m2b_sent' });

    const entry = this.pendingMysteryShop.get(cleanPhone);
    if (entry) {
      entry.phase = 'M2B';
      if (entry.mortoTimer) clearTimeout(entry.mortoTimer);
      // Timer MORTO M2B: 12h úteis sem resposta
      entry.mortoTimer = setTimeout(async () => {
        if (this.pendingMysteryShop.has(cleanPhone)) {
          this.removePending(cleanPhone);
          await this.marcarMorto(leadId, cleanPhone, 'Sem resposta ao M2B após 12h úteis');
        }
      }, this.calcBusinessHoursDelay(sentAt, 12));
    }

    this.activity.log('sent', `M2B enviado para ${leadNome}`, leadNome);
  }

  // ── Webhook de resposta ───────────────────────────────────────

  async handleWebhook(data: any) {
    const remoteJid: string = data?.data?.key?.remoteJid || '';
    const pushName: string = data?.data?.pushName || '';
    const rawMessage = data?.data?.message || {};
    const { text: messageText, isInteractive, isMedia, messageType } = this.extractMessageInfo(rawMessage);

    if (!messageText && !isInteractive && !isMedia) return;

    let cleanPhone: string | undefined;

    if (remoteJid.endsWith('@s.whatsapp.net')) {
      cleanPhone = remoteJid.replace('@s.whatsapp.net', '');
    } else if (remoteJid.endsWith('@lid')) {
      const lidId = remoteJid.replace('@lid', '');
      cleanPhone = this.lidMap.get(lidId);
      if (!cleanPhone && pushName) {
        cleanPhone = this.pendingByName.get(pushName.toLowerCase().trim());
        if (cleanPhone) {
          this.saveLidMap(lidId, cleanPhone);
          this.logger.log(`@lid resolvido: ${lidId} → ${cleanPhone} (via pushName "${pushName}")`);
        }
      }
      if (!cleanPhone) {
        const now = Date.now();
        let bestPhone: string | undefined;
        let bestTime = 0;
        for (const [phone, entry] of this.pendingMysteryShop) {
          const elapsed = now - entry.m1SentAt.getTime();
          if (elapsed <= 2 * 60 * 60 * 1000 && entry.m1SentAt.getTime() > bestTime) {
            bestTime = entry.m1SentAt.getTime();
            bestPhone = phone;
          }
        }
        if (bestPhone) {
          this.saveLidMap(lidId, bestPhone);
          this.logger.warn(`@lid ${lidId} pushName vazio — match por proximidade temporal para ${bestPhone}`);
          cleanPhone = bestPhone;
        }
      }
    }

    if (!cleanPhone) return;
    const pending = this.pendingMysteryShop.get(cleanPhone);
    if (!pending) return;

    const lead = await this.crmService.getLeadById(pending.leadId);
    const respostaTexto = this.getRespostaTexto(messageText, messageType, isInteractive, isMedia);
    const receivedAt = new Date();
    const tempoRespostaS = Math.round((receivedAt.getTime() - pending.m1SentAt.getTime()) / 1000);

    this.logger.log(`Resposta recebida de ${pushName || cleanPhone} — fase ${pending.phase}`);

    if (pending.phase === 'M1') {
      // Cancelar timer M2B e timer MORTO
      if (pending.m2bTimer) clearTimeout(pending.m2bTimer);
      if (pending.mortoTimer) clearTimeout(pending.mortoTimer);

      await this.crmService.saveMysteryMessage(pending.leadId, 'M1', 'RECEIVED', respostaTexto, {
        tempo_resposta_s: tempoRespostaS,
        is_bot: isInteractive,
      });

      // Enviar M2A
      await this.sendM2A(pending.leadId, cleanPhone, pushName || cleanPhone, lead?.cidade);
      this.activity.log('responded', `${pushName || cleanPhone} respondeu M1 — M2A enviado`, pushName || cleanPhone);

    } else if (pending.phase === 'M2A') {
      // Cancelar timer MORTO
      if (pending.mortoTimer) clearTimeout(pending.mortoTimer);
      this.removePending(cleanPhone);

      await this.crmService.saveMysteryMessage(pending.leadId, 'M2A', 'RECEIVED', respostaTexto, {
        tempo_resposta_s: tempoRespostaS,
      });

      // Marcar ATIVO e disparar intelligence
      await this.crmService.updateLead(pending.leadId, { status: 'ativo', tag_final: 'ATIVO' });
      await this.intelligenceQueue.add('run_intelligence', { leadId: pending.leadId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      });
      this.activity.log('responded', `${pushName || cleanPhone} respondeu M2A — ATIVO, intelligence disparado`, pushName || cleanPhone);

    } else if (pending.phase === 'M2B') {
      // Cancelar timer MORTO
      if (pending.mortoTimer) clearTimeout(pending.mortoTimer);

      await this.crmService.saveMysteryMessage(pending.leadId, 'M2B', 'RECEIVED', respostaTexto, {
        tempo_resposta_s: tempoRespostaS,
      });

      // Enviar M2A (mesmo fluxo que se tivesse respondido M1)
      await this.sendM2A(pending.leadId, cleanPhone, pushName || cleanPhone, lead?.cidade);
      this.activity.log('responded', `${pushName || cleanPhone} respondeu M2B — M2A enviado`, pushName || cleanPhone);

    } else if (pending.phase === 'ENG_V1' || pending.phase === 'ENG_V2' || pending.phase === 'ENG_V3') {
      // Engenharia social — detecta número de telefone do gestor
      const gestor_phone = this.extractBrazilPhone(respostaTexto);
      await this.crmService.saveMysteryMessage(pending.leadId, pending.phase, 'RECEIVED', respostaTexto);

      if (gestor_phone) {
        this.removePending(cleanPhone);
        await this.crmService.updateLead(pending.leadId, {
          gestor_phone,
          status_numero: 'RECEBIDO',
        });

        // Disparar briefing
        const { Queue: BriefingQueue } = await import('bullmq');
        // Usamos a fila injetada diretamente — não precisa criar nova instância
        await this.socialEngQueue.add('generate_briefing_from_eng', { leadId: pending.leadId }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
        });
        this.activity.log('phone_received', `Número do gestor recebido: ${gestor_phone} — briefing disparado`, pushName || cleanPhone);
      } else {
        // Resposta sem número — cancelar timer automático e enviar para revisão manual
        const variacao = lead?.engenharia_social_variacao ?? 1;
        try {
          await this.socialEngQueue.remove(`retry_soc_eng_${pending.leadId}_v${variacao}`);
          this.logger.log(`Timer de retry_soc_eng cancelado para ${lead?.nome} (aguardando revisão manual)`);
        } catch { /* job já pode ter sido processado */ }

        await this.crmService.updateLead(pending.leadId, { status: 'eng_revisao' });
        this.activity.log('responded', `${pushName || cleanPhone} respondeu Eng V${variacao} sem número → aguardando revisão manual`, pushName || cleanPhone);
      }
    }
  }

  private getRespostaTexto(text: string, messageType: string, isInteractive: boolean, isMedia: boolean): string {
    if (text) return text.substring(0, 1000);
    const labels: Record<string, string> = {
      interactiveMessage: '[menu interativo]', templateButtonReplyMessage: '[resposta de botão]',
      buttonsResponseMessage: '[resposta de botão]', listResponseMessage: '[seleção de lista]',
      imageMessage: '[imagem]', audioMessage: '[áudio]', pttMessage: '[nota de voz]',
      videoMessage: '[vídeo]', documentMessage: '[documento]',
    };
    return labels[messageType] || `[${messageType}]`;
  }

  // Chamado pelo SocialEngineeringService para adicionar leads em fase ENG ao map
  registerSocialEngEntry(cleanPhone: string, leadNome: string, leadId: string, phase: MysteryPhase) {
    const existing = this.pendingMysteryShop.get(cleanPhone);
    if (existing) {
      existing.phase = phase;
    } else {
      const entry: MysteryEntry = { leadId, phase, m1SentAt: new Date() };
      this.addPending(cleanPhone, leadNome, entry);
    }
  }

  // ── Replay: recupera respostas perdidas do histórico ─────────

  async replayResponses(): Promise<number> {
    this.logger.log('Replay V2: buscando mensagens recebidas...');
    // Para V2, o replay apenas verifica leads em ms_m1_sent/ms_m2b_sent que possam ter
    // respondido durante downtime. Estratégia simples: recarregar o estado via onModuleInit lógic.
    // Implementação completa fica para V2.1 — por ora retorna 0 para não quebrar o endpoint.
    this.logger.warn('replayResponses: funcionalidade desabilitada temporariamente para V2');
    return 0;
  }

  // ── Geração de mensagens via OpenAI ──────────────────────────

  private async gerarMensagemM1(cidade?: string): Promise<string> {
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
          content: `Gere UMA mensagem curta e natural de WhatsApp de uma pessoa querendo saber o câmbio do dólar numa casa de câmbio${cidade ? ` em ${cidade}` : ''}. A mensagem deve:
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
      return completion.choices[0].message.content?.trim() || fallbacks[Math.floor(Math.random() * fallbacks.length)];
    } catch {
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  private async gerarMensagemM2A(cidade?: string): Promise<string> {
    const custom = MysteryShopConfigStore.get().m2a_custom;
    if (custom?.trim()) return custom.trim();
    const fallbacks = [
      'E pra euro, qual é a taxa de vocês hoje? Tô comparando algumas casas antes de decidir.',
      'Vocês também fazem câmbio de libra? Qual seria o valor hoje?',
      'E se eu quiser fazer em dinheiro físico, tem diferença na taxa?',
      'Vocês têm taxa mínima pra transação? Perguntando porque vou comprar uns 300 dólares.',
    ];
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Você está fazendo mystery shopping numa casa de câmbio. Acabou de perguntar sobre câmbio de dólar e precisa agora fazer uma SEGUNDA pergunta técnica mais difícil para avaliar o atendimento.
A pergunta deve:
- Ser sobre câmbio (euro, libra, quantidade mínima, spread, taxa de conversão, prazo de entrega, etc.)
- Soar natural, como um cliente real indo mais fundo
- Ser 1 frase curta
- Em português brasileiro informal
Retorne APENAS a pergunta, sem aspas ou explicações.`,
        }],
        max_tokens: 80,
        temperature: 0.9,
      });
      return completion.choices[0].message.content?.trim() || fallbacks[Math.floor(Math.random() * fallbacks.length)];
    } catch {
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  private async gerarMensagemM2B(): Promise<string> {
    const custom = MysteryShopConfigStore.get().m2b_custom;
    if (custom?.trim()) return custom.trim();
    const fallbacks = [
      'Oi, me desculpe incomodar! Ainda está disponível o câmbio do dólar?',
      'Olá! Vocês estão atendendo hoje? Queria saber a taxa do dólar.',
      'Tudo bem? Perguntei antes sobre o dólar, vocês conseguem me responder?',
    ];
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Você enviou uma mensagem pra uma casa de câmbio perguntando sobre dólar, mas não recebeu resposta. Escreva uma mensagem de follow-up simples e natural para cobrar a resposta.
A mensagem deve:
- Ser gentil e não agressiva
- Ser curta (1 frase)
- Em português brasileiro informal
Retorne APENAS a mensagem, sem aspas ou explicações.`,
        }],
        max_tokens: 60,
        temperature: 0.9,
      });
      return completion.choices[0].message.content?.trim() || fallbacks[Math.floor(Math.random() * fallbacks.length)];
    } catch {
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  // Calcula quantos ms de calendário equivalem a N horas úteis (seg-sex, 5h-22h no Brasil UTC-3)
  calcBusinessHoursDelay(from: Date, businessHours: number): number {
    let remainingMin = businessHours * 60;
    const toBrazilMs = (d: Date) => d.getTime() - d.getTimezoneOffset() * 60000 - 3 * 3600000;
    const fromBrMs = toBrazilMs(from);
    let current = new Date(fromBrMs);
    let totalMs = 0;
    const BIZ_START = 5 * 60;
    const BIZ_END   = 22 * 60;

    while (remainingMin > 0) {
      const day = current.getDay();
      const currentMin = current.getHours() * 60 + current.getMinutes();

      if (day === 0 || day === 6) {
        const daysToMon = day === 0 ? 1 : 2;
        const next = new Date(current);
        next.setDate(next.getDate() + daysToMon);
        next.setHours(5, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else if (currentMin < BIZ_START) {
        const next = new Date(current);
        next.setHours(5, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else if (currentMin >= BIZ_END) {
        const daysToAdd = day === 5 ? 3 : 1;
        const next = new Date(current);
        next.setDate(next.getDate() + daysToAdd);
        next.setHours(5, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else {
        const minLeftToday = BIZ_END - currentMin;
        if (remainingMin <= minLeftToday) {
          totalMs += remainingMin * 60 * 1000;
          remainingMin = 0;
        } else {
          totalMs += minLeftToday * 60 * 1000;
          remainingMin -= minLeftToday;
          current = new Date(current.getTime() + minLeftToday * 60 * 1000);
        }
      }
    }
    return totalMs;
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1);
    if (cleaned.startsWith('55')) return cleaned;
    return '55' + cleaned;
  }
}
