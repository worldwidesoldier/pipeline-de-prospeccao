import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

function StatCard({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <div className="bg-surface border border-brd rounded-xl p-4">
      <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">{label}</div>
      {value == null ? (
        <div className="h-8 w-12 bg-surface2 rounded animate-pulse" />
      ) : (
        <div className={`text-[26px] font-bold tabular-nums ${color}`}>{value}</div>
      )}
    </div>
  )
}

const STAGES = [
  { key: 'novo',             label: 'Novos',      color: '#a855f7' },
  { key: 'enriched',         label: 'Enriquec.',  color: '#3b82f6' },
  { key: 'tested',           label: 'Testados',   color: '#eab308' },
  { key: 'scored',           label: 'Scored',     color: '#f97316' },
  { key: 'pending_approval', label: 'Pendentes',  color: '#ef4444' },
  { key: 'approved',         label: 'Aprovados',  color: '#22c55e' },
  { key: 'outreach',         label: 'Outreach',   color: '#06b6d4' },
]

export function PipelinePage() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, refetchInterval: 30_000 })
  const { data: pipeline } = useQuery({ queryKey: ['pipeline'], queryFn: api.getPipeline, refetchInterval: 30_000 })

  const chartData = STAGES.map(s => ({
    name: s.label,
    value: pipeline?.[s.key as keyof typeof pipeline] ?? 0,
    color: s.color,
  }))

  return (
    <div className="space-y-6">
      {/* Today KPIs */}
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">Hoje</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
          <StatCard label="Prospectados" value={stats?.prospectados} color="text-blue-400" />
          <StatCard label="Enriquecidos" value={stats?.enriquecidos} color="text-blue-400" />
          <StatCard label="Testados WA"  value={stats?.testados}     color="text-yellow-400" />
          <StatCard label="Aprovados"    value={stats?.aprovados}    color="text-orange-400" />
          <StatCard label="Enviados"     value={stats?.enviados}     color="text-purple-400" />
          <StatCard label="Responderam"  value={stats?.respostas}    color="text-green-400" />
          <StatCard label="Convertidos"  value={stats?.convertidos}  color="text-green-400" />
        </div>
      </div>

      {/* Funnel Chart */}
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">Funil total</div>
        <div className="bg-surface border border-brd rounded-xl p-6">
          {!pipeline ? (
            <div className="h-48 bg-surface2 rounded animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 40 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={72} tick={{ fill: '#8892a4', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#1a1d27', border: '1px solid #2e3248', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  itemStyle={{ color: '#8892a4' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                  ))}
                  <LabelList dataKey="value" position="right" style={{ fill: '#8892a4', fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* Fora do funil */}
          <div className="mt-4 pt-4 border-t border-brd flex flex-wrap gap-6">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-muted uppercase tracking-wide">Descartados</span>
              <span className="text-[20px] font-bold text-muted tabular-nums">
                {pipeline?.descartado ?? '—'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-sky-400 uppercase tracking-wide">📞 Só número fixo</span>
              <span className="text-[20px] font-bold text-sky-400 tabular-nums">
                {pipeline?.sem_whatsapp_fixo ?? '—'}
              </span>
              <span className="text-[11px] text-muted">para ligar</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
