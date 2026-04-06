import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { CampaignStat } from '@/types/api'
import { Play, CheckCircle, XCircle, Clock, RefreshCw, Activity, TrendingUp, RotateCcw } from 'lucide-react'

// ─── Activity Feed ────────────────────────────────────────────────

const ACTIVITY_ICONS: Record<string, { icon: string; cls: string }> = {
  sending:     { icon: '📤', cls: 'text-blue-400' },
  sent:        { icon: '✅', cls: 'text-green-400' },
  responded:   { icon: '💬', cls: 'text-purple-400' },
  bot:         { icon: '🤖', cls: 'text-red-400' },
  no_response: { icon: '⏰', cls: 'text-yellow-400' },
  enriched:    { icon: '🔍', cls: 'text-cyan-400' },
  error:       { icon: '❌', cls: 'text-red-500' },
}

function ActivityFeed() {
  const { data: events } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(30),
    refetchInterval: 5000,
  })

  return (
    <div className="bg-surface border border-brd rounded-xl flex flex-col" style={{ height: 420 }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-brd flex-shrink-0">
        <Activity size={14} className="text-blue-400" />
        <span className="text-[13px] font-semibold text-white">Atividade em tempo real</span>
        <span className="ml-auto text-[11px] text-muted">atualiza a cada 5s</span>
      </div>
      <div className="overflow-y-auto flex-1 px-2 py-2 space-y-1">
        {!events?.length ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted">
            <Clock size={20} className="opacity-40" />
            <p className="text-[12px]">Nenhuma atividade ainda.</p>
            <p className="text-[11px] opacity-60">As mensagens aparecerão aqui em tempo real.</p>
          </div>
        ) : events.map(ev => {
          const icon = ACTIVITY_ICONS[ev.type] ?? { icon: '•', cls: 'text-muted' }
          const time = new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          return (
            <div key={ev.id} className="flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors">
              <span className="text-[14px] mt-0.5 flex-shrink-0">{icon.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-[12px] leading-snug ${icon.cls}`}>{ev.message}</p>
              </div>
              <span className="text-[10px] text-muted flex-shrink-0 mt-0.5 tabular-nums">{time}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────

function CampaignCard({ camp }: { camp: CampaignStat }) {
  const elapsed = camp.finished_at
    ? Math.round((new Date(camp.finished_at).getTime() - new Date(camp.started_at).getTime()) / 1000) + 's'
    : Math.round((Date.now() - new Date(camp.started_at).getTime()) / 1000) + 's'

  const waRate = camp.leads_found > 0 ? Math.round((camp.leads_wa / camp.leads_found) * 100) : 0
  const contactRate = camp.leads_wa > 0 ? Math.round((camp.leads_contatados / camp.leads_wa) * 100) : 0

  return (
    <div className="bg-surface2 border border-brd rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[13px] text-white truncate">{camp.query}</p>
          <p className="text-muted text-[11px] mt-0.5">
            {new Date(camp.started_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {camp.status !== 'running' && ` · ${elapsed}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {camp.status === 'running' && <RefreshCw size={12} className="animate-spin text-yellow-400" />}
          {camp.status === 'done' && <CheckCircle size={12} className="text-green-400" />}
          {camp.status === 'error' && <XCircle size={12} className="text-red-400" />}
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            camp.status === 'running' ? 'bg-yellow-500/15 text-yellow-400'
            : camp.status === 'done' ? 'bg-green-500/15 text-green-400'
            : 'bg-red-500/15 text-red-400'
          }`}>
            {camp.status === 'running' ? 'Rodando' : camp.status === 'done' ? 'Concluída' : 'Erro'}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-surface rounded-lg px-3 py-2 text-center">
          <p className="text-[18px] font-bold text-white tabular-nums">{camp.leads_found}</p>
          <p className="text-[10px] text-muted mt-0.5">Encontrados</p>
        </div>
        <div className="bg-surface rounded-lg px-3 py-2 text-center">
          <p className="text-[18px] font-bold text-green-400 tabular-nums">{camp.leads_wa}</p>
          <p className="text-[10px] text-muted mt-0.5">Com WA</p>
          {waRate > 0 && <p className="text-[9px] text-green-400/70">{waRate}%</p>}
        </div>
        <div className="bg-surface rounded-lg px-3 py-2 text-center">
          <p className="text-[18px] font-bold text-blue-400 tabular-nums">{camp.leads_contatados}</p>
          <p className="text-[10px] text-muted mt-0.5">Contatados</p>
          {contactRate > 0 && <p className="text-[9px] text-blue-400/70">{contactRate}%</p>}
        </div>
        <div className="bg-surface rounded-lg px-3 py-2 text-center">
          <p className="text-[18px] font-bold text-purple-400 tabular-nums">{camp.leads_respondidos}</p>
          <p className="text-[10px] text-muted mt-0.5">Respondidos</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────

export function CampanhasPage() {
  const [query, setQuery] = useState('')
  const [max, setMax] = useState('80')
  const [templateId, setTemplateId] = useState('')
  const qc = useQueryClient()

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: api.getCampaigns,
    refetchInterval: (q) => q.state.data?.some(c => c.status === 'running') ? 5000 : 15000,
  })

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: api.getTemplates,
  })

  const trigger = useMutation({
    mutationFn: () => api.triggerScrape({ query: query.trim(), max: parseInt(max), templateId: templateId || undefined }),
    onSuccess: () => {
      setQuery('')
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Campanha iniciada!')
    },
    onError: () => toast.error('Erro ao disparar campanha'),
  })

  const replay = useMutation({
    mutationFn: api.replayResponses,
    onSuccess: (res) => {
      const r = res as { replayed: number }
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(r.replayed > 0 ? `${r.replayed} respostas recuperadas!` : 'Nenhuma resposta nova encontrada')
    },
    onError: () => toast.error('Erro ao recuperar respostas'),
  })

  const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2.5 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-6">
      {/* New campaign form */}
      <div className="bg-surface border border-brd rounded-xl p-5 space-y-4">
        <p className="text-muted text-[12px]">
          Cole uma query ou URL do Google Maps. O pipeline roda completo: Maps → Site → Instagram → WA → Score → Aprovação.
        </p>
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) trigger.mutate() }}
            placeholder="casa de câmbio Porto Alegre · ou link do Maps"
            className={`${inputCls} flex-1 min-w-[260px]`}
          />
          <select value={max} onChange={e => setMax(e.target.value)} className={inputCls}>
            {['20', '30', '50', '80', '100'].map(v => (
              <option key={v} value={v}>{v} leads</option>
            ))}
          </select>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputCls}>
            <option value="">Mensagem gerada por IA</option>
            {templates?.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <button
            onClick={() => query.trim() && trigger.mutate()}
            disabled={!query.trim() || trigger.isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold text-[13px] rounded-lg transition-colors"
          >
            <Play size={14} />
            {trigger.isPending ? 'Iniciando...' : 'Disparar'}
          </button>
          <button
            onClick={() => replay.mutate()}
            disabled={replay.isPending}
            title="Recupera respostas perdidas do histórico do WhatsApp (útil após restart)"
            className="flex items-center gap-2 px-3 py-2.5 bg-surface2 border border-brd text-muted hover:text-white disabled:opacity-40 text-[13px] rounded-lg transition-colors"
          >
            <RotateCcw size={13} className={replay.isPending ? 'animate-spin' : ''} />
            {replay.isPending ? 'Recuperando...' : 'Recuperar respostas'}
          </button>
        </div>
      </div>

      {/* Main content: campaigns + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaign list */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-muted" />
            <span className="text-[13px] font-semibold text-white">Histórico de campanhas</span>
            {campaigns && <span className="text-[11px] text-muted">({campaigns.length})</span>}
          </div>
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-surface2 border border-brd rounded-xl p-4 h-32 animate-pulse" />
            ))
          ) : !campaigns?.length ? (
            <div className="bg-surface border border-brd rounded-xl p-8 text-center space-y-2">
              <Clock size={20} className="text-muted mx-auto opacity-40" />
              <p className="text-[13px] text-muted">Nenhuma campanha ainda.</p>
              <p className="text-[11px] text-muted opacity-60">Dispare a primeira campanha acima.</p>
            </div>
          ) : (
            campaigns.map(c => <CampaignCard key={c.id} camp={c} />)
          )}
        </div>

        {/* Activity feed */}
        <ActivityFeed />
      </div>
    </div>
  )
}
