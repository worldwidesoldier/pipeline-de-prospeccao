import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Lead, ActivityEvent } from '@/types/api'
import { LeadDetailDrawer } from '@/components/shared/LeadDetailDrawer'
import {
  Clock, MapPin, MessageCircle, Eye, Skull, ChevronRight,
  ChevronLeft, Zap, Activity, AlertTriangle, Send, Check,
} from 'lucide-react'

// ── Constants ──────────────────────────────────────────────────

const M1_DELAY_MIN = 45   // WA_M2B_DELAY_MIN default
const ENG_DELAY_H  = 6    // hours between Eng V1/V2/V3

const COLUMNS = [
  { id: 'ms_m1_sent',        label: 'M1 Enviado',  color: 'text-yellow-400',  border: 'border-yellow-500/30',  bg: 'bg-yellow-500/5'  },
  { id: 'ms_m2a_sent',       label: 'M2A Enviado', color: 'text-orange-400',  border: 'border-orange-500/30',  bg: 'bg-orange-500/5'  },
  { id: 'ms_m2b_sent',       label: 'M2B Enviado', color: 'text-amber-400',   border: 'border-amber-500/30',   bg: 'bg-amber-500/5'   },
  { id: 'ativo',             label: 'Ativo',       color: 'text-green-400',   border: 'border-green-500/30',   bg: 'bg-green-500/5'   },
  { id: 'intelligence_done', label: 'Analisando',  color: 'text-cyan-400',    border: 'border-cyan-500/30',    bg: 'bg-cyan-500/5'    },
  { id: 'eng_v1',            label: 'Eng V1',      color: 'text-purple-400',  border: 'border-purple-500/30',  bg: 'bg-purple-500/5'  },
  { id: 'eng_v2',            label: 'Eng V2',      color: 'text-violet-400',  border: 'border-violet-500/30',  bg: 'bg-violet-500/5'  },
  { id: 'eng_v3',            label: 'Eng V3',      color: 'text-fuchsia-400', border: 'border-fuchsia-500/30', bg: 'bg-fuchsia-500/5' },
] as const

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

function getNextAction(lead: Lead & { phase_sent_at?: string }): { label: string; urgent: boolean } | null {
  const sentAt = lead.phase_sent_at ? new Date(lead.phase_sent_at).getTime() : null

  switch (lead.status) {
    case 'ms_m1_sent': {
      if (!sentAt) return null
      const target = sentAt + M1_DELAY_MIN * 60_000
      const cd = countdown(target)
      return { label: `M2A em ${cd}`, urgent: target - Date.now() < 10 * 60_000 }
    }
    case 'ms_m2a_sent': {
      if (!sentAt) return null
      // 18h business hours ≈ 27h real time (rough: assume 9h/day → 2 days)
      const target = sentAt + 27 * 3600_000
      const cd = countdown(target)
      return { label: `morto em ${cd}`, urgent: target - Date.now() < 2 * 3600_000 }
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
      const cd = countdown(target)
      return { label: `${nextLabel} em ${cd}`, urgent: target - Date.now() < 3600_000 }
    }
    default:
      return null
  }
}

// ── Card ────────────────────────────────────────────────────────

function FunilCard({
  lead,
  onView,
  onMarkMorto,
}: {
  lead: Lead & { phase_sent_at?: string }
  onView: () => void
  onMarkMorto: () => void
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

  return (
    <div className="bg-surface2 border border-brd rounded-xl p-3 group hover:border-slate-600 transition-colors select-none">
      {/* Name + city */}
      <p className="text-[12px] font-semibold text-white leading-snug truncate">{lead.nome}</p>
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

      {/* Action buttons */}
      <div className="flex items-center gap-1 mt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded-md bg-red-500/10 text-red-400/70 hover:text-red-400 transition-colors"
          title="Maps"
          onClick={e => e.stopPropagation()}
        >
          <MapPin size={11} />
        </a>
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded-md bg-green-500/10 text-green-400/70 hover:text-green-400 transition-colors"
            title="WhatsApp"
            onClick={e => e.stopPropagation()}
          >
            <MessageCircle size={11} />
          </a>
        )}
        <button
          onClick={onView}
          className="p-1 rounded-md bg-blue-500/10 text-blue-400/70 hover:text-blue-400 transition-colors"
          title="Ver conversa"
        >
          <Eye size={11} />
        </button>
        <button
          onClick={onMarkMorto}
          className="p-1 rounded-md bg-surface text-muted/50 hover:text-red-400 hover:bg-red-500/10 transition-colors ml-auto"
          title="Marcar como morto"
        >
          <Skull size={11} />
        </button>
      </div>
    </div>
  )
}

// ── Kanban column ───────────────────────────────────────────────

function KanbanColumn({
  col,
  leads,
  onView,
  onMarkMorto,
}: {
  col: typeof COLUMNS[number]
  leads: (Lead & { phase_sent_at?: string })[]
  onView: (id: string) => void
  onMarkMorto: (id: string) => void
}) {
  return (
    <div className="flex flex-col min-w-[220px] w-[220px] shrink-0">
      {/* Header */}
      <div className={`flex items-center gap-2 mb-2 px-2 py-1.5 rounded-lg ${col.bg} border ${col.border}`}>
        <span className={`text-[11px] font-bold ${col.color}`}>{col.label}</span>
        <span className="ml-auto text-[10px] font-medium bg-black/20 text-white/60 px-1.5 py-0.5 rounded-full tabular-nums">
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-[200px]">
        {leads.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[11px] text-muted/40">vazio</span>
          </div>
        ) : (
          leads.map(lead => (
            <FunilCard
              key={lead.id}
              lead={lead}
              onView={() => onView(lead.id)}
              onMarkMorto={() => onMarkMorto(lead.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Activity event icon ─────────────────────────────────────────

function activityIcon(type: ActivityEvent['type']) {
  switch (type) {
    case 'sent':      return <span className="text-yellow-400">→</span>
    case 'sending':   return <span className="text-yellow-300">⟳</span>
    case 'responded': return <span className="text-green-400">←</span>
    case 'bot':       return <span className="text-purple-400">🤖</span>
    case 'no_response': return <span className="text-red-400">✗</span>
    case 'intelligence': return <span className="text-cyan-400">🧠</span>
    case 'social_eng': return <span className="text-violet-400">🎯</span>
    case 'phone_received': return <span className="text-green-400">📱</span>
    case 'briefing':  return <span className="text-blue-400">📋</span>
    case 'enriched':  return <span className="text-slate-400">⚙</span>
    default:          return <span className="text-muted">·</span>
  }
}

// ── Live Activity panel ─────────────────────────────────────────

function LiveActivityPanel({ open, onToggle, mockEvents }: { open: boolean; onToggle: () => void; mockEvents?: ActivityEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const { data: liveEvents = [] } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api.getActivity(60),
    refetchInterval: 5_000,
  })
  const events = mockEvents && liveEvents.length === 0 ? mockEvents : liveEvents

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [events.length, autoScroll])

  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="flex flex-col items-center gap-2 w-8 bg-surface border border-brd rounded-xl py-3 text-muted hover:text-white transition-colors shrink-0"
        title="Abrir Live Activity"
      >
        <Activity size={14} />
        <span className="text-[9px] font-bold tracking-widest" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          LIVE
        </span>
        {events.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        )}
      </button>
    )
  }

  return (
    <div className="flex flex-col w-[260px] shrink-0 bg-surface border border-brd rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-brd">
        <Zap size={12} className="text-green-400" />
        <span className="text-[12px] font-semibold text-white">Live Activity</span>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-0.5" />
        <button
          onClick={onToggle}
          className="ml-auto text-muted hover:text-white transition-colors"
          title="Recolher"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Events feed */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 max-h-[calc(100vh-180px)]"
        onScroll={() => {
          if (scrollRef.current) {
            setAutoScroll(scrollRef.current.scrollTop < 20)
          }
        }}
      >
        {events.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-muted/50">
            Aguardando eventos…
          </div>
        ) : (
          events.map(ev => (
            <div key={ev.id} className="flex gap-2 p-1.5 rounded-lg hover:bg-surface2 transition-colors">
              <div className="text-[11px] shrink-0 mt-0.5">{activityIcon(ev.type)}</div>
              <div className="min-w-0">
                <p className="text-[11px] text-slate-300 leading-snug break-words">{ev.message}</p>
                <p className="text-[9px] text-muted/50 mt-0.5 tabular-nums">
                  {new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              </div>
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
}

const MOCK_ACTIVITY: ActivityEvent[] = [
  { id: 'a1', type: 'sent',          message: 'M1 enviado para Câmbio Boa Vista', lead_nome: 'Câmbio Boa Vista',          timestamp: new Date(now - 22 * 60000).toISOString() },
  { id: 'a2', type: 'sent',          message: 'M1 enviado para Turismo Cambial SP', lead_nome: 'Turismo Cambial SP',        timestamp: new Date(now - 38 * 60000).toISOString() },
  { id: 'a3', type: 'responded',     message: 'Money Express Floripa respondeu em 8min', lead_nome: 'Money Express Floripa', timestamp: new Date(now - 35 * 60000).toISOString() },
  { id: 'a4', type: 'responded',     message: 'Câmbio BH Premium respondeu em 22min', lead_nome: 'Câmbio BH Premium',      timestamp: new Date(now - 90 * 60000).toISOString() },
  { id: 'a5', type: 'bot',           message: 'Quick Dollar Fortaleza — resposta automática detectada → M2B enviado', lead_nome: 'Quick Dollar Fortaleza', timestamp: new Date(now - 2 * 3600000).toISOString() },
  { id: 'a6', type: 'intelligence',  message: 'Análise concluída: Top Câmbio Recife — qualidade ALTA, taxa 5.2%', lead_nome: 'Top Câmbio Recife',       timestamp: new Date(now - 8 * 3600000).toISOString() },
  { id: 'a7', type: 'intelligence',  message: 'Análise concluída: Dollar House Salvador — sem dores identificadas', lead_nome: 'Dollar House Salvador',  timestamp: new Date(now - 4 * 3600000).toISOString() },
  { id: 'a8', type: 'social_eng',    message: 'Eng V1 enviado para Dolar Store Natal', lead_nome: 'Dolar Store Natal',      timestamp: new Date(now - 4 * 3600000).toISOString() },
  { id: 'a9', type: 'social_eng',    message: 'Eng V1 enviado para Cambix Belém', lead_nome: 'Cambix Belém',               timestamp: new Date(now - 5.5 * 3600000).toISOString() },
  { id:'a10', type: 'social_eng',    message: 'Eng V2 enviado para Câmbio Goiânia Center', lead_nome: 'Câmbio Goiânia Center', timestamp: new Date(now - 3 * 3600000).toISOString() },
  { id:'a11', type: 'social_eng',    message: 'Eng V3 enviado para Prime Câmbio Vitória', lead_nome: 'Prime Câmbio Vitória', timestamp: new Date(now - 1.5 * 3600000).toISOString() },
  { id:'a12', type: 'sent',          message: 'M2A enviado para Cambial Curitiba (sem resposta ao M1)', lead_nome: 'Cambial Curitiba',     timestamp: new Date(now - 5 * 3600000).toISOString() },
  { id:'a13', type: 'no_response',   message: 'Fox Câmbio Manaus marcado como MORTO — sem resposta após 18h úteis', lead_nome: 'Fox Câmbio Manaus', timestamp: new Date(now - 18 * 3600000).toISOString() },
  { id:'a14', type: 'phone_received', message: 'Número do gestor recebido: Câmbio Sul (51) 99812-3456 → briefing gerado', lead_nome: 'Câmbio Sul', timestamp: new Date(now - 6 * 3600000).toISOString() },
  { id:'a15', type: 'briefing',      message: 'Briefing gerado para Câmbio Sul — pronto para ligar', lead_nome: 'Câmbio Sul',            timestamp: new Date(now - 6 * 3600000).toISOString() },
]

// ── Eng Revisão panel ───────────────────────────────────────────

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
    <div className="mb-5 border border-amber-500/30 bg-amber-500/5 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-500/20">
        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        <span className="text-[12px] font-bold text-amber-400">
          {leads.length} lead{leads.length !== 1 ? 's' : ''} aguardando sua revisão
        </span>
        <span className="text-[11px] text-amber-400/60 ml-1">— responderam a engenharia sem dar o número</span>
      </div>

      {/* Cards */}
      <div className="p-3 space-y-2">
        {leads.map((lead: any) => {
          const variacao = lead.engenharia_social_variacao ?? 1
          const nextVariacao = Math.min(variacao + 1, 3)
          const waUrl = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, '')}` : null

          return (
            <div key={lead.id} className="bg-surface border border-brd rounded-xl p-3 space-y-2.5">
              {/* Lead info */}
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

              {/* Their response */}
              {lead.last_response && (
                <div className="bg-surface2 border border-brd rounded-lg px-3 py-2">
                  <p className="text-[10px] text-muted mb-1 uppercase tracking-wide">Resposta recebida</p>
                  <p className="text-[12px] text-slate-300 leading-relaxed">"{lead.last_response}"</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {waUrl && (
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 text-[11px] font-semibold rounded-lg transition-colors"
                  >
                    <MessageCircle size={11} /> Abrir WA
                  </a>
                )}
                {variacao < 3 && (
                  <button
                    onClick={() => action.mutate({ id: lead.id, act: 'next_eng' })}
                    disabled={action.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500/15 border border-purple-500/30 text-purple-400 hover:bg-purple-500/25 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                  >
                    <Send size={11} /> Enviar Eng V{nextVariacao} agora
                  </button>
                )}
                <button
                  onClick={() => action.mutate({ id: lead.id, act: 'handled' })}
                  disabled={action.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/15 border border-blue-500/30 text-blue-400 hover:bg-blue-500/25 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-40"
                >
                  <Check size={11} /> Já resolvi manualmente
                </button>
                <button
                  onClick={() => action.mutate({ id: lead.id, act: 'morto' })}
                  disabled={action.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 border border-brd text-muted hover:text-red-400 text-[11px] rounded-lg transition-colors disabled:opacity-40"
                >
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
  const [activityOpen, setActivityOpen] = useState(true)
  const [preview, setPreview] = useState(false)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['operacao'],
    queryFn: api.getOperacao,
    refetchInterval: 15_000,
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

  const inProgress = showPreview ? MOCK : realProgress
  const total = showPreview
    ? Object.values(MOCK).reduce((s, arr) => s + arr.length, 0)
    : realTotal

  return (
    <div className="flex gap-3 items-start">
      {/* Kanban board */}
      <div className="flex-1 min-w-0">
        <EngRevisaoPanel />
        {/* Header row */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-[12px] text-muted">
            {isLoading ? '…' : `${showPreview ? total + ' (preview)' : total} lead${total !== 1 ? 's' : ''} em processamento`}
          </span>
          {!isLoading && (
            <button
              onClick={() => setPreview(v => !v)}
              className={`ml-auto text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                showPreview
                  ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                  : 'bg-surface2 border-brd text-muted hover:text-white'
              }`}
            >
              {showPreview ? '✕ Fechar preview' : '👁 Ver preview'}
            </button>
          )}
        </div>

        {showPreview && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
            <span className="text-[11px] text-purple-400">Preview com dados fictícios — assim vai aparecer quando o pipeline estiver rodando</span>
          </div>
        )}

        {/* Board */}
        <div className="overflow-x-auto pb-4" style={{ scrollbarWidth: 'thin' }}>
          <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
            {isLoading ? (
              COLUMNS.map(col => (
                <div key={col.id} className="min-w-[220px] w-[220px] shrink-0">
                  <div className="h-8 bg-surface2 rounded-lg animate-pulse mb-2" />
                  <div className="space-y-1.5">
                    {[1, 2].map(i => (
                      <div key={i} className="h-20 bg-surface2 rounded-xl animate-pulse" />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              COLUMNS.map(col => (
                <KanbanColumn
                  key={col.id}
                  col={col}
                  leads={(inProgress as any)[col.id] ?? []}
                  onView={showPreview ? () => {} : setSelectedLeadId}
                  onMarkMorto={showPreview ? () => {} : id => markMorto.mutate(id)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Live Activity panel */}
      <LiveActivityPanel
        open={activityOpen}
        onToggle={() => setActivityOpen(v => !v)}
        mockEvents={showPreview ? MOCK_ACTIVITY : undefined}
      />

      {/* Conversation drawer */}
      <LeadDetailDrawer
        leadId={selectedLeadId}
        onClose={() => {
          setSelectedLeadId(null)
          qc.invalidateQueries({ queryKey: ['operacao'] })
        }}
      />
    </div>
  )
}
