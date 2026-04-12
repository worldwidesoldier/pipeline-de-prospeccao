import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Globe, Instagram, Phone, Star, MapPin } from 'lucide-react'
import type { PendingItem, OutreachTemplates } from '@/types/api'
import { waHref, mapsHref, timeChipClass, fmtMin, cn } from '@/lib/utils'
import { ScoreBadge } from '@/components/shared/ScoreBadge'
import { ScoreBars } from '@/components/shared/ScoreBars'
import { PitchPreview } from './PitchPreview'
import { api } from '@/lib/api'

interface Props {
  item: PendingItem
  pitchTemplates?: OutreachTemplates | null
}

export function LeadCard({ item, pitchTemplates }: Props) {
  const { lead, enrichment, waTest, score } = item
  const [removed, setRemoved] = useState(false)
  const qc = useQueryClient()

  const onSuccess = () => {
    setRemoved(true)
    setTimeout(() => qc.invalidateQueries({ queryKey: ['inbox'] }), 300)
  }

  const approveMutation = useMutation({
    mutationFn: () => api.approveLead(lead.id),
    onSuccess: () => { toast.success(`${lead.nome} aprovado — pitch na fila!`); onSuccess() },
    onError: () => toast.error('Erro ao aprovar lead'),
  })

  const discardMutation = useMutation({
    mutationFn: () => api.discardLead(lead.id),
    onSuccess: () => { toast.success('Lead descartado'); onSuccess() },
    onError: () => toast.error('Erro ao descartar lead'),
  })

  const phone = lead.whatsapp || lead.telefone_google
  const wHref = waHref(phone)
  const igUser = enrichment?.ig_username
  const tc = timeChipClass(waTest)
  const s = score?.score_total ?? 0
  const busy = approveMutation.isPending || discardMutation.isPending

  // Determine WA section bg based on response quality
  const waNoResponse = !waTest?.respondeu && waTest?.tempo_resposta_min != null
  const waBot = waTest?.is_bot
  const waBg = waNoResponse
    ? 'bg-emerald-950/40 border-emerald-800/30'
    : waBot
      ? 'bg-purple-950/30 border-purple-800/20'
      : 'bg-slate-800/40 border-slate-700/30'

  // suppress unused warning
  void fmtMin

  return (
    <div
      className={cn(
        'bg-surface border border-brd rounded-xl overflow-hidden flex flex-col transition-all duration-300',
        removed ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      )}
    >
      {/* ── Header: Nome + Score ─────────────────────── */}
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[15px] leading-snug text-white">{lead.nome}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {lead.google_rating && (
              <span className="flex items-center gap-0.5 text-[12px] text-yellow-400">
                <Star size={11} fill="currentColor" />
                {lead.google_rating}
                {lead.google_reviews ? <span className="text-muted ml-0.5">({lead.google_reviews})</span> : null}
              </span>
            )}
            <span className="flex items-center gap-1 text-[12px] text-muted">
              <MapPin size={11} />
              {[lead.cidade, lead.estado].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
        </div>
        <ScoreBadge score={s} />
      </div>

      {/* ── WA Atendimento (hero section) ────────────── */}
      <div className={cn('mx-3 mb-3 rounded-lg border p-3', waBg)}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide">Atendimento WA</span>
          <span className={cn('text-[12px] font-bold px-2.5 py-1 rounded-full', tc.cls)}>
            {tc.label}
          </span>
        </div>

        {waTest?.resposta_texto ? (
          <p className="text-[13px] text-slate-200 leading-relaxed italic max-h-[72px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
            "{waTest.resposta_texto}"
          </p>
        ) : waNoResponse ? (
          <p className="text-[13px] text-emerald-400/70 italic">
            Nenhuma resposta recebida após 18h úteis — forte sinal de dor.
          </p>
        ) : waTest?.mensagem_enviada ? (
          <p className="text-[12px] text-muted italic">
            Aguardando resposta... <span className="not-italic opacity-50">"{waTest.mensagem_enviada.substring(0, 80)}"</span>
          </p>
        ) : (
          <p className="text-[12px] text-muted italic">Nenhum teste WA enviado.</p>
        )}

        {waTest?.qualidade_resposta != null && waTest.qualidade_resposta > 0 && !waBot && (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="text-[11px] text-muted">Qualidade da resposta:</span>
            <span className={cn('text-[11px] font-semibold', waTest.qualidade_resposta >= 70 ? 'text-orange-400' : waTest.qualidade_resposta >= 40 ? 'text-yellow-400' : 'text-green-400')}>
              {waTest.qualidade_resposta}/100
            </span>
          </div>
        )}
      </div>

      {/* ── Score bars (compact) ─────────────────────── */}
      <div className="px-3 pb-3">
        <ScoreBars
          wa={score?.score_resposta}
          site={score?.score_site}
          ig={score?.score_instagram}
          google={score?.score_google}
        />
      </div>

      <div className="border-t border-brd" />

      {/* ── Contato (compact row) ────────────────────── */}
      <div className="px-3 py-2.5 flex items-center gap-3 flex-wrap">
        {phone && (
          <a
            href={wHref ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-blue-400 hover:text-blue-300 transition-colors"
          >
            <Phone size={12} />
            <span className="font-mono">{phone.replace(/\D/g,'').replace(/^55(\d{2})(\d{4,5})(\d{4})$/,'($1) $2-$3')}</span>
            <span className="text-[10px] bg-blue-500/15 px-1.5 py-0.5 rounded">WA ↗</span>
          </a>
        )}
        {lead.site && (
          <a
            href={lead.site}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-300 transition-colors"
          >
            <Globe size={12} />
            <span className="truncate max-w-[120px]">{lead.site.replace(/^https?:\/\/(www\.)?/,'')}</span>
          </a>
        )}
        {igUser && (
          <a
            href={`https://instagram.com/${igUser}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] text-pink-400 hover:text-pink-300 transition-colors"
          >
            <Instagram size={12} />
            <span>@{igUser}</span>
          </a>
        )}
        <a
          href={mapsHref(lead.nome, lead.cidade, lead.estado)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[12px] text-red-400 hover:text-red-300 transition-colors"
        >
          <MapPin size={12} />
          <span>Google</span>
        </a>
      </div>

      {/* ── Pitch preview ────────────────────────────── */}
      <PitchPreview waTest={waTest} templates={pitchTemplates} />

      {/* ── Actions ──────────────────────────────────── */}
      <div className="px-3 pb-3 flex gap-2">
        <button
          onClick={() => approveMutation.mutate()}
          disabled={busy}
          className="flex-[2] py-2.5 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-black font-bold text-[13px] rounded-lg transition-colors"
        >
          {approveMutation.isPending ? 'Enviando...' : '✓ Aprovar e Enviar Pitch'}
        </button>
        <button
          onClick={() => discardMutation.mutate()}
          disabled={busy}
          className="flex-1 py-2.5 bg-surface2 hover:bg-red-500/10 disabled:opacity-40 text-muted hover:text-red-400 border border-brd hover:border-red-500/50 font-semibold text-[13px] rounded-lg transition-colors"
        >
          ✕ Descartar
        </button>
      </div>
    </div>
  )
}
