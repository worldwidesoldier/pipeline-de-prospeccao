import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { api } from '@/lib/api'
import { WaStatusButton, WaPanel } from '@/components/layout/WaPanel'
import { InboxPage } from '@/pages/Inbox'
import { PipelinePage } from '@/pages/Pipeline'
import { LeadsPage } from '@/pages/Leads'
import { KanbanPage } from '@/pages/Kanban'
import { CampanhasPage } from '@/pages/Campanhas'
import { TemplatesPage } from '@/pages/Templates'

type Tab = 'inbox' | 'pipeline' | 'leads' | 'crm' | 'campanhas' | 'templates'

function Clock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const update = () => setTime(
      new Date().toLocaleTimeString('pt-BR') + ' — ' + new Date().toLocaleDateString('pt-BR')
    )
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [])
  return <span className="text-muted text-[12px] tabular-nums hidden sm:block">{time}</span>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('inbox')
  const [waOpen, setWaOpen] = useState(false)

  const { data: inbox } = useQuery({
    queryKey: ['inbox'],
    queryFn: api.getPending,
    refetchInterval: 30_000,
  })

  const inboxCount = inbox?.length ?? 0

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'inbox',     label: 'Inbox',     badge: inboxCount },
    { key: 'pipeline',  label: 'Pipeline' },
    { key: 'leads',     label: 'Leads' },
    { key: 'crm',       label: 'CRM' },
    { key: 'campanhas', label: 'Campanhas' },
    { key: 'templates', label: 'Templates' },
  ]

  return (
    <div className="min-h-screen bg-bg text-slate-200">
      <Toaster position="bottom-right" theme="dark" richColors />

      {/* Header */}
      <header className="bg-surface border-b border-brd px-6 h-[52px] flex items-center justify-between sticky top-0 z-50">
        <div className="font-bold text-[15px] tracking-tight">
          Fair <span className="text-blue-400">Assist</span>
          <span className="text-muted font-normal ml-1.5">— Pipeline</span>
        </div>
        <div className="flex items-center gap-3">
          <WaStatusButton onClick={() => setWaOpen(v => !v)} />
          <Clock />
        </div>
      </header>

      <WaPanel open={waOpen} onClose={() => setWaOpen(false)} />

      {/* Tab nav */}
      <nav className="bg-surface border-b border-brd px-6 flex sticky top-[52px] z-40 overflow-x-auto">
        {TABS.map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`relative px-4 py-3.5 text-[13px] font-medium whitespace-nowrap transition-colors flex items-center gap-2 ${
              tab === key ? 'text-white' : 'text-muted hover:text-slate-300'
            }`}
          >
            {label}
            {badge != null && badge > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {badge}
              </span>
            )}
            {tab === key && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t" />
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {tab === 'inbox'     && <InboxPage />}
        {tab === 'pipeline'  && <PipelinePage />}
        {tab === 'leads'     && <LeadsPage />}
        {tab === 'crm'       && <KanbanPage />}
        {tab === 'campanhas' && <CampanhasPage />}
        {tab === 'templates' && <TemplatesPage />}
      </main>
    </div>
  )
}
