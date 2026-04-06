import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Flame, Star, Globe, Mail, Phone, Instagram, Facebook, Twitter, MessageCircle, Loader2, ExternalLink, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'

interface Props {
  leadId: string | null
  onClose: () => void
}

type Tab = 'intel' | 'reviews' | 'email'

export function LeadDetailDrawer({ leadId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('intel')
  const [emailContext, setEmailContext] = useState('')
  const [generatedEmail, setGeneratedEmail] = useState<{ assunto: string; corpo: string } | null>(null)
  const qc = useQueryClient()

  // Reset ao trocar de lead
  useEffect(() => {
    setTab('intel')
    setEmailContext('')
    setGeneratedEmail(null)
  }, [leadId])

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => api.getLead(leadId!),
    enabled: !!leadId,
  })

  // Restore draft salvo
  useEffect(() => {
    if (lead?.cold_email_draft) {
      try { setGeneratedEmail(JSON.parse(lead.cold_email_draft)) } catch {}
    }
  }, [lead?.cold_email_draft])

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

  if (!leadId) return null

  const waHref = lead?.whatsapp
    ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`
    : null

  const gmailUrl = generatedEmail && lead?.email
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(generatedEmail.assunto)}&body=${encodeURIComponent(generatedEmail.corpo)}`
    : null

  const reviews = (lead?.google_reviews_raw as any[]) ?? []
  const painPoints = (lead?.pain_points as string[]) ?? []

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[520px] max-w-[95vw] bg-[#0f1117] border-l border-brd z-50 flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
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

        {/* Tabs */}
        <div className="flex border-b border-brd shrink-0 bg-surface">
          {([
            { key: 'intel', label: 'Sales Intelligence' },
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
              {tab === 'email' && (
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
      </div>
    </>
  )
}
