export interface Lead {
  id: string
  nome: string
  telefone_google?: string
  whatsapp?: string
  whatsapp_source?: string
  site?: string
  instagram?: string
  facebook_url?: string
  x_url?: string
  email?: string
  cep?: string
  endereco?: string
  cidade?: string
  estado?: string
  google_rating?: number
  google_reviews?: number
  status: string
  criado_em: string
  score_total?: number | null
  campaign_id?: string | null
  // Sales Intelligence
  is_hot?: boolean
  pain_points?: string[]
  ai_summary?: string
  cold_email_draft?: string
  google_reviews_raw?: GoogleReview[]
  // V2 Mystery Shop
  tag_final?: 'ATIVO' | 'MORTO'
  tipo_atendimento?: string
  qualidade_resposta?: string
  dor_perfil?: 'INEFICIENCIA' | 'OPORTUNIDADE'
  pontos_fracos?: string[]
  pontos_fortes?: string[]
  tom_atendente?: string
  tempo_resposta_m1?: number
  taxa_oferecida?: string
  engenharia_social_sent_at?: string
  engenharia_social_variacao?: number
  status_numero?: 'AGUARDANDO' | 'RECEBIDO' | 'NEGADO'
  gestor_phone?: string
  briefing_gerado?: string
  // Funil: time the current phase message was sent (from mystery_conversations)
  phase_sent_at?: string
}

export interface MysteryConversation {
  id: string
  lead_id: string
  phase: string
  direction: 'SENT' | 'RECEIVED'
  message: string
  metadata?: { tempo_resposta_s?: number; is_bot?: boolean }
  sent_at: string
}

export interface Briefing {
  id: string
  nome: string
  cidade?: string
  estado?: string
  whatsapp?: string
  gestor_phone?: string
  briefing_gerado?: string
  tipo_atendimento?: string
  dor_perfil?: 'INEFICIENCIA' | 'OPORTUNIDADE'
  pontos_fracos?: string[]
  pontos_fortes?: string[]
  qualidade_resposta?: string
  call_outcome?: 'fechou' | 'sem_interesse' | 'sem_resposta' | null
}

export interface OperacaoData {
  sem_wa: Lead[]
  in_progress: {
    ms_m1_sent: Lead[]
    ms_m2a_sent: Lead[]
    ms_m2b_sent: Lead[]
    ativo: Lead[]
    intelligence_done: Lead[]
    eng_v1: Lead[]
    eng_v2: Lead[]
    eng_v3: Lead[]
  }
}

export interface SocEngVariant {
  nome: string
  texto: string
}

export interface SocEngTemplates {
  v1: SocEngVariant
  v2: SocEngVariant
  v3: SocEngVariant
}

export interface GoogleReview {
  author: string
  rating: number
  text: string
  date?: string
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
  // V2
  novo: number
  enriched: number
  ms_m1_sent: number
  ms_m2a_sent: number
  ms_m2b_sent: number
  ativo: number
  intelligence_done: number
  eng_v1: number
  eng_v2: number
  eng_v3: number
  briefing_done: number
  morto: number
  // legacy / sem WA
  descartado: number
  sem_whatsapp: number
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
  semWhatsapp: KanbanLead[]
  contatados: KanbanLead[]
  respondidos: KanbanLead[]
  fechados: KanbanLead[]
}

export interface WhatsappStatus {
  connected: boolean
  status: string
  number?: string | null
}

export type ActivityType = 'sending' | 'sent' | 'responded' | 'bot' | 'no_response' | 'enriched' | 'error' | 'intelligence' | 'social_eng' | 'phone_received' | 'briefing'

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
