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

  async leadExists(nome: string, estado: string): Promise<boolean> {
    const { count } = await this.supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .ilike('nome', nome)
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

  // ─── ENRICHMENT ──────────────────────────────────────────────

  async saveEnrichment(data: Partial<Enrichment>): Promise<Enrichment | null> {
    const { data: result, error } = await this.supabase
      .from('enrichment')
      .upsert(data, { onConflict: 'lead_id' })
      .select()
      .single();
    if (error) { this.logger.error('Erro ao salvar enrichment:', error.message); return null; }
    return result;
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

    const [prospectados, enriquecidos, testados, aprovados, enviados, respostas] = await Promise.all([
      this.supabase.from('leads').select('*', { count: 'exact', head: true })
        .gte('criado_em', today),
      this.supabase.from('leads').select('*', { count: 'exact', head: true })
        .eq('status', 'enriched').gte('criado_em', today),
      this.supabase.from('wa_tests').select('*', { count: 'exact', head: true })
        .gte('enviado_em', today),
      this.supabase.from('leads').select('*', { count: 'exact', head: true })
        .eq('status', 'approved').gte('criado_em', today),
      this.supabase.from('outreach').select('*', { count: 'exact', head: true })
        .gte('msg1_enviada_em', today),
      this.supabase.from('outreach').select('*', { count: 'exact', head: true })
        .eq('respondeu', true).gte('respondeu_em', today),
    ]);

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
}

// ─── TIPOS ────────────────────────────────────────────────────

interface Lead {
  id: string;
  nome: string;
  telefone_google: string;
  whatsapp: string;
  whatsapp_source: string;
  site: string;
  instagram: string;
  endereco: string;
  cidade: string;
  estado: string;
  google_rating: number;
  google_reviews: number;
  status: string;
  criado_em: string;
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
