function Sk({ className = '' }: { className?: string }) {
  return <div className={`bg-surface2 rounded animate-pulse ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="bg-surface border border-brd rounded-xl overflow-hidden">
      <div className="p-4 flex justify-between items-start gap-3">
        <div className="flex-1 space-y-2">
          <Sk className="h-4 w-3/4" />
          <Sk className="h-3 w-1/2" />
        </div>
        <Sk className="h-12 w-12 rounded-lg" />
      </div>
      <div className="border-t border-brd p-4 space-y-2">
        <Sk className="h-3 w-full" />
        <Sk className="h-3 w-4/5" />
        <Sk className="h-3 w-3/5" />
      </div>
      <div className="border-t border-brd p-4">
        <Sk className="h-14 w-full rounded-lg" />
      </div>
      <div className="border-t border-brd p-4 grid grid-cols-2 gap-2">
        <Sk className="h-2 w-full" />
        <Sk className="h-2 w-full" />
        <Sk className="h-2 w-full" />
        <Sk className="h-2 w-full" />
      </div>
      <div className="border-t border-brd p-4 flex gap-2">
        <Sk className="h-9 flex-[2] rounded-lg" />
        <Sk className="h-9 flex-1 rounded-lg" />
      </div>
    </div>
  )
}
