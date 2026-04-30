import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Flame, Star, Globe, Mail, Phone, Instagram, Facebook, Twitter, MessageCircle, Loader2, ExternalLink, Copy, MapPin, Send, Check } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { MysteryConversation } from '@/types/api'

interface Props {
  leadId: string | null
  onClose: () => void
  mockLead?: any
}

type Tab = 'intel' | 'conversa' | 'reviews' | 'email'

// ── Mock conversation builder (preview mode) ────────────────────

function buildMockConversation(lead: any): any[] {
  const idx = getStageIndex(lead?.status)
  const sentAt = lead?.phase_sent_at ? new Date(lead.phase_sent_at).getTime() : Date.now() - 3600_000
  const out: any[] = []
  // M1
  if (idx >= 1) {
    out.push({ id: 'mock-m1-out', phase: 'M1', direction: 'SENT', message: 'Oi, tudo bem? Queria saber o valor do dólar hoje pra compra. Obrigado!', sent_at: new Date(sentAt - 30 * 60_000).toISOString() })
  }
  // M2A (sent + recebido se ativo)
  if (idx >= 2) {
    out.push({ id: 'mock-m1-in', phase: 'M1', direction: 'RECEIVED', message: 'Oi! Tudo bem. O dólar tá R$ 5.42 pra compra hoje.', sent_at: new Date(sentAt - 25 * 60_000).toISOString(), metadata: { tempo_resposta_s: 300 } })
    out.push({ id: 'mock-m2a-out', phase: 'M2A', direction: 'SENT', message: 'Beleza, e o euro? Tô vendo opções de compra fracionada também. Vocês fazem?', sent_at: new Date(sentAt - 20 * 60_000).toISOString() })
  }
  if (idx >= 3) {
    out.push({ id: 'mock-m2a-in', phase: 'M2A', direction: 'RECEIVED', message: 'Euro tá R$ 5.89 e sim, fazemos compra fracionada a partir de US$ 100. Quer agendar?', sent_at: new Date(sentAt - 15 * 60_000).toISOString(), metadata: { tempo_resposta_s: 300 } })
  }
  if (idx >= 5) {
    const variacao = lead?.engenharia_social_variacao ?? 1
    out.push({ id: 'mock-eng-out', phase: `ENG_V${variacao}`, direction: 'SENT', message: 'Obrigado! Olha, sou consultor de tecnologia pra casas de câmbio. Posso falar direto com o gestor de vocês?', sent_at: new Date(sentAt - 5 * 60_000).toISOString() })
  }
  return out
}

// ── Journey stepper ────────────────────────────────────────────

const JOURNEY_STAGES = [
  { key: 'enriched',        label: 'Enriquecido', short: 'Enrich' },
  { key: 'ms_m1_sent',      label: 'M1 enviado',  short: 'M1' },
  { key: 'ms_m2a_sent',     label: 'M2A enviado', short: 'M2A' },
  { key: 'ativo',           label: 'Conversou',   short: 'Ativo' },
  { key: 'intelligence_done', label: 'Analisado', short: 'Análise' },
  { key: 'eng_v1',          label: 'Eng. social', short: 'Eng' },
  { key: 'briefing_done',   label: 'Pra ligar',   short: 'Pra Ligar' },
] as const

function getStageIndex(status?: string): number {
  if (!status) return -1
  const map: Record<string, number> = {
    novo: -1, sem_whatsapp: 0, sem_whatsapp_fixo: 0, enriched: 0,
    ms_m1_sent: 1, ms_m2b_sent: 1,
    ms_m2a_sent: 2,
    ativo: 3,
    intelligence_done: 4,
    eng_v1: 5, eng_v2: 5, eng_v3: 5,
    briefing_done: 6,
    morto: -2,
  }
  return map[status] ?? -1
}

function JourneyStepper({ lead, conversations }: { lead: any; conversations?: any[] }) {
  const currentIdx = getStageIndex(lead?.status)
  const isMorto = lead?.status === 'morto' || lead?.tag_final === 'MORTO'

  // Try to find timestamp for each stage from conversation data
  const timestamps: Record<string, string> = {}
  conversations?.forEach((c: any) => {
    if (c.direction !== 'SENT') return
    if (c.phase === 'M1' && !timestamps.ms_m1_sent) timestamps.ms_m1_sent = c.sent_at
    if (c.phase === 'M2A' && !timestamps.ms_m2a_sent) timestamps.ms_m2a_sent = c.sent_at
  })
  if (lead?.criado_em) timestamps.enriched = lead.criado_em
  if (lead?.engenharia_social_sent_at) timestamps.eng_v1 = lead.engenharia_social_sent_at

  const fmt = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    const today = new Date()
    const isToday = d.toDateString() === today.toDateString()
    return isToday
      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="px-5 py-3 bg-surface2/40 border-b border-brd shrink-0">
      <div className="flex items-center gap-1">
        {JOURNEY_STAGES.map((stage, i) => {
          const done = !isMorto && i < currentIdx
          const current = !isMorto && i === currentIdx

          const dotColor = current
            ? 'bg-blue-500 ring-4 ring-blue-500/20 animate-pulse'
            : done
              ? 'bg-emerald-500'
              : isMorto
                ? 'bg-red-500/30'
                : 'bg-surface border border-brd'

          const lineColor = (i < currentIdx && !isMorto) ? 'bg-emerald-500/60' : 'bg-brd'
          const labelColor = current
            ? 'text-blue-300 font-bold'
            : done
              ? 'text-emerald-400/80'
              : isMorto
                ? 'text-red-400/40'
                : 'text-muted/50'

          const ts = timestamps[stage.key]

          return (
            <div key={stage.key} className="flex-1 flex flex-col items-center min-w-0">
              <div className="flex items-center w-full">
                <div className={`flex-1 h-0.5 ${i === 0 ? 'invisible' : lineColor}`} />
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${dotColor}`}>
                  {done && <Check size={11} className="text-white" />}
                  {current && <span className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className={`flex-1 h-0.5 ${i === JOURNEY_STAGES.length - 1 ? 'invisible' : (i < currentIdx && !isMorto ? 'bg-emerald-500/60' : 'bg-brd')}`} />
              </div>
              <div className={`text-[9px] font-semibold mt-1 text-center ${labelColor}`}>
                {stage.short}
              </div>
              {ts && (done || current) && (
                <div className="text-[8px] text-muted/60 tabular-nums">{fmt(ts)}</div>
              )}
            </div>
          )
        })}
      </div>
      {isMorto && (
        <div className="mt-2 text-center text-[11px] text-red-400/80 font-semibold">
          Lead marcado como MORTO
        </div>
      )}
    </div>
  )
}

export function LeadDetailDrawer({ leadId, onClose, mockLead }: Props) {
  const [tab, setTab] = useState<Tab>('intel')
  const [emailContext, setEmailContext] = useState('')
  const [generatedEmail, setGeneratedEmail] = useState<{ assunto: string; corpo: string } | null>(null)
  const [manualWa, setManualWa] = useState('')
  const qc = useQueryClient()

  // Reset ao trocar de lead
  useEffect(() => {
    setTab('intel')
    setEmailContext('')
    setGeneratedEmail(null)
    setManualWa('')
  }, [leadId])

  const { data: realLead, isLoading: realLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => api.getLead(leadId!),
    enabled: !!leadId && !mockLead,
  })

  const lead = mockLead ?? realLead
  const isLoading = !mockLead && realLoading

  // Restore draft salvo
  useEffect(() => {
    if (lead?.cold_email_draft) {
      try { setGeneratedEmail(JSON.parse(lead.cold_email_draft)) } catch {}
    }
  }, [lead?.cold_email_draft])

  const updateWaMutation = useMutation({
    mutationFn: () => api.updateLeadWhatsapp(leadId!, manualWa),
    onSuccess: () => {
      toast.success('WhatsApp salvo — enfileirado para teste')
      setManualWa('')
      qc.invalidateQueries({ queryKey: ['lead', leadId] })
      qc.invalidateQueries({ queryKey: ['leads'] })
    },
    onError: () => toast.error('Erro ao salvar WhatsApp'),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.generateEmail(leadId!, emailContext),
    onSuccess: (res: any) => {
      try {
        const parsed = JSON.parse(res.email)
        setGeneratedEmail(parsed)
        qc.invalidateQueries({ queryKey: ['lead', leadId] })
        toast.success('Email gerado!')
      } catch {
        toast.error('Erro ao processar email')
      }
    },
    onError: () => toast.error('Erro ao gerar email'),
  })

  // ALL hooks must be called before any early return (rules of hooks)
  const { data: convData } = useQuery({
    queryKey: ['lead-conversation', leadId],
    queryFn: () => api.getLeadConversation(leadId!),
    enabled: !!leadId && !mockLead, // load always so stepper can show timestamps
  })

  if (!leadId) return null

  const waHref = lead?.whatsapp
    ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`
    : null

  const gmailUrl = generatedEmail && lead?.email
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(generatedEmail.assunto)}&body=${encodeURIComponent(generatedEmail.corpo)}`
    : null

  const reviews = (lead?.google_reviews_raw as any[]) ?? []
  const painPoints = (lead?.pain_points as string[]) ?? []

  // Mock conversation for preview mode (so stepper shows timestamps)
  const mockConversations = mockLead ? buildMockConversation(mockLead) : null
  const conversations = mockConversations ?? convData?.conversations

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[520px] max-w-[95vw] bg-[#0f1117] border-l border-brd z-50 flex flex-col shadow-2xl overflow-hidden">

        {/* Empty state — when no lead data */}
        {!isLoading && !lead && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
            <div className="w-12 h-12 rounded-full bg-surface2 flex items-center justify-center">
              <X size={24} className="text-muted/50" />
            </div>
            <p className="text-[14px] text-white font-semibold">Lead não encontrado</p>
            <p className="text-[12px] text-muted text-center">Esse lead pode ter sido removido ou ainda não foi processado.</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 bg-blue-600/20 border border-blue-500/30 text-blue-300 text-[13px] rounded-lg hover:bg-blue-600/30 transition-colors">
              Fechar
            </button>
          </div>
        )}

        {/* Header */}
        {(isLoading || lead) && <>
        <div className="flex items-start justify-between px-5 py-4 border-b border-brd bg-surface shrink-0">
          <div className="flex-1 min-w-0 pr-3">
            {isLoading ? (
              <div className="h-5 w-40 bg-surface2 rounded animate-pulse" />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-white text-[15px] truncate">{lead?.nome}</h2>
                  {lead?.is_hot && (
                    <span className="flex items-center gap-1 px-2 py-0.5 bg-red-500/20 border border-red-500/40 text-red-400 text-[11px] font-bold rounded-full shrink-0">
                      <Flame size={10} /> HOT
                    </span>
                  )}
                </div>
                <p className="text-muted text-[12px] mt-0.5">
                  {[lead?.cidade, lead?.estado].filter(Boolean).join(' · ')}
                  {lead?.cep && <span className="ml-2 text-[11px]">CEP {lead.cep}</span>}
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-white hover:bg-surface2 rounded-lg transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Socials / Contacts bar */}
        {lead && (
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-brd bg-surface/50 shrink-0 flex-wrap">
            {lead.google_rating && (
              <span className="flex items-center gap-1 text-yellow-400 text-[12px]">
                <Star size={11} fill="currentColor" /> {lead.google_rating}
                <span className="text-muted">({lead.google_reviews ?? 0})</span>
              </span>
            )}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([lead.nome, lead.cidade, lead.estado].filter(Boolean).join(' '))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-md text-[11px] transition-colors"
            >
              <MapPin size={11} /> Google
            </a>
            {lead.site && (
              <a href={lead.site} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-white/10 text-blue-400 rounded-md text-[11px] transition-colors">
                <Globe size={11} /> Site
              </a>
            )}
            {waHref && (
              <a href={waHref} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-md text-[11px] transition-colors">
                <MessageCircle size={11} /> WA
              </a>
            )}
            {lead.instagram && (
              <a href={`https://instagram.com/${lead.instagram.replace('@', '')}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-white/10 text-pink-400 rounded-md text-[11px] transition-colors">
                <Instagram size={11} /> IG
              </a>
            )}
            {lead.facebook_url && (
              <a href={lead.facebook_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-white/10 text-blue-500 rounded-md text-[11px] transition-colors">
                <Facebook size={11} /> FB
              </a>
            )}
            {lead.x_url && (
              <a href={lead.x_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 bg-surface2 hover:bg-white/10 text-slate-300 rounded-md text-[11px] transition-colors">
                <Twitter size={11} /> X
              </a>
            )}
            {lead.email && (
              <span className="flex items-center gap-1 text-slate-400 text-[11px] ml-auto">
                <Mail size={11} /> {lead.email}
              </span>
            )}
            {lead.telefone_google && (
              <span className="flex items-center gap-1 text-slate-400 text-[11px]">
                <Phone size={11} /> {lead.telefone_google}
              </span>
            )}
          </div>
        )}

        {/* Journey stepper */}
        {lead && <JourneyStepper lead={lead} conversations={conversations} />}

        {/* Tabs */}
        <div className="flex border-b border-brd shrink-0 bg-surface overflow-x-auto">
          {([
            { key: 'intel', label: 'Intelligence' },
            { key: 'conversa', label: 'Conversa' },
            { key: 'reviews', label: `Reviews${reviews.length ? ` (${reviews.length})` : ''}` },
            { key: 'email', label: 'Cold Email' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-[12px] font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-muted hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          ) : (
            <>
              {/* ── SALES INTELLIGENCE ── */}
              {tab === 'intel' && (
                <div className="p-5 space-y-4">
                  {/* WhatsApp manual — aparece quando lead não tem WA */}
                  {lead && !lead.whatsapp && (
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl space-y-2">
                      <p className="text-yellow-400 text-[12px] font-semibold">WhatsApp não encontrado automaticamente</p>
                      <p className="text-yellow-300/70 text-[11px]">Se você encontrou o número manualmente (site, Instagram, etc.), cole aqui.</p>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={manualWa}
                          onChange={e => setManualWa(e.target.value)}
                          placeholder="Ex: 48 99999-1234 ou 5548999991234"
                          className="flex-1 bg-surface border border-brd text-white text-[12px] placeholder-muted px-3 py-2 rounded-lg outline-none focus:border-yellow-500 transition-colors"
                        />
                        <button
                          onClick={() => manualWa.trim() && updateWaMutation.mutate()}
                          disabled={!manualWa.trim() || updateWaMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white text-[12px] font-semibold rounded-lg transition-colors"
                        >
                          {updateWaMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                          Salvar e testar
                        </button>
                      </div>
                    </div>
                  )}

                  {lead?.is_hot && (
                    <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
                      <Flame size={18} className="text-red-400 shrink-0" />
                      <div>
                        <p className="text-red-400 font-semibold text-[13px]">Lead quente</p>
                        <p className="text-red-300/70 text-[12px]">Alta concentração de reclamações — ótima oportunidade</p>
                      </div>
                    </div>
                  )}

                  {lead?.ai_summary ? (
                    <div>
                      <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Resumo de Inteligência</h3>
                      <p className="text-[13px] text-slate-300 leading-relaxed bg-surface2 rounded-xl p-4 border border-brd">
                        {lead.ai_summary}
                      </p>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-muted text-[13px]">
                      <p>Nenhuma análise disponível.</p>
                      <p className="text-[12px] mt-1">Execute o Outscraper para coletar reviews e gerar inteligência.</p>
                    </div>
                  )}

                  {painPoints.length > 0 && (
                    <div>
                      <h3 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Dores identificadas</h3>
                      <ul className="space-y-2">
                        {painPoints.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-[13px] text-slate-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* ── CONVERSA (Mystery Shop) ── */}
              {tab === 'conversa' && (
                <div className="p-5">
                  {!conversations && !mockLead ? (
                    <div className="flex items-center justify-center h-32">
                      <Loader2 size={18} className="animate-spin text-muted" />
                    </div>
                  ) : !conversations || conversations.length === 0 ? (
                    <div className="py-10 text-center text-muted text-[13px]">
                      <p>Nenhuma conversa de mystery shop ainda.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {conversations.map((c: MysteryConversation) => {
                        const isSent = c.direction === 'SENT'
                        const phaseColor: Record<string, string> = {
                          M1: 'bg-yellow-500/15 text-yellow-400',
                          M2A: 'bg-orange-500/15 text-orange-400',
                          M2B: 'bg-red-500/15 text-red-400',
                          ENG_V1: 'bg-purple-500/15 text-purple-400',
                          ENG_V2: 'bg-purple-500/20 text-purple-300',
                          ENG_V3: 'bg-purple-500/25 text-purple-200',
                        }
                        const phaseCls = phaseColor[c.phase] ?? 'bg-surface2 text-muted'
                        return (
                          <div key={c.id} className={`flex flex-col ${isSent ? 'items-end' : 'items-start'} gap-1`}>
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${phaseCls}`}>{c.phase}</span>
                              <span className="text-[10px] text-muted">{isSent ? 'Enviado' : 'Recebido'}</span>
                              <span className="text-[10px] text-muted">
                                {new Date(c.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                {' · '}
                                {new Date(c.sent_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                              </span>
                            </div>
                            <div className={`max-w-[85%] px-3 py-2.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                              isSent
                                ? 'bg-blue-600/30 text-blue-100 border border-blue-500/25'
                                : 'bg-surface2 text-slate-300 border border-brd'
                            }`}>
                              {c.message}
                            </div>
                            {c.metadata?.tempo_resposta_s && !isSent && (
                              <span className="text-[10px] text-muted">
                                Resposta em {Math.round(c.metadata.tempo_resposta_s / 60)}min
                                {c.metadata.is_bot && ' · BOT'}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── REVIEWS ── */}
              {tab === 'reviews' && (
                <div className="p-5">
                  {reviews.length === 0 ? (
                    <div className="py-8 text-center text-muted text-[13px]">
                      <p>Nenhuma avaliação coletada ainda.</p>
                      <p className="text-[12px] mt-1">Execute o Outscraper para importar reviews do Google.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reviews.map((r: any, i: number) => (
                        <div key={i} className="p-3 bg-surface2 border border-brd rounded-xl">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[12px] font-medium text-white">{r.author || 'Anônimo'}</span>
                            <span className="flex items-center gap-0.5">
                              {Array.from({ length: 5 }).map((_, s) => (
                                <Star key={s} size={10} className={s < (r.rating ?? 0) ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600 fill-slate-600'} />
                              ))}
                            </span>
                          </div>
                          {r.text && <p className="text-[12px] text-slate-400 leading-relaxed">{r.text}</p>}
                          {r.date && <p className="text-[11px] text-muted mt-1">{r.date}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── COLD EMAIL ── */}
              {tab === 'email' && lead && (
                <div className="p-5 space-y-4">
                  {!lead?.email && (
                    <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400 text-[12px]">
                      Nenhum email encontrado para este lead. O botão Gmail não estará disponível.
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] font-semibold text-muted uppercase tracking-wide block mb-2">
                      Contexto da proposta (opcional)
                    </label>
                    <textarea
                      value={emailContext}
                      onChange={e => setEmailContext(e.target.value)}
                      placeholder="Descreva o que você quer oferecer, diferenciais, condições especiais..."
                      rows={3}
                      className="w-full bg-surface2 border border-brd text-white text-[13px] placeholder-muted rounded-xl px-3 py-2.5 resize-none outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>

                  <button
                    onClick={() => generateMutation.mutate()}
                    disabled={generateMutation.isPending}
                    className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[13px] font-semibold rounded-xl transition-colors"
                  >
                    {generateMutation.isPending
                      ? <><Loader2 size={14} className="animate-spin" /> Gerando...</>
                      : '⚡ Gerar Email Personalizado'}
                  </button>

                  {generatedEmail && (
                    <div className="space-y-3">
                      <div className="p-3 bg-surface2 border border-brd rounded-xl">
                        <p className="text-[10px] text-muted uppercase tracking-wide mb-1">Assunto</p>
                        <p className="text-[13px] text-white font-medium">{generatedEmail.assunto}</p>
                      </div>
                      <div className="p-3 bg-surface2 border border-brd rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-muted uppercase tracking-wide">Corpo</p>
                          <button
                            onClick={() => { navigator.clipboard.writeText(generatedEmail.corpo); toast.success('Copiado!') }}
                            className="flex items-center gap-1 text-[11px] text-muted hover:text-white transition-colors"
                          >
                            <Copy size={11} /> Copiar
                          </button>
                        </div>
                        <p className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap">{generatedEmail.corpo}</p>
                      </div>

                      {gmailUrl ? (
                        <a
                          href={gmailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-[13px] font-semibold rounded-xl transition-colors"
                        >
                          <ExternalLink size={14} /> Abrir no Gmail
                        </a>
                      ) : (
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${generatedEmail.assunto}\n\n${generatedEmail.corpo}`); toast.success('Email copiado — cole no seu cliente de email') }}
                          className="flex items-center justify-center gap-2 w-full py-2.5 bg-surface2 border border-brd text-muted text-[13px] font-semibold rounded-xl transition-colors hover:text-white"
                        >
                          <Copy size={14} /> Copiar email completo
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        </>}
      </div>
    </>
  )
}
