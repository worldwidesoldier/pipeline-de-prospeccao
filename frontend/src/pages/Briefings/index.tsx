import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Briefing } from '@/types/api'
import { Phone, Copy, ChevronDown, ChevronUp, MessageCircle, PhoneCall, CheckCircle2, XCircle, PhoneMissed } from 'lucide-react'
import { toast } from 'sonner'

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text)
  toast.success(`${label} copiado!`)
}

const DOR_BADGE: Record<string, { label: string; cls: string }> = {
  INEFICIENCIA: { label: 'INEFICIÊNCIA', cls: 'bg-red-500/15 text-red-400 border border-red-500/25' },
  OPORTUNIDADE: { label: 'OPORTUNIDADE', cls: 'bg-green-500/15 text-green-400 border border-green-500/25' },
}

const TIPO_BADGE: Record<string, string> = {
  BOT:    'bg-orange-500/15 text-orange-400 border border-orange-500/25',
  HUMANO: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',
}

const QUAL_COLOR: Record<string, string> = {
  RUIM:      'text-red-400',
  MEDIANA:   'text-yellow-400',
  BOA:       'text-green-400',
  EXCELENTE: 'text-emerald-400',
}

function BriefingCard({ b, onOutcome }: { b: Briefing; onOutcome: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmOutcome, setConfirmOutcome] = useState<'fechou' | 'sem_interesse' | null>(null)
  const qc = useQueryClient()

  const dor = b.dor_perfil ? DOR_BADGE[b.dor_perfil] : null
  const tipoCls = b.tipo_atendimento ? TIPO_BADGE[b.tipo_atendimento] ?? '' : ''
  const qualColor = b.qualidade_resposta ? QUAL_COLOR[b.qualidade_resposta] ?? 'text-muted' : 'text-muted'
  const fracos = b.pontos_fracos ?? []

  const outcome = useMutation({
    mutationFn: (o: 'fechou' | 'sem_interesse' | 'sem_resposta') => api.callOutcome(b.id, o),
    onSuccess: (_, o) => {
      if (o === 'fechou') toast.success('Deal fechado! 🎉')
      else if (o === 'sem_interesse') toast.success('Lead descartado')
      else toast.success('Registrado — lead permanece na fila')
      setConfirmOutcome(null)
      qc.invalidateQueries({ queryKey: ['briefings'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      onOutcome()
    },
    onError: () => toast.error('Erro ao registrar resultado'),
  })

  const alreadyCalled = !!b.call_outcome

  return (
    <div className={`bg-surface border rounded-xl overflow-hidden transition-colors ${
      b.call_outcome === 'sem_resposta' ? 'border-yellow-500/30' : 'border-brd hover:border-slate-600'
    }`}>
      {/* Header do card */}
      <div className="p-4 space-y-3">
        {/* Linha 1: nome + badges */}
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-[14px] truncate">{b.nome}</h3>
            {(b.cidade || b.estado) && (
              <p className="text-muted text-[12px] mt-0.5">{[b.cidade, b.estado].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {dor && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dor.cls}`}>{dor.label}</span>
            )}
            {b.tipo_atendimento && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tipoCls}`}>{b.tipo_atendimento}</span>
            )}
            {b.qualidade_resposta && (
              <span className={`text-[10px] font-semibold tabular-nums ${qualColor}`}>{b.qualidade_resposta}</span>
            )}
          </div>
        </div>

        {/* Linha 2: gestor phone + ações */}
        {b.gestor_phone ? (
          <div className="flex items-center gap-2 p-2.5 bg-green-500/8 border border-green-500/20 rounded-lg">
            <PhoneCall size={14} className="text-green-400 shrink-0" />
            <span className="font-mono text-[13px] text-green-300 flex-1">{b.gestor_phone}</span>
            <button
              onClick={() => copy(b.gestor_phone!, 'Número')}
              className="p-1 text-green-400/60 hover:text-green-400 transition-colors"
              title="Copiar número"
            >
              <Copy size={12} />
            </button>
            <a
              href={`https://wa.me/${b.gestor_phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-green-400/60 hover:text-green-400 transition-colors"
              title="Abrir no WhatsApp"
            >
              <MessageCircle size={12} />
            </a>
            <a
              href={`tel:${b.gestor_phone.replace(/\D/g, '')}`}
              className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold rounded-md transition-colors"
            >
              <Phone size={10} /> Ligar
            </a>
          </div>
        ) : (
          <div className="px-2.5 py-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg text-yellow-400/70 text-[11px]">
            Aguardando número do gestor...
          </div>
        )}

        {/* Pontos fracos */}
        {fracos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fracos.map((f, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-red-500/10 text-red-300/80 border border-red-500/15 rounded-full">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sem resposta badge */}
      {b.call_outcome === 'sem_resposta' && (
        <div className="mx-4 mb-3 px-2.5 py-1.5 bg-yellow-500/8 border border-yellow-500/20 rounded-lg flex items-center gap-2">
          <PhoneMissed size={12} className="text-yellow-400 shrink-0" />
          <span className="text-[11px] text-yellow-400">Ligação tentada — sem resposta</span>
          <button
            onClick={() => outcome.mutate('sem_resposta')}
            disabled={outcome.isPending}
            className="ml-auto text-[10px] text-yellow-400/60 hover:text-yellow-400 transition-colors"
            title="Registrar nova tentativa"
          >
            tentar dnv
          </button>
        </div>
      )}

      {/* Briefing expandível */}
      {b.briefing_gerado && (
        <div className="border-t border-brd">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] text-muted hover:text-white hover:bg-surface2/50 transition-colors"
          >
            <span className="font-medium">Ver briefing completo</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-2">
              <div className="relative">
                <button
                  onClick={() => copy(b.briefing_gerado!, 'Briefing')}
                  className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-muted hover:text-white px-2 py-1 bg-surface rounded border border-brd transition-colors"
                >
                  <Copy size={10} /> Copiar
                </button>
                <pre className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap bg-surface2 rounded-lg p-4 pr-20 border border-brd font-sans">
                  {b.briefing_gerado}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outcome buttons */}
      {!alreadyCalled && (
        <div className="border-t border-brd px-4 py-3">
          {confirmOutcome ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-white flex-1">
                {confirmOutcome === 'fechou' ? 'Confirmar fechamento? 🎉' : 'Confirmar descarte?'}
              </span>
              <button
                onClick={() => outcome.mutate(confirmOutcome)}
                disabled={outcome.isPending}
                className={`px-3 py-1.5 text-[12px] font-bold text-white rounded-lg transition-colors disabled:opacity-50 ${
                  confirmOutcome === 'fechou' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {outcome.isPending ? '...' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirmOutcome(null)}
                className="px-2 py-1.5 text-[12px] text-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted mr-1">Resultado da ligação:</span>
              <button
                onClick={() => setConfirmOutcome('fechou')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 text-[11px] font-semibold rounded-lg transition-colors"
              >
                <CheckCircle2 size={11} /> Fechou
              </button>
              <button
                onClick={() => outcome.mutate('sem_resposta')}
                disabled={outcome.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 hover:bg-yellow-500/20 text-[11px] font-semibold rounded-lg transition-colors"
              >
                <PhoneMissed size={11} /> Sem resposta
              </button>
              <button
                onClick={() => setConfirmOutcome('sem_interesse')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface2 border border-brd text-muted hover:text-red-400 hover:border-red-500/30 text-[11px] rounded-lg transition-colors ml-auto"
              >
                <XCircle size={11} /> Sem interesse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function BriefingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['briefings'],
    queryFn: api.getBriefings,
    refetchInterval: 60_000,
  })

  const total = data?.length ?? 0
  const comNumero = data?.filter(b => b.gestor_phone).length ?? 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Pronto pra Ligar</h2>
          <p className="text-[12px] text-muted mt-0.5">
            Leads com mystery shop completo e briefing gerado
          </p>
        </div>
        {!isLoading && (
          <div className="flex items-center gap-4 text-[12px]">
            <span className="text-muted">{total} lead{total !== 1 ? 's' : ''} no total</span>
            <span className="text-green-400 font-semibold">{comNumero} com número</span>
          </div>
        )}
      </div>

      {/* Conteúdo */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface border border-brd rounded-xl h-40 animate-pulse" />
          ))}
        </div>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted gap-3">
          <PhoneCall size={40} className="opacity-20" />
          <p className="text-[15px] text-white/50">Nenhum lead pronto para ligar ainda</p>
          <p className="text-[13px]">Quando um lead completar o mystery shop e passar pela engenharia social, aparece aqui.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
          {data.map(b => <BriefingCard key={b.id} b={b} onOutcome={() => {}} />)}
        </div>
      )}
    </div>
  )
}
