import { statusConfig } from '@/lib/utils'

export function StatusPill({ status }: { status: string }) {
  const { label, cls } = statusConfig(status)
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}
