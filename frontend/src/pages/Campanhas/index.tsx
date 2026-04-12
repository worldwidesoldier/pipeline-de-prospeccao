import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { CampaignStat } from '@/types/api'
import {
  Play, CheckCircle, XCircle, Clock, RefreshCw, Activity, TrendingUp,
  RotateCcw, Pause, PlayCircle, Zap, AlertTriangle, MapPin, Tag, Sparkles, Trash2,
} from 'lucide-react'

// ─── Countdown hook ───────────────────────────────────────────────

function useCountdown(targetIso: string | null | undefined): number | null {
  const [secsLeft, setSecsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!targetIso) { setSecsLeft(null); return }
    const target = new Date(targetIso).getTime()
    const calc = () => Math.max(0, Math.round((target - Date.now()) / 1000))
    setSecsLeft(calc())
    const id = setInterval(() => setSecsLeft(calc()), 1000)
    return () => clearInterval(id)
  }, [targetIso])

  return secsLeft
}

// ─── Motor Status Card ────────────────────────────────────────────

function MotorCard() {
  const qc = useQueryClient()

  const { data: motor, isLoading } = useQuery({
    queryKey: ['motorStatus'],
    queryFn: api.getMotorStatus,
    refetchInterval: 8000,
  })

  const pause = useMutation({
    mutationFn: api.pauseMotor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['motorStatus'] })
      toast.success('Motor pausado')
    },
    onError: () => toast.error('Erro ao pausar motor'),
  })

  const resume = useMutation({
    mutationFn: api.resumeMotor,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['motorStatus'] })
      toast.success('Motor retomado')
    },
    onError: () => toast.error('Erro ao retomar motor'),
  })

  const requeue = useMutation({
    mutationFn: api.requeueWaTest,
    onSuccess: (res) => {
      const r = res as { queued: number }
      toast.success(r.queued > 0 ? `${r.queued} leads re-enfileirados` : 'Nenhum lead pendente')
    },
    onError: () => toast.error('Erro ao re-enfileirar'),
  })

  const isPaused = motor?.status === 'paused'
  const isAtLimit = motor ? motor.remaining === 0 : false
  const countdown = useCountdown(motor?.nextSendAt)

  return (
    <div className={`bg-surface border rounded-xl p-5 space-y-4 ${
      isPaused ? 'border-yellow-500/40' : isAtLimit ? 'border-red-500/30' : 'border-brd'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-2 rounded-full ${
            isLoading ? 'bg-gray-500' :
            isPaused ? 'bg-yellow-400 animate-pulse' :
            isAtLimit ? 'bg-red-400' :
            'bg-green-400 animate-pulse'
          }`} />
          <span className="text-[13px] font-semibold text-white">Motor de Envio WA</span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            isPaused ? 'bg-yellow-500/15 text-yellow-400'
            : isAtLimit ? 'bg-red-500/15 text-red-400'
            : 'bg-green-500/15 text-green-400'
          }`}>
            {isLoading ? '...' : isPaused ? 'Pausado' : isAtLimit ? 'Limite atingido' : 'Rodando'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => requeue.mutate()}
            disabled={requeue.isPending}
            title="Re-enfileirar leads com WA que ainda não foram testados"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface2 border border-brd text-muted hover:text-white disabled:opacity-40 text-[12px] rounded-lg transition-colors"
          >
            <RotateCcw size={11} className={requeue.isPending ? 'animate-spin' : ''} />
            Re-enfileirar
          </button>
          {isPaused ? (
            <button
              onClick={() => resume.mutate()}
              disabled={resume.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold text-[12px] rounded-lg transition-colors"
            >
              <PlayCircle size={13} />
              Retomar
            </button>
          ) : (
            <button
              onClick={() => pause.mutate()}
              disabled={pause.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white font-semibold text-[12px] rounded-lg transition-colors"
            >
              <Pause size={13} />
              Pausar
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-surface2 rounded-lg px-3 py-2.5 text-center">
          <p className="text-[20px] font-bold text-white tabular-nums">{motor?.pendingCount ?? '—'}</p>
          <p className="text-[10px] text-muted mt-0.5">Aguardando</p>
        </div>
        <div className="bg-surface2 rounded-lg px-3 py-2.5 text-center">
          <p className="text-[20px] font-bold text-blue-400 tabular-nums">{motor?.todayCount ?? '—'}</p>
          <p className="text-[10px] text-muted mt-0.5">Enviados hoje</p>
        </div>
        <div className="bg-surface2 rounded-lg px-3 py-2.5 text-center">
          <p className={`text-[20px] font-bold tabular-nums ${
            isAtLimit ? 'text-red-400' : 'text-green-400'
          }`}>{motor?.remaining ?? '—'}</p>
          <p className="text-[10px] text-muted mt-0.5">Restam hoje</p>
        </div>
        <div className="bg-surface2 rounded-lg px-3 py-2.5 text-center">
          <p className="text-[20px] font-bold text-muted tabular-nums">{motor?.maxDaily ?? '—'}</p>
          <p className="text-[10px] text-muted mt-0.5">Limite diário</p>
        </div>
      </div>

      {/* Status line */}
      {motor && (
        <div className="space-y-2">
          {/* Last sent */}
          {motor.lastSentAt && (
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="flex-shrink-0">Último envio:</span>
              <span className="text-white font-medium truncate">
                {motor.lastSentLeadNome
                  ? <><span className="text-blue-300">{motor.lastSentLeadNome}</span> · {new Date(motor.lastSentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                  : new Date(motor.lastSentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                }
              </span>
            </div>
          )}

          {/* Next lead countdown */}
          {motor.nextSendAt && !isPaused && !isAtLimit && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
              countdown !== null && countdown <= 60
                ? 'bg-green-500/10 border border-green-500/20'
                : 'bg-surface2'
            }`}>
              <Zap size={11} className={countdown !== null && countdown <= 60 ? 'text-green-400 animate-pulse' : 'text-blue-400'} />
              <span className="text-[11px] text-muted flex-shrink-0">Próxima mensagem:</span>
              {motor.nextLeadNome && (
                <span className="text-[11px] text-white font-semibold truncate">{motor.nextLeadNome}</span>
              )}
              {countdown !== null && countdown > 0 ? (
                <span className={`text-[12px] font-bold tabular-nums ml-auto flex-shrink-0 ${
                  countdown <= 30 ? 'text-green-400' : countdown <= 120 ? 'text-yellow-400' : 'text-muted'
                }`}>
                  {countdown >= 3600
                    ? `${Math.floor(countdown / 3600)}h ${Math.floor((countdown % 3600) / 60)}m`
                    : countdown >= 60
                    ? `${Math.floor(countdown / 60)}m ${countdown % 60}s`
                    : `${countdown}s`
                  }
                </span>
              ) : countdown === 0 ? (
                <span className="text-[11px] text-green-400 font-semibold ml-auto flex-shrink-0 animate-pulse">enviando agora...</span>
              ) : (
                <span className="text-[11px] text-muted ml-auto flex-shrink-0">{new Date(motor.nextSendAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
              )}
            </div>
          )}

          {isPaused && motor.pausedAt && (
            <div className="flex items-center gap-1 text-[11px] text-yellow-400">
              <AlertTriangle size={10} />
              Pausado desde: {new Date(motor.pausedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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

function CampaignCard({ camp, onDelete }: { camp: CampaignStat; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const qc = useQueryClient()

  const elapsed = camp.finished_at
    ? Math.round((new Date(camp.finished_at).getTime() - new Date(camp.started_at).getTime()) / 1000) + 's'
    : Math.round((Date.now() - new Date(camp.started_at).getTime()) / 1000) + 's'

  const waRate = camp.leads_found > 0 ? Math.round((camp.leads_wa / camp.leads_found) * 100) : 0
  const contactRate = camp.leads_wa > 0 ? Math.round((camp.leads_contatados / camp.leads_wa) * 100) : 0

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteCampaign(camp.id),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['campaigns'] })
      qc.invalidateQueries({ queryKey: ['leads'] })
      qc.invalidateQueries({ queryKey: ['kanban'] })
      qc.invalidateQueries({ queryKey: ['niches'] })
      toast.success(`Campanha deletada (${res.deleted} leads removidos)`)
      onDelete()
    },
    onError: () => toast.error('Erro ao deletar campanha'),
  })

  return (
    <div className="bg-surface2 border border-brd rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[13px] text-white truncate">{camp.query}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <p className="text-muted text-[11px]">
              {new Date(camp.started_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              {camp.status !== 'running' && ` · ${elapsed}`}
            </p>
            {(camp as any).location && (
              <span className="flex items-center gap-0.5 text-[10px] text-cyan-400">
                <MapPin size={9} />{(camp as any).location}
              </span>
            )}
            {(camp as any).niche && (
              <span className="flex items-center gap-0.5 text-[10px] text-purple-400">
                <Tag size={9} />{(camp as any).niche}
              </span>
            )}
          </div>
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
          {confirming ? (
            <div className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="text-[11px] px-2 py-0.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-bold rounded-md transition-colors"
              >
                {deleteMutation.isPending ? '...' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirming(false)} className="text-[11px] px-2 py-0.5 bg-surface text-muted hover:text-white rounded-md transition-colors">
                Cancelar
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="p-1 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
              title="Deletar campanha e todos os leads"
            >
              <Trash2 size={12} />
            </button>
          )}
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
  const [campaignName, setCampaignName] = useState('')
  const [location, setLocation] = useState('')
  const [niche, setNiche] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [expanding, setExpanding] = useState(false)
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
    mutationFn: () => api.triggerScrape({
      query: query.trim(),
      max: parseInt(max),
      templateId: templateId || undefined,
      campaignName: campaignName.trim() || undefined,
      location: location.trim() || undefined,
      niche: niche.trim() || undefined,
    }),
    onSuccess: () => {
      setQuery('')
      setCampaignName('')
      setLocation('')
      setNiche('')
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

  async function handleExpand() {
    const lines = query.trim().split('\n').filter(Boolean)
    // Pega a última linha como região se tiver só uma, ou pede confirmação
    const region = lines.length === 1 ? lines[0] : query.trim()
    if (!region) return
    setExpanding(true)
    try {
      const res = await api.expandRegion({ region, niche: niche || 'casa de câmbio' })
      if (res.queries?.length) setQuery(res.queries.join('\n'))
    } catch {
      toast.error('Erro ao expandir região')
    } finally {
      setExpanding(false)
    }
  }

  const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2.5 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors'

  return (
    <div className="space-y-5">
      {/* Motor status */}
      <MotorCard />

      {/* New campaign form */}
      <div className="bg-surface border border-brd rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-muted text-[12px]">
            Cole uma query ou URL do Google Maps. O pipeline roda completo: Maps → Site → Instagram → WA → Score → Aprovação.
          </p>
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors flex-shrink-0 ml-4"
          >
            {showAdvanced ? 'Ocultar opções' : 'Mais opções'}
          </button>
        </div>

        {/* Main row */}
        <div className="flex gap-3 flex-wrap items-start">
          <div className="flex-1 min-w-[260px] space-y-1">
            <div className="relative">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={"casa de câmbio Porto Alegre\ncasa de câmbio Caxias do Sul\ncasa de câmbio Pelotas"}
                rows={3}
                className={`${inputCls} w-full resize-none leading-relaxed pr-24`}
              />
              <button
                onClick={handleExpand}
                disabled={!query.trim() || expanding}
                title="Expandir região automaticamente com IA"
                className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-purple-600/80 hover:bg-purple-500 disabled:opacity-40 text-white text-[11px] font-semibold rounded-md transition-colors"
              >
                <Sparkles size={11} className={expanding ? 'animate-spin' : ''} />
                {expanding ? '...' : 'Expandir'}
              </button>
            </div>
            <p className="text-[10px] text-muted">Digite uma região ou cidade e clique em <span className="text-purple-400">Expandir</span> — a IA gera as queries automaticamente. Ou escreva uma por linha.</p>
          </div>
          <div className="space-y-1">
            <input
              type="text"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="Nome da campanha *"
              className={`${inputCls} w-[200px] ${!campaignName.trim() ? 'border-red-500/50' : ''}`}
            />
            <p className="text-[10px] text-red-400/70">Obrigatório</p>
          </div>
          <select value={max} onChange={e => setMax(e.target.value)} className={inputCls} title="Máximo de leads por query">
            {['20', '30', '50', '80', '100'].map(v => (
              <option key={v} value={v}>{v} / query</option>
            ))}
          </select>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputCls}>
            <option value="">Mensagem gerada por IA</option>
            {templates?.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <button
            onClick={() => query.trim() && campaignName.trim() && trigger.mutate()}
            disabled={!query.trim() || !campaignName.trim() || trigger.isPending}
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

        {/* Advanced options */}
        {showAdvanced && (
          <div className="grid grid-cols-2 gap-3 pt-1 border-t border-brd">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[11px] text-muted">
                <MapPin size={10} />Localização
              </label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Ex: Porto Alegre, RS"
                className={`${inputCls} w-full`}
              />
            </div>
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[11px] text-muted">
                <Tag size={10} />Nicho
              </label>
              <input
                type="text"
                value={niche}
                onChange={e => setNiche(e.target.value)}
                placeholder="Ex: casa de câmbio"
                className={`${inputCls} w-full`}
              />
            </div>
          </div>
        )}
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
            campaigns.map(c => <CampaignCard key={c.id} camp={c} onDelete={() => {}} />)
          )}
        </div>

        {/* Activity feed */}
        <ActivityFeed />
      </div>
    </div>
  )
}
