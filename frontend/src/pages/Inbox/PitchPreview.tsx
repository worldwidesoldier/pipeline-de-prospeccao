import type { WaTest } from '@/types/api'
import type { OutreachTemplates } from '@/types/api'
import { selectPitchVariant, fmtHoras } from '@/lib/utils'

interface Props {
  waTest?: WaTest | null
  templates?: OutreachTemplates | null
}

export function PitchPreview({ waTest, templates }: Props) {
  if (!templates) return null
  const variant = selectPitchVariant(waTest)
  const tpl = templates[variant]
  if (!tpl) return null

  const horasStr = fmtHoras(waTest?.tempo_resposta_min)
  const preview = tpl.texto
    .replace(/\[X horas\]/g, horasStr)
    .substring(0, 140)

  const variantColors: Record<string, string> = {
    v1: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    v2: 'text-red-400 bg-red-500/10 border-red-500/20',
    v3: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  }

  return (
    <div className={`mx-4 mb-3 p-3 rounded-lg border ${variantColors[variant]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">Pitch a enviar</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${variantColors[variant]}`}>
          {tpl.nome}
        </span>
      </div>
      <p className="text-[11px] opacity-75 leading-relaxed line-clamp-2">{preview}...</p>
    </div>
  )
}
