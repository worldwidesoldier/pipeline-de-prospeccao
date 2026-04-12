import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { StatusPill } from '@/components/shared/StatusPill'
import { LeadDetailDrawer } from '@/components/shared/LeadDetailDrawer'
import { Search, ChevronLeft, ChevronRight, Trash2, AlertTriangle, Flame, Globe, MessageCircle, Instagram, Facebook, Twitter, Mail, Phone, Star, Bot, MapPin, Download } from 'lucide-react'

const LIMIT = 20

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'novo', label: 'Novo' },
  { value: 'enriched', label: 'Enriquecido' },
  { value: 'tested', label: 'Testado' },
  { value: 'scored', label: 'Scored' },
  { value: 'pending_approval', label: 'Pendente Aprovação' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'outreach', label: 'Outreach' },
  { value: 'descartado', label: 'Descartado' },
  { value: 'descartado_bot', label: 'Bot (descartado)' },
  { value: 'sem_whatsapp', label: 'Sem WhatsApp' },
  { value: 'sem_whatsapp_fixo', label: '📞 Só número fixo' },
]

function SocialButtons({ lead }: { lead: any }) {
  const waHref = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}` : null
  const igHref = lead.instagram ? `https://instagram.com/${lead.instagram.replace('@', '')}` : null
  return (
    <div className="flex items-center gap-1">
      {waHref && (
        <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title="WhatsApp" className="p-1 rounded-md bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors">
          <MessageCircle size={12} />
        </a>
      )}
      {igHref && (
        <a href={igHref} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title="Instagram" className="p-1 rounded-md bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-colors">
          <Instagram size={12} />
        </a>
      )}
      {lead.facebook_url && (
        <a href={lead.facebook_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title="Facebook" className="p-1 rounded-md bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors">
          <Facebook size={12} />
        </a>
      )}
      {lead.x_url && (
        <a href={lead.x_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title="X / Twitter" className="p-1 rounded-md bg-white/5 text-slate-400 hover:bg-white/10 transition-colors">
          <Twitter size={12} />
        </a>
      )}
      {lead.site && (
        <a href={lead.site} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title="Site" className="p-1 rounded-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors">
          <Globe size={12} />
        </a>
      )}
    </div>
  )
}

export function LeadsPage() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [niche, setNiche] = useState('')
  const [page, setPage] = useState(1)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: campaigns } = useQuery({ queryKey: ['campaigns'], queryFn: api.getCampaigns })
  const { data: niches } = useQuery({ queryKey: ['niches'], queryFn: api.getNiches })

  const onSearch = useCallback((v: string) => {
    setSearch(v)
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
    setTimer(t)
  }, [timer])

  const { data, isLoading } = useQuery({
    queryKey: ['leads', status, debouncedSearch, page, campaignId, niche],
    queryFn: () => api.getLeads({ status: status || undefined, search: debouncedSearch || undefined, page, limit: LIMIT, campaign_id: campaignId || undefined, niche: niche || undefined }),
    placeholderData: prev => prev,
  })

  const deleteLead = useMutation({
    mutationFn: (id: string) => api.deleteLead(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['leads'] }); toast.success('Lead deletado') },
    onError: () => toast.error('Erro ao deletar lead'),
  })

  const deleteAll = useMutation({
    mutationFn: api.deleteAllLeads,
    onSuccess: (res) => {
      const r = res as { deleted: number }
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['inbox'] })
      setConfirmDeleteAll(false)
      toast.success(`${r.deleted} leads deletados`)
    },
    onError: () => toast.error('Erro ao deletar leads'),
  })

  const total = data?.total ?? 0
  const start = (page - 1) * LIMIT + 1
  const end = Math.min(page * LIMIT, total)
  const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors'
  const HEADERS = ['', 'Nome', 'Endereço', 'Cidade', 'UF', 'Email', 'Telefone', 'Socials', 'Reviews', 'Score', 'Status', '']

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className={`${inputCls} flex-1 min-w-[140px]`}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {niches && niches.length > 0 && (
          <select value={niche} onChange={e => { setNiche(e.target.value); setCampaignId(''); setPage(1) }} className={`${inputCls} min-w-[140px]`}>
            <option value="">Todos os nichos</option>
            {niches.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {campaigns && campaigns.length > 0 && (
          <select value={campaignId} onChange={e => { setCampaignId(e.target.value); setNiche(''); setPage(1) }} className={`${inputCls} flex-1 min-w-[140px] max-w-[220px]`}>
            <option value="">Todas as campanhas</option>
            {campaigns.map(c => <option key={c.id} value={c.id}>{c.query.length > 30 ? c.query.slice(0, 30) + '…' : c.query}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" value={search} onChange={e => onSearch(e.target.value)}
            placeholder="Buscar por nome..." className={`${inputCls} w-full pl-8`} />
        </div>
        <a
          href={api.exportLeadsCsvUrl(status || undefined, campaignId || undefined)}
          download="leads.csv"
          className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 hover:bg-green-500/20 text-[13px] font-semibold rounded-lg transition-colors shrink-0"
          title="Exportar CSV"
        >
          <Download size={13} />
          <span className="hidden sm:inline">Exportar</span>
        </a>
        <button onClick={() => setConfirmDeleteAll(true)}
          className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-[13px] font-semibold rounded-lg transition-colors shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {confirmDeleteAll && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 shrink-0" />
          <p className="text-[13px] text-red-300 flex-1">Apagar <strong>todos os {total} leads</strong> e dados relacionados? Isso não pode ser desfeito.</p>
          <button onClick={() => deleteAll.mutate()} disabled={deleteAll.isPending}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-[12px] font-bold rounded-lg transition-colors">
            {deleteAll.isPending ? 'Apagando...' : 'Confirmar'}
          </button>
          <button onClick={() => setConfirmDeleteAll(false)}
            className="px-3 py-1.5 bg-surface2 text-muted hover:text-white text-[12px] rounded-lg transition-colors">Cancelar</button>
        </div>
      )}

      {/* ── MOBILE: card list ── */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface border border-brd rounded-xl p-4 h-24 animate-pulse" />
          ))
        ) : !data?.leads.length ? (
          <div className="py-12 text-center text-muted text-[13px]">Nenhum lead encontrado.</div>
        ) : (
          data.leads.map(l => {
            const waHref = l.whatsapp ? `https://wa.me/${l.whatsapp.replace(/\D/g, '')}` : null
            const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([l.nome, l.cidade, l.estado].filter(Boolean).join(' '))}`
            return (
              <div key={l.id} onClick={() => setSelectedLeadId(l.id)}
                className="bg-surface border border-brd rounded-xl p-4 cursor-pointer active:bg-white/[0.04] transition-colors">
                {/* Row 1: name + badges + status */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {(l as any).is_hot && <Flame size={13} className="text-red-400 shrink-0" />}
                    {(l as any).wa_is_bot && <Bot size={13} className="text-purple-400 shrink-0" />}
                    <span className="font-semibold text-white text-[14px] truncate">{l.nome}</span>
                  </div>
                  <StatusPill status={l.status} />
                </div>
                {/* Row 2: city + score */}
                <div className="flex items-center gap-3 mb-3">
                  {(l.cidade || l.estado) && (
                    <span className="text-muted text-[12px] truncate">
                      {[l.cidade, l.estado].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {l.score_total != null && (
                    <span className={`text-[12px] font-semibold ml-auto shrink-0 ${l.score_total >= 70 ? 'text-green-400' : l.score_total >= 40 ? 'text-yellow-400' : 'text-muted'}`}>
                      {l.score_total}<span className="text-muted font-normal text-[10px]">/100</span>
                    </span>
                  )}
                  {l.google_rating && (
                    <span className="flex items-center gap-1 text-[12px] shrink-0">
                      <Star size={11} className="text-yellow-400 fill-yellow-400" />
                      <span className="text-yellow-400">{l.google_rating}</span>
                    </span>
                  )}
                </div>
                {/* Row 3: action buttons */}
                <div className="flex items-center gap-2">
                  {waHref ? (
                    <a href={waHref} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/10 border border-green-500/20 text-green-400 text-[12px] font-semibold rounded-lg">
                      <MessageCircle size={13} /> WA
                    </a>
                  ) : (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-brd text-muted text-[12px] rounded-lg">
                      <MessageCircle size={13} /> Sem WA
                    </span>
                  )}
                  <a href={mapsHref} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] font-semibold rounded-lg">
                    <MapPin size={13} /> Google
                  </a>
                  {l.site && (
                    <a href={l.site} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-brd text-blue-400 text-[12px] rounded-lg">
                      <Globe size={13} /> Site
                    </a>
                  )}
                  <button onClick={e => { e.stopPropagation(); deleteLead.mutate(l.id) }}
                    className="ml-auto p-2 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })
        )}
        {/* Mobile pagination */}
        <div className="flex justify-between items-center pt-1">
          <span className="text-muted text-[12px]">{total > 0 ? `${start}–${end} de ${total}` : '0 leads'}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
              className="p-2 bg-surface border border-brd rounded-lg disabled:opacity-40">
              <ChevronLeft size={15} />
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={end >= total}
              className="p-2 bg-surface border border-brd rounded-lg disabled:opacity-40">
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ── DESKTOP: table ── */}
      <div className="hidden md:block bg-surface border border-brd rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-surface2">
              <tr>
                {HEADERS.map((h, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-[10px] text-muted uppercase tracking-wide font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-brd">
                    {HEADERS.map((_, j) => <td key={j} className="px-3 py-2.5"><div className="h-3 bg-surface2 rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : !data?.leads.length ? (
                <tr><td colSpan={HEADERS.length} className="py-12 text-center text-muted">Nenhum lead encontrado.</td></tr>
              ) : (
                data.leads.map(l => (
                  <tr key={l.id} onClick={() => setSelectedLeadId(l.id)}
                    className="border-t border-brd hover:bg-white/[0.025] transition-colors group cursor-pointer">
                    <td className="px-3 py-2.5 w-8">
                      <div className="flex flex-col gap-0.5 items-center">
                        {(l as any).is_hot && <span title="Lead quente"><Flame size={12} className="text-red-400" /></span>}
                        {(l as any).wa_is_bot && <span title="Bot detectado no WA"><Bot size={12} className="text-purple-400" /></span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-white whitespace-nowrap max-w-[160px] truncate">{l.nome}</td>
                    <td className="px-3 py-2.5 text-muted max-w-[150px] truncate">{l.endereco || '—'}</td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{l.cidade || '—'}</td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap">{l.estado || '—'}</td>
                    <td className="px-3 py-2.5">
                      {(l as any).email
                        ? <span className="flex items-center gap-1 text-slate-400"><Mail size={10} /><span className="truncate max-w-[130px]">{(l as any).email}</span></span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.telefone_google
                        ? <span className="flex items-center gap-1 text-slate-400 whitespace-nowrap"><Phone size={10} />{l.telefone_google}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5"><SocialButtons lead={l} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {l.google_rating
                        ? <span className="flex items-center gap-1">
                            <Star size={10} className="text-yellow-400 fill-yellow-400" />
                            <span className="text-yellow-400">{l.google_rating}</span>
                            <span className="text-muted">({l.google_reviews ?? 0})</span>
                          </span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {l.score_total != null
                        ? <span className={`font-semibold ${l.score_total >= 70 ? 'text-green-400' : l.score_total >= 40 ? 'text-yellow-400' : 'text-muted'}`}>
                            {l.score_total}<span className="text-muted text-[10px]">/100</span>
                          </span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={l.status} />
                      {l.status === 'outreach' && (
                        <div className="text-[10px] text-muted mt-0.5">
                          {(l as any).outreach_respondeu
                            ? `Respondeu · ${(l as any).outreach_interesse || 'médio'}`
                            : (l as any).outreach_msg4 ? 'Msg 4 · último'
                            : (l as any).outreach_msg3 ? 'Msg 3 enviada'
                            : (l as any).outreach_msg2 ? 'Msg 2 enviada'
                            : 'Msg 1 enviada'}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <button onClick={e => { e.stopPropagation(); deleteLead.mutate(l.id) }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all" title="Deletar lead">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-4 py-3 border-t border-brd bg-surface2">
          <span className="text-muted text-[12px]">{total > 0 ? `${start}–${end} de ${total} leads` : '0 leads'}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-brd text-[12px] rounded-lg disabled:opacity-40 hover:border-blue-500/50 transition-colors">
              <ChevronLeft size={13} /> Anterior
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={end >= total}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-brd text-[12px] rounded-lg disabled:opacity-40 hover:border-blue-500/50 transition-colors">
              Próxima <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      <LeadDetailDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
    </div>
  )
}
