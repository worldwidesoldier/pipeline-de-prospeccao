import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';
import { MotorService } from '../motor/motor.service';
import OpenAI from 'openai';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectQueue('enrichment_queue') private enrichmentQueue: Queue,
    @InjectQueue('mystery_shop_queue') private mysteryShopQueue: Queue,
    @InjectQueue('social_eng_queue') private socialEngQueue: Queue,
    private crmService: CrmService,
    private motorService: MotorService,
  ) {}

  async getMotorStatus() {
    const maxDaily    = parseInt(process.env.WA_DAILY_LIMIT || '20');
    const todayCount  = await this.crmService.countTodayWaTests();
    const enriched    = await this.crmService.getLeadsByStatus('enriched');
    const pendingCount = enriched.filter((l: any) => l.whatsapp).length;
    return this.motorService.getSnapshot(pendingCount, todayCount, maxDaily);
  }

  async getStats(): Promise<any> {
    return this.crmService.getTodayStats();
  }

  async getPipelineCounts(): Promise<any> {
    const statuses = [
      'novo', 'enriched',
      // V2 statuses
      'ms_m1_sent', 'ms_m2a_sent', 'ms_m2b_sent',
      'ativo', 'intelligence_done', 'eng_v1', 'eng_v2', 'eng_v3',
      'briefing_done', 'morto',
      // approval/conversion
      'pending_approval',
      // legacy
      'descartado', 'sem_whatsapp', 'sem_whatsapp_fixo',
    ];
    const counts: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (status) => {
        const leads = await this.crmService.getLeadsByStatus(status);
        counts[status] = leads.length;
      })
    );
    return counts;
  }

  async getPendingApprovals(campaign_id?: string): Promise<any[]> {
    return this.crmService.getPendingApprovalsData(campaign_id);
  }

  async getLeads(status?: string, search?: string, page = 1, limit = 20, campaign_id?: string, niche?: string): Promise<any> {
    const [leads, total] = await Promise.all([
      this.crmService.getLeadsFiltered({ status, search, campaign_id, niche }, page, limit),
      this.crmService.countLeads({ status, search, campaign_id, niche }),
    ]);
    return { leads, total, page, limit };
  }

  async getCampaigns(): Promise<any[]> {
    return this.crmService.getCampaignStats();
  }

  async getNiches(): Promise<string[]> {
    return this.crmService.getNiches();
  }

  async deleteCampaign(id: string) {
    return this.crmService.deleteCampaign(id);
  }

  async exportLeads(status?: string, campaign_id?: string): Promise<any[]> {
    // Busca até 1000 leads sem paginação para exportar tudo de uma vez
    return this.crmService.getLeadsFiltered({ status, campaign_id }, 1, 1000);
  }

  async approveLead(leadId: string) {
    // V2: não tem mais fluxo de approval manual — este endpoint não faz nada de destrutivo
    this.logger.log(`approveLead chamado para ${leadId} — ignorado em V2 (sem approval manual)`);
    return { ok: true, message: 'V2: fluxo automático, sem approval manual' };
  }

  async updateLeadWhatsapp(leadId: string, whatsapp: string) {
    if (!whatsapp) return { error: 'WhatsApp obrigatório' };
    // Normaliza: remove tudo exceto dígitos e +
    const cleaned = whatsapp.replace(/[^\d+]/g, '');
    if (cleaned.length < 10) return { error: 'Número inválido' };

    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return { error: 'Lead não encontrado' };

    await this.crmService.updateLead(leadId, {
      whatsapp: cleaned,
      whatsapp_source: 'manual',
      status: 'enriched',
    });

    // Enfileira para mystery shop imediatamente
    await this.mysteryShopQueue.add('send_m1', { leadId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30000 },
    });

    this.logger.log(`WhatsApp manual para lead ${lead.nome}: ${cleaned} → mystery_shop_queue`);
    return { ok: true, whatsapp: cleaned };
  }

  async discardLead(leadId: string) {
    await this.crmService.updateLead(leadId, { status: 'descartado' });
    this.logger.log(`Lead ${leadId} descartado via dashboard`);
    return { ok: true };
  }

  async deleteLead(leadId: string) {
    await this.crmService.deleteLead(leadId);
    return { ok: true };
  }

  async deleteAllLeads() {
    return this.crmService.deleteAllLeads();
  }

  async getLeadById(leadId: string): Promise<any> {
    return this.crmService.getLeadById(leadId);
  }

  async generateColdEmail(leadId: string, context: string): Promise<{ email: string }> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) throw new Error('Lead não encontrado');

    const painPoints = (lead.pain_points as string[] | null) ?? [];
    const summary = lead.ai_summary || 'Sem resumo disponível';

    const prompt = `Você é um especialista em copywriting B2B e cold email.

Escreva um cold email personalizado para a empresa "${lead.nome}", localizada em ${lead.cidade || lead.estado || 'Brasil'}.

Resumo de inteligência sobre o negócio:
${summary}

Principais dores identificadas nas avaliações dos clientes:
${painPoints.length > 0 ? painPoints.map(p => `- ${p}`).join('\n') : '- Nenhuma dor identificada'}

Contexto da proposta (produto/serviço que estamos oferecendo):
${context || 'Fair Assist — bot de WhatsApp para casas de câmbio que responde cotações 24h, qualifica leads e passa para o humano na hora certa.'}

Regras do email:
- Assunto curto e instigante (max 8 palavras)
- Abertura personalizada ligando as dores reais da empresa à nossa solução
- 3 parágrafos no máximo
- CTA claro no final (reunião de 15 minutos)
- Tom direto, sem exageros, sem clichês de marketing
- Em português brasileiro

Retorne APENAS um JSON válido:
{"assunto": "...", "corpo": "..."}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });
      const parsed = JSON.parse(response.choices[0].message.content || '{}');
      const draft = JSON.stringify(parsed);
      await this.crmService.updateLead(leadId, { cold_email_draft: draft } as any);
      return { email: draft };
    } catch (err) {
      this.logger.error('Erro ao gerar cold email:', err);
      throw err;
    }
  }

  async expandRegion(region: string, niche: string): Promise<{ queries: string[] }> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Você é um assistente de prospecção B2B no Brasil.
O usuário quer prospectar "${niche}" na região: "${region}".
Gere uma lista de queries de busca no Google Maps — uma por cidade relevante da região.
Formato de cada query: "${niche} NOME_DA_CIDADE"
Retorne APENAS JSON: { "queries": ["...", "...", ...] }
Regras:
- Inclua a cidade principal e todas as cidades relevantes da região (mínimo 5, máximo 20)
- Cidades com maior população primeiro
- Não repita cidades
- Não adicione estado ou país, só cidade`,
      }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    return { queries: parsed.queries || [] };
  }

  async getKanbanData() {
    return this.crmService.getKanbanLeads();
  }

  async convertLead(leadId: string) {
    const existing = await this.crmService.getOutreachByLeadId(leadId);
    if (existing) {
      await this.crmService.updateOutreach(existing.id, { status: 'convertido' });
    } else {
      await this.crmService.createOutreach({
        lead_id: leadId,
        aprovado_por: 'dashboard_crm',
        aprovado_em: new Date().toISOString(),
        status: 'convertido',
      });
    }
    this.logger.log(`Lead ${leadId} marcado como convertido via CRM`);
    return { ok: true };
  }

  async requeueEnrichedLeads(): Promise<{ queued: number }> {
    const leads = await this.crmService.getLeadsByStatus('enriched');
    let queued = 0;

    for (const lead of leads) {
      if (!lead.whatsapp) continue;
      await this.crmService.updateLead(lead.id, { status: 'enriched' });
      await this.mysteryShopQueue.add('send_m1', { leadId: lead.id }, {
        delay: queued * 30_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      queued++;
    }

    this.logger.log(`Re-enfileirou ${queued} leads para mystery_shop_queue`);
    return { queued };
  }

  async requeueNovoLeads(): Promise<{ queued: number }> {
    const leads = await this.crmService.getLeadsByStatus('novo');
    let queued = 0;
    for (const lead of leads) {
      await this.enrichmentQueue.add('enrich_lead', { leadId: lead.id }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
      queued++;
    }
    this.logger.log(`Re-enfileirou ${queued} leads novo para enrichment_queue`);
    return { queued };
  }

  async reEnrichDiscarded(): Promise<{ queued: number }> {
    // Re-enrich leads with a site that were discarded (may have had no WA found)
    const leads = await this.crmService.getLeadsFiltered({ status: 'descartado' }, 1, 1000);
    const withSite = leads.filter((l: any) => l.site);
    let queued = 0;
    for (const lead of withSite) {
      await this.crmService.updateLead(lead.id, { status: 'novo', whatsapp: null, whatsapp_source: null });
      await this.enrichmentQueue.add('enrich_lead', { leadId: lead.id }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 5000 },
      });
      queued++;
    }
    this.logger.log(`Re-enriquecendo ${queued} leads descartados`);
    return { queued };
  }

  // ── V2 endpoints ──────────────────────────────────────────────

  async getOperacaoData(): Promise<any> {
    const IN_PROGRESS = [
      'ms_m1_sent', 'ms_m2a_sent', 'ms_m2b_sent',
      'ativo', 'intelligence_done',
      'eng_v1', 'eng_v2', 'eng_v3',
    ] as const;

    const [semWa, semWaFixo, ...groups] = await Promise.all([
      this.crmService.getLeadsByStatus('sem_whatsapp'),
      this.crmService.getLeadsByStatus('sem_whatsapp_fixo'),
      ...IN_PROGRESS.map(s => this.crmService.getLeadsByStatus(s)),
    ]);

    const in_progress: Record<string, any[]> = {};
    IN_PROGRESS.forEach((s, i) => { in_progress[s] = groups[i]; });

    // Batch-fetch last SENT mystery_conversation for each in-progress lead (for countdowns)
    const allLeads = Object.values(in_progress).flat();
    const leadIds = allLeads.map(l => l.id);
    if (leadIds.length > 0) {
      const { data: convs } = await this.crmService['supabase']
        .from('mystery_conversations')
        .select('lead_id, sent_at')
        .in('lead_id', leadIds)
        .eq('direction', 'SENT')
        .order('sent_at', { ascending: false });

      const lastSentByLead: Record<string, string> = {};
      for (const conv of (convs || [])) {
        if (!lastSentByLead[conv.lead_id]) lastSentByLead[conv.lead_id] = conv.sent_at;
      }
      IN_PROGRESS.forEach(s => {
        in_progress[s] = in_progress[s].map(l => ({
          ...l,
          phase_sent_at: lastSentByLead[l.id] || l.criado_em,
        }));
      });
    }

    return { sem_wa: [...semWa, ...semWaFixo], in_progress };
  }

  async markLeadMorto(leadId: string): Promise<any> {
    await this.crmService.updateLead(leadId, { status: 'morto', tag_final: 'MORTO' });
    return { ok: true };
  }

  async getEngRevisao(): Promise<any[]> {
    const leads = await this.crmService.getLeadsByStatus('eng_revisao');
    const result = await Promise.all(leads.map(async l => {
      const convs = await this.crmService.getMysteryConversation(l.id);
      // Get the last received message (the unexpected response)
      const lastReceived = [...convs].reverse().find(c => c.direction === 'RECEIVED');
      const lastSent = [...convs].reverse().find(c => c.direction === 'SENT');
      return { ...l, last_response: lastReceived?.message ?? null, last_response_at: lastReceived?.sent_at ?? null, last_eng_sent: lastSent?.message ?? null };
    }));
    return result;
  }

  async dispatchEngAction(leadId: string, action: 'next_eng' | 'morto' | 'handled'): Promise<any> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return { error: 'Lead não encontrado' };

    if (action === 'morto') {
      await this.crmService.updateLead(leadId, { status: 'morto', tag_final: 'MORTO' });
      return { ok: true };
    }

    if (action === 'handled') {
      // Mark as handled — advance to next eng or close
      const variacao = (lead.engenharia_social_variacao ?? 1) as 1 | 2 | 3;
      const nextStatus = variacao >= 3 ? 'morto' : `eng_v${variacao}`;
      await this.crmService.updateLead(leadId, { status: nextStatus });
      return { ok: true };
    }

    if (action === 'next_eng') {
      const variacao = (lead.engenharia_social_variacao ?? 1) as 1 | 2 | 3;
      const nextVariacao = Math.min(variacao + 1, 3) as 1 | 2 | 3;
      await this.socialEngQueue.add('send_social_eng', { leadId, variacao: nextVariacao }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      });
      return { ok: true, nextVariacao };
    }

    return { error: 'Ação inválida' };
  }

  async callOutcome(leadId: string, outcome: 'fechou' | 'sem_interesse' | 'sem_resposta'): Promise<any> {
    const updates: any = { call_outcome: outcome };
    if (outcome === 'fechou') updates.status = 'convertido';
    else if (outcome === 'sem_interesse') updates.status = 'descartado';
    // sem_resposta keeps status=briefing_done — stays in the list
    await this.crmService.updateLead(leadId, updates);
    this.logger.log(`Lead ${leadId} call outcome: ${outcome}`);
    return { ok: true };
  }

  async getBriefings(): Promise<any[]> {
    const leads = await this.crmService.getBriefings();
    return leads.map(l => ({
      id: l.id,
      nome: l.nome,
      cidade: l.cidade,
      estado: l.estado,
      whatsapp: l.whatsapp,
      gestor_phone: l.gestor_phone,
      briefing_gerado: l.briefing_gerado,
      tipo_atendimento: l.tipo_atendimento,
      dor_perfil: l.dor_perfil,
      pontos_fracos: l.pontos_fracos,
      pontos_fortes: l.pontos_fortes,
      qualidade_resposta: l.qualidade_resposta,
    }));
  }

  async getLeadConversation(leadId: string): Promise<any> {
    const [lead, conversations] = await Promise.all([
      this.crmService.getLeadById(leadId),
      this.crmService.getMysteryConversation(leadId),
    ]);
    return { lead, conversations };
  }

  async getLeadBriefing(leadId: string): Promise<any> {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return { error: 'Lead não encontrado' };
    return {
      id: lead.id,
      nome: lead.nome,
      cidade: lead.cidade,
      gestor_phone: lead.gestor_phone,
      briefing_gerado: lead.briefing_gerado,
      status: lead.status,
    };
  }

  @Cron('0 21 * * *')
  async saveDailyReport() {
    const stats = await this.crmService.getTodayStats();
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
    this.logger.log('Relatório diário salvo');
  }

  // ── DEMO / SEED ──────────────────────────────────────────────

  async seedDemo(): Promise<{ seeded: number }> {
    const supabase = (this.crmService as any).supabase;

    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

    const fakeLeads: any[] = [
      // ── outros estágios (contexto para o funil)
      { nome: 'FastCâmbio Campinas', cidade: 'Campinas', estado: 'SP', telefone_google: '(19) 91234-0001', whatsapp: '+551912340001', whatsapp_source: 'site', status: 'ms_m1_sent', google_rating: 4.4, google_reviews: 33, criado_em: ago(48) },
      { nome: 'Euro House RJ', cidade: 'Rio de Janeiro', estado: 'RJ', telefone_google: '(21) 92222-0001', whatsapp: '+552192220001', whatsapp_source: 'site', status: 'ms_m2a_sent', google_rating: 4.5, google_reviews: 87, tipo_atendimento: 'HUMANO', qualidade_resposta: 'BOA', criado_em: ago(72) },
      { nome: 'CâmbioMax Londrina', cidade: 'Londrina', estado: 'PR', telefone_google: '(43) 91234-0030', whatsapp: '+554312340030', whatsapp_source: 'site', status: 'ativo', google_rating: 4.6, google_reviews: 82, tipo_atendimento: 'HUMANO', qualidade_resposta: 'ÓTIMA', tag_final: 'ATIVO', criado_em: ago(120) },
      { nome: 'Câmbio Elite Brasília', cidade: 'Brasília', estado: 'DF', telefone_google: '(61) 91234-0040', whatsapp: '+556112340040', whatsapp_source: 'site', status: 'intelligence_done', google_rating: 4.7, google_reviews: 109, tipo_atendimento: 'HUMANO', tag_final: 'ATIVO', criado_em: ago(140) },
      { nome: 'Câmbio Velho Porto Velho', cidade: 'Porto Velho', estado: 'RO', telefone_google: '(69) 91234-0099', whatsapp: '+556912340099', whatsapp_source: 'site', status: 'morto', google_rating: 3.2, google_reviews: 4, tag_final: 'MORTO', criado_em: ago(240) },

      // ── briefing_done — foco da tab "Pra Ligar" ─────────────────

      {
        nome: 'Câmbio Premium Sorocaba',
        cidade: 'Sorocaba', estado: 'SP',
        telefone_google: '(15) 3232-4400',
        whatsapp: '+5515991110001', gestor_phone: '+5515991110001',
        whatsapp_source: 'site', site: 'https://cambiopremium.com.br',
        status: 'briefing_done', google_rating: 4.8, google_reviews: 93,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'ÓTIMA',
        taxa_oferecida: 'USD 5,82',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['Sem atendimento fora do horário comercial', 'Fila de espera para cotações', 'Equipe sobrecarregada em alta temporada'],
        pontos_fortes: ['Atendimento humano de qualidade', 'Taxas competitivas', 'Clientela fiel há anos'],
        briefing_gerado: `Câmbio Premium Sorocaba é uma casa de câmbio consolidada, com forte reputação local e clientela fiel.\n\nPRINCIPAL DOR: ausência de atendimento automatizado fora do horário comercial. Clientes relatam dificuldade em obter cotações à noite e nos fins de semana. A equipe é enxuta e fica sobrecarregada nas altas temporadas (férias, Carnaval, Copa).\n\nOPORTUNIDADE: bot de WhatsApp 24h que responde cotações instantaneamente, qualifica o lead e só passa para o humano quando o cliente já está aquecido. Elimina a fila, aumenta a conversão fora do horário e libera a equipe para atendimentos de maior valor.`,
        criado_em: ago(200),
      },

      {
        nome: 'Global Câmbio Ribeirão Preto',
        cidade: 'Ribeirão Preto', estado: 'SP',
        telefone_google: '(16) 3610-7700',
        whatsapp: '+5516992220002', gestor_phone: '+5516992220002',
        whatsapp_source: 'site', site: 'https://globalcambio-rp.com.br',
        status: 'briefing_done', google_rating: 4.9, google_reviews: 134,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'ÓTIMA',
        taxa_oferecida: 'USD 5,79',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['Atendimento por WhatsApp não escala', 'Demora de 30-40 min para retornar cotação', 'Perde clientes para concorrentes com resposta imediata'],
        pontos_fortes: ['Maior casa de câmbio do interior paulista', 'Excelente reputação (4.9 ⭐)', 'Múltiplas moedas disponíveis'],
        briefing_gerado: `Global Câmbio é a maior casa de câmbio do interior de SP, referência em Ribeirão Preto há 15 anos.\n\nPRINCIPAL DOR: o volume de mensagens no WhatsApp é alto demais para a equipe responder rápido. Clientes reclamam nas avaliações sobre demora de até 40 minutos para receber uma cotação — e nesse tempo já foram para o concorrente.\n\nOPORTUNIDADE CLARA: bot de cotação imediata no WhatsApp. O cliente digita a moeda e o valor, recebe a taxa em segundos. O atendente só entra quando o cliente confirma interesse. Potencial de recuperar 20-30% dos leads perdidos por demora.`,
        criado_em: ago(180),
      },

      {
        nome: 'MoneyXpress Florianópolis',
        cidade: 'Florianópolis', estado: 'SC',
        telefone_google: '(48) 3225-9900',
        whatsapp: '+5548993330003', gestor_phone: '+5548993330003',
        whatsapp_source: 'instagram', site: 'https://moneyxpress.com.br',
        status: 'briefing_done', google_rating: 4.6, google_reviews: 78,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'BOA',
        taxa_oferecida: 'USD 5,85',
        tag_final: 'ATIVO', dor_perfil: 'OPORTUNIDADE',
        pontos_fracos: ['Sem resposta nos fins de semana', 'Instagram com engajamento alto mas sem conversão para venda'],
        pontos_fortes: ['Forte presença digital (4.6k seguidores no Instagram)', 'Localização premium no centro', 'Atende muito turista estrangeiro'],
        briefing_gerado: `MoneyXpress tem presença digital forte para o segmento — 4.6k seguidores no Instagram e avaliações consistentes. Atende muito turista que chega em Floripa e precisa de câmbio rápido.\n\nPRINCIPAL DOR: sem atendimento nos fins de semana, que é exatamente quando os turistas chegam. Os seguidores do Instagram mandam DM para perguntar taxa e não recebem resposta rápida.\n\nOPORTUNIDADE: bot de WhatsApp integrado com automação de Instagram DM. Turista manda mensagem, recebe cotação instantânea, e se quiser fechar é direcionado para o atendente presencial ou agendamento. Captura a demanda do fim de semana que hoje se perde.`,
        criado_em: ago(160),
      },

      {
        nome: 'Câmbio Sul Porto Alegre',
        cidade: 'Porto Alegre', estado: 'RS',
        telefone_google: '(51) 3311-2200',
        whatsapp: '+5551994440004', gestor_phone: '+5551994440004',
        whatsapp_source: 'site',
        status: 'briefing_done', google_rating: 4.3, google_reviews: 55,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'BOA',
        taxa_oferecida: 'USD 5,88',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['Atendimento telefônico congestionado', 'Clientes reclamam de espera na linha', 'Sem canal digital estruturado'],
        pontos_fortes: ['Referência no RS para empresas que precisam remessa internacional', 'Relacionamento B2B consolidado', 'Equipe experiente'],
        briefing_gerado: `Câmbio Sul é referência em Porto Alegre para empresas que fazem remessa internacional. Base de clientes B2B sólida, mas com gargalo no canal de atendimento.\n\nPRINCIPAL DOR: o telefone é o único canal e fica sempre congestionado. Clientes corporativos (importadores, exportadores) precisam de cotações ágeis para fechar operações — a demora no atendimento já custou negócios.\n\nOPORTUNIDADE: canal de cotação via WhatsApp Business com bot que atende corporativos 24h. Integra com o fluxo atual: bot qualifica (moeda, valor, prazo), passa para o operador fechar. Ideal para o perfil B2B que já têm.`,
        criado_em: ago(150),
      },

      {
        nome: 'TurismoCâmbio Salvador',
        cidade: 'Salvador', estado: 'BA',
        telefone_google: '(71) 3312-5500',
        whatsapp: '+5571995550005', gestor_phone: '+5571995550005',
        whatsapp_source: 'site', site: 'https://turismocambio.com.br',
        status: 'briefing_done', google_rating: 4.4, google_reviews: 67,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'BOA',
        taxa_oferecida: 'USD 5,91',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['Perde muito cliente no Carnaval por não ter atendimento automatizado', 'WhatsApp sem resposta rápida nas épocas de pico'],
        pontos_fortes: ['Localização estratégica no Pelourinho', 'Alta demanda de turistas estrangeiros', 'Parceria com agências de turismo'],
        briefing_gerado: `TurismoCâmbio Salvador ocupa uma posição privilegiada no Pelourinho, epicentro do turismo baiano. Alta demanda natural de turistas estrangeiros, especialmente europeus e norte-americanos.\n\nPRINCIPAL DOR: no Carnaval e alta temporada, o WhatsApp fica sem resposta por horas. Turistas com urgência vão para o concorrente da esquina. O gestor relatou na conversa que "a gente perde dinheiro toda vez que não consegue atender"\n\nOPORTUNIDADE DIRETA: bot de cotação em português, inglês e espanhol. Atende o turista no idioma dele, 24h, responde taxa instantânea, e direciona para a loja quando confirma interesse. ROI imediato nas altas temporadas.`,
        criado_em: ago(130),
      },

      {
        nome: 'Prime Exchange Belo Horizonte',
        cidade: 'Belo Horizonte', estado: 'MG',
        telefone_google: '(31) 3282-8800',
        whatsapp: '+5531996660006',
        whatsapp_source: 'site', site: 'https://primeexchange.com.br',
        // sem gestor_phone — ainda não conseguimos o número do decisor
        status: 'briefing_done', google_rating: 4.5, google_reviews: 101,
        tipo_atendimento: 'BOT', qualidade_resposta: 'RUIM',
        taxa_oferecida: 'USD 5,95',
        tag_final: 'ATIVO', dor_perfil: 'OPORTUNIDADE',
        pontos_fracos: ['Bot atual é rudimentar — responde errado, clientes ficam frustrados', 'Alta taxa de abandono no WhatsApp', 'Bot não qualifica, só irrita o cliente'],
        pontos_fortes: ['Volume alto de atendimentos (100+ por dia)', 'Boa localização com fluxo garantido', 'Gestão profissional, aberta a tecnologia'],
        briefing_gerado: `Prime Exchange já tentou automação — tem um bot no WhatsApp — mas a implementação é ruim. Clientes reclamam que "o robô não entende nada" nas avaliações do Google.\n\nOPORTUNIDADE DE TROCA: esse é o perfil perfeito para substituição. Eles já acreditam em bot (tomaram a decisão), só precisam de um que funcione de verdade. O pitch é direto: "vocês já investiram em automação, mas o bot atual está afastando clientes. A gente resolve isso."\n\nNOTA: ainda não conseguimos o número do gestor — o bot não passou. Ligar no número da loja e pedir para falar com o responsável pelo WhatsApp/atendimento.`,
        criado_em: ago(110),
      },

      {
        nome: 'Câmbio Carioca Ipanema',
        cidade: 'Rio de Janeiro', estado: 'RJ',
        telefone_google: '(21) 2511-4400',
        whatsapp: '+5521997770007', gestor_phone: '+5521997770007',
        whatsapp_source: 'site', site: 'https://cambiocarioca.com.br',
        status: 'briefing_done', google_rating: 4.7, google_reviews: 189,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'ÓTIMA',
        taxa_oferecida: 'USD 5,80',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['2 atendentes para 189 avaliações — equipe claramente subdimensionada', 'Clientes aguardam 1h+ para ser atendidos presencialmente', 'Sem fila virtual ou agendamento'],
        pontos_fortes: ['Melhor avaliação da região (4.7 com 189 reviews)', 'Localização premium em Ipanema', 'Clientela de alto poder aquisitivo'],
        briefing_gerado: `Câmbio Carioca Ipanema é a casa de câmbio mais avaliada da Zona Sul do Rio. 189 reviews com média 4.7 é uma raridade no segmento — indica clientela fiel e satisfeita.\n\nPRINCIPAL DOR: demanda maior do que a capacidade de atendimento. Com apenas 2 atendentes visíveis, clientes relatam espera longa. O volume de mensagens no WhatsApp está fora de controle.\n\nOPORTUNIDADE PREMIUM: esse cliente vale mais — propor bot + fila virtual. Cliente chega no WhatsApp, recebe cotação, confirma interesse e já agenda um horário de atendimento. Zero fila, zero cliente frustrado, mais conversão. Ticket para venda de plano mais completo (gestão de fila + cotação + follow-up).`,
        criado_em: ago(90),
      },

      {
        nome: 'Dólar Certo Curitiba',
        cidade: 'Curitiba', estado: 'PR',
        telefone_google: '(41) 3025-6600',
        whatsapp: '+5541998880008', gestor_phone: '+5541998880008',
        whatsapp_source: 'site',
        status: 'briefing_done', google_rating: 4.2, google_reviews: 43,
        tipo_atendimento: 'HUMANO', qualidade_resposta: 'REGULAR',
        taxa_oferecida: 'USD 5,89',
        tag_final: 'ATIVO', dor_perfil: 'INEFICIENCIA',
        pontos_fracos: ['Atendimento inconsistente — depende do humor do atendente (avaliações citam isso)', 'Sem padronização no atendimento via WhatsApp', 'Concorrência forte em Curitiba'],
        pontos_fortes: ['Preço competitivo', 'Localização central', 'Gerente aberto a tecnologia (mencionou interesse em automação na conversa)'],
        briefing_gerado: `Dólar Certo tem um gap claro de padronização no atendimento. Reviews mencionam variação de qualidade dependendo de qual atendente pega — "na segunda-feira foi ótimo, na quinta foi mal atendido".\n\nOPORTUNIDADE: bot garante padronização. Independente do dia ou do atendente, o cliente sempre recebe a cotação certa, no tempo certo, com a mensagem certa. O gerente sinalizou interesse em automação durante a conversa do mystery shop — esse é o principal comprador.\n\nTOM DA ABORDAGEM: não vender como "substituir o humano" — vender como "garantir que o humano sempre pareça no seu melhor dia". A inconsistência é a dor principal.`,
        criado_em: ago(70),
      },
    ];

    let seeded = 0;
    for (const lead of fakeLeads) {
      const payload = {
        nome: lead.nome,
        cidade: lead.cidade,
        estado: lead.estado,
        telefone_google: lead.telefone_google,
        whatsapp: lead.whatsapp ?? null,
        whatsapp_source: lead.whatsapp_source ?? null,
        site: lead.site ?? null,
        endereco: `[DEMO] Rua Fictícia, 100 — ${lead.cidade}/${lead.estado}`,
        google_rating: lead.google_rating ?? null,
        google_reviews: lead.google_reviews ?? 0,
        status: lead.status,
        criado_em: lead.criado_em ?? now.toISOString(),
        // V2 fields
        tipo_atendimento: lead.tipo_atendimento ?? null,
        qualidade_resposta: lead.qualidade_resposta ?? null,
        taxa_oferecida: lead.taxa_oferecida ?? null,
        tag_final: lead.tag_final ?? null,
        dor_perfil: lead.dor_perfil ?? null,
        pain_points: lead.pain_points ?? null,
        pontos_fracos: lead.pontos_fracos ?? null,
        pontos_fortes: lead.pontos_fortes ?? null,
        ai_summary: lead.ai_summary ?? null,
        engenharia_social_variacao: lead.engenharia_social_variacao ?? null,
        engenharia_social_sent_at: lead.engenharia_social_sent_at ?? null,
        gestor_phone: lead.gestor_phone ?? null,
        briefing_gerado: lead.briefing_gerado ?? null,
      };
      const { error } = await supabase.from('leads').insert(payload);
      if (!error) seeded++;
      else this.logger.warn(`Demo seed erro em ${lead.nome}: ${error.message}`);
    }

    this.logger.log(`Demo seed: ${seeded}/${fakeLeads.length} leads inseridos`);
    return { seeded };
  }

  async clearDemo(): Promise<{ deleted: number }> {
    const supabase = (this.crmService as any).supabase;

    const { data: leads } = await supabase
      .from('leads')
      .select('id')
      .like('endereco', '%[DEMO]%');
    const leadIds = (leads || []).map((l: any) => l.id);

    if (leadIds.length) {
      await Promise.all([
        supabase.from('wa_tests').delete().in('lead_id', leadIds),
        supabase.from('enrichment').delete().in('lead_id', leadIds),
        supabase.from('scores').delete().in('lead_id', leadIds),
        supabase.from('outreach').delete().in('lead_id', leadIds),
        supabase.from('mystery_conversations').delete().in('lead_id', leadIds),
      ]);
      await supabase.from('leads').delete().in('id', leadIds);
    }

    this.logger.log(`Demo cleared: ${leadIds.length} leads removidos`);
    return { deleted: leadIds.length };
  }
}
