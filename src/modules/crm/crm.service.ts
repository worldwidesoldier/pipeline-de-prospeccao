import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config/env.config';

@Injectable()
export class CrmService implements OnModuleInit {
  private readonly logger = new Logger(CrmService.name);
  private supabase: SupabaseClient;

  onModuleInit() {
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    this.logger.log('Supabase client inicializado');
  }

  // ─── LEADS ───────────────────────────────────────────────────

  async createLead(data: Partial<Lead>): Promise<Lead | null> {
    const { data: lead, error } = await this.supabase
      .from('leads')
      .insert(data)
      .select()
      .single();
    if (error) { this.logger.error('Erro ao criar lead:', error.message); return null; }
    return lead;
  }

  async getLeadById(id: string): Promise<Lead | null> {
    const { data, error } = await this.supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return data;
  }

  async updateLead(id: string, data: Partial<Lead>): Promise<void> {
    const { error } = await this.supabase
      .from('leads')
      .update(data)
      .eq('id', id);
    if (error) this.logger.error(`Erro ao atualizar lead ${id}:`, error.message);
  }

  async leadExists(nome: string, estado: string, telefone?: string): Promise<boolean> {
    // Match by phone first (most reliable) — same number = same business
    if (telefone) {
      const cleanPhone = telefone.replace(/[^\d]/g, '');
      if (cleanPhone.length >= 8) {
        const { count } = await this.supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .like('telefone_google', `%${cleanPhone.slice(-8)}`);
        if ((count || 0) > 0) return true;
      }
    }
    // Fallback: normalize name (lowercase, trim) + state
    const { count } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .ilike('nome', nome.trim())
      .eq('estado', estado);
    return (count || 0) > 0;
  }

  async getLeadsByStatus(status: string): Promise<Lead[]> {
    const { data } = await this.supabase
      .from('leads')
      .select('*')
      .eq('status', status)
      .order('criado_em', { ascending: false });
    return data || [];
  }

  async getLeadsFiltered(
    filters: { status?: string; search?: string; campaign_id?: string; niche?: string },
    page = 1,
    limit = 20,
  ): Promise<Lead[]> {
    let campaignIds: string[] | null = null;
    if (filters.niche && !filters.campaign_id) {
      const jobs = await this.getScrapeJobs();
      campaignIds = jobs.filter(j => j.niche === filters.niche).map(j => j.id);
      if (!campaignIds.length) return [];
    }

    let query = this.supabase
      .from('leads')
      .select('*, scores(score_total), wa_tests(is_bot), outreach(msg2_enviada_em, msg3_enviada_em, msg4_enviada_em, respondeu, interesse_nivel)')
      .order('criado_em', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.ilike('nome', `%${filters.search}%`);
    if (filters.campaign_id) query = query.eq('campaign_id', filters.campaign_id);
    else if (campaignIds) query = query.in('campaign_id', campaignIds);

    const { data } = await query;
    return (data || []).map((l: any) => ({
      ...l,
      score_total: l.scores?.[0]?.score_total ?? null,
      wa_is_bot: l.wa_tests?.[0]?.is_bot ?? false,
      outreach_respondeu: l.outreach?.[0]?.respondeu ?? false,
      outreach_msg2: l.outreach?.[0]?.msg2_enviada_em ?? null,
      outreach_msg3: l.outreach?.[0]?.msg3_enviada_em ?? null,
      outreach_msg4: l.outreach?.[0]?.msg4_enviada_em ?? null,
      outreach_interesse: l.outreach?.[0]?.interesse_nivel ?? null,
      scores: undefined,
      wa_tests: undefined,
      outreach: undefined,
    }));
  }

  async countLeads(filters: { status?: string; search?: string; campaign_id?: string; niche?: string }): Promise<number> {
    let campaignIds: string[] | null = null;
    if (filters.niche && !filters.campaign_id) {
      const jobs = await this.getScrapeJobs();
      campaignIds = jobs.filter(j => j.niche === filters.niche).map(j => j.id);
      if (!campaignIds.length) return 0;
    }

    let query = this.supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.search) query = query.ilike('nome', `%${filters.search}%`);
    if (filters.campaign_id) query = query.eq('campaign_id', filters.campaign_id);
    else if (campaignIds) query = query.in('campaign_id', campaignIds);

    const { count } = await query;
    return count || 0;
  }

  async getNiches(): Promise<string[]> {
    const jobs = await this.getScrapeJobs();
    const niches = [...new Set(jobs.map(j => j.niche).filter(Boolean))] as string[];
    return niches.sort();
  }

  async getCampaignStats(): Promise<any[]> {
    const jobs = await this.getScrapeJobs();
    if (!jobs.length) return [];

    const { data } = await this.supabase
      .from('leads')
      .select('campaign_id, status, whatsapp')
      .not('campaign_id', 'is', null);

    const leads = data || [];
    const contatadosSet = new Set(['tested', 'scored', 'pending_approval', 'approved', 'outreach', 'convertido']);
    const respondidosSet = new Set(['approved', 'outreach', 'convertido']);

    return jobs.map(job => {
      const jl = leads.filter(l => l.campaign_id === job.id);
      return {
        ...job,
        leads_total: jl.length,
        leads_wa: jl.filter(l => l.whatsapp).length,
        leads_contatados: jl.filter(l => contatadosSet.has(l.status)).length,
        leads_respondidos: jl.filter(l => respondidosSet.has(l.status)).length,
      };
    });
  }

  async deleteCampaign(campaignId: string): Promise<{ deleted: number }> {
    // Buscar todos os leads da campanha
    const { data: leads } = await this.supabase
      .from('leads')
      .select('id')
      .eq('campaign_id', campaignId);
    const leadIds = (leads || []).map(l => l.id);

    if (leadIds.length) {
      await Promise.all([
        this.supabase.from('wa_tests').delete().in('lead_id', leadIds),
        this.supabase.from('enrichment').delete().in('lead_id', leadIds),
        this.supabase.from('scores').delete().in('lead_id', leadIds),
        this.supabase.from('outreach').delete().in('lead_id', leadIds),
      ]);
      await this.supabase.from('leads').delete().in('id', leadIds);
    }

    await this.supabase.from('scrape_jobs').delete().eq('id', campaignId);
    return { deleted: leadIds.length };
  }

  async deleteLead(id: string): Promise<void> {
    // Deletar tabelas relacionadas primeiro
    await Promise.all([
      this.supabase.from('wa_tests').delete().eq('lead_id', id),
      this.supabase.from('enrichment').delete().eq('lead_id', id),
      this.supabase.from('scores').delete().eq('lead_id', id),
      this.supabase.from('outreach').delete().eq('lead_id', id),
    ]);
    await this.supabase.from('leads').delete().eq('id', id);
  }

  async getKanbanLeads(): Promise<{ minerados: any[]; waEncontrado: any[]; semWhatsapp: any[]; contatados: any[]; respondidos: any[]; fechados: any[] }> {
    const { data } = await this.supabase
      .from('leads')
      .select('*, scores(score_total), outreach(respondeu, status), wa_tests(respondeu, tempo_resposta_min, is_bot)')
      .not('status', 'in', '("descartado","descartado_bot")')
      .order('criado_em', { ascending: false })
      .limit(500);

    const leads = (data || []).map((l: any) => {
      const waTest = l.wa_tests?.[0] ?? null;
      return {
        ...l,
        score_total: l.scores?.[0]?.score_total ?? null,
        outreach_respondeu: l.outreach?.[0]?.respondeu ?? false,
        outreach_status: l.outreach?.[0]?.status ?? null,
        wa_respondeu: waTest?.respondeu ?? null,
        wa_tempo_resposta_min: waTest?.tempo_resposta_min ?? null,
        wa_is_bot: waTest?.is_bot ?? false,
        scores: undefined,
        outreach: undefined,
        wa_tests: undefined,
      };
    });

    const contatadosStatuses = ['tested', 'scored', 'pending_approval', 'approved', 'outreach'];

    const minerados     = leads.filter((l: any) => l.status === 'novo');
    const waEncontrado  = leads.filter((l: any) => l.status === 'enriched');
    const semWhatsapp   = leads.filter((l: any) => l.status === 'sem_whatsapp' || l.status === 'sem_whatsapp_fixo');
    const contatados    = leads.filter((l: any) => contatadosStatuses.includes(l.status) && !l.outreach_respondeu && l.outreach_status !== 'convertido');
    const respondidos   = leads.filter((l: any) => l.outreach_respondeu === true && l.outreach_status !== 'convertido');
    const fechados      = leads.filter((l: any) => l.outreach_status === 'convertido');

    return { minerados, waEncontrado, semWhatsapp, contatados, respondidos, fechados };
  }

  async deleteAllLeads(): Promise<{ deleted: number }> {
    const { count } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });
    const total = count || 0;
    // Limpar todas as tabelas relacionadas primeiro
    await Promise.all([
      this.supabase.from('wa_tests').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      this.supabase.from('enrichment').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      this.supabase.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      this.supabase.from('outreach').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
    ]);
    await this.supabase.from('leads').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    this.logger.log(`Todos os leads deletados (${total} registros)`);
    return { deleted: total };
  }

  // ─── ENRICHMENT ──────────────────────────────────────────────

  async saveEnrichment(data: Partial<Enrichment>): Promise<Enrichment | null> {
    // Try update first; if no row exists, insert
    const { data: updated, error: updateError } = await this.supabase
      .from('enrichment')
      .update(data)
      .eq('lead_id', data.lead_id)
      .select()
      .single();
    if (!updateError && updated) return updated;

    const { data: inserted, error: insertError } = await this.supabase
      .from('enrichment')
      .insert(data)
      .select()
      .single();
    if (insertError) { this.logger.error('Erro ao salvar enrichment:', insertError.message); return null; }
    return inserted;
  }

  async getEnrichmentByLeadId(leadId: string): Promise<Enrichment | null> {
    const { data } = await this.supabase
      .from('enrichment')
      .select('*')
      .eq('lead_id', leadId)
      .single();
    return data;
  }

  // ─── WA TESTS ─────────────────────────────────────────────────

  async createWaTest(data: Partial<WaTest>): Promise<WaTest> {
    const { data: result, error } = await this.supabase
      .from('wa_tests')
      .insert(data)
      .select()
      .single();
    if (error) throw new Error(`Erro ao criar wa_test: ${error.message}`);
    return result;
  }

  async updateWaTest(id: string, data: Partial<WaTest>): Promise<void> {
    await this.supabase.from('wa_tests').update(data).eq('id', id);
  }

  async getLatestWaTestByLeadId(leadId: string): Promise<WaTest | null> {
    const { data } = await this.supabase
      .from('wa_tests')
      .select('*')
      .eq('lead_id', leadId)
      .order('enviado_em', { ascending: false })
      .limit(1)
      .single();
    return data;
  }

  // ─── SCORES ──────────────────────────────────────────────────

  async saveScore(data: Partial<Score>): Promise<Score | null> {
    const { data: result, error } = await this.supabase
      .from('scores')
      .insert(data)
      .select()
      .single();
    if (error) { this.logger.error('Erro ao salvar score:', error.message); return null; }
    return result;
  }

  async getScoreByLeadId(leadId: string): Promise<Score | null> {
    const { data } = await this.supabase
      .from('scores')
      .select('*')
      .eq('lead_id', leadId)
      .order('calculado_em', { ascending: false })
      .limit(1)
      .single();
    return data;
  }

  // ─── OUTREACH ─────────────────────────────────────────────────

  async createOutreach(data: Partial<Outreach>): Promise<Outreach | null> {
    const { data: result, error } = await this.supabase
      .from('outreach')
      .insert(data)
      .select()
      .single();
    if (error) { this.logger.error('Erro ao criar outreach:', error.message); return null; }
    return result;
  }

  async getOutreachByLeadId(leadId: string): Promise<Outreach | null> {
    const { data } = await this.supabase
      .from('outreach')
      .select('*')
      .eq('lead_id', leadId)
      .single();
    return data;
  }

  async updateOutreach(id: string, data: Partial<Outreach>): Promise<void> {
    await this.supabase.from('outreach').update(data).eq('id', id);
  }

  // ─── RELATÓRIOS ───────────────────────────────────────────────

  async getTodayStats(): Promise<RelatorioStats> {
    const today = new Date().toISOString().split('T')[0];

    const [prospectados, testados, enviados, respostas] = await Promise.all([
      // Leads criados hoje
      this.supabase.from('leads').select('*', { count: 'exact', head: true })
        .gte('criado_em', today),
      // WA tests enviados hoje (usa tabela wa_tests — sempre preciso)
      this.supabase.from('wa_tests').select('*', { count: 'exact', head: true })
        .gte('enviado_em', today),
      // Outreach enviados hoje
      this.supabase.from('outreach').select('*', { count: 'exact', head: true })
        .gte('msg1_enviada_em', today),
      // Respostas recebidas hoje
      this.supabase.from('outreach').select('*', { count: 'exact', head: true })
        .eq('respondeu', true).gte('respondeu_em', today),
    ]);

    // Enriquecidos hoje: usa tabela enrichment.atualizado_em (mais preciso que leads.criado_em)
    const enriquecidos = await this.supabase
      .from('enrichment').select('*', { count: 'exact', head: true })
      .gte('atualizado_em', today);

    // Aprovados: leads que tiveram outreach criado hoje (aprovação gera outreach)
    const aprovados = await this.supabase
      .from('outreach').select('*', { count: 'exact', head: true })
      .gte('aprovado_em', today);

    const convertidos = await this.supabase
      .from('outreach').select('*', { count: 'exact', head: true })
      .eq('status', 'convertido');

    return {
      prospectados: prospectados.count || 0,
      enriquecidos: enriquecidos.count || 0,
      testados: testados.count || 0,
      aprovados: aprovados.count || 0,
      enviados: enviados.count || 0,
      respostas: respostas.count || 0,
      interessados: respostas.count || 0,
      convertidos: convertidos.count || 0,
    };
  }

  async saveRelatorio(data: any): Promise<void> {
    await this.supabase.from('relatorios_diarios').upsert(data, { onConflict: 'data' });
  }

  // Busca leads pending_approval com dados relacionados em uma única query (evita N+1)
  async getPendingApprovalsData(campaign_id?: string): Promise<Array<{ lead: Lead; enrichment: Enrichment | null; waTest: WaTest | null; score: Score | null }>> {
    let query = this.supabase
      .from('leads')
      .select('*, enrichment(*), wa_tests(*), scores(*)')
      .eq('status', 'pending_approval')
      .order('criado_em', { ascending: false });
    if (campaign_id) query = query.eq('campaign_id', campaign_id);
    const { data } = await query;

    return (data || []).map((row: any) => {
      const { enrichment, wa_tests, scores, ...lead } = row;
      const waTest = (wa_tests || []).sort((a: any, b: any) =>
        new Date(b.enviado_em).getTime() - new Date(a.enviado_em).getTime()
      )[0] ?? null;
      const score = (scores || []).sort((a: any, b: any) =>
        new Date(b.calculado_em).getTime() - new Date(a.calculado_em).getTime()
      )[0] ?? null;
      return { lead, enrichment: enrichment?.[0] ?? null, waTest, score };
    });
  }

  async getPendingWaTests(): Promise<Array<{ id: string; lead_id: string; numero_testado: string; enviado_em: string }>> {
    const { data } = await this.supabase
      .from('wa_tests')
      .select('id, lead_id, numero_testado, enviado_em')
      .eq('respondeu', false)
      .is('tempo_resposta_min', null); // Exclui entradas já processadas como sem-resposta
    return data || [];
  }

  async getAllNoResponseWaTests(): Promise<Array<{ id: string; lead_id: string; numero_testado: string; enviado_em: string }>> {
    // Retorna TODOS os testes marcados como sem-resposta (inclui os que tiveram timeout)
    const { data } = await this.supabase
      .from('wa_tests')
      .select('id, lead_id, numero_testado, enviado_em')
      .eq('respondeu', false);
    return data || [];
  }

  async countTodayWaTests(): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const { count } = await this.supabase
      .from('wa_tests')
      .select('*', { count: 'exact', head: true })
      .gte('enviado_em', today);
    return count || 0;
  }

  async findLeadByName(nome: string): Promise<Lead | null> {
    const { data } = await this.supabase
      .from('leads')
      .select('*')
      .ilike('nome', nome.trim())
      .limit(1)
      .maybeSingle();
    return data || null;
  }

  // ─── SCRAPER JOBS ──────────────────────────────────────────────

  async createScrapeJob(job: ScrapeJobRow): Promise<void> {
    const { error } = await this.supabase.from('scraper_jobs').insert(job);
    if (error) this.logger.error('Erro ao criar scraper job:', error.message);
  }

  async updateScrapeJob(id: string, data: Partial<ScrapeJobRow>): Promise<void> {
    const { error } = await this.supabase.from('scraper_jobs').update(data).eq('id', id);
    if (error) this.logger.error(`Erro ao atualizar scraper job ${id}:`, error.message);
  }

  async getScrapeJobs(): Promise<ScrapeJobRow[]> {
    const { data } = await this.supabase
      .from('scraper_jobs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);
    return data || [];
  }

  async getScrapeJobById(id: string): Promise<ScrapeJobRow | null> {
    const { data } = await this.supabase
      .from('scraper_jobs')
      .select('*')
      .eq('id', id)
      .single();
    return data || null;
  }
}

// ─── TIPOS ────────────────────────────────────────────────────

export interface ScrapeJobRow {
  id: string;
  query: string;
  campaign_name?: string;
  location?: string | null;
  niche?: string | null;
  status: 'running' | 'done' | 'error';
  leads_found: number;
  leads_new: number;
  started_at: string;
  finished_at?: string;
  error?: string;
}

interface Lead {
  id: string;
  nome: string;
  telefone_google: string;
  whatsapp: string;
  whatsapp_source: string;
  site: string;
  instagram: string;
  facebook_url?: string;
  x_url?: string;
  email?: string;
  cep?: string;
  endereco: string;
  cidade: string;
  estado: string;
  google_rating: number;
  google_reviews: number;
  status: string;
  criado_em: string;
  // Sales Intelligence
  is_hot?: boolean;
  pain_points?: string[];
  ai_summary?: string;
  cold_email_draft?: string;
  google_reviews_raw?: any[];
}

interface Enrichment {
  id: string;
  lead_id: string;
  tem_site: boolean;
  site_score: number;
  site_resumo: string;
  ig_username: string;
  ig_followers: number;
  ig_ultimo_post_dias: number;
  ig_ativo: boolean;
  ig_bio: string;
}

interface WaTest {
  id: string;
  lead_id: string;
  numero_testado: string;
  mensagem_enviada: string;
  enviado_em: string;
  respondido_em: string;
  tempo_resposta_min: number;
  respondeu: boolean;
  qualidade_resposta: number;
  resposta_texto: string;
  is_bot?: boolean; // requer coluna na tabela wa_tests: ALTER TABLE wa_tests ADD COLUMN is_bot boolean DEFAULT false;
}

interface Score {
  id: string;
  lead_id: string;
  score_total: number;
  score_resposta: number;
  score_site: number;
  score_instagram: number;
  score_google: number;
  calculado_em: string;
}

interface Outreach {
  id: string;
  lead_id: string;
  aprovado_por: string;
  aprovado_em: string;
  msg1_enviada_em: string;
  msg2_enviada_em: string;
  msg3_enviada_em: string;
  msg4_enviada_em: string;
  respondeu: boolean;
  respondeu_em: string;
  interesse_nivel: string;
  status: string;
}

interface RelatorioStats {
  prospectados: number;
  enriquecidos: number;
  testados: number;
  aprovados: number;
  enviados: number;
  respostas: number;
  interessados: number;
  convertidos: number;
}
