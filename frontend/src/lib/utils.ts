import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { WaTest } from '@/types/api'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function waHref(n?: string | null): string | null {
  if (!n) return null
  const c = n.replace(/[^\d]/g, '')
  return 'https://wa.me/' + (c.startsWith('55') ? c : '55' + c)
}

export function fmtMin(m?: number | null): string {
  if (m == null) return '—'
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`
}

export function scoreClass(t: number): 'hot' | 'warm' | 'cold' {
  return t >= 70 ? 'hot' : t >= 50 ? 'warm' : 'cold'
}

export function fillColor(v?: number | null): string {
  if (!v) return 'bg-brd'
  if (v >= 70) return 'bg-green-500'
  if (v >= 40) return 'bg-yellow-500'
  return 'bg-blue-500'
}

export function selectPitchVariant(waTest?: WaTest | null): 'v1' | 'v2' | 'v3' {
  if (!waTest || !waTest.respondeu) return 'v2'
  if ((waTest.qualidade_resposta ?? 100) < 60) return 'v3'
  return 'v1'
}

export function fmtHoras(min?: number | null): string {
  if (!min) return '0 horas'
  const h = Math.round(min / 60)
  return h === 1 ? '1 hora' : `${h} horas`
}

export function esc(s?: string | null): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function timeChipClass(waTest?: WaTest | null): { cls: string; label: string } {
  if (!waTest) return { cls: 'bg-surface2 text-muted', label: 'Não testado' }
  if (waTest.is_bot) return { cls: 'bg-purple-500/15 text-purple-400', label: '🤖 Bot detectado' }
  if (!waTest.respondeu) return { cls: 'bg-emerald-500/20 text-emerald-400 font-bold', label: '🎯 Sem resposta (+18h)' }
  const min = waTest.tempo_resposta_min ?? 0
  if (min >= 240) return { cls: 'bg-emerald-500/15 text-emerald-400', label: `🐌 ${fmtMin(min)}` }
  if (min >= 60)  return { cls: 'bg-yellow-500/15 text-yellow-400',   label: `⏱ ${fmtMin(min)}` }
  if (min >= 15)  return { cls: 'bg-orange-500/15 text-orange-400',   label: `⚡ ${fmtMin(min)}` }
  return { cls: 'bg-red-500/15 text-red-400', label: `⚡ ${fmtMin(min)} (rápido)` }
}

export function statusConfig(status: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    novo:             { label: 'Novo',            cls: 'bg-purple-500/15 text-purple-400' },
    enriched:         { label: 'Enriquecido',     cls: 'bg-blue-500/15 text-blue-400' },
    tested:           { label: 'Testado',         cls: 'bg-yellow-500/15 text-yellow-400' },
    scored:           { label: 'Scored',          cls: 'bg-orange-500/15 text-orange-400' },
    pending_approval: { label: 'Pendente',        cls: 'bg-red-500/15 text-red-400' },
    approved:         { label: 'Aprovado',        cls: 'bg-green-500/15 text-green-400' },
    outreach:         { label: 'Outreach',        cls: 'bg-cyan-500/15 text-cyan-400' },
    descartado:          { label: 'Descartado',      cls: 'bg-surface2 text-muted' },
    descartado_bot:      { label: 'Tem bot',         cls: 'bg-purple-500/15 text-purple-400' },
    sem_whatsapp:        { label: 'Sem WhatsApp',    cls: 'bg-slate-500/15 text-slate-400' },
    sem_whatsapp_fixo:   { label: 'Só número fixo',  cls: 'bg-sky-500/15 text-sky-400' },
  }
  return map[status] ?? { label: status, cls: 'bg-surface2 text-muted' }
}
