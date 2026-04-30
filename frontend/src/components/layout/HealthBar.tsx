import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function HealthBar() {
  const { data: motor } = useQuery({
    queryKey: ['motorStatus'],
    queryFn: api.getMotorStatus,
    refetchInterval: 15_000,
  })
  const { data: wa } = useQuery({
    queryKey: ['waStatus'],
    queryFn: api.getWaStatus,
    refetchInterval: 30_000,
  })

  const isPaused = motor?.status === 'paused'
  const waOk = wa?.connected
  const remaining = motor?.remaining ?? 0
  const maxDaily = motor?.maxDaily ?? 0
  const progress = maxDaily > 0 ? Math.round(((motor?.todayCount ?? 0) / maxDaily) * 100) : 0

  return (
    <div className="bg-[#13161f] border-b border-brd px-6 h-[34px] flex items-center gap-5 text-[11px] overflow-x-auto">
      {/* WA */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${waOk ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
        <span className={waOk ? 'text-green-400' : 'text-red-400'}>{waOk ? 'WA OK' : 'WA Offline'}</span>
        {wa?.number && <span className="text-muted hidden lg:inline">· {wa.number}</span>}
      </div>

      <span className="text-brd/60 shrink-0">|</span>

      {/* Motor */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPaused ? 'bg-yellow-400' : remaining > 0 ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
        <span className={isPaused ? 'text-yellow-400' : remaining > 0 ? 'text-muted' : 'text-red-400'}>
          {isPaused ? 'Motor pausado' : remaining > 0 ? 'Rodando' : 'Limite atingido'}
        </span>
      </div>

      <span className="text-brd/60 shrink-0">|</span>

      {/* Daily quota */}
      {motor && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-muted">M1 hoje:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-white font-semibold tabular-nums">{motor.todayCount}</span>
            <span className="text-muted">/ {motor.maxDaily}</span>
            <div className="w-16 h-1 bg-surface2 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progress >= 90 ? 'bg-red-400' : progress >= 60 ? 'bg-yellow-400' : 'bg-blue-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {motor?.pendingCount != null && (
        <>
          <span className="text-brd/60 shrink-0">|</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-muted">Fila:</span>
            <span className={`font-semibold tabular-nums ${motor.pendingCount > 0 ? 'text-blue-400' : 'text-muted'}`}>
              {motor.pendingCount}
            </span>
          </div>
        </>
      )}

      {/* Last sent */}
      {motor?.lastSentLeadNome && (
        <div className="hidden lg:flex items-center gap-1.5 ml-auto shrink-0">
          <span className="text-muted">Último M1:</span>
          <span className="text-slate-300 truncate max-w-[140px]">{motor.lastSentLeadNome}</span>
          {motor.lastSentAt && (
            <span className="text-muted">
              {new Date(motor.lastSentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
