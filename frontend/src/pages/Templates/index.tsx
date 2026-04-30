import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { WaTemplate } from '@/types/api'
import { Edit2, Trash2, Plus, Save, X, Zap } from 'lucide-react'

// ── Social Engineering Templates ─────────────────────────────

function SocEngCard({ variant, nome, texto, onSave }: {
  variant: string
  nome: string
  texto: string
  onSave: (nome: string, texto: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(nome)
  const [t, setT] = useState(texto)

  const variantColor: Record<string, string> = {
    v1: 'border-yellow-500/30 bg-yellow-500/5',
    v2: 'border-orange-500/30 bg-orange-500/5',
    v3: 'border-red-500/30 bg-red-500/5',
  }
  const badgeColor: Record<string, string> = {
    v1: 'bg-yellow-500/15 text-yellow-400',
    v2: 'bg-orange-500/15 text-orange-400',
    v3: 'bg-red-500/15 text-red-400',
  }
  const sequencia: Record<string, string> = {
    v1: '1ª abordagem',
    v2: '+6h sem resposta',
    v3: '+12h sem resposta (última)',
  }

  const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors w-full'

  return (
    <div className={`border rounded-xl p-4 space-y-3 ${variantColor[variant] ?? 'border-brd'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${badgeColor[variant] ?? 'bg-surface2 text-muted'}`}>
            {variant.toUpperCase()}
          </span>
          <span className="text-[11px] text-muted">{sequencia[variant]}</span>
        </div>
        {!editing && (
          <button onClick={() => { setEditing(true); setN(nome); setT(texto) }} className="text-muted hover:text-white transition-colors">
            <Edit2 size={13} />
          </button>
        )}
      </div>
      {editing ? (
        <>
          <input value={n} onChange={e => setN(e.target.value)} placeholder="Nome do template" className={inputCls} />
          <textarea value={t} onChange={e => setT(e.target.value)} rows={6} className={`${inputCls} resize-y`} />
          <div className="flex gap-2">
            <button
              onClick={() => { onSave(n, t); setEditing(false) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-semibold rounded-lg transition-colors"
            >
              <Save size={12} /> Salvar
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 text-muted hover:text-white text-[12px] rounded-lg transition-colors">
              <X size={12} /> Cancelar
            </button>
          </div>
          <p className="text-[10px] text-muted">
            Variáveis disponíveis:{' '}
            <code className="bg-surface2 px-1 rounded">[NOME]</code>{' '}
            <code className="bg-surface2 px-1 rounded">[CIDADE]</code>
          </p>
        </>
      ) : (
        <p className="text-[12px] text-slate-400 leading-relaxed whitespace-pre-line line-clamp-5">{texto}</p>
      )}
    </div>
  )
}

function SocEngSection() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['soc-eng-templates'], queryFn: api.getSocEngTemplates })

  const save = useMutation({
    mutationFn: ({ variant, nome, texto }: { variant: string; nome: string; texto: string }) =>
      api.updateSocEngTemplate(variant, { nome, texto }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['soc-eng-templates'] })
      toast.success('Template de engenharia social salvo!')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  if (!data) return <div className="h-32 bg-surface2 rounded-xl animate-pulse" />

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
      {(['v1', 'v2', 'v3'] as const).map(v => (
        <SocEngCard
          key={v}
          variant={v}
          nome={data[v].nome}
          texto={data[v].texto}
          onSave={(nome, texto) => save.mutate({ variant: v, nome, texto })}
        />
      ))}
    </div>
  )
}

// ── WA Templates (Mystery Shop M1) ────────────────────────────

function WaTemplateCard({ t, onEdit, onDelete }: { t: WaTemplate; onEdit: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="bg-surface border border-brd rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-[13px] text-white">{t.nome}</p>
          <p className="text-muted text-[11px] mt-0.5">{new Date(t.criado_em).toLocaleDateString('pt-BR')}</p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 text-muted hover:text-white hover:bg-surface2 rounded-lg transition-colors"><Edit2 size={13} /></button>
          <button onClick={() => setConfirming(true)} className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"><Trash2 size={13} /></button>
        </div>
      </div>
      <p className="text-[12px] text-muted italic leading-relaxed bg-surface2 rounded-lg px-3 py-2 line-clamp-3">"{t.texto}"</p>
      {confirming && (
        <div className="flex gap-2 items-center p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <span className="text-[12px] text-red-400 flex-1">Excluir este template?</span>
          <button onClick={() => { onDelete(); setConfirming(false) }} className="px-2 py-1 bg-red-500 text-white text-[11px] rounded font-semibold">Excluir</button>
          <button onClick={() => setConfirming(false)} className="px-2 py-1 bg-surface2 text-muted text-[11px] rounded">Cancelar</button>
        </div>
      )}
    </div>
  )
}

function WaSection() {
  const qc = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [texto, setTexto] = useState('')

  const { data: templates } = useQuery({ queryKey: ['templates'], queryFn: api.getTemplates })

  const save = useMutation({
    mutationFn: () => editId
      ? api.updateTemplate(editId, { nome, texto })
      : api.createTemplate({ nome, texto }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      setEditId(null); setNome(''); setTexto('')
      toast.success(editId ? 'Template atualizado!' : 'Template criado!')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  const del = useMutation({
    mutationFn: (id: string) => api.deleteTemplate(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Template excluído') },
  })

  const startEdit = (t: WaTemplate) => { setEditId(t.id); setNome(t.nome); setTexto(t.texto) }
  const cancel = () => { setEditId(null); setNome(''); setTexto('') }

  const inputCls = 'bg-surface2 border border-brd text-white placeholder-muted px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors w-full'

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-brd rounded-xl p-5 space-y-3">
        <p className="font-semibold text-[13px]">{editId ? 'Editar Template' : 'Novo Template de M1'}</p>
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do template (ex: Pergunta dólar turismo)" className={inputCls} />
        <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={3} placeholder="Texto da primeira mensagem (M1) do mystery shop..." className={`${inputCls} resize-y`} />
        <div className="flex gap-2">
          <button
            onClick={() => save.mutate()}
            disabled={!nome.trim() || !texto.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            {editId ? <><Save size={13} /> Salvar</> : <><Plus size={13} /> Criar</>}
          </button>
          {editId && (
            <button onClick={cancel} className="flex items-center gap-1.5 px-3 py-2 bg-surface2 text-muted hover:text-white text-[13px] rounded-lg transition-colors">
              <X size={13} /> Cancelar
            </button>
          )}
        </div>
      </div>

      {!templates ? (
        <div className="h-24 bg-surface2 rounded-xl animate-pulse" />
      ) : !templates.length ? (
        <p className="text-muted text-[13px]">Nenhum template ainda. Se deixar vazio, o sistema gera automaticamente via IA.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {templates.map(t => (
            <WaTemplateCard key={t.id} t={t} onEdit={() => startEdit(t)} onDelete={() => del.mutate(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── M2A / M2B config section ───────────────────────────────────

function MysteryFollowupCard({
  phase,
  label,
  hint,
  current,
  onSave,
  onClear,
}: {
  phase: 'm2a' | 'm2b'
  label: string
  hint: string
  current: string | null
  onSave: (t: string) => void
  onClear: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [texto, setTexto] = useState(current ?? '')

  const inputCls = 'bg-surface border border-brd text-white placeholder-muted px-3 py-2 rounded-lg text-[13px] outline-none focus:border-blue-500 transition-colors w-full'

  return (
    <div className={`border rounded-xl p-4 space-y-3 bg-surface2/40 ${
      phase === 'm2a' ? 'border-orange-500/30' : 'border-amber-500/30'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${
            phase === 'm2a' ? 'bg-orange-500/15 text-orange-400' : 'bg-amber-500/15 text-amber-400'
          }`}>
            {label}
          </span>
          <span className="text-[11px] text-muted">{hint}</span>
        </div>
        {!editing && (
          <button onClick={() => { setEditing(true); setTexto(current ?? '') }} className="text-muted hover:text-white transition-colors">
            <Edit2 size={13} />
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={texto}
            onChange={e => setTexto(e.target.value)}
            rows={4}
            placeholder="Deixe em branco para usar geração automática por IA..."
            className={`${inputCls} resize-y`}
          />
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { onSave(texto); setEditing(false) }}
              disabled={!texto.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-[12px] font-semibold rounded-lg transition-colors"
            >
              <Save size={12} /> Salvar mensagem fixa
            </button>
            <button
              onClick={() => { onClear(); setEditing(false) }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-brd text-muted hover:text-white text-[12px] rounded-lg transition-colors"
            >
              <Zap size={12} /> Usar IA (limpar)
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface2 text-muted hover:text-white text-[12px] rounded-lg transition-colors">
              <X size={12} /> Cancelar
            </button>
          </div>
        </>
      ) : current ? (
        <p className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-line line-clamp-4">{current}</p>
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-muted/70">
          <Zap size={12} className="text-blue-400" />
          Gerada automaticamente por IA a cada envio
        </div>
      )}
    </div>
  )
}

function MysteryFollowupSection() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['mystery-shop-config'], queryFn: api.getMysteryShopConfig })

  const save = useMutation({
    mutationFn: ({ phase, texto }: { phase: 'm2a' | 'm2b'; texto: string | null }) =>
      api.setMysteryShopConfig(phase, texto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mystery-shop-config'] })
      toast.success('Template atualizado!')
    },
    onError: () => toast.error('Erro ao salvar'),
  })

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <MysteryFollowupCard
        phase="m2a"
        label="M2A"
        hint="+45min sem resposta ao M1"
        current={data?.m2a_custom ?? null}
        onSave={t => save.mutate({ phase: 'm2a', texto: t })}
        onClear={() => save.mutate({ phase: 'm2a', texto: null })}
      />
      <MysteryFollowupCard
        phase="m2b"
        label="M2B"
        hint="resposta de bot detectada"
        current={data?.m2b_custom ?? null}
        onSave={t => save.mutate({ phase: 'm2b', texto: t })}
        onClear={() => save.mutate({ phase: 'm2b', texto: null })}
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────

export function TemplatesPage() {
  return (
    <div className="space-y-10">
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Mystery Shop (M1) — Primeira mensagem</div>
        <p className="text-[12px] text-muted mb-4">
          Pergunta inicial sobre câmbio de dólar. Se nenhum template for selecionado no scraper, o sistema gera automaticamente via IA.
        </p>
        <WaSection />
      </div>
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Mystery Shop (M2A e M2B) — Follow-ups</div>
        <p className="text-[12px] text-muted mb-4">
          M2A é enviado +45min após M1 sem resposta (pergunta técnica de follow-up). M2B é enviado quando a resposta ao M1 parece automática/bot (confirmação de humano). Se deixar em branco, a IA gera automaticamente.
        </p>
        <MysteryFollowupSection />
      </div>
      <div>
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1">Engenharia Social</div>
        <p className="text-[12px] text-muted mb-4">
          Mensagens enviadas após o lead responder o mystery shop para extrair o número do gestor.
          Use <code className="bg-surface2 px-1 rounded">[NOME]</code> e <code className="bg-surface2 px-1 rounded">[CIDADE]</code> como variáveis.
        </p>
        <SocEngSection />
      </div>
    </div>
  )
}
