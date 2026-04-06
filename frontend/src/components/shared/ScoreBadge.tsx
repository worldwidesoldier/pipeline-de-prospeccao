import { scoreClass } from '@/lib/utils'
import { cn } from '@/lib/utils'

interface Props { score: number }

export function ScoreBadge({ score }: Props) {
  const variant = scoreClass(score)
  return (
    <div className={cn(
      'flex-shrink-0 text-[20px] font-bold px-3 py-1.5 rounded-lg text-center leading-none tabular-nums',
      variant === 'hot' && 'bg-orange-500/15 text-orange-400',
      variant === 'warm' && 'bg-yellow-500/15 text-yellow-400',
      variant === 'cold' && 'bg-blue-500/15 text-blue-400',
    )}>
      {score}
      <div className="text-[9px] font-medium opacity-70 mt-0.5">/100</div>
    </div>
  )
}
