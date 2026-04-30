import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts'

function StatCard({ label, value, color, sub }: { label: string; value?: number; color: string; sub?: string }) {
  return (
    <div className="bg-surface border border-brd rounded-xl p-4">
      <div className="text-[10px] text-muted uppercase tracking-wide mb-1.5">{label}</div>
      {value == null ? (
        <div className="h-8 w-12 bg-surface2 rounded animate-pulse" />
      ) : (
        <div className={`text-[26px] font-bold tabular-nums ${color}`}>{value}</div>
      )}
      {sub && <div className="text-[10px] text-muted mt-1">{sub}</div>}
    </div>
  )
}

// Funil V2: do mystery shop até briefing
const FUNNEL_STAGES = [
  { key: 'novo',             label: 'Novos',       color: '#a855f7' },
  { key: 'enriched',         label: 'Com WA',      color: '#3b82f6' },
  { key: 'ms_m1_sent',       label: 'M1 Enviado',  color: '#eab308' },
  { key: 'ms_m2a_sent',      label: 'M2A Enviado', color: '#f97316' },
  { key: 'ativo',            label: 'Ativos',      color: '#22c55e' },
  { key: 'intelligence_done',label: 'Analisados',  color: '#06b6d4' },
  { key: 'eng_v1',           label: 'Eng. V1',     color: '#8b5cf6' },
  { key: 'briefing_done',    label: 'Pra Ligar',   color: '#10b981' },
]

export function PipelinePage() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, refetchInterval: 30_000 })
  const { data: pipeline } = useQuery({ queryKey: ['pipeline'], queryFn: api.getPipeline, refetchInterval: 30_000 })

  const chartData = FUNNEL_STAGES.map(s => ({
    name: s.label,
    value: pipeline?.[s.key as keyof typeof pipeline] ?? 0,
    color: s.color,
  }))

  const engEmAndamento = (pipeline?.eng_v1 ?? 0) + (pipeline?.eng_v2 ?? 0) + (pipeline?.eng_v3 ?? 0)
  const msMystery = (pipeline?.ms_m1_sent ?? 0) + (pipeline?.ms_m2b_sent ?? 0) + (pipeline?.ms_m2a_sent ?? 0)

  return (
    <div className="space-y-6">
      {/* KPIs de hoje */}
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">Hoje</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
          <StatCard label="Prospectados"   value={stats?.prospectados}  color="text-blue-400" />
          <StatCard label="Enriquecidos"   value={stats?.enriquecidos}  color="text-blue-400" />
          <StatCard label="M1 Enviados"    value={stats?.testados}      color="text-yellow-400" />
          <StatCard label="Responderam"    value={stats?.respostas}     color="text-green-400" />
          <StatCard label="Convertidos"    value={stats?.convertidos}   color="text-emerald-400" />
        </div>
      </div>

      {/* Funil total */}
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-3">Funil total</div>
        <div className="bg-surface border border-brd rounded-xl p-6">
          {!pipeline ? (
            <div className="h-56 bg-surface2 rounded animate-pulse" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 48 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={88} tick={{ fill: '#8892a4', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#1a1d27', border: '1px solid #2e3248', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  itemStyle={{ color: '#8892a4' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                  ))}
                  <LabelList dataKey="value" position="right" style={{ fill: '#8892a4', fontSize: 12 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* Conversion rates */}
          {pipeline && (() => {
            const conv = (a: number, b: number) => a > 0 ? `${Math.round((b / a) * 100)}%` : '—'
            const rows = [
              { label: 'Com WA → M1 Enviado',  from: pipeline.enriched,         to: pipeline.ms_m1_sent,        color: '#eab308' },
              { label: 'M1 → Ativos',           from: pipeline.ms_m1_sent,       to: pipeline.ativo,             color: '#22c55e' },
              { label: 'Ativos → Analisados',   from: pipeline.ativo,            to: pipeline.intelligence_done, color: '#06b6d4' },
              { label: 'Analisados → Eng V1',   from: pipeline.intelligence_done,to: pipeline.eng_v1,            color: '#8b5cf6' },
              { label: 'Eng → Briefing',        from: pipeline.eng_v1,           to: pipeline.briefing_done,     color: '#10b981' },
            ]
            return (
              <div className="mt-4 pt-4 border-t border-brd">
                <div className="text-[10px] text-muted uppercase tracking-wide mb-2 font-semibold">Taxas de conversão</div>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {rows.map(r => (
                    <div key={r.label} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted">{r.label}</span>
                      <span className="text-[13px] font-bold tabular-nums" style={{ color: r.color }}>
                        {conv(r.from, r.to)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Em andamento + descartados */}
          <div className="mt-4 pt-4 border-t border-brd flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted uppercase tracking-wide">Em mystery shop</span>
              <span className="text-[20px] font-bold text-yellow-400 tabular-nums">{msMystery}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-purple-400 uppercase tracking-wide">Engenharia</span>
              <span className="text-[20px] font-bold text-purple-400 tabular-nums">{engEmAndamento}</span>
              <span className="text-[11px] text-muted">em andamento</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-red-400 uppercase tracking-wide">Mortos</span>
              <span className="text-[20px] font-bold text-red-400/70 tabular-nums">{pipeline?.morto ?? '—'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted uppercase tracking-wide">Descartados</span>
              <span className="text-[20px] font-bold text-muted tabular-nums">{pipeline?.descartado ?? '—'}</span>
            </div>
            {(pipeline?.sem_whatsapp_fixo ?? 0) > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-sky-400 uppercase tracking-wide">Só fixo</span>
                <span className="text-[20px] font-bold text-sky-400 tabular-nums">{pipeline?.sem_whatsapp_fixo}</span>
                <span className="text-[11px] text-muted">para ligar direto</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
