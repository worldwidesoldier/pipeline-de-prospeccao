import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Briefing } from '@/types/api'
import { Phone, Copy, ChevronDown, ChevronUp, MessageCircle, PhoneCall, CheckCircle2, XCircle, PhoneMissed } from 'lucide-react'
import { toast } from 'sonner'

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text)
  toast.success(`${label} copiado!`)
}

const DOR_BADGE: Record<string, { label: string; cls: string }> = {
  INEFICIENCIA: { label: 'INEFICIÊNCIA', cls: 'bg-red-500/15 text-red-400 border border-red-500/25' },
  OPORTUNIDADE: { label: 'OPORTUNIDADE', cls: 'bg-green-500/15 text-green-400 border border-green-500/25' },
}

const TIPO_BADGE: Record<string, string> = {
  BOT:    'bg-orange-500/15 text-orange-400 border border-orange-500/25',
  HUMANO: 'bg-blue-500/15 text-blue-400 border border-blue-500/25',
}

const QUAL_COLOR: Record<string, string> = {
  RUIM:      'text-red-400',
  MEDIANA:   'text-yellow-400',
  BOA:       'text-green-400',
  EXCELENTE: 'text-emerald-400',
}

function BriefingCard({ b, onOutcome, preview = false }: { b: Briefing; onOutcome: () => void; preview?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmOutcome, setConfirmOutcome] = useState<'fechou' | 'sem_interesse' | null>(null)
  const qc = useQueryClient()

  const dor = b.dor_perfil ? DOR_BADGE[b.dor_perfil] : null
  const tipoCls = b.tipo_atendimento ? TIPO_BADGE[b.tipo_atendimento] ?? '' : ''
  const qualColor = b.qualidade_resposta ? QUAL_COLOR[b.qualidade_resposta] ?? 'text-muted' : 'text-muted'
  const fracos = b.pontos_fracos ?? []

  const outcome = useMutation({
    mutationFn: (o: 'fechou' | 'sem_interesse' | 'sem_resposta') => {
      if (preview) {
        toast.info('Modo preview — ação simulada')
        return Promise.resolve({ ok: true })
      }
      return api.callOutcome(b.id, o)
    },
    onSuccess: (_, o) => {
      if (preview) { setConfirmOutcome(null); return }
      if (o === 'fechou') toast.success('Deal fechado! 🎉')
      else if (o === 'sem_interesse') toast.success('Lead descartado')
      else toast.success('Registrado — lead permanece na fila')
      setConfirmOutcome(null)
      qc.invalidateQueries({ queryKey: ['briefings'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      onOutcome()
    },
    onError: () => toast.error('Erro ao registrar resultado'),
  })

  const alreadyCalled = !!b.call_outcome

  return (
    <div className={`bg-surface border rounded-xl overflow-hidden transition-colors ${
      b.call_outcome === 'sem_resposta' ? 'border-yellow-500/30' : 'border-brd hover:border-slate-600'
    }`}>
      {/* Header do card */}
      <div className="p-4 space-y-3">
        {/* Linha 1: nome + badges */}
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-[14px] truncate">{b.nome}</h3>
            {(b.cidade || b.estado) && (
              <p className="text-muted text-[12px] mt-0.5">{[b.cidade, b.estado].filter(Boolean).join(' · ')}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {dor && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dor.cls}`}>{dor.label}</span>
            )}
            {b.tipo_atendimento && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tipoCls}`}>{b.tipo_atendimento}</span>
            )}
            {b.qualidade_resposta && (
              <span className={`text-[10px] font-semibold tabular-nums ${qualColor}`}>{b.qualidade_resposta}</span>
            )}
          </div>
        </div>

        {/* Linha 2: gestor phone + ações */}
        {b.gestor_phone ? (
          <div className="flex items-center gap-2 p-2.5 bg-green-500/8 border border-green-500/20 rounded-lg">
            <PhoneCall size={14} className="text-green-400 shrink-0" />
            <span className="font-mono text-[13px] text-green-300 flex-1">{b.gestor_phone}</span>
            <button
              onClick={() => copy(b.gestor_phone!, 'Número')}
              className="p-1 text-green-400/60 hover:text-green-400 transition-colors"
              title="Copiar número"
            >
              <Copy size={12} />
            </button>
            <a
              href={`https://wa.me/${b.gestor_phone.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-green-400/60 hover:text-green-400 transition-colors"
              title="Abrir no WhatsApp"
            >
              <MessageCircle size={12} />
            </a>
            <a
              href={`tel:${b.gestor_phone.replace(/\D/g, '')}`}
              className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold rounded-md transition-colors"
            >
              <Phone size={10} /> Ligar
            </a>
          </div>
        ) : (
          <div className="px-2.5 py-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg text-yellow-400/70 text-[11px]">
            Aguardando número do gestor...
          </div>
        )}

        {/* Pontos fracos */}
        {fracos.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fracos.map((f, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 bg-red-500/10 text-red-300/80 border border-red-500/15 rounded-full">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Sem resposta badge */}
      {b.call_outcome === 'sem_resposta' && (
        <div className="mx-4 mb-3 px-2.5 py-1.5 bg-yellow-500/8 border border-yellow-500/20 rounded-lg flex items-center gap-2">
          <PhoneMissed size={12} className="text-yellow-400 shrink-0" />
          <span className="text-[11px] text-yellow-400">Ligação tentada — sem resposta</span>
          <button
            onClick={() => outcome.mutate('sem_resposta')}
            disabled={outcome.isPending}
            className="ml-auto text-[10px] text-yellow-400/60 hover:text-yellow-400 transition-colors"
            title="Registrar nova tentativa"
          >
            tentar dnv
          </button>
        </div>
      )}

      {/* Briefing expandível */}
      {b.briefing_gerado && (
        <div className="border-t border-brd">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] text-muted hover:text-white hover:bg-surface2/50 transition-colors"
          >
            <span className="font-medium">Ver briefing completo</span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {expanded && (
            <div className="px-4 pb-4 space-y-2">
              <div className="relative">
                <button
                  onClick={() => copy(b.briefing_gerado!, 'Briefing')}
                  className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-muted hover:text-white px-2 py-1 bg-surface rounded border border-brd transition-colors"
                >
                  <Copy size={10} /> Copiar
                </button>
                <pre className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap bg-surface2 rounded-lg p-4 pr-20 border border-brd font-sans">
                  {b.briefing_gerado}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outcome buttons */}
      {!alreadyCalled && (
        <div className="border-t border-brd px-4 py-3">
          {confirmOutcome ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-white flex-1">
                {confirmOutcome === 'fechou' ? 'Confirmar fechamento? 🎉' : 'Confirmar descarte?'}
              </span>
              <button
                onClick={() => outcome.mutate(confirmOutcome)}
                disabled={outcome.isPending}
                className={`px-3 py-1.5 text-[12px] font-bold text-white rounded-lg transition-colors disabled:opacity-50 ${
                  confirmOutcome === 'fechou' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {outcome.isPending ? '...' : 'Confirmar'}
              </button>
              <button
                onClick={() => setConfirmOutcome(null)}
                className="px-2 py-1.5 text-[12px] text-muted hover:text-white transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted mr-1">Resultado da ligação:</span>
              <button
                onClick={() => setConfirmOutcome('fechou')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 text-[11px] font-semibold rounded-lg transition-colors"
              >
                <CheckCircle2 size={11} /> Fechou
              </button>
              <button
                onClick={() => outcome.mutate('sem_resposta')}
                disabled={outcome.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-yellow-500/10 border border-yellow-500/25 text-yellow-400 hover:bg-yellow-500/20 text-[11px] font-semibold rounded-lg transition-colors"
              >
                <PhoneMissed size={11} /> Sem resposta
              </button>
              <button
                onClick={() => setConfirmOutcome('sem_interesse')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface2 border border-brd text-muted hover:text-red-400 hover:border-red-500/30 text-[11px] rounded-lg transition-colors ml-auto"
              >
                <XCircle size={11} /> Sem interesse
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Mock briefings (preview) ───────────────────────────────────

const MOCK_BRIEFINGS: Briefing[] = [
  {
    id: 'mock-1',
    nome: 'Câmbio Sul Premium',
    cidade: 'Porto Alegre',
    estado: 'RS',
    whatsapp: '5551992345678',
    gestor_phone: '5551998123456',
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'INEFICIENCIA',
    qualidade_resposta: 'MEDIANA',
    pontos_fracos: ['demorou 32min pra responder', 'sem cotação no site', 'não tem WhatsApp Business'],
    pontos_fortes: ['atendimento humano educado', 'reputação Google 4.7★'],
    briefing_gerado: `RESUMO EXECUTIVO
Casa de câmbio familiar em Porto Alegre, atendimento humano porém lento (32min para responder cotação básica do dólar). Sem automação. Tem boa reputação no Google (4.7★, 89 reviews) mas perde clientes por demora.

ANGLE DE ABORDAGEM
"Oi João! Vi que vocês são bem avaliados em POA, mas testei o atendimento de vocês quarta passada e demorei 32 min pra ter resposta sobre cotação do dólar. Imagino que vocês perdem cliente assim, né?"

PRINCIPAIS DORES A EXPLORAR
• Atendente sumiu por 32 min no meio da conversa de teste
• Não respondeu de cabeça a cotação do dólar canadense
• Pediu pra ligar no comercial pra fechar (fricção desnecessária)
• Site sem cotação atualizada — cliente não consegue se informar sozinho

PROPOSTA DE VALOR
Bot Fair Assist responde cotações em segundos 24/7, faz handoff pro atendente humano só pra fechar deal. Você não perde mais cliente por demora — e seu atendente foca só no que importa: fechar.

OBJEÇÕES PROVÁVEIS
1. "Já temos atendente humano" → Bot é COMPLEMENTAR. Atende fora do horário comercial e nos picos. Atendente foca só nas conversas quentes.
2. "Vai sair caro" → 7 dias grátis sem cartão. Se não der ROI, você cancela.
3. "Cliente prefere humano" → Handoff é instantâneo. Cliente nem percebe que começou no bot.

PRÓXIMO PASSO SUGERIDO
Pedir 15min de demo essa semana — terça ou quinta de manhã.`,
  },
  {
    id: 'mock-2',
    nome: 'Money Way Câmbio',
    cidade: 'Florianópolis',
    estado: 'SC',
    whatsapp: '5548999991234',
    gestor_phone: '5548996781234',
    tipo_atendimento: 'BOT',
    dor_perfil: 'OPORTUNIDADE',
    qualidade_resposta: 'BOA',
    pontos_fracos: ['bot atual só responde cotação', 'não faz handoff inteligente'],
    pontos_fortes: ['já tem bot', 'site moderno', 'IG ativo'],
    briefing_gerado: `RESUMO EXECUTIVO
Casa de câmbio em Floripa que já tem bot básico no WhatsApp respondendo cotações. Operação digital (site bom, IG ativo, 1.2k seguidores). Bot atual é limitado — só dá cotação, não conduz pra venda.

ANGLE DE ABORDAGEM
"Pedro, testei o bot de vocês — gostei que responde rápido as cotações. Mas notei que ele não tenta fechar venda nem agendar — só responde e tchau. Posso te mostrar como nosso bot conduz cliente até a operação?"

PRINCIPAIS DORES A EXPLORAR
• Bot atual responde cotação mas não pergunta volume nem urgência
• Sem qualificação — manda todo cliente pro mesmo atendente
• Sem handoff inteligente — perde leads quentes pro frio do horário comercial

PROPOSTA DE VALOR
Fair Assist não só responde — qualifica, prioriza e faz handoff inteligente. Cliente quente (>$5k) vai direto pro atendente. Cliente frio recebe nutrição automática.

OBJEÇÕES PROVÁVEIS
1. "Já tenho bot" → Sim, mas o seu não vende. Eu mostro a diferença em 10min.
2. "Migração é trabalhosa" → Plug-and-play em 24h. Sem mexer no seu setup atual.

PRÓXIMO PASSO SUGERIDO
Demo de 15min comparando bot atual vs Fair Assist — agendar pra essa semana.`,
  },
  {
    id: 'mock-3',
    nome: 'Executive Câmbio Caxias',
    cidade: 'Caxias do Sul',
    estado: 'RS',
    whatsapp: '5554999990001',
    gestor_phone: '5554998765432',
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'INEFICIENCIA',
    qualidade_resposta: 'RUIM',
    pontos_fracos: ['não respondeu em 4h', 'WA mostra "visto" sem resposta', 'sem horário no site'],
    pontos_fortes: ['empresa grande (3 unidades)', '15+ anos de mercado'],
    briefing_gerado: `RESUMO EXECUTIVO
Empresa estabelecida (15+ anos, 3 unidades em Caxias), MAS atendimento WA péssimo — não respondeu em 4h, viu mensagem e ignorou. Cliente sente abandono. Tamanho da operação justifica investimento em automação imediato.

ANGLE DE ABORDAGEM
"Carlos, vi que vocês têm 3 unidades em Caxias e 15 anos de mercado — operação séria. Mas testei o WA de vocês quarta — viram a mensagem e nunca responderam. Quanto vocês perdem por mês desse jeito?"

PRINCIPAIS DORES A EXPLORAR
• 3 unidades, 1 número de WA → impossível atender tudo manualmente
• Cliente sai sem resposta = vai pro concorrente
• "Visto" sem resposta = pior que não ter WA

PROPOSTA DE VALOR
Bot atende as 3 unidades 24/7. Roteia o cliente pra unidade mais próxima. Atendente humano só entra quando cliente tá pronto pra fechar.

OBJEÇÕES PROVÁVEIS
1. "Temos WA business" → Não importa o app. O problema é não ter quem responda.
2. "Atendente já tá sobrecarregado" → Exato — bot tira 70% do volume dele.

PRÓXIMO PASSO SUGERIDO
Pedir reunião com gerente operacional + Carlos. 30min, terça às 10h.`,
  },
  {
    id: 'mock-4',
    nome: 'Câmbio Centro POA',
    cidade: 'Porto Alegre',
    estado: 'RS',
    whatsapp: '5551991112233',
    gestor_phone: undefined,
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'INEFICIENCIA',
    qualidade_resposta: 'MEDIANA',
    pontos_fracos: ['demora 1h pra responder'],
    briefing_gerado: 'Briefing gerado mas aguardando captura do número do gestor via Eng Social.',
  },
  {
    id: 'mock-5',
    nome: 'Turcambio Floripa',
    cidade: 'Florianópolis',
    estado: 'SC',
    whatsapp: '5548997776655',
    gestor_phone: '5548991234567',
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'OPORTUNIDADE',
    qualidade_resposta: 'EXCELENTE',
    pontos_fracos: ['sem bot fora do horário'],
    pontos_fortes: ['atendimento excelente', 'cotação em 2min', 'site profissional'],
    briefing_gerado: `RESUMO EXECUTIVO
Operação top em Floripa — atendimento humano EXCELENTE (resposta em 2min, cotação na ponta da língua, educados). Único gap: fora do horário comercial não tem ninguém. Lead pré-vendido — só precisa fechar valor.

ANGLE DE ABORDAGEM
"Marina, parabéns pelo atendimento de vocês — testei e vocês me responderam em 2min com cotação certinha. Tô ligando porque imagino que fora do horário vocês perdem cliente. Quero te mostrar como cobrir esse gap sem contratar mais ninguém."

PRINCIPAIS DORES A EXPLORAR
• Operação fecha 18h — clientes que precisam de cotação à noite vão pra concorrente
• Sábado de manhã tem volume mas com staff reduzido
• Domingo zero atendimento

PROPOSTA DE VALOR
Bot Fair Assist cobre 100% do horário não-comercial com o MESMO padrão de qualidade. Cliente recebe cotação na hora, agenda atendimento humano pra próximo dia útil.

PRÓXIMO PASSO SUGERIDO
Demo rápida de 10min — Marina já tá vendida no conceito, só falta ver funcionando.`,
    call_outcome: 'sem_resposta',
  },
  {
    id: 'mock-6',
    nome: 'AMB Câmbio Bento Gonçalves',
    cidade: 'Bento Gonçalves',
    estado: 'RS',
    whatsapp: '5554999998888',
    gestor_phone: '5554998887777',
    tipo_atendimento: 'BOT',
    dor_perfil: 'INEFICIENCIA',
    qualidade_resposta: 'RUIM',
    pontos_fracos: ['bot quebrado', 'respostas duplicadas', 'sem fallback humano'],
    pontos_fortes: ['quer automação (já tentou)'],
    briefing_gerado: `RESUMO EXECUTIVO
Já tentou automação mas o bot atual tá quebrado — manda mensagem duplicada, não entende cotação de moedas menos comuns, não tem fallback pra humano. Lead QUENTE — entende o valor da automação, só precisa de uma solução que funcione.

ANGLE DE ABORDAGEM
"Roberto, vi que vocês já têm bot no WA mas testei e ele tá com bug — me mandou a mesma mensagem 3x e travou quando perguntei sobre dólar canadense. Vocês já sabem que automação é o caminho — só faltou a ferramenta certa."

PRINCIPAIS DORES A EXPLORAR
• Bot atual passa imagem de empresa amadora pro cliente
• Sem qualificação — cliente quente espera junto com curioso
• Sem analytics — não sabe o que tá funcionando

PROPOSTA DE VALOR
Fair Assist é o bot que vocês precisavam: estável, com fallback humano automático, qualifica e prioriza leads, dashboard com métricas em tempo real.

PRÓXIMO PASSO SUGERIDO
Migração assistida em 24h — sem perder histórico. Demo + plano de migração na mesma reunião.`,
  },
]

export function BriefingsPage() {
  const [preview, setPreview] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['briefings'],
    queryFn: api.getBriefings,
    refetchInterval: 60_000,
  })

  const realCount = data?.length ?? 0
  const showPreview = preview || (!isLoading && realCount === 0)
  const briefings = showPreview ? MOCK_BRIEFINGS : (data ?? [])

  const total = briefings.length
  const comNumero = briefings.filter(b => b.gestor_phone).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-white">Pronto pra Ligar</h2>
          <p className="text-[12px] text-muted mt-0.5">
            Leads com mystery shop completo e briefing gerado
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          {!isLoading && (
            <>
              <span className="text-muted">{total}{showPreview ? ' (preview)' : ''} lead{total !== 1 ? 's' : ''} no total</span>
              <span className="text-green-400 font-semibold">{comNumero} com número</span>
              <button
                onClick={() => setPreview(v => !v)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
                  showPreview
                    ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                    : 'bg-surface2 border-brd text-muted hover:text-white'
                }`}
              >
                {showPreview ? '✕ Fechar preview' : '👁 Ver preview'}
              </button>
            </>
          )}
        </div>
      </div>

      {showPreview && (
        <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 border border-purple-500/20 rounded-lg">
          <span className="text-[11px] text-purple-400">Preview com dados fictícios — assim vai aparecer quando seus leads completarem o pipeline</span>
        </div>
      )}

      {/* Conteúdo */}
      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-surface border border-brd rounded-xl h-40 animate-pulse" />
          ))}
        </div>
      ) : !briefings.length ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted gap-3">
          <PhoneCall size={40} className="opacity-20" />
          <p className="text-[15px] text-white/50">Nenhum lead pronto para ligar ainda</p>
          <p className="text-[13px]">Quando um lead completar o mystery shop e passar pela engenharia social, aparece aqui.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
          {briefings.map(b => (
            <BriefingCard
              key={b.id}
              b={b}
              onOutcome={() => {}}
              preview={showPreview}
            />
          ))}
        </div>
      )}
    </div>
  )
}
