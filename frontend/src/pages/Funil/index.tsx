import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Lead, ActivityEvent } from '@/types/api'
import { LeadDetailDrawer } from '@/components/shared/LeadDetailDrawer'
import {
  Clock, MapPin, MessageCircle, Eye, Skull, ChevronRight,
  Zap, AlertTriangle, Send, Check, Phone, Brain, Target, Send as SendIcon,
} from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────

const M1_DELAY_MIN = 45
const ENG_DELAY_H  = 6

// 5 grouped columns instead of 8
type GroupId = 'aguardando' | 'conversou' | 'analisando' | 'pedindo_numero' | 'pra_ligar'

const COLUMN_GROUPS: {
  id: GroupId
  statuses: string[]
  label: string
  sublabel?: string
  icon: React.ReactNode
  color: string
  border: string
  bg: string
  highlight?: boolean
}[] = [
  {
    id: 'aguardando',
    statuses: ['ms_m1_sent', 'ms_m2a_sent', 'ms_m2b_sent'],
    label: 'Aguardando resposta',
    sublabel: 'M1 / M2A / M2B',
    icon: <SendIcon size={12} />,
    color: 'text-yellow-400',
    border: 'border-yellow-500/30',
    bg: 'bg-yellow-500/5',
  },
  {
    id: 'conversou',
    statuses: ['ativo'],
    label: 'Conversou',
    icon: <MessageCircle size={12} />,
    color: 'text-green-400',
    border: 'border-green-500/30',
    bg: 'bg-green-500/5',
  },
  {
    id: 'analisando',
    statuses: ['intelligence_done'],
    label: 'Analisando',
    icon: <Brain size={12} />,
    color: 'text-cyan-400',
    border: 'border-cyan-500/30',
    bg: 'bg-cyan-500/5',
  },
  {
    id: 'pedindo_numero',
    statuses: ['eng_v1', 'eng_v2', 'eng_v3'],
    label: 'Pedindo número',
    sublabel: 'V1 / V2 / V3',
    icon: <Target size={12} />,
    color: 'text-purple-400',
    border: 'border-purple-500/30',
    bg: 'bg-purple-500/5',
  },
  {
    id: 'pra_ligar',
    statuses: ['briefing_done'],
    label: 'PRA LIGAR',
    icon: <Phone size={12} />,
    color: 'text-emerald-400',
    border: 'border-emerald-500/40',
    bg: 'bg-emerald-500/10',
    highlight: true,
  },
]

// Sub-status pill labels (for cards inside grouped columns)
const SUBSTATUS_LABELS: Record<string, { label: string; color: string }> = {
  ms_m1_sent:  { label: 'M1',  color: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  ms_m2a_sent: { label: 'M2A', color: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  ms_m2b_sent: { label: 'M2B', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30'   },
  eng_v1:      { label: 'V1',  color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  eng_v2:      { label: 'V2',  color: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  eng_v3:      { label: 'V3',  color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30' },
}

// Detailed view: 8 individual columns
const COLUMN_DETAILED: typeof COLUMN_GROUPS = [
  { id: 'aguardando' as GroupId, statuses: ['ms_m1_sent'],        label: 'M1 Enviado',  sublabel: 'aguarda 1ª resposta',  icon: <SendIcon size={12} />,     color: 'text-yellow-400',  border: 'border-yellow-500/30',  bg: 'bg-yellow-500/5'  },
  { id: 'aguardando' as GroupId, statuses: ['ms_m2a_sent'],       label: 'M2A Enviado', sublabel: 'pergunta técnica',     icon: <SendIcon size={12} />,     color: 'text-orange-400',  border: 'border-orange-500/30',  bg: 'bg-orange-500/5'  },
  { id: 'aguardando' as GroupId, statuses: ['ms_m2b_sent'],       label: 'M2B Enviado', sublabel: 'cobrança suave',       icon: <SendIcon size={12} />,     color: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5'   },
  { id: 'conversou' as GroupId,  statuses: ['ativo'],             label: 'Conversou',   sublabel: 'respondeu M2A',        icon: <MessageCircle size={12} />, color: 'text-green-400',   border: 'border-green-500/30',   bg: 'bg-green-500/5'   },
  { id: 'analisando' as GroupId, statuses: ['intelligence_done'], label: 'Analisando',  sublabel: 'GPT processando',      icon: <Brain size={12} />,        color: 'text-cyan-400',    border: 'border-cyan-500/30',    bg: 'bg-cyan-500/5'    },
  { id: 'pedindo_numero' as GroupId, statuses: ['eng_v1'],        label: 'Eng V1',      sublabel: '1ª tentativa',         icon: <Target size={12} />,       color: 'text-purple-400',  border: 'border-purple-500/30',  bg: 'bg-purple-500/5'  },
  { id: 'pedindo_numero' as GroupId, statuses: ['eng_v2'],        label: 'Eng V2',      sublabel: '2ª tentativa',         icon: <Target size={12} />,       color: 'text-violet-400',  border: 'border-violet-500/30',  bg: 'bg-violet-500/5'  },
  { id: 'pedindo_numero' as GroupId, statuses: ['eng_v3'],        label: 'Eng V3',      sublabel: 'última tentativa',     icon: <Target size={12} />,       color: 'text-fuchsia-400', border: 'border-fuchsia-500/30', bg: 'bg-fuchsia-500/5' },
  { id: 'pra_ligar' as GroupId,  statuses: ['briefing_done'],     label: 'PRA LIGAR',   sublabel: 'briefing pronto',      icon: <Phone size={12} />,        color: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/10', highlight: true },
]

// ── Helpers ────────────────────────────────────────────────────

function elapsed(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}min`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

function countdown(targetMs: number): string {
  const diff = targetMs - Date.now()
  if (diff <= 0) return 'atrasado'
  const min = Math.floor(diff / 60000)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${m}min` : `${h}h`
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

function getNextAction(lead: Lead & { phase_sent_at?: string }): { label: string; urgent: boolean } | null {
  const sentAt = lead.phase_sent_at ? new Date(lead.phase_sent_at).getTime() : null

  switch (lead.status) {
    case 'ms_m1_sent': {
      if (!sentAt) return null
      const target = sentAt + M1_DELAY_MIN * 60_000
      return { label: `M2A em ${countdown(target)}`, urgent: target - Date.now() < 10 * 60_000 }
    }
    case 'ms_m2a_sent': {
      if (!sentAt) return null
      const target = sentAt + 27 * 3600_000
      return { label: `morto em ${countdown(target)}`, urgent: target - Date.now() < 2 * 3600_000 }
    }
    case 'ms_m2b_sent':
      return { label: 'aguardando resposta', urgent: false }
    case 'ativo':
      return { label: 'analisando conversa', urgent: false }
    case 'intelligence_done':
      return { label: 'Eng V1 pendente', urgent: false }
    case 'eng_v1':
    case 'eng_v2':
    case 'eng_v3': {
      const sentAtEng = lead.engenharia_social_sent_at
        ? new Date(lead.engenharia_social_sent_at).getTime()
        : sentAt
      if (!sentAtEng) return null
      const variacao = lead.engenharia_social_variacao ?? 1
      const nextLabel = variacao < 3 ? `Eng V${variacao + 1}` : 'MORTO'
      const target = sentAtEng + ENG_DELAY_H * 3600_000
      return { label: `${nextLabel} em ${countdown(target)}`, urgent: target - Date.now() < 3600_000 }
    }
    case 'briefing_done':
      return { label: 'pronto pra ligar', urgent: false }
    default:
      return null
  }
}

// ── Today Pulse (resumo do dia) ────────────────────────────────

function TodayPulse({ events, briefingsCount }: { events: ActivityEvent[]; briefingsCount: number }) {
  const todayEvents = events.filter(e => isToday(e.timestamp))
  const m1sToday        = todayEvents.filter(e => e.type === 'sent' && /M1/i.test(e.message)).length
  const respostasToday  = todayEvents.filter(e => e.type === 'responded').length
  const analisesToday   = todayEvents.filter(e => e.type === 'intelligence').length

  const items = [
    { icon: <SendIcon size={14} />,    label: 'M1 enviados',  value: m1sToday,        color: 'text-yellow-400' },
    { icon: <MessageCircle size={14} />, label: 'Responderam', value: respostasToday,  color: 'text-green-400'  },
    { icon: <Brain size={14} />,       label: 'Analisados',   value: analisesToday,   color: 'text-cyan-400'   },
    { icon: <Phone size={14} />,       label: 'Pra ligar',    value: briefingsCount,  color: 'text-emerald-400', highlight: briefingsCount > 0 },
  ]

  return (
    <div className="mb-4 bg-surface border border-brd rounded-xl px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Hoje</span>
          <span className="text-[10px] text-muted/50 tabular-nums">{new Date().toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          {items.map(it => (
            <div key={it.label} className={`flex items-center gap-2 ${it.highlight ? 'animate-pulse' : ''}`}>
              <span className={it.color}>{it.icon}</span>
              <span className={`text-[20px] font-bold tabular-nums ${it.color}`}>{it.value}</span>
              <span className="text-[11px] text-muted">{it.label}</span>
              {it.highlight && it.value > 0 && <span className="text-[12px]">🔥</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────

function FunilCard({
  lead,
  onView,
  onMarkMorto,
  showSubBadge,
}: {
  lead: Lead & { phase_sent_at?: string }
  onView: () => void
  onMarkMorto: () => void
  showSubBadge: boolean
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(iv)
  }, [])

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    [lead.nome, lead.cidade, lead.estado].filter(Boolean).join(' ')
  )}`
  const waUrl = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}` : null
  const nextAction = getNextAction(lead)
  const phaseSrc = lead.phase_sent_at || lead.criado_em
  const subBadge = showSubBadge ? SUBSTATUS_LABELS[lead.status] : null

  return (
    <div
      onClick={onView}
      className="bg-surface2 border border-brd rounded-xl p-3 group hover:border-blue-500/50 hover:bg-surface2/80 transition-colors select-none cursor-pointer"
    >
      {/* Header: name + sub-badge */}
      <div className="flex items-start gap-1.5">
        <p className="text-[12px] font-semibold text-white leading-snug truncate flex-1">{lead.nome}</p>
        {subBadge && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border tabular-nums shrink-0 ${subBadge.color}`}>
            {subBadge.label}
          </span>
        )}
      </div>

      {(lead.cidade || lead.estado) && (
        <p className="text-[11px] text-muted mt-0.5 truncate">
          {[lead.cidade, lead.estado].filter(Boolean).join(', ')}
        </p>
      )}

      {/* Time in phase */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <Clock size={9} className="text-muted/60 shrink-0" />
        <span className="text-[10px] text-muted/70 tabular-nums">há {elapsed(phaseSrc)}</span>
      </div>

      {/* Next action countdown */}
      {nextAction && (
        <div className={`mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium ${
          nextAction.urgent
            ? 'bg-red-500/15 text-red-400 border border-red-500/20'
            : 'bg-surface text-muted border border-brd'
        }`}>
          <ChevronRight size={9} className="shrink-0" />
          {nextAction.label}
        </div>
      )}

      {/* Bottom row: hint + quick actions */}
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-brd/40">
        <span className="flex items-center gap-1 text-[10px] text-blue-400/70 group-hover:text-blue-400 transition-colors">
          <Eye size={10} />
          ver detalhes
        </span>
        <div className="flex items-center gap-1">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="p-1 rounded-md text-muted/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Abrir no Google Maps" onClick={e => e.stopPropagation()}>
            <MapPin size={11} />
          </a>
          {waUrl && (
            <a href={waUrl} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded-md text-muted/40 hover:text-green-400 hover:bg-green-500/10 transition-colors"
              title="Abrir no WhatsApp" onClick={e => e.stopPropagation()}>
              <MessageCircle size={11} />
            </a>
          )}
          <button onClick={e => { e.stopPropagation(); onMarkMorto() }}
            className="p-1 rounded-md text-muted/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Marcar como morto">
            <Skull size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Grouped Kanban column ────────────────────────────────────────

function KanbanColumn({
  group,
  leads,
  onView,
  onMarkMorto,
}: {
  group: typeof COLUMN_GROUPS[number]
  leads: (Lead & { phase_sent_at?: string })[]
  onView: (id: string) => void
  onMarkMorto: (id: string) => void
}) {
  const showSubBadge = group.statuses.length > 1

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] shrink-0">
      {/* Header */}
      <div className={`flex items-center gap-2 mb-2 px-2.5 py-2 rounded-lg ${group.bg} border ${group.border} ${group.highlight ? 'shadow-[0_0_20px_-5px] shadow-emerald-500/30' : ''}`}>
        <span className={group.color}>{group.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-[11px] font-bold ${group.color}`}>{group.label}</div>
          {group.sublabel && (
            <div className="text-[9px] text-muted/60 leading-tight">{group.sublabel}</div>
          )}
        </div>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${
          group.highlight && leads.length > 0
            ? 'bg-emerald-500 text-white animate-pulse'
            : 'bg-black/20 text-white/60'
        }`}>
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-[200px]">
        {leads.length === 0 ? (
          <div className="flex-1 flex items-center justify-center min-h-[120px]">
            <span className="text-[11px] text-muted/40">vazio</span>
          </div>
        ) : (
          leads.map(lead => (
            <FunilCard
              key={lead.id}
              lead={lead}
              onView={() => onView(lead.id)}
              onMarkMorto={() => onMarkMorto(lead.id)}
              showSubBadge={showSubBadge}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Activity icon ───────────────────────────────────────────────

function activityIcon(type: ActivityEvent['type']) {
  switch (type) {
    case 'sent':           return <span className="text-yellow-400">→</span>
    case 'sending':        return <span className="text-yellow-300">⟳</span>
    case 'responded':      return <span className="text-green-400">←</span>
    case 'bot':            return <span className="text-purple-400">🤖</span>
    case 'no_response':    return <span className="text-red-400">✗</span>
    case 'intelligence':   return <span className="text-cyan-400">🧠</span>
    case 'social_eng':     return <span className="text-violet-400">🎯</span>
    case 'phone_received': return <span className="text-green-400">📱</span>
    case 'briefing':       return <span className="text-blue-400">📋</span>
    case 'enriched':       return <span className="text-slate-400">⚙</span>
    default:               return <span className="text-muted">·</span>
  }
}

// ── Conversion Rates strip ──────────────────────────────────────

function ConversionRates({ pipeline }: { pipeline: any }) {
  if (!pipeline) return null
  const conv = (a: number, b: number) => (a > 0 ? `${Math.round((b / a) * 100)}%` : '—')
  const rows = [
    { label: 'Com WA → M1',         from: pipeline.enriched,          to: pipeline.ms_m1_sent,        color: 'text-yellow-400' },
    { label: 'M1 → Conversou',      from: pipeline.ms_m1_sent,        to: pipeline.ativo,             color: 'text-green-400'  },
    { label: 'Conversou → Análise', from: pipeline.ativo,             to: pipeline.intelligence_done, color: 'text-cyan-400'   },
    { label: 'Análise → Eng',       from: pipeline.intelligence_done, to: pipeline.eng_v1,            color: 'text-purple-400' },
    { label: 'Eng → Briefing',      from: pipeline.eng_v1,            to: pipeline.briefing_done,     color: 'text-emerald-400'},
  ]
  return (
    <div className="mt-5 bg-surface border border-brd rounded-xl px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold text-muted uppercase tracking-widest shrink-0">Taxas de conversão</span>
        <div className="flex flex-wrap gap-x-6 gap-y-2 ml-auto">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="text-[11px] text-muted">{r.label}</span>
              <span className={`text-[14px] font-bold tabular-nums ${r.color}`}>{conv(r.from, r.to)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Live Activity strip (rodapé) ────────────────────────────────

function LiveActivityStrip({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="mt-5 bg-surface border border-brd rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-brd">
        <Zap size={12} className="text-green-400" />
        <span className="text-[12px] font-semibold text-white">Atividade ao vivo</span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[10px] text-muted ml-auto">últimos {Math.min(events.length, 8)} eventos</span>
      </div>
      <div className="divide-y divide-brd/40 max-h-[240px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-muted/50">Aguardando eventos…</div>
        ) : (
          events.slice(0, 12).map(ev => (
            <div key={ev.id} className="flex items-center gap-3 px-4 py-2 hover:bg-surface2/50 transition-colors">
              <div className="text-[12px] shrink-0 w-4 text-center">{activityIcon(ev.type)}</div>
              <p className="text-[12px] text-slate-300 leading-snug flex-1 truncate">{ev.message}</p>
              <span className="text-[10px] text-muted/50 tabular-nums shrink-0">
                {new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── Mock data ──────────────────────────────────────────────────

const now = Date.now()
const MOCK: Record<string, (Lead & { phase_sent_at?: string })[]> = {
  ms_m1_sent: [
    { id: 'm1-1', nome: 'Câmbio Boa Vista', cidade: 'Porto Alegre', estado: 'RS', status: 'ms_m1_sent', criado_em: new Date(now - 22 * 60000).toISOString(), whatsapp: '5551999990001', phase_sent_at: new Date(now - 22 * 60000).toISOString() },
    { id: 'm1-2', nome: 'Turismo Cambial SP', cidade: 'São Paulo', estado: 'SP', status: 'ms_m1_sent', criado_em: new Date(now - 38 * 60000).toISOString(), whatsapp: '5511999990002', phase_sent_at: new Date(now - 38 * 60000).toISOString() },
    { id: 'm1-3', nome: 'Casa Gaúcha de Câmbio', cidade: 'Caxias do Sul', estado: 'RS', status: 'ms_m1_sent', criado_em: new Date(now - 5 * 60000).toISOString(), whatsapp: '5554999990003', phase_sent_at: new Date(now - 5 * 60000).toISOString() },
  ],
  ms_m2a_sent: [
    { id: 'm2a-1', nome: 'Cambial Curitiba', cidade: 'Curitiba', estado: 'PR', status: 'ms_m2a_sent', criado_em: new Date(now - 5 * 3600000).toISOString(), whatsapp: '5541999990004', phase_sent_at: new Date(now - 5 * 3600000).toISOString() },
    { id: 'm2a-2', nome: 'Fox Câmbio Manaus', cidade: 'Manaus', estado: 'AM', status: 'ms_m2a_sent', criado_em: new Date(now - 18 * 3600000).toISOString(), whatsapp: '5592999990005', phase_sent_at: new Date(now - 18 * 3600000).toISOString() },
  ],
  ms_m2b_sent: [
    { id: 'm2b-1', nome: 'Quick Dollar Fortaleza', cidade: 'Fortaleza', estado: 'CE', status: 'ms_m2b_sent', criado_em: new Date(now - 2 * 3600000).toISOString(), whatsapp: '5585999990006', phase_sent_at: new Date(now - 2 * 3600000).toISOString() },
  ],
  ativo: [
    { id: 'at-1', nome: 'Money Express Floripa', cidade: 'Florianópolis', estado: 'SC', status: 'ativo', criado_em: new Date(now - 35 * 60000).toISOString(), whatsapp: '5548999990007', phase_sent_at: new Date(now - 35 * 60000).toISOString() },
    { id: 'at-2', nome: 'Câmbio BH Premium', cidade: 'Belo Horizonte', estado: 'MG', status: 'ativo', criado_em: new Date(now - 90 * 60000).toISOString(), whatsapp: '5531999990008', phase_sent_at: new Date(now - 90 * 60000).toISOString() },
    { id: 'at-3', nome: 'Real Gold Câmbio', cidade: 'Brasília', estado: 'DF', status: 'ativo', criado_em: new Date(now - 15 * 60000).toISOString(), whatsapp: '5561999990009', phase_sent_at: new Date(now - 15 * 60000).toISOString() },
  ],
  intelligence_done: [
    { id: 'int-1', nome: 'Top Câmbio Recife', cidade: 'Recife', estado: 'PE', status: 'intelligence_done', criado_em: new Date(now - 8 * 3600000).toISOString(), whatsapp: '5581999990010', phase_sent_at: new Date(now - 8 * 3600000).toISOString() },
    { id: 'int-2', nome: 'Dollar House Salvador', cidade: 'Salvador', estado: 'BA', status: 'intelligence_done', criado_em: new Date(now - 4 * 3600000).toISOString(), whatsapp: '5571999990011', phase_sent_at: new Date(now - 4 * 3600000).toISOString() },
  ],
  eng_v1: [
    { id: 'ev1-1', nome: 'Dolar Store Natal', cidade: 'Natal', estado: 'RN', status: 'eng_v1', criado_em: new Date(now - 14 * 3600000).toISOString(), whatsapp: '5584999990012', engenharia_social_sent_at: new Date(now - 4 * 3600000).toISOString(), engenharia_social_variacao: 1, phase_sent_at: new Date(now - 4 * 3600000).toISOString() },
    { id: 'ev1-2', nome: 'Cambix Belém', cidade: 'Belém', estado: 'PA', status: 'eng_v1', criado_em: new Date(now - 20 * 3600000).toISOString(), whatsapp: '5591999990013', engenharia_social_sent_at: new Date(now - 5.5 * 3600000).toISOString(), engenharia_social_variacao: 1, phase_sent_at: new Date(now - 5.5 * 3600000).toISOString() },
  ],
  eng_v2: [
    { id: 'ev2-1', nome: 'Câmbio Goiânia Center', cidade: 'Goiânia', estado: 'GO', status: 'eng_v2', criado_em: new Date(now - 30 * 3600000).toISOString(), whatsapp: '5562999990014', engenharia_social_sent_at: new Date(now - 3 * 3600000).toISOString(), engenharia_social_variacao: 2, phase_sent_at: new Date(now - 3 * 3600000).toISOString() },
  ],
  eng_v3: [
    { id: 'ev3-1', nome: 'Prime Câmbio Vitória', cidade: 'Vitória', estado: 'ES', status: 'eng_v3', criado_em: new Date(now - 48 * 3600000).toISOString(), whatsapp: '5527999990015', engenharia_social_sent_at: new Date(now - 1.5 * 3600000).toISOString(), engenharia_social_variacao: 3, phase_sent_at: new Date(now - 1.5 * 3600000).toISOString() },
  ],
  briefing_done: [
    { id: 'br-1', nome: 'Câmbio Sul Premium', cidade: 'Porto Alegre', estado: 'RS', status: 'briefing_done', criado_em: new Date(now - 6 * 3600000).toISOString(), whatsapp: '5551999990016', phase_sent_at: new Date(now - 30 * 60000).toISOString() },
  ],
}

const MOCK_ACTIVITY: ActivityEvent[] = [
  { id: 'a1',  type: 'sent',           message: 'M1 enviado para Câmbio Boa Vista', lead_nome: 'Câmbio Boa Vista', timestamp: new Date(now - 22 * 60000).toISOString() },
  { id: 'a3',  type: 'responded',      message: 'Money Express Floripa respondeu em 8min', lead_nome: 'Money Express Floripa', timestamp: new Date(now - 35 * 60000).toISOString() },
  { id: 'a4',  type: 'responded',      message: 'Câmbio BH Premium respondeu em 22min', lead_nome: 'Câmbio BH Premium', timestamp: new Date(now - 90 * 60000).toISOString() },
  { id: 'a6',  type: 'intelligence',   message: 'Análise concluída: Top Câmbio Recife — qualidade ALTA, taxa 5.2%', lead_nome: 'Top Câmbio Recife', timestamp: new Date(now - 8 * 3600000).toISOString() },
  { id: 'a14', type: 'phone_received', message: 'Número do gestor recebido: Câmbio Sul (51) 99812-3456', lead_nome: 'Câmbio Sul', timestamp: new Date(now - 6 * 3600000).toISOString() },
  { id: 'a15', type: 'briefing',       message: 'Briefing gerado para Câmbio Sul — pronto para ligar', lead_nome: 'Câmbio Sul', timestamp: new Date(now - 6 * 3600000).toISOString() },
]

// ── Eng Revisão panel ──────────────────────────────────────────

function EngRevisaoPanel() {
  const qc = useQueryClient()
  const { data: leads = [] } = useQuery({
    queryKey: ['eng-revisao'],
    queryFn: api.getEngRevisao,
    refetchInterval: 10_000,
  })
  const action = useMutation({
    mutationFn: ({ id, act }: { id: string; act: 'next_eng' | 'morto' | 'handled' }) =>
      api.dispatchEngAction(id, act),
    onSuccess: (_, { act }) => {
      const msgs = { next_eng: 'Próxima variação disparada!', morto: 'Lead marcado como morto', handled: 'Marcado como tratado' }
      toast.success(msgs[act])
      qc.invalidateQueries({ queryKey: ['eng-revisao'] })
      qc.invalidateQueries({ queryKey: ['operacao'] })
    },
    onError: () => toast.error('Erro ao executar ação'),
  })

  if (!leads.length) return null

  return (
    <div className="mb-4 border border-amber-500/30 bg-amber-500/5 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        <span className="text-[12px] font-bold text-amber-400">
          {leads.length} lead{leads.length !== 1 ? 's' : ''} aguardando sua revisão
        </span>
        <span className="text-[11px] text-amber-400/60 ml-1">— responderam a engenharia sem dar o número</span>
      </div>
      <div className="p-3 space-y-2">
        {leads.map((lead: any) => {
          const variacao = lead.engenharia_social_variacao ?? 1
          const nextVariacao = Math.min(variacao + 1, 3)
          const waUrl = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}` : null
          return (
            <div key={lead.id} className="bg-surface border border-brd rounded-xl p-3 space-y-2.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-white">{lead.nome}</p>
                  {(lead.cidade || lead.estado) && (
                    <p className="text-[11px] text-muted">{[lead.cidade, lead.estado].filter(Boolean).join(', ')}</p>
                  )}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 shrink-0">
                  Eng V{variacao}
                </span>
              </div>
              {lead.last_response && (
                <div className="bg-surface2 border border-brd rounded-lg px-3 py-2">
                  <p className="text-[10px] text-muted mb-1 uppercase tracking-wide">Resposta recebida</p>
                  <p className="text-[12px] text-slate-300 leading-relaxed">"{lead.last_response}"</p>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {waUrl && (
                  <a href={waUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 text-[11px] font-semibold rounded-lg transition-colors">
                    <MessageCircle size={11} /> Abrir WA
                  </a>
                )}
                {variacao < 3 && (
                  <button onClick={() => action.mutate({ id: lead.id, act: 'next_eng' })} disabled={action.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40">
                    <Send size={11} /> Enviar Eng V{nextVariacao} agora
                  </button>
                )}
                <button onClick={() => action.mutate({ id: lead.id, act: 'handled' })} disabled={action.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40">
                  <Check size={11} /> Já resolvi manualmente
                </button>
                <button onClick={() => action.mutate({ id: lead.id, act: 'morto' })} disabled={action.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-brd text-muted hover:text-red-400 text-[11px] rounded-lg transition-colors disabled:opacity-40">
                  <Skull size={11} /> Morto
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────

export function FunilPage() {
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [detailed, setDetailed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('funil-detailed') === '1'
  })
  const qc = useQueryClient()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('funil-detailed', detailed ? '1' : '0')
    }
  }, [detailed])

  const { data, isLoading } = useQuery({
    queryKey: ['operacao'],
    queryFn: api.getOperacao,
    refetchInterval: 15_000,
  })

  const { data: liveEvents = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(60),
    refetchInterval: 5_000,
  })

  const { data: briefings = [] } = useQuery({
    queryKey: ['briefings'],
    queryFn: api.getBriefings,
    refetchInterval: 30_000,
  })

  const { data: pipelineCounts } = useQuery({
    queryKey: ['pipeline'],
    queryFn: api.getPipeline,
    refetchInterval: 30_000,
  })

  const markMorto = useMutation({
    mutationFn: (id: string) => api.markLeadMorto(id),
    onSuccess: () => {
      toast.success('Lead marcado como morto')
      qc.invalidateQueries({ queryKey: ['operacao'] })
    },
    onError: () => toast.error('Erro ao marcar como morto'),
  })

  const realProgress = data?.in_progress ?? {}
  const realTotal = Object.values(realProgress).reduce((s: number, arr) => s + (arr as Lead[]).length, 0)
  const showPreview = preview || (!isLoading && realTotal === 0)

  const inProgress = (showPreview ? MOCK : realProgress) as Record<string, (Lead & { phase_sent_at?: string })[]>
  const events = showPreview ? MOCK_ACTIVITY : liveEvents
  const briefingsCount = showPreview ? 1 : briefings.length

  // Combine leads from multiple statuses for grouped columns (or use detailed view)
  const activeColumns = detailed ? COLUMN_DETAILED : COLUMN_GROUPS
  const groupedLeads = activeColumns.map(group => ({
    group,
    leads: group.statuses.flatMap(s => inProgress[s] ?? []),
  }))
  const total = groupedLeads.reduce((s, g) => s + g.leads.length, 0)

  return (
    <div>
      <EngRevisaoPanel />

      {/* Pulse do dia */}
      <TodayPulse events={events} briefingsCount={briefingsCount} />

      {/* Header row */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[12px] text-muted">
          {isLoading ? '…' : `${showPreview ? total + ' (preview)' : total} lead${total !== 1 ? 's' : ''} em processamento`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Compacto / Detalhado toggle */}
          <div className="flex items-center bg-surface2 border border-brd rounded-lg p-0.5">
            <button
              onClick={() => setDetailed(false)}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                !detailed ? 'bg-blue-500/20 text-blue-300 font-semibold' : 'text-muted hover:text-white'
              }`}
              title="5 colunas — visão simplificada"
            >
              Compacto
            </button>
            <button
              onClick={() => setDetailed(true)}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                detailed ? 'bg-blue-500/20 text-blue-300 font-semibold' : 'text-muted hover:text-white'
              }`}
              title="9 colunas — vê M1, M2A, M2B, V1, V2, V3 separados"
            >
              Detalhado
            </button>
          </div>

          {!isLoading && (
            <button
              onClick={() => setPreview(v => !v)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                showPreview
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                  : 'bg-surface2 border-brd text-muted hover:text-white'
              }`}
            >
              {showPreview ? '✕ Fechar preview' : '👁 Ver preview'}
            </button>
          )}
        </div>
      </div>

      {showPreview && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <span className="text-[11px] text-purple-400">Preview com dados fictícios — assim vai aparecer quando o pipeline estiver rodando</span>
        </div>
      )}

      {/* Kanban — 5 grouped columns */}
      <div className="overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
        <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
          {isLoading ? (
            activeColumns.map((g, i) => (
              <div key={`${g.id}-${i}`} className="min-w-[240px] w-[240px] shrink-0">
                <div className="h-10 bg-surface2 rounded-lg animate-pulse mb-2" />
                <div className="space-y-1.5">
                  {[1, 2].map(i => <div key={i} className="h-20 bg-surface2 rounded-xl animate-pulse" />)}
                </div>
              </div>
            ))
          ) : (
            groupedLeads.map(({ group, leads }, i) => (
              <KanbanColumn
                key={`${group.id}-${group.label}-${i}`}
                group={group}
                leads={leads}
                onView={setSelectedLeadId}
                onMarkMorto={showPreview ? () => toast.info('Modo preview — ação simulada') : id => markMorto.mutate(id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Conversion rates */}
      <ConversionRates pipeline={pipelineCounts} />

      {/* Live activity strip — bottom */}
      <LiveActivityStrip events={events} />

      {/* Conversation drawer */}
      <LeadDetailDrawer
        leadId={selectedLeadId}
        mockLead={showPreview && selectedLeadId
          ? Object.values(MOCK).flat().find((l: any) => l.id === selectedLeadId) as any
          : undefined}
        onClose={() => {
          setSelectedLeadId(null)
          qc.invalidateQueries({ queryKey: ['operacao'] })
        }}
      />
    </div>
  )
}
