import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
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
export class WaTesterService implements OnModuleInit {
  private readonly logger = new Logger(WaTesterService.name);
  private readonly evolutionUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly evolutionKey = process.env.EVOLUTION_API_KEY;
  private readonly instance = process.env.EVOLUTION_INSTANCE_PROSPECCAO;
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Map principal: cleanPhone (sem @...) → dados do teste pendente
  private pendingTests = new Map<string, { leadId: string; waTestId: string; enviadoEm: Date }>();
  // Lookup secundário para @lid: nome_lower → cleanPhone
  private pendingByName = new Map<string, string>();
  // Cache @lid → cleanPhone (preenchido ao resolver o primeiro match, persiste em disco)
  private lidMap = new Map<string, string>();
  // Arquivo de mapa persistente: sobrevive a restarts
  private readonly LID_MAP_FILE = path.join(process.cwd(), 'data', 'lid-map.json');
  // Timestamp do último envio — rate limiting interno
  private lastSentAt: number = 0;

  constructor(
    @InjectQueue('scoring_queue') private scoringQueue: Queue,
    @InjectQueue('wa_test_queue') private waTestQueue: Queue,
    private crmService: CrmService,
    private activity: ActivityService,
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

    // Reconstrói pendingTests a partir do banco para sobreviver a restarts
    const pending = await this.crmService.getPendingWaTests();
    let restored = 0;
    for (const row of pending) {
      const enviadoEm = new Date(row.enviado_em);
      const totalDelay = this.calcBusinessHoursDelay(enviadoEm, 18);
      const elapsed = Date.now() - enviadoEm.getTime();
      const remaining = totalDelay - elapsed;

      if (remaining <= 0) {
        // Janela de 18h úteis já expirou durante o downtime — processar imediatamente
        await this.handleNoResponse(row.lead_id, row.id);
      } else {
        const cleanNumber = row.numero_testado.replace('@s.whatsapp.net', '').replace(/[^\d]/g, '');
        const entry = { leadId: row.lead_id, waTestId: row.id, enviadoEm };

        // Indexar por phone
        this.pendingTests.set(cleanNumber, entry);

        // Indexar por nome para @lid matching
        const lead = await this.crmService.getLeadById(row.lead_id);
        if (lead) {
          this.pendingByName.set(lead.nome.toLowerCase().trim(), cleanNumber);
        }

        setTimeout(async () => {
          if (this.pendingTests.has(cleanNumber)) {
            this.removePending(cleanNumber);
            await this.handleNoResponse(row.lead_id, row.id);
          }
        }, remaining);
        restored++;
      }
    }
    if (restored > 0) this.logger.log(`Restaurados ${restored} testes pendentes do banco`);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private addPending(cleanPhone: string, leadNome: string, entry: { leadId: string; waTestId: string; enviadoEm: Date }) {
    this.pendingTests.set(cleanPhone, entry);
    this.pendingByName.set(leadNome.toLowerCase().trim(), cleanPhone);
  }

  private removePending(cleanPhone: string) {
    this.pendingTests.delete(cleanPhone);
    for (const [k, v] of this.pendingByName) {
      if (v === cleanPhone) { this.pendingByName.delete(k); break; }
    }
  }

  // Extrai texto e detecta tipo de mensagem (inclui respostas não-texto como menus e mídia)
  private extractMessageInfo(message: any): { text: string; isInteractive: boolean; isMedia: boolean; messageType: string } {
    const text = (message?.conversation || message?.extendedTextMessage?.text || '') as string;
    const msgType =
      message?.interactiveMessage         ? 'interactiveMessage'        :
      message?.templateButtonReplyMessage  ? 'templateButtonReplyMessage' :
      message?.buttonsResponseMessage      ? 'buttonsResponseMessage'     :
      message?.listResponseMessage         ? 'listResponseMessage'        :
      message?.imageMessage                ? 'imageMessage'               :
      message?.audioMessage                ? 'audioMessage'               :
      message?.pttMessage                  ? 'pttMessage'                 :
      message?.videoMessage                ? 'videoMessage'               :
      message?.documentMessage             ? 'documentMessage'            :
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

  // Retorna o horário atual no fuso do Brasil (UTC-3)
  private getBrazilDate(): Date {
    const utcMs = Date.now() + new Date().getTimezoneOffset() * 60000;
    return new Date(utcMs - 3 * 3600000);
  }

  private isBusinessHours(): boolean {
    const br = this.getBrazilDate();
    return br.getDay() >= 1 && br.getDay() <= 5 && br.getHours() >= 8 && br.getHours() < 22;
  }

  // ── Envio de mensagem de teste ────────────────────────────────

  async sendTestMessage(leadId: string, templateId?: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead || !lead.whatsapp) {
      this.logger.warn(`Lead ${leadId} sem WhatsApp, pulando teste`);
      await this.scoringQueue.add('score_lead', { leadId });
      return;
    }

    if (!this.isBusinessHours()) {
      // Calcula delay até próximo dia útil 8h no horário do Brasil
      const br = this.getBrazilDate();
      const brDay = br.getDay();
      const daysToAdd = brDay === 5 ? 3 : brDay === 6 ? 2 : 1; // sex→seg, sáb→seg, resto→+1
      const nextBr = new Date(br);
      nextBr.setDate(br.getDate() + daysToAdd);
      nextBr.setHours(8, 0, 0, 0);
      // Converte de volta para UTC real (adiciona 3h de offset Brazil→UTC)
      const nextUtcMs = nextBr.getTime() + 3 * 3600000;
      const delay = nextUtcMs - Date.now();
      this.logger.log(`Fora do horário BR — reagendando ${lead.nome} para ${nextBr.toLocaleString('pt-BR')}`);
      await this.waTestQueue.add('test_whatsapp', { leadId, templateId }, { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return;
    }

    // Limite diário: máximo WA_DAILY_LIMIT mensagens de teste por dia (padrão 20)
    const maxDaily = parseInt(process.env.WA_DAILY_LIMIT || '20');
    const todayCount = await this.crmService.countTodayWaTests();
    if (todayCount >= maxDaily) {
      const br = this.getBrazilDate();
      const brDay = br.getDay();
      const daysToAdd = brDay === 5 ? 3 : brDay === 6 ? 2 : 1;
      const nextBr = new Date(br);
      nextBr.setDate(br.getDate() + daysToAdd);
      nextBr.setHours(8, 30, 0, 0);
      const nextUtcMs = nextBr.getTime() + 3 * 3600000;
      const delay = nextUtcMs - Date.now();
      this.logger.log(`Limite diário atingido (${todayCount}/${maxDaily}) — reagendando ${lead.nome} para amanhã`);
      await this.waTestQueue.add('test_whatsapp', { leadId, templateId }, { delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return;
    }

    // Rate limiting interno: intervalo aleatório 7-12 min entre envios (anti-ban)
    const now = Date.now();
    const minDelay = 7 * 60 * 1000;
    const maxDelay = 12 * 60 * 1000;
    const randomDelay = minDelay + Math.floor(Math.random() * (maxDelay - minDelay));
    const sinceLastSend = now - this.lastSentAt;
    if (this.lastSentAt > 0 && sinceLastSend < randomDelay) {
      const waitMs = randomDelay - sinceLastSend;
      this.logger.log(`Rate limit: próximo envio para ${lead.nome} em ${Math.round(waitMs / 1000)}s`);
      await this.waTestQueue.add('test_whatsapp', { leadId, templateId }, { delay: waitMs, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      return;
    }
    this.lastSentAt = now;

    const mensagem = templateId
      ? (TemplateStore.get(templateId) ?? await this.gerarMensagemTeste())
      : await this.gerarMensagemTeste();
    const numero = this.formatNumber(lead.whatsapp);

    this.logger.log(`Enviando teste para ${lead.nome} (${numero})`);
    this.activity.log('sending', `Enviando mensagem para ${lead.nome} (${lead.cidade || lead.estado || ''})`, lead.nome);

    // Envia primeiro — só cria o registro se o envio der certo
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
    // Se axios jogar erro, propaga — Bull vai retentar (attempts: 3, backoff exponencial)

    const enviadoEm = new Date();
    const waTest = await this.crmService.createWaTest({
      lead_id: leadId,
      numero_testado: numero,
      mensagem_enviada: mensagem,
      enviado_em: enviadoEm.toISOString(),
      respondeu: false,
    });

    // Chave limpa (só dígitos) — deve bater com o fromNumber do webhook e com @lid lookup
    const cleanNumber = numero.replace('@s.whatsapp.net', '');
    const entry = { leadId, waTestId: waTest.id, enviadoEm };
    this.addPending(cleanNumber, lead.nome, entry);

    // Agendar timeout de 18h úteis (seg-sex, 8h-22h) para registrar não-resposta
    const delay = this.calcBusinessHoursDelay(enviadoEm, 18);
    setTimeout(async () => {
      if (this.pendingTests.has(cleanNumber)) {
        this.removePending(cleanNumber);
        await this.handleNoResponse(leadId, waTest.id);
      }
    }, delay);

    await this.crmService.updateLead(leadId, { status: 'tested' });
    this.logger.log(`Mensagem de teste enviada para ${lead.nome}: "${mensagem}"`);
    this.activity.log('sent', `Mensagem enviada — aguardando resposta de ${lead.nome}`, lead.nome);
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
      // Tenta cache lidMap primeiro (já visto antes)
      cleanPhone = this.lidMap.get(lidId);
      // Fallback: match por pushName (nome da empresa)
      if (!cleanPhone && pushName) {
        cleanPhone = this.pendingByName.get(pushName.toLowerCase().trim());
        if (cleanPhone) {
          this.saveLidMap(lidId, cleanPhone);
          this.logger.log(`@lid resolvido: ${lidId} → ${cleanPhone} (via pushName "${pushName}")`);
        }
      }
      // Fallback final: pushName vazio — match pelo teste pendente enviado mais recentemente (≤2h)
      // WA Business pode responder de @lid com pushName vazio (ex: mensagens automáticas de atendimento)
      if (!cleanPhone) {
        const now = Date.now();
        let bestPhone: string | undefined;
        let bestTime = 0;
        for (const [phone, entry] of this.pendingTests) {
          const elapsed = now - entry.enviadoEm.getTime();
          if (elapsed <= 2 * 60 * 60 * 1000 && entry.enviadoEm.getTime() > bestTime) {
            bestTime = entry.enviadoEm.getTime();
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
    const pending = this.pendingTests.get(cleanPhone);
    if (!pending) return;

    this.removePending(cleanPhone);

    const respondidoEm = new Date();
    const tempoMin = Math.round(
      (respondidoEm.getTime() - pending.enviadoEm.getTime()) / 60000
    );

    const leadNome = pushName || cleanPhone;
    this.logger.log(`Resposta recebida de ${leadNome} (${remoteJid}) em ${tempoMin}min`);

    // Avalia qualidade e detecção de bot conforme tipo de mensagem
    let qualidade = 0;
    let isBot = false;
    let respostaTexto: string;

    if (isInteractive) {
      // WA Business enviou menu interativo automático → bot
      isBot = true;
      const interactiveLabels: Record<string, string> = {
        interactiveMessage: '[menu interativo]',
        templateButtonReplyMessage: '[resposta de botão]',
        buttonsResponseMessage: '[resposta de botão]',
        listResponseMessage: '[seleção de lista]',
      };
      respostaTexto = interactiveLabels[messageType] || `[${messageType}]`;
    } else if (isMedia && !messageText) {
      // Lead enviou imagem/áudio/vídeo sem texto → resposta humana
      const mediaLabels: Record<string, string> = {
        imageMessage: '[imagem]', audioMessage: '[áudio]',
        pttMessage: '[nota de voz]', videoMessage: '[vídeo]', documentMessage: '[documento]',
      };
      respostaTexto = mediaLabels[messageType] || '[mídia]';
      qualidade = 60; // resposta humana por mídia tem valor mínimo de qualidade
    } else {
      const result = await this.avaliarQualidadeResposta(messageText);
      qualidade = result.qualidade;
      isBot = result.isBot;
      respostaTexto = messageText;
    }

    if (isBot) {
      this.logger.log(`Bot detectado em ${leadNome} — descartando lead ${pending.leadId}`);
      this.activity.log('bot', `Bot detectado — descartando ${leadNome}`);
      await this.crmService.updateWaTest(pending.waTestId, {
        respondeu: true,
        respondido_em: respondidoEm.toISOString(),
        tempo_resposta_min: tempoMin,
        qualidade_resposta: 0,
        resposta_texto: respostaTexto.substring(0, 500),
        is_bot: true,
      });
      await this.crmService.updateLead(pending.leadId, { status: 'descartado_bot' });
      return;
    }

    await this.crmService.updateWaTest(pending.waTestId, {
      respondeu: true,
      respondido_em: respondidoEm.toISOString(),
      tempo_resposta_min: tempoMin,
      qualidade_resposta: qualidade,
      resposta_texto: respostaTexto.substring(0, 500),
      is_bot: false,
    });

    this.activity.log('responded', `${leadNome} respondeu em ${tempoMin}min — qualidade ${qualidade}/100`);
    await this.scoringQueue.add('score_lead', { leadId: pending.leadId });
  }

  // ── Replay: recupera respostas perdidas do histórico ─────────

  async replayResponses(): Promise<number> {
    this.logger.log('Iniciando replay de respostas perdidas...');

    // Busca TODAS as mensagens recebidas do Evolution API (todas as páginas)
    let messages: any[] = [];
    try {
      let page = 1;
      while (true) {
        const res = await axios.post(
          `${this.evolutionUrl}/chat/findMessages/${this.instance}`,
          { where: { key: { fromMe: false } }, limit: 100, page },
          { headers: { 'apikey': this.evolutionKey }, timeout: 30000 },
        );
        const data = res.data;
        const records = Array.isArray(data) ? data : (data?.messages?.records || []);
        messages.push(...records);
        const totalPages = data?.messages?.pages || 1;
        if (page >= totalPages || !records.length) break;
        page++;
      }
    } catch (err: any) {
      this.logger.error('Erro ao buscar mensagens para replay:', err.message);
      return 0;
    }

    this.logger.log(`Replay: ${messages.length} mensagens recebidas encontradas`);

    // Ordena por timestamp crescente — captura a 1ª resposta, não a última
    messages.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

    const pendingRows = await this.crmService.getAllNoResponseWaTests();
    if (!pendingRows.length) {
      this.logger.log('Nenhum teste sem resposta para verificar');
      return 0;
    }

    const skipStatuses = new Set(['approved', 'outreach', 'convertido', 'descartado', 'descartado_bot']);
    const byPhone = new Map<string, { waTestId: string; leadId: string; enviadoEm: Date }>();
    const byName: Array<{ key: string; waTestId: string; leadId: string; enviadoEm: Date }> = [];

    for (const row of pendingRows) {
      const lead = await this.crmService.getLeadById(row.lead_id);
      const cleanPhone = row.numero_testado.replace('@s.whatsapp.net', '').replace(/[^\d]/g, '');
      const enviadoEm = new Date(row.enviado_em);
      if (lead && !skipStatuses.has(lead.status)) {
        byPhone.set(cleanPhone, { waTestId: row.id, leadId: row.lead_id, enviadoEm });
        byName.push({ key: lead.nome.toLowerCase().trim(), waTestId: row.id, leadId: row.lead_id, enviadoEm });
      }
    }

    const MAX_RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;
    const commonWords = new Set(['câmbio', 'turismo', 'house', 'exchange', 'money', 'cambio']);
    const distinctiveWord = (str: string) =>
      str.split(/[\s|/-]+/).find(w => w.length >= 5 && !commonWords.has(w)) || '';

    // ── Fase 1: acumula TODAS as mensagens por waTestId ──────────
    // Uma lead pode ter: bot auto-resposta (1s) + resposta humana (30min depois)
    // Precisamos coletar tudo para escolher a melhor resposta na fase 2.
    const MEDIA_LABELS: Record<string, string> = {
      interactiveMessage: '[menu interativo]', templateButtonReplyMessage: '[resposta de botão]',
      buttonsResponseMessage: '[resposta de botão]', listResponseMessage: '[seleção de lista]',
      imageMessage: '[imagem]', audioMessage: '[áudio]', pttMessage: '[nota de voz]',
      videoMessage: '[vídeo]', documentMessage: '[documento]',
    };
    type MsgEntry = { timestamp: Date; messageText: string; messageType: string; isInteractive: boolean; isMedia: boolean; pushName: string; jid: string; waTestId: string; leadId: string; enviadoEm: Date };
    const accumulated = new Map<string, MsgEntry[]>();
    const claimedMsgIdx = new Set<number>(); // evita que a mesma mensagem match 2 waTests

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const jid: string = msg.key?.remoteJid || '';
      const pushName: string = (msg.pushName || '').toLowerCase().trim();
      const { text: messageText, isInteractive, isMedia, messageType } = this.extractMessageInfo(msg.message);
      const timestamp = new Date((msg.messageTimestamp || 0) * 1000);

      if (!messageText && !isInteractive && !isMedia) continue;

      let waTestId: string | undefined;
      let leadId: string | undefined;
      let enviadoEm: Date | undefined;

      if (jid.endsWith('@s.whatsapp.net')) {
        const cleanPhone = jid.replace('@s.whatsapp.net', '');
        const e = byPhone.get(cleanPhone);
        const elapsed = timestamp.getTime() - (e?.enviadoEm.getTime() || 0);
        if (e && timestamp > e.enviadoEm && elapsed <= MAX_RESPONSE_WINDOW_MS) {
          waTestId = e.waTestId; leadId = e.leadId; enviadoEm = e.enviadoEm;
        }
      } else if (jid.endsWith('@lid')) {
        // 0) Match por lidMap persistente (@lid já visto e mapeado para phone)
        const lidId = jid.replace('@lid', '');
        const knownPhone = this.lidMap.get(lidId);
        if (knownPhone) {
          const e = byPhone.get(knownPhone);
          const elapsed = timestamp.getTime() - (e?.enviadoEm.getTime() || 0);
          if (e && timestamp > e.enviadoEm && elapsed <= MAX_RESPONSE_WINDOW_MS) {
            waTestId = e.waTestId; leadId = e.leadId; enviadoEm = e.enviadoEm;
          }
        }
        // 1) Match por pushName (fuzzy) — quando lidMap não tem esse @lid ainda
        if (!waTestId && pushName) {
          for (const item of byName) {
            if (timestamp <= item.enviadoEm) continue;
            const elapsed = timestamp.getTime() - item.enviadoEm.getTime();
            if (elapsed > MAX_RESPONSE_WINDOW_MS) continue;
            const nomeLower = item.key;
            const pushToken = distinctiveWord(pushName);
            const nomeToken = distinctiveWord(nomeLower);
            if (
              nomeLower.includes(pushName) ||
              (pushToken.length >= 5 && nomeLower.includes(pushToken)) ||
              (nomeToken.length >= 5 && pushName.includes(nomeToken))
            ) {
              waTestId = item.waTestId; leadId = item.leadId; enviadoEm = item.enviadoEm;
              break;
            }
          }
        }
        // Nota: NÃO usar time-proximity no replay — histórico tem mensagens de múltiplas
        // empresas na mesma janela de tempo, causando false positives. Time-proximity
        // só é confiável no webhook ao vivo (handleWebhook), não em replay histórico.
      }

      if (!waTestId || !leadId || !enviadoEm) continue;
      if (claimedMsgIdx.has(i)) continue;
      claimedMsgIdx.add(i);

      if (!accumulated.has(waTestId)) accumulated.set(waTestId, []);
      accumulated.get(waTestId)!.push({ timestamp, messageText, messageType, isInteractive, isMedia, pushName, jid, waTestId, leadId, enviadoEm });
    }

    // ── Fase 2: processa o melhor conjunto de respostas por waTestId ──
    // Se há bot + humano, prefere humano. Usa 1ª msg para tempo_resposta_min.
    let count = 0;
    for (const [waTestId, msgs] of accumulated) {
      const firstMsg = msgs[0]; // mensagens já ordenadas por timestamp
      const tempoMin = Math.max(1, Math.round(
        (firstMsg.timestamp.getTime() - firstMsg.enviadoEm.getTime()) / 60000
      ));

      // Avalia cada mensagem, para na primeira não-bot
      let bestMsg = firstMsg;
      let bestQualidade = 0;
      let bestIsBot = true;

      for (const m of msgs) {
        let qualidade = 0;
        let isBot = false;
        if (m.isInteractive) {
          isBot = true; // menu WA Business = bot automático
        } else if (m.isMedia && !m.messageText) {
          isBot = false; // imagem/áudio/vídeo enviado pelo lead = resposta humana
          qualidade = 60;
        } else {
          const result = await this.avaliarQualidadeResposta(m.messageText);
          qualidade = result.qualidade;
          isBot = result.isBot;
        }
        if (!isBot) {
          bestMsg = m;
          bestQualidade = qualidade;
          bestIsBot = false;
          break;
        }
        bestQualidade = qualidade; // guarda qualidade do bot
      }

      const firstLabel = firstMsg.messageText || MEDIA_LABELS[firstMsg.messageType] || `[${firstMsg.messageType}]`;
      const bestLabel  = bestMsg.messageText  || MEDIA_LABELS[bestMsg.messageType]  || `[${bestMsg.messageType}]`;
      this.logger.log(`Replay: ${bestMsg.pushName || bestMsg.jid} — ${msgs.length} msg(s), ${tempoMin}min, isBot=${bestIsBot} — "${bestLabel.substring(0, 60)}"`);

      if (bestIsBot) {
        await this.crmService.updateWaTest(waTestId, {
          respondeu: true, respondido_em: firstMsg.timestamp.toISOString(),
          tempo_resposta_min: tempoMin, qualidade_resposta: 0,
          resposta_texto: firstLabel.substring(0, 500), is_bot: true,
        });
        await this.crmService.updateLead(firstMsg.leadId, { status: 'descartado_bot' });
        this.activity.log('bot', `[Replay] Bot detectado — ${firstMsg.pushName || firstMsg.jid} descartado`);
      } else {
        await this.crmService.updateWaTest(waTestId, {
          respondeu: true, respondido_em: firstMsg.timestamp.toISOString(),
          tempo_resposta_min: tempoMin, qualidade_resposta: bestQualidade,
          resposta_texto: bestLabel.substring(0, 500), is_bot: false,
        });
        await this.scoringQueue.add('score_lead', { leadId: bestMsg.leadId });
        this.activity.log('responded', `[Replay] ${bestMsg.pushName || bestMsg.jid} respondeu em ${tempoMin}min — qualidade ${bestQualidade}/100`);
      }
      count++;
    }

    this.logger.log(`Replay concluído: ${count} respostas recuperadas de ${messages.length} mensagens`);
    return count;
  }

  // ── Geração de mensagem e avaliação ──────────────────────────

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
    this.logger.log(`Sem resposta após 18h úteis para lead ${leadId}`);
    this.activity.log('no_response', `Sem resposta após 18h — seguindo para score`);
    await this.crmService.updateWaTest(waTestId, {
      respondeu: false,
      tempo_resposta_min: 18 * 60,
    });
    await this.scoringQueue.add('score_lead', { leadId });
  }

  // Calcula quantos ms de calendário equivalem a N horas úteis (seg-sex, 8h-22h no Brasil UTC-3)
  private calcBusinessHoursDelay(from: Date, businessHours: number): number {
    let remainingMin = businessHours * 60;
    // Trabalha em horário Brasil (UTC-3)
    const toBrazilMs = (d: Date) => d.getTime() - d.getTimezoneOffset() * 60000 - 3 * 3600000;
    const fromBrMs = toBrazilMs(from);
    let current = new Date(fromBrMs); // representa horário BR em Date local
    let totalMs = 0;
    const BIZ_START = 8 * 60;  // 480 min
    const BIZ_END   = 22 * 60; // 1320 min

    while (remainingMin > 0) {
      const day = current.getDay();
      const currentMin = current.getHours() * 60 + current.getMinutes();

      if (day === 0 || day === 6) {
        // Final de semana → pular para segunda 8h
        const daysToMon = day === 0 ? 1 : 2;
        const next = new Date(current);
        next.setDate(next.getDate() + daysToMon);
        next.setHours(8, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else if (currentMin < BIZ_START) {
        // Antes das 8h → pular para 8h
        const next = new Date(current);
        next.setHours(8, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else if (currentMin >= BIZ_END) {
        // Após 22h → pular para próximo dia útil 8h
        const daysToAdd = day === 5 ? 3 : 1; // sexta → segunda
        const next = new Date(current);
        next.setDate(next.getDate() + daysToAdd);
        next.setHours(8, 0, 0, 0);
        totalMs += next.getTime() - current.getTime();
        current = next;
      } else {
        // Dentro do horário comercial
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

  private async avaliarQualidadeResposta(texto: string): Promise<{ qualidade: number; isBot: boolean }> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Avalie a resposta de uma casa de câmbio sobre cotação do dólar. Responda APENAS com JSON válido no formato: {"qualidade": N, "is_bot": B}

Onde:
- N = 0 a 100: 0=vaga/inútil, 60=com alguma info, 80=cotação + info útil, 100=completa com cotação, horário e contato
- B = true se parece mensagem automática de bot/sistema (menus numerados, "olá seja bem-vindo", "clique 1 para", "para mais opções", saudações genéricas sem cotação), false se parece humano

Resposta recebida: "${texto}"`,
        }],
        response_format: { type: 'json_object' },
      });
      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const qualidade = Math.min(100, Math.max(0, parseInt(parsed.qualidade ?? 50)));
      const isBot = parsed.is_bot === true;
      return { qualidade, isBot };
    } catch {
      return { qualidade: 50, isBot: false };
    }
  }

  private formatNumber(numero: string): string {
    const cleaned = numero.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned.substring(1) + '@s.whatsapp.net';
    if (cleaned.startsWith('55')) return cleaned + '@s.whatsapp.net';
    return '55' + cleaned + '@s.whatsapp.net';
  }
}
