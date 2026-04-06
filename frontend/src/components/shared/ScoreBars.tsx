import { fillColor } from '@/lib/utils'

function Bar({ label, value }: { label: string; value?: number | null }) {
  const v = value ?? 0
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted w-8 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${fillColor(v)}`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-[10px] text-muted w-5 text-right tabular-nums">{v}</span>
    </div>
  )
}

interface Props {
  wa?: number | null
  site?: number | null
  ig?: number | null
  google?: number | null
}

export function ScoreBars({ wa, site, ig, google }: Props) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      <Bar label="WA" value={wa} />
      <Bar label="Site" value={site} />
      <Bar label="IG" value={ig} />
      <Bar label="Google" value={google} />
    </div>
  )
}
