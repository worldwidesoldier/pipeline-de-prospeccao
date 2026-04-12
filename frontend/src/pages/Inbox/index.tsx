import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { LeadCard } from './LeadCard'
import { SkeletonCard } from '@/components/shared/SkeletonCard'
import { CheckCircle } from 'lucide-react'

const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors'

export function InboxPage() {
  const [campaignId, setCampaignId] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['inbox', campaignId],
    queryFn: () => api.getPending(campaignId || undefined),
    refetchInterval: 30_000,
  })

  const { data: pitchTemplates } = useQuery({
    queryKey: ['outreach-templates'],
    queryFn: api.getOutreachTemplates,
  })

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: api.getCampaigns,
  })

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={campaignId}
          onChange={e => setCampaignId(e.target.value)}
          className={`${inputCls} max-w-[260px]`}
        >
          <option value="">Todas as campanhas</option>
          {campaigns?.map(c => (
            <option key={c.id} value={c.id}>
              {((c as any).campaign_name || c.query).slice(0, 40)}
            </option>
          ))}
        </select>
        {data && (
          <span className="text-[12px] text-muted">
            {data.length} lead{data.length !== 1 ? 's' : ''} aguardando aprovação
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : !data?.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted gap-3">
          <CheckCircle size={40} className="text-green-500/50" />
          <p className="text-[15px] text-white">
            {campaignId ? 'Nenhum lead pendente nessa campanha' : 'Inbox limpo'}
          </p>
          <p className="text-[13px]">
            {campaignId ? 'Tente outra campanha.' : 'Dispare uma campanha para gerar novos leads.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
          {data.map(item => (
            <LeadCard key={item.lead.id} item={item} pitchTemplates={pitchTemplates} />
          ))}
        </div>
      )}
    </div>
  )
}
