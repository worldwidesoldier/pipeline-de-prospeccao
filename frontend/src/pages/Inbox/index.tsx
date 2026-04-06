import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { LeadCard } from './LeadCard'
import { SkeletonCard } from '@/components/shared/SkeletonCard'
import { CheckCircle } from 'lucide-react'

export function InboxPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['inbox'],
    queryFn: api.getPending,
    refetchInterval: 30_000,
  })

  const { data: pitchTemplates } = useQuery({
    queryKey: ['outreach-templates'],
    queryFn: api.getOutreachTemplates,
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
        {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
      </div>
    )
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted gap-3">
        <CheckCircle size={40} className="text-green-500/50" />
        <p className="text-[15px] text-white">Inbox limpo</p>
        <p className="text-[13px]">Dispare uma campanha para gerar novos leads.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
      {data.map(item => (
        <LeadCard key={item.lead.id} item={item} pitchTemplates={pitchTemplates} />
      ))}
    </div>
  )
}
