import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
import { Search, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { KanbanLead } from '@/types/api'
import { StatusPill } from '@/components/shared/StatusPill'
import { waHref, timeChipClass } from '@/lib/utils'

const COLUMNS = [
  { id: 'minerados',    label: 'Minerados',      emoji: '💎', hint: 'Sendo prospectados' },
  { id: 'waEncontrado', label: 'WA Encontrado',  emoji: '📞', hint: 'WhatsApp encontrado, aguardando teste' },
  { id: 'contatados',   label: 'Contatados',     emoji: '📱', hint: 'Mensagem teste enviada' },
  { id: 'respondidos',  label: 'Respondidos',    emoji: '💬', hint: 'Responderam o outreach' },
  { id: 'fechados',     label: 'Fechados',       emoji: '🤝', hint: 'Convertidos em clientes' },
] as const

type ColumnId = typeof COLUMNS[number]['id']

// ─── Card content (shared between draggable & overlay) ────────────

function CardContent({ lead, onDelete }: { lead: KanbanLead; onDelete?: () => void }) {
  const wHref = waHref(lead.whatsapp)

  // Build a minimal waTest-like object for timeChipClass
  const waTestLike = lead.wa_respondeu !== null && lead.wa_respondeu !== undefined
    ? { respondeu: lead.wa_respondeu, tempo_resposta_min: lead.wa_tempo_resposta_min, is_bot: lead.wa_is_bot }
    : null
  const timeChip = waTestLike !== null ? timeChipClass(waTestLike as any) : null

  return (
    <div className="group/card">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-[13px] text-white leading-tight break-words">{lead.nome}</div>
        {onDelete && (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="opacity-0 group-hover/card:opacity-100 p-1 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all flex-shrink-0"
            title="Deletar lead"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {(lead.cidade || lead.estado) && (
        <div className="text-[11px] text-muted mt-0.5">
          {[lead.cidade, lead.estado].filter(Boolean).join(' / ')}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusPill status={lead.status} />
        {lead.score_total != null && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
            lead.score_total >= 70 ? 'bg-green-500/15 text-green-400' :
            lead.score_total >= 40 ? 'bg-yellow-500/15 text-yellow-400' :
            'bg-surface2 text-muted'
          }`}>
            {lead.score_total}<span className="font-normal">/100</span>
          </span>
        )}
        {timeChip && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${timeChip.cls}`}>
            {timeChip.label}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        {wHref && (
          <a
            href={wHref}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={e => e.stopPropagation()}
            className="text-green-400 text-[11px] hover:text-green-300 transition-colors"
          >
            ✓ WA
          </a>
        )}
        {lead.site && (
          <a
            href={lead.site}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={e => e.stopPropagation()}
            className="text-blue-400 text-[11px] hover:text-blue-300 transition-colors"
          >
            ↗ Site
          </a>
        )}
        {lead.google_rating && (
          <span className="text-[11px] text-yellow-400">
            {lead.google_rating}★
            {lead.google_reviews ? <span className="text-muted"> ({lead.google_reviews})</span> : null}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Draggable card ───────────────────────────────────────────────

function KanbanCard({ lead, columnId, onDelete }: {
  lead: KanbanLead
  columnId: ColumnId
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead, columnId },
  })

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-surface2 border border-brd rounded-xl p-3 cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? 'opacity-25' : 'hover:border-white/10'}`}
    >
      <CardContent lead={lead} onDelete={onDelete} />
    </div>
  )
}

// ─── Droppable column ─────────────────────────────────────────────

function KanbanColumn({ col, leads, onDelete }: {
  col: typeof COLUMNS[number]
  leads: KanbanLead[]
  onDelete: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  const isFechados = col.id === 'fechados'

  return (
    <div className="flex flex-col min-w-[250px] flex-1">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-base leading-none">{col.emoji}</span>
        <span className="font-semibold text-[13px] text-white">{col.label}</span>
        <span className="ml-auto text-[11px] font-medium bg-surface2 text-muted px-2 py-0.5 rounded-full tabular-nums">
          {leads.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[300px] rounded-xl p-2 flex flex-col gap-2 transition-all duration-150 ${
          isOver && isFechados
            ? 'bg-green-500/10 border-2 border-green-500/50 border-dashed'
            : isOver
            ? 'bg-blue-500/5 border-2 border-blue-500/20 border-dashed'
            : 'bg-surface/50 border border-brd'
        }`}
      >
        {leads.map(lead => (
          <KanbanCard
            key={lead.id}
            lead={lead}
            columnId={col.id}
            onDelete={() => onDelete(lead.id)}
          />
        ))}

        {leads.length === 0 && (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-[12px] text-muted text-center px-4">
              {isFechados ? '↙ Arraste aqui para fechar negócio' : 'Nenhum lead'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────

export function KanbanPage() {
  const [search, setSearch]       = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [activeId, setActiveId]   = useState<string | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['kanban'],
    queryFn: api.getKanban,
    refetchInterval: 30_000,
  })

  const { data: campaigns } = useQuery({ queryKey: ['campaigns'], queryFn: api.getCampaigns })

  const convertLead = useMutation({
    mutationFn: (id: string) => api.convertLead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      toast.success('Negócio fechado! 🤝')
    },
    onError: () => toast.error('Erro ao converter lead'),
  })

  const deleteLead = useMutation({
    mutationFn: (id: string) => api.deleteLead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      toast.success('Lead deletado')
    },
    onError: () => toast.error('Erro ao deletar lead'),
  })

  function filterLeads(leads: KanbanLead[] = []) {
    let result = leads
    if (campaignId) result = result.filter(l => (l as any).campaign_id === campaignId)
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.nome?.toLowerCase().includes(q) ||
        l.cidade?.toLowerCase().includes(q) ||
        l.estado?.toLowerCase().includes(q) ||
        l.whatsapp?.includes(q)
      )
    }
    return result
  }

  const columnData: Record<ColumnId, KanbanLead[]> = {
    minerados:    filterLeads(data?.minerados),
    waEncontrado: filterLeads(data?.waEncontrado),
    contatados:   filterLeads(data?.contatados),
    respondidos:  filterLeads(data?.respondidos),
    fechados:     filterLeads(data?.fechados),
  }

  const allLeads = [
    ...(data?.minerados ?? []),
    ...(data?.waEncontrado ?? []),
    ...(data?.contatados ?? []),
    ...(data?.respondidos ?? []),
    ...(data?.fechados ?? []),
  ]
  const activeLead = allLeads.find(l => l.id === activeId)

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const targetCol = over.id as ColumnId
    const sourceCol = active.data.current?.columnId as ColumnId
    if (targetCol === sourceCol) return
    if (targetCol === 'fechados') {
      convertLead.mutate(active.id as string)
    }
  }

  const totalLeads = (data?.minerados.length ?? 0) + (data?.waEncontrado.length ?? 0) +
                     (data?.contatados.length ?? 0) + (data?.respondidos.length ?? 0) +
                     (data?.fechados.length ?? 0)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar empresa..."
            className="bg-surface border border-brd text-white placeholder-muted px-3 py-2 pl-8 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors w-full"
          />
        </div>
        {campaigns && campaigns.length > 0 && (
          <select
            value={campaignId}
            onChange={e => setCampaignId(e.target.value)}
            className="bg-surface border border-brd text-white px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors max-w-[200px]"
          >
            <option value="">Todas as campanhas</option>
            {campaigns.map(c => (
              <option key={c.id} value={c.id}>
                {c.query.length > 28 ? c.query.slice(0, 28) + '…' : c.query}
              </option>
            ))}
          </select>
        )}
        {!isLoading && (
          <span className="text-[12px] text-muted">
            {totalLeads} leads no CRM
          </span>
        )}
        <span className="text-[11px] text-muted ml-auto hidden sm:block">
          Arraste para <span className="text-green-400">Fechados</span> para converter
        </span>
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map(col => (
            <div key={col.id} className="min-w-[250px] flex-1">
              <div className="h-6 w-32 bg-surface2 rounded animate-pulse mb-3" />
              <div className="bg-surface/50 border border-brd rounded-xl p-2 space-y-2 min-h-[300px]">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="bg-surface2 rounded-xl p-3 h-24 animate-pulse" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLUMNS.map(col => (
              <KanbanColumn
                key={col.id}
                col={col}
                leads={columnData[col.id]}
                onDelete={id => deleteLead.mutate(id)}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
            {activeLead && (
              <div className="bg-surface2 border border-blue-500/60 rounded-xl p-3 shadow-2xl w-[250px] rotate-1 opacity-95">
                <CardContent lead={activeLead} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
