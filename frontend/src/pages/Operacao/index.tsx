import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Lead, CampaignStat } from '@/types/api'
import { Phone, MessageCircle, Search, Wifi, WifiOff, MapPin, Globe, ChevronDown, ChevronUp, Skull, Eye } from 'lucide-react'
import { StatusPill } from '@/components/shared/StatusPill'
import { LeadDetailDrawer } from '@/components/shared/LeadDetailDrawer'

// ── Helpers ──────────────────────────────────────────────────────

function googleSearchUrl(lead: Lead) {
  const q = [lead.nome, lead.cidade, lead.estado, 'câmbio'].filter(Boolean).join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

function mapsUrl(lead: Lead) {
  const q = [lead.nome, lead.cidade, lead.estado].filter(Boolean).join(' ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

function elapsed(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}min`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}


// ── Sem WA input row ──────────────────────────────────────────

function WaInputRow({ lead, onSuccess }: { lead: Lead; onSuccess: () => void }) {
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState('')
  const qc = useQueryClient()

  const update = useMutation({
    mutationFn: () => api.updateLeadWhatsapp(lead.id, phone),
    onSuccess: () => {
      toast.success('WhatsApp salvo — enfileirando para mystery shop!')
      setEditing(false); setPhone('')
      qc.invalidateQueries({ queryKey: ['operacao'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      onSuccess()
    },
    onError: () => toast.error('Erro ao salvar WhatsApp'),
  })

  const discard = useMutation({
    mutationFn: () => api.discardLead(lead.id),
    onSuccess: () => {
      toast.success('Lead descartado')
      qc.invalidateQueries({ queryKey: ['operacao'] })
    },
  })

  const isSoFixo = lead.status === 'sem_whatsapp_fixo'

  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-brd rounded-xl hover:border-slate-600 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[13px] text-white truncate">{lead.nome}</span>
          {isSoFixo && (
            <span className="text-[10px] px-1.5 py-0.5 bg-sky-500/15 text-sky-400 border border-sky-500/20 rounded-full shrink-0">Só fixo</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {(lead.cidade || lead.estado) && (
            <span className="text-muted text-[11px]">{[lead.cidade, lead.estado].filter(Boolean).join(', ')}</span>
          )}
          {lead.telefone_google && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <Phone size={10} />{lead.telefone_google}
            </span>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            autoFocus
            className="bg-surface2 border border-brd text-white placeholder-muted px-2.5 py-1.5 rounded-lg text-[12px] outline-none focus:border-blue-500 w-[160px]"
            onKeyDown={e => { if (e.key === 'Enter' && phone.trim()) update.mutate() }}
          />
          <button onClick={() => phone.trim() && update.mutate()} disabled={!phone.trim() || update.isPending}
            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[12px] font-semibold rounded-lg transition-colors">
            {update.isPending ? '...' : 'Salvar'}
          </button>
          <button onClick={() => { setEditing(false); setPhone('') }} className="text-muted hover:text-white text-[12px] px-1.5">✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <a href={googleSearchUrl(lead)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="p-1.5 bg-surface2 border border-brd text-blue-400/70 hover:text-blue-400 rounded-lg transition-colors" title="Pesquisar no Google">
            <Globe size={12} />
          </a>
          <a href={mapsUrl(lead)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="p-1.5 bg-surface2 border border-brd text-red-400/70 hover:text-red-400 rounded-lg transition-colors" title="Google Maps">
            <MapPin size={12} />
          </a>
          {lead.telefone_google && (
            <a href={`tel:${lead.telefone_google.replace(/\D/g, '')}`} onClick={e => e.stopPropagation()}
              className="p-1.5 bg-surface2 border border-brd text-slate-400 hover:text-white rounded-lg transition-colors" title="Ligar">
              <Phone size={12} />
            </a>
          )}
          <button onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600/20 border border-blue-500/30 text-blue-400 hover:bg-blue-600/30 text-[11px] font-semibold rounded-lg transition-colors">
            <MessageCircle size={11} /> Adicionar WA
          </button>
          <button onClick={() => discard.mutate()} disabled={discard.isPending}
            className="px-2 py-1.5 bg-surface2 text-muted hover:text-red-400 text-[11px] rounded-lg transition-colors">
            Descartar
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sem WA section ────────────────────────────────────────────

function SemWaSection({ leads, isLoading }: { leads: Lead[]; isLoading: boolean }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(true)
  const filtered = search
    ? leads.filter(l => l.nome.toLowerCase().includes(search.toLowerCase()) || l.cidade?.toLowerCase().includes(search.toLowerCase()))
    : leads

  return (
    <div className="bg-surface border border-brd rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <WifiOff size={13} className="text-red-400 shrink-0" />
        <span className="text-[12px] font-semibold text-white">Sem WhatsApp</span>
        <span className="text-[11px] text-muted ml-1">
          — clique no Google, ache o número, adicione aqui e o lead entra no funil automaticamente
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!isLoading && <span className="text-[11px] text-muted tabular-nums">{leads.length}</span>}
          {open ? <ChevronUp size={13} className="text-muted" /> : <ChevronDown size={13} className="text-muted" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-brd">
          {isLoading ? (
            <div className="space-y-2 pt-3">{[1,2,3].map(i => <div key={i} className="h-14 bg-surface2 rounded-xl animate-pulse" />)}</div>
          ) : !leads.length ? (
            <div className="flex items-center gap-3 p-4 text-muted pt-3">
              <Wifi size={15} className="text-green-400 shrink-0" />
              <span className="text-[13px]">Todos os leads têm WhatsApp</span>
            </div>
          ) : (
            <>
              {leads.length > 5 && (
                <div className="relative pt-3">
                  <Search size={13} className="absolute left-3 top-1/2 translate-y-1 text-muted" />
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Filtrar por nome ou cidade..."
                    className="bg-surface2 border border-brd text-white placeholder-muted pl-8 pr-3 py-2 rounded-lg text-[12px] outline-none focus:border-blue-500 w-full max-w-[320px]" />
                </div>
              )}
              <div className={`space-y-2 ${leads.length > 5 ? '' : 'pt-3'}`}>
                {filtered.map(l => <WaInputRow key={l.id} lead={l} onSuccess={() => {}} />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Quick filter pill ─────────────────────────────────────────

type QuickFilter = 'todos' | 'sem_wa' | 'wa_encontrado' | 'mortos' | 'no_funil'

const QUICK_FILTERS: { id: QuickFilter; label: string; statuses: string[]; color: string; activeColor: string }[] = [
  {
    id: 'todos',
    label: 'Todos',
    statuses: [],
    color: 'bg-surface border-brd text-muted hover:text-white',
    activeColor: 'bg-slate-700 border-slate-500 text-white',
  },
  {
    id: 'sem_wa',
    label: 'Sem WhatsApp',
    statuses: ['sem_whatsapp', 'sem_whatsapp_fixo'],
    color: 'bg-surface border-brd text-muted hover:text-red-400',
    activeColor: 'bg-red-500/15 border-red-500/40 text-red-400',
  },
  {
    id: 'wa_encontrado',
    label: 'WA Encontrado',
    statuses: ['enriched'],
    color: 'bg-surface border-brd text-muted hover:text-blue-400',
    activeColor: 'bg-blue-500/15 border-blue-500/40 text-blue-400',
  },
  {
    id: 'no_funil',
    label: 'No Funil',
    statuses: ['ms_m1_sent', 'ms_m2a_sent', 'ms_m2b_sent', 'ativo', 'intelligence_done', 'eng_v1', 'eng_v2', 'eng_v3'],
    color: 'bg-surface border-brd text-muted hover:text-purple-400',
    activeColor: 'bg-purple-500/15 border-purple-500/40 text-purple-400',
  },
  {
    id: 'mortos',
    label: 'Mortos',
    statuses: ['morto'],
    color: 'bg-surface border-brd text-muted hover:text-slate-400',
    activeColor: 'bg-slate-600/30 border-slate-500/40 text-slate-300',
  },
]

// ── All leads list ────────────────────────────────────────────

function AllLeadsSection() {
  const [search, setSearch] = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('todos')
  const [campaignId, setCampaignId] = useState('')
  const [page, setPage] = useState(1)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const qc = useQueryClient()
  const LIMIT = 30

  const { data: campaigns } = useQuery({ queryKey: ['campaigns'], queryFn: api.getCampaigns })

  // Resolve status param from quick filter
  const activeFilter = QUICK_FILTERS.find(f => f.id === quickFilter)!
  // For multi-status filters (sem_wa, no_funil) we need to fetch each and combine,
  // but the API supports single status. We use undefined (all) and filter client-side
  // for the multi-status groups, or pass single status when only one.
  const statusParam = activeFilter.statuses.length === 1 ? activeFilter.statuses[0] : undefined

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['all-leads', search, quickFilter, campaignId, page],
    queryFn: () => api.getLeads({
      search: search || undefined,
      status: statusParam,
      campaign_id: campaignId || undefined,
      page,
      limit: LIMIT,
    }),
    keepPreviousData: true,
  } as any)

  const rawLeads: Lead[] = (data as any)?.leads ?? []
  const total: number = (data as any)?.total ?? 0

  // Client-side filter for multi-status groups
  const leads = activeFilter.statuses.length > 1
    ? rawLeads.filter(l => activeFilter.statuses.includes(l.status))
    : rawLeads

  function changeFilter(f: QuickFilter) {
    setQuickFilter(f); setPage(1)
  }

  return (
    <div>
      {/* Quick filters + campaign */}
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        {/* Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => changeFilter(f.id)}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-lg border transition-colors whitespace-nowrap ${
                quickFilter === f.id ? f.activeColor : f.color
              }`}
            >
              {f.id === 'mortos' && <Skull size={10} className="inline mr-1 mb-0.5" />}
              {f.label}
            </button>
          ))}
        </div>

        {/* Campaign filter */}
        {campaigns && campaigns.length > 0 && (
          <select
            value={campaignId}
            onChange={e => { setCampaignId(e.target.value); setPage(1) }}
            className="bg-surface border border-brd text-white px-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-blue-500 max-w-[200px] truncate"
          >
            <option value="">Todas as campanhas</option>
            {(campaigns as CampaignStat[]).map(c => (
              <option key={c.id} value={c.id}>
                {c.query.length > 30 ? c.query.slice(0, 30) + '…' : c.query}
              </option>
            ))}
          </select>
        )}

        {/* Search */}
        <div className="relative ml-auto">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar por nome..."
            className="bg-surface border border-brd text-white placeholder-muted pl-8 pr-3 py-1.5 rounded-lg text-[12px] outline-none focus:border-blue-500 w-[180px]"
          />
        </div>
      </div>

      {/* Count */}
      {!isLoading && (
        <p className="text-[11px] text-muted mb-2 tabular-nums">
          {total} lead{total !== 1 ? 's' : ''}
          {isFetching && !isLoading && <span className="ml-2 opacity-50">atualizando…</span>}
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-1.5">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-surface2 rounded-xl animate-pulse" />)}</div>
      ) : !leads.length ? (
        <div className="text-[13px] text-muted py-8 text-center">Nenhum lead encontrado</div>
      ) : (
        <>
          <div className="space-y-1">
            {leads.map(l => {
              const waUrl = l.whatsapp ? `https://wa.me/${l.whatsapp.replace(/\D/g, '')}` : null
              const isMorto = l.status === 'morto'
              const hasConversation = ['ms_m1_sent','ms_m2a_sent','ms_m2b_sent','ativo','intelligence_done','eng_v1','eng_v2','eng_v3','briefing_done','morto'].includes(l.status)
              const displayPhone = l.whatsapp
                ? l.whatsapp.replace(/^55/, '').replace(/(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
                : l.telefone_google
              return (
                <div
                  key={l.id}
                  className={`flex items-center gap-3 px-3 py-2.5 border rounded-xl hover:border-slate-600 transition-colors group ${
                    isMorto ? 'bg-surface/50 border-brd opacity-55' : 'bg-surface border-brd'
                  }`}
                >
                  {/* Name + location */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[13px] font-medium truncate ${isMorto ? 'text-muted line-through' : 'text-white'}`}>
                        {l.nome}
                      </span>
                      {(l.cidade || l.estado) && (
                        <span className="text-[11px] text-muted/70">{[l.cidade, l.estado].filter(Boolean).join(', ')}</span>
                      )}
                    </div>
                    {/* Phone number */}
                    {displayPhone && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Phone size={9} className={l.whatsapp ? 'text-green-400/60' : 'text-muted/40'} />
                        <span className={`text-[10px] tabular-nums ${l.whatsapp ? 'text-green-400/80' : 'text-muted/50'}`}>
                          {displayPhone}
                        </span>
                        {!l.whatsapp && <span className="text-[9px] text-muted/40">fixo</span>}
                      </div>
                    )}
                  </div>

                  {/* Status + age */}
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill status={l.status} />
                    <span className="text-[10px] text-muted/50 tabular-nums hidden md:block">{elapsed(l.criado_em)}</span>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {hasConversation && (
                      <button
                        onClick={() => setSelectedLeadId(l.id)}
                        className="p-1.5 bg-blue-500/10 border border-blue-500/20 text-blue-400/70 hover:text-blue-400 rounded-lg transition-colors"
                        title="Ver conversa"
                      >
                        <Eye size={11} />
                      </button>
                    )}
                    <a href={googleSearchUrl(l)} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 bg-surface2 border border-brd text-blue-400/70 hover:text-blue-400 rounded-lg transition-colors" title="Google">
                      <Globe size={11} />
                    </a>
                    <a href={mapsUrl(l)} target="_blank" rel="noopener noreferrer"
                      className="p-1.5 bg-surface2 border border-brd text-red-400/70 hover:text-red-400 rounded-lg transition-colors" title="Maps">
                      <MapPin size={11} />
                    </a>
                    {waUrl && (
                      <a href={waUrl} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 bg-surface2 border border-brd text-green-400/70 hover:text-green-400 rounded-lg transition-colors" title="Abrir no WhatsApp">
                        <MessageCircle size={11} />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {total > LIMIT && (
            <div className="flex items-center justify-between mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 bg-surface border border-brd text-muted hover:text-white disabled:opacity-40 text-[12px] rounded-lg transition-colors">
                ← Anterior
              </button>
              <span className="text-[12px] text-muted">Página {page} de {Math.ceil(total / LIMIT)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page * LIMIT >= total}
                className="px-3 py-1.5 bg-surface border border-brd text-muted hover:text-white disabled:opacity-40 text-[12px] rounded-lg transition-colors">
                Próxima →
              </button>
            </div>
          )}
        </>
      )}

      <LeadDetailDrawer
        leadId={selectedLeadId}
        onClose={() => {
          setSelectedLeadId(null)
          qc.invalidateQueries({ queryKey: ['all-leads'] })
        }}
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────

export function OperacaoPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['operacao'],
    queryFn: api.getOperacao,
    refetchInterval: 20_000,
  })

  return (
    <div className="space-y-6">
      <SemWaSection leads={data?.sem_wa ?? []} isLoading={isLoading} />

      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">Todos os Leads</div>
        <AllLeadsSection />
      </div>
    </div>
  )
}
