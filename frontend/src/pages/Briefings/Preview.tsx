/**
 * PREVIEW FICTÍCIO — só para visualização de como fica a tela "Pronto pra Ligar"
 * Dados 100% inventados. Não usa API.
 */

import { useState } from 'react'
import { Phone, Copy, ChevronDown, ChevronUp, MessageCircle, PhoneCall, CheckCircle2, Clock } from 'lucide-react'
import { toast } from 'sonner'

function copy(text: string, label: string) {
  navigator.clipboard.writeText(text)
  toast.success(`${label} copiado!`)
}

// ── Dados fictícios ─────────────────────────────────────────────

const MOCK_BRIEFINGS = [
  {
    id: '1',
    nome: 'Câmbio Real Florianópolis',
    cidade: 'Florianópolis',
    estado: 'SC',
    whatsapp: '5548991234567',
    gestor_phone: '48 99234-7810',
    tipo_atendimento: 'BOT',
    dor_perfil: 'INEFICIENCIA' as const,
    qualidade_resposta: 'RUIM',
    pontos_fracos: ['Atendimento 100% robotizado', 'Não informou taxa de câmbio', 'Menu de opções confuso'],
    pontos_fortes: ['Resposta rápida (2min)', 'Horário estendido'],
    briefing_gerado: `## Resumo executivo
A Câmbio Real opera exclusivamente via bot de WhatsApp — o cliente não chega em momento algum a um humano. Nas duas rodadas de teste, o sistema apresentou menus numerados sem nunca mencionar uma taxa real de câmbio.

## Angle de abordagem
Abrir com a dor direta: "Você sabia que 68% dos leads de câmbio abandonam o atendimento quando batem em bot antes de receber a cotação?" Conectar com a realidade que o bot deles nunca deu o preço.

## Principais dores a explorar
- Bot nunca entregou taxa → lead vai para o concorrente
- Menu de 7 opções antes de qualquer informação útil
- Sem fallback humano nos horários de pico

## Proposta de valor
Fair Assist entra como camada inteligente: o bot responde cotação em tempo real, mas passa para o humano assim que o lead demonstra intenção de fechar. Zero fricção, conversão máxima.

## Objeções prováveis
**"Já temos sistema"** → "Exatamente — não precisa trocar nada, a gente senta em cima do que vocês já têm."
**"Funciona no WhatsApp mesmo?"** → "100%. Usamos a mesma Evolution API que o mercado usa, só com IA por cima."
**"Quanto custa?"** → Marcar demo primeiro, não citar preço no telefone.

## Próximo passo sugerido
Pedir 20 minutos de demo ao vivo. Script: "Quero te mostrar como ficaria o atendimento de vocês com IA — 20 minutos, eu rodo ao vivo no número de vocês."`,
  },
  {
    id: '2',
    nome: 'Turismo & Câmbio Barão',
    cidade: 'Curitiba',
    estado: 'PR',
    whatsapp: '5541988765432',
    gestor_phone: '41 98876-5500',
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'OPORTUNIDADE' as const,
    qualidade_resposta: 'BOA',
    pontos_fracos: ['Demora para responder fora do horário', 'Sem automação de cotação'],
    pontos_fortes: ['Atendimento humano e amigável', 'Deu taxa de câmbio precisa', 'Proativo com alternativas'],
    briefing_gerado: `## Resumo executivo
A Barão tem um atendimento humano acima da média — responderam em 4 min com taxa real e ainda sugeriram euro como alternativa. O problema é escala: dependem 100% de pessoas, o que significa que fora do horário comercial perdem leads.

## Angle de abordagem
Não entrar com "seu atendimento é ruim" — entrar com "vocês têm o melhor atendimento da categoria, mas estão perdendo dinheiro fora do horário". Elogio genuíno + dor de oportunidade.

## Principais dores a explorar
- Fora das 9h-18h ninguém responde → concorrência pega o lead
- Fins de semana/feriados = zero conversão automática
- Uma pessoa não consegue atender 30 conversas simultâneas

## Proposta de valor
Fair Assist como cobertura 24/7 que replica o estilo humano deles. IA aprende o tom, mantém a qualidade fora do horário, passa para o humano só quando o lead está quente.

## Objeções prováveis
**"Não queremos perder o toque humano"** → "Exato — a IA imita o seu jeito. Não substitui, cobre."
**"Já tentamos chatbot antes"** → "Isso era chatbot de fluxo. IA generativa é diferente — sem menus, responde qualquer pergunta."

## Próximo passo sugerido
Mostrar demo com o número deles — pedir para o gestor fazer papel de cliente durante a call.`,
  },
  {
    id: '3',
    nome: 'Casa de Câmbio Moeda Viva',
    cidade: 'São Paulo',
    estado: 'SP',
    whatsapp: '5511977889900',
    gestor_phone: '11 97788-9900',
    tipo_atendimento: 'BOT',
    dor_perfil: 'INEFICIENCIA' as const,
    qualidade_resposta: 'MEDIANA',
    pontos_fracos: ['Bot com respostas genéricas', 'Taxa não informada na primeira mensagem'],
    pontos_fortes: ['Respondeu dentro de 5min', 'Mencionou horário de funcionamento'],
    briefing_gerado: `## Resumo executivo
Moeda Viva usa bot mas com alguma personalização — responderam com horário e pediram para ligar, o que é um sinal de que querem o lead mas não conseguem converter via WhatsApp.

## Angle de abordagem
"Vocês estão corretos em pedir a ligação, mas o lead nunca liga — ele vai para quem deu a taxa no WhatsApp." Mostrar que o passo de "ligue pra gente" é onde 80% da conversão vaza.

## Principais dores a explorar
- Pedir para o lead ligar = taxa de conversão cai 5x
- Bot genérico sem taxa real = lead compara com concorrente que mostrou o número
- SP tem concorrência altíssima — quem responde primeiro leva

## Próximo passo sugerido
Demo focada em mostrar o fluxo de cotação em tempo real — integração com API de câmbio + resposta automática com spread personalizado.`,
  },
  {
    id: '4',
    nome: 'Global Exchange Porto Alegre',
    cidade: 'Porto Alegre',
    estado: 'RS',
    whatsapp: '5551966554433',
    gestor_phone: null,
    tipo_atendimento: 'HUMANO',
    dor_perfil: 'OPORTUNIDADE' as const,
    qualidade_resposta: 'EXCELENTE',
    pontos_fracos: ['Sem automação para volume alto'],
    pontos_fortes: ['Taxa de câmbio precisa e rápida', 'Atendimento extremamente cordial', 'Explicou spread e prazo de entrega'],
    briefing_gerado: `## Resumo executivo
Melhor atendimento dos testados — respondeu em 3min com taxa, spread, prazo de entrega e o nome da atendente. Este lead é puro OPORTUNIDADE: eles já vendem bem, querem escalar.

## Angle de abordagem
Entrar como parceiro de escala, não como solução de problema. "Como vocês estão pensando em crescer sem contratar mais 5 pessoas de atendimento?"

## Próximo passo sugerido
Conversa estratégica com o dono/gestor. Este lead provavelmente vira cliente se a demo for bem executada.`,
  },
]

// ── Componentes ────────────────────────────────────────────────

const DOR_BADGE = {
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

function BriefingCard({ b }: { b: typeof MOCK_BRIEFINGS[0] }) {
  const [expanded, setExpanded] = useState(false)
  const dor = b.dor_perfil ? DOR_BADGE[b.dor_perfil] : null
  const tipoCls = b.tipo_atendimento ? TIPO_BADGE[b.tipo_atendimento] ?? '' : ''
  const qualColor = b.qualidade_resposta ? QUAL_COLOR[b.qualidade_resposta] ?? 'text-muted' : 'text-muted'
  const fracos = b.pontos_fracos ?? []
  const fortes = b.pontos_fortes ?? []

  return (
    <div className="bg-surface border border-brd rounded-xl overflow-hidden hover:border-slate-600 transition-all duration-200">
      {/* Header */}
      <div className="p-4 space-y-3">

        {/* Nome + badges */}
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white text-[14px] truncate">{b.nome}</h3>
            <p className="text-muted text-[12px] mt-0.5">{[b.cidade, b.estado].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {dor && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dor.cls}`}>
                {dor.label}
              </span>
            )}
            {b.tipo_atendimento && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tipoCls}`}>
                {b.tipo_atendimento}
              </span>
            )}
            {b.qualidade_resposta && (
              <span className={`text-[11px] font-semibold flex items-center gap-1 ${qualColor}`}>
                <span className="text-[8px]">●</span>
                {b.qualidade_resposta}
              </span>
            )}
          </div>
        </div>

        {/* Gestor phone */}
        {b.gestor_phone ? (
          <div className="flex items-center gap-2 p-2.5 bg-green-500/8 border border-green-500/20 rounded-lg">
            <PhoneCall size={14} className="text-green-400 shrink-0" />
            <span className="font-mono text-[13px] text-green-300 flex-1 tracking-wide">{b.gestor_phone}</span>
            <button
              onClick={() => copy(b.gestor_phone!, 'Número')}
              className="p-1 text-green-400/50 hover:text-green-400 transition-colors"
              title="Copiar"
            >
              <Copy size={12} />
            </button>
            <a
              href={`https://wa.me/${b.gestor_phone.replace(/\D/g, '')}`}
              target="_blank" rel="noopener noreferrer"
              className="p-1 text-green-400/50 hover:text-green-400 transition-colors"
              title="WhatsApp"
            >
              <MessageCircle size={12} />
            </a>
            <a
              href={`tel:${b.gestor_phone.replace(/\D/g, '')}`}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold rounded-lg transition-colors"
            >
              <Phone size={10} /> Ligar
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg">
            <Clock size={13} className="text-yellow-400/60 shrink-0" />
            <span className="text-yellow-400/70 text-[11px]">Aguardando número do gestor via engenharia social...</span>
          </div>
        )}

        {/* Pontos fracos + fortes */}
        <div className="space-y-1.5">
          {fracos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fracos.map((f, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 bg-red-500/10 text-red-300/80 border border-red-500/15 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          )}
          {fortes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fortes.map((f, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 bg-emerald-500/8 text-emerald-400/70 border border-emerald-500/15 rounded-full">
                  <CheckCircle2 size={9} className="inline mr-1 opacity-80" />
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Briefing expandível */}
      {b.briefing_gerado && (
        <div className="border-t border-brd">
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] text-muted hover:text-white hover:bg-white/[0.02] transition-colors group"
          >
            <span className="font-medium group-hover:text-slate-200 transition-colors">
              {expanded ? 'Fechar briefing' : 'Ver briefing completo'}
            </span>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {expanded && (
            <div className="px-4 pb-4">
              <div className="relative">
                <button
                  onClick={() => copy(b.briefing_gerado!, 'Briefing')}
                  className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[10px] text-muted hover:text-white px-2 py-1 bg-[#0f1117] rounded border border-brd transition-colors z-10"
                >
                  <Copy size={10} /> Copiar
                </button>
                <pre className="text-[12px] text-slate-300 leading-[1.7] whitespace-pre-wrap bg-[#0f1117] rounded-xl p-4 pr-20 border border-brd font-sans">
                  {b.briefing_gerado}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────

export function BriefingsPreview() {
  const total = MOCK_BRIEFINGS.length
  const comNumero = MOCK_BRIEFINGS.filter(b => b.gestor_phone).length
  const semNumero = total - comNumero

  return (
    <div className="min-h-screen bg-bg text-slate-200 p-6 max-w-[1200px] mx-auto">

      {/* Badge de preview */}
      <div className="mb-6 flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/25 rounded-lg w-fit">
        <span className="text-blue-400 text-[11px] font-bold uppercase tracking-wide">Preview Fictício</span>
        <span className="text-blue-300/60 text-[11px]">— dados de exemplo para visualização do layout</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-white tracking-tight">Pronto pra Ligar</h1>
          <p className="text-[13px] text-muted mt-1">
            Leads com mystery shop completo, análise de IA e briefing gerado
          </p>
        </div>

        {/* Contadores */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-center px-4 py-2 bg-surface border border-brd rounded-xl">
            <span className="text-[22px] font-bold text-white tabular-nums">{total}</span>
            <span className="text-[10px] text-muted uppercase tracking-wide mt-0.5">total</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 bg-green-500/8 border border-green-500/20 rounded-xl">
            <span className="text-[22px] font-bold text-green-400 tabular-nums">{comNumero}</span>
            <span className="text-[10px] text-green-400/60 uppercase tracking-wide mt-0.5">com número</span>
          </div>
          <div className="flex flex-col items-center px-4 py-2 bg-yellow-500/8 border border-yellow-500/20 rounded-xl">
            <span className="text-[22px] font-bold text-yellow-400 tabular-nums">{semNumero}</span>
            <span className="text-[10px] text-yellow-400/60 uppercase tracking-wide mt-0.5">aguardando</span>
          </div>
        </div>
      </div>

      {/* Legenda rápida */}
      <div className="flex flex-wrap gap-3 mb-6 text-[11px]">
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500/60" />
          INEFICIÊNCIA = atendimento péssimo → dor óbvia
        </div>
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500/60" />
          OPORTUNIDADE = atende bem mas sem escala → up-sell
        </div>
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-500/60" />
          BOT = menu automático
        </div>
        <div className="flex items-center gap-1.5 text-muted">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500/60" />
          HUMANO = pessoa real respondeu
        </div>
      </div>

      {/* Grid de cards */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(400px,1fr))] gap-4">
        {MOCK_BRIEFINGS.map(b => <BriefingCard key={b.id} b={b} />)}
      </div>
    </div>
  )
}
