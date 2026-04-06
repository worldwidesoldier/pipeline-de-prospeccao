export interface Lead {
  id: string
  nome: string
  telefone_google?: string
  whatsapp?: string
  whatsapp_source?: string
  site?: string
  instagram?: string
  endereco?: string
  cidade?: string
  estado?: string
  google_rating?: number
  google_reviews?: number
  status: string
  criado_em: string
  score_total?: number | null
  campaign_id?: string | null
}

export interface Enrichment {
  id: string
  lead_id: string
  tem_site?: boolean
  site_score?: number
  site_resumo?: string
  ig_username?: string
  ig_followers?: number
  ig_ultimo_post_dias?: number | null
  ig_ativo?: boolean
  ig_bio?: string
}

export interface WaTest {
  id: string
  lead_id: string
  numero_testado?: string
  mensagem_enviada?: string
  enviado_em?: string
  respondido_em?: string
  tempo_resposta_min?: number
  respondeu?: boolean
  qualidade_resposta?: number
  resposta_texto?: string
  is_bot?: boolean
}

export interface Score {
  id: string
  lead_id: string
  score_total: number
  score_resposta?: number
  score_site?: number
  score_instagram?: number
  score_google?: number
  calculado_em?: string
}

export interface PendingItem {
  lead: Lead
  enrichment?: Enrichment | null
  waTest?: WaTest | null
  score?: Score | null
}

export interface PipelineCounts {
  novo: number
  enriched: number
  tested: number
  scored: number
  pending_approval: number
  approved: number
  outreach: number
  descartado: number
  sem_whatsapp_fixo: number
}

export interface Stats {
  prospectados: number
  enriquecidos: number
  testados: number
  aprovados: number
  enviados: number
  respostas: number
  convertidos: number
}

export interface WaTemplate {
  id: string
  nome: string
  texto: string
  criado_em: string
}

export interface OutreachVariant {
  nome: string
  texto: string
}

export interface OutreachTemplates {
  v1: OutreachVariant
  v2: OutreachVariant
  v3: OutreachVariant
}

export interface ScraperJob {
  id: string
  query: string
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  leads_found?: number
  leads_new?: number
  error?: string
}

export interface KanbanLead {
  id: string
  nome: string
  whatsapp?: string
  telefone_google?: string
  site?: string
  cidade?: string
  estado?: string
  status: string
  score_total?: number | null
  google_rating?: number
  google_reviews?: number
  criado_em: string
  campaign_id?: string | null
  outreach_respondeu?: boolean
  outreach_status?: string | null
  wa_respondeu?: boolean | null
  wa_tempo_resposta_min?: number | null
  wa_is_bot?: boolean
}

export interface KanbanData {
  minerados: KanbanLead[]
  waEncontrado: KanbanLead[]
  contatados: KanbanLead[]
  respondidos: KanbanLead[]
  fechados: KanbanLead[]
}

export interface WhatsappStatus {
  connected: boolean
  status: string
  number?: string | null
}

export type ActivityType = 'sending' | 'sent' | 'responded' | 'bot' | 'no_response' | 'enriched' | 'error'

export interface ActivityEvent {
  id: string
  type: ActivityType
  message: string
  lead_nome?: string
  timestamp: string
}

export interface CampaignStat {
  id: string
  query: string
  status: 'running' | 'done' | 'error'
  started_at: string
  finished_at?: string
  leads_found: number
  leads_new: number
  leads_total: number
  leads_wa: number
  leads_contatados: number
  leads_respondidos: number
  error?: string
}
