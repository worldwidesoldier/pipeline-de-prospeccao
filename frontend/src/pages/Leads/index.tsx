import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { StatusPill } from '@/components/shared/StatusPill'
import { waHref } from '@/lib/utils'
import { Search, ChevronLeft, ChevronRight, Trash2, AlertTriangle } from 'lucide-react'

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
  { value: 'descartado_bot',    label: 'Bot (descartado)' },
  { value: 'sem_whatsapp_fixo', label: '📞 Só número fixo' },
]

export function LeadsPage() {
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [page, setPage] = useState(1)
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const qc = useQueryClient()

  const { data: campaigns } = useQuery({ queryKey: ['campaigns'], queryFn: api.getCampaigns })

  const onSearch = useCallback((v: string) => {
    setSearch(v)
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => { setDebouncedSearch(v); setPage(1) }, 400)
    setTimer(t)
  }, [timer])

  const { data, isLoading } = useQuery({
    queryKey: ['leads', status, debouncedSearch, page, campaignId],
    queryFn: () => api.getLeads({ status: status || undefined, search: debouncedSearch || undefined, page, limit: LIMIT, campaign_id: campaignId || undefined }),
    placeholderData: prev => prev,
  })

  const deleteLead = useMutation({
    mutationFn: (id: string) => api.deleteLead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      toast.success('Lead deletado')
    },
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

  return (
    <div className="space-y-4">
      {/* Filters + Delete All */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1) }}
          className={inputCls}
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {campaigns && campaigns.length > 0 && (
          <select
            value={campaignId}
            onChange={e => { setCampaignId(e.target.value); setPage(1) }}
            className={`${inputCls} max-w-[220px]`}
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>
                {c.query.length > 30 ? c.query.slice(0, 30) + '…' : c.query}
              </option>
            ))}
          </select>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Buscar por nome..."
            className={`${inputCls} w-full pl-8`}
          />
        </div>
        <button
          onClick={() => setConfirmDeleteAll(true)}
          className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 text-[13px] font-semibold rounded-lg transition-colors"
        >
          <Trash2 size={13} /> Apagar tudo
        </button>
      </div>

      {/* Confirm delete all */}
      {confirmDeleteAll && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-[13px] text-red-300 flex-1">
            Apagar <strong>todos os {total} leads</strong> e dados relacionados? Isso não pode ser desfeito.
          </p>
          <button
            onClick={() => deleteAll.mutate()}
            disabled={deleteAll.isPending}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-[12px] font-bold rounded-lg transition-colors"
          >
            {deleteAll.isPending ? 'Apagando...' : 'Confirmar'}
          </button>
          <button
            onClick={() => setConfirmDeleteAll(false)}
            className="px-3 py-1.5 bg-surface2 text-muted hover:text-white text-[12px] rounded-lg transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-surface border border-brd rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="bg-surface2">
              <tr>
                {['Nome', 'Cidade / Estado', 'Status', 'WhatsApp', 'Site', 'Score', 'Google ⭐', 'Criado em', ''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] text-muted uppercase tracking-wide font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-brd">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-surface2 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : !data?.leads.length ? (
                <tr><td colSpan={9} className="py-12 text-center text-muted">Nenhum lead encontrado.</td></tr>
              ) : (
                data.leads.map(l => {
                  const wHref = waHref(l.whatsapp)
                  const date = new Date(l.criado_em).toLocaleDateString('pt-BR')
                  return (
                    <tr key={l.id} className="border-t border-brd hover:bg-white/[0.02] transition-colors group">
                      <td className="px-4 py-2.5 font-medium text-white">{l.nome}</td>
                      <td className="px-4 py-2.5 text-muted">{[l.cidade, l.estado].filter(Boolean).join(' / ')}</td>
                      <td className="px-4 py-2.5"><StatusPill status={l.status} /></td>
                      <td className="px-4 py-2.5">
                        {wHref
                          ? <a href={wHref} target="_blank" rel="noopener noreferrer" className="text-green-400 text-[12px] hover:text-green-300">✓ WA ↗</a>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.site
                          ? <a href={l.site} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-[12px] hover:text-blue-300">↗</a>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {l.score_total != null
                          ? <span className={`font-semibold ${l.score_total >= 70 ? 'text-green-400' : l.score_total >= 40 ? 'text-yellow-400' : 'text-muted'}`}>
                              {l.score_total}<span className="text-muted text-[11px]">/100</span>
                            </span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {l.google_rating
                          ? <span><span className="text-yellow-400">{l.google_rating}★</span><span className="text-muted text-[12px]"> ({l.google_reviews ?? 0})</span></span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted">{date}</td>
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() => deleteLead.mutate(l.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                          title="Deletar lead"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex justify-between items-center px-4 py-3 border-t border-brd bg-surface2">
          <span className="text-muted text-[12px]">{total > 0 ? `${start}–${end} de ${total} leads` : '0 leads'}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-brd text-[12px] rounded-lg disabled:opacity-40 hover:border-blue-500/50 transition-colors"
            >
              <ChevronLeft size={13} /> Anterior
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={end >= total}
              className="flex items-center gap-1 px-3 py-1.5 bg-surface border border-brd text-[12px] rounded-lg disabled:opacity-40 hover:border-blue-500/50 transition-colors"
            >
              Próxima <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
