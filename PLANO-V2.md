# Plano V2 — Pipeline de Prospecção (Mystery Shop Multi-Turn + Social Engineering + Briefing)

## Context
O sistema atual faz uma única mensagem de teste (M1), mede resposta e envia um pitch de vendas genérico. O V2 transforma isso em um fluxo de conversa multi-turn com mystery shopping profundo, análise de IA, engenharia social para extrair o número do dono, e geração de briefing para abordagem manual pelo Vitor.

---

## Mudanças no Fluxo de Status dos Leads

**Novo fluxo:**
```
novo → enriched → ms_m1_sent
  (respondeu) → ms_m2a_sent
    (respondeu) → ativo → intelligence_done → eng_v1 → eng_v2 → eng_v3 → morto
    (silêncio >18h) → morto
  (silêncio >[M2B_DELAY]) → ms_m2b_sent
    (respondeu) → ms_m2a_sent → (mesmo fluxo)
    (silêncio >12h) → morto
ativo + gestor_phone recebido → briefing_done
```

**Statuses antigos que saem (módulos eliminados):**
`tested`, `scored`, `pending_approval`, `approved`, `outreach`, `convertido`, `perdido`, `descartado_bot`
→ Dados existentes ficam no banco para backward compat, novos leads usam novo fluxo.

---

## Database Changes (Supabase SQL)

```sql
-- 1. Augmentar tabela leads com novos campos V2
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tag_final TEXT CHECK (tag_final IN ('ATIVO', 'MORTO')),
  ADD COLUMN IF NOT EXISTS tipo_atendimento TEXT,          -- 'BOT' | 'HUMANO'
  ADD COLUMN IF NOT EXISTS qualidade_resposta TEXT,
  ADD COLUMN IF NOT EXISTS dor_perfil TEXT CHECK (dor_perfil IN ('INEFICIENCIA', 'OPORTUNIDADE')),
  ADD COLUMN IF NOT EXISTS pontos_fracos JSONB,
  ADD COLUMN IF NOT EXISTS pontos_fortes JSONB,
  ADD COLUMN IF NOT EXISTS tom_atendente TEXT,
  ADD COLUMN IF NOT EXISTS tempo_resposta_m1 INTEGER,      -- em segundos
  ADD COLUMN IF NOT EXISTS taxa_oferecida TEXT,
  ADD COLUMN IF NOT EXISTS engenharia_social_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS engenharia_social_variacao INTEGER CHECK (engenharia_social_variacao IN (1,2,3)),
  ADD COLUMN IF NOT EXISTS status_numero TEXT CHECK (status_numero IN ('AGUARDANDO', 'RECEBIDO', 'NEGADO')),
  ADD COLUMN IF NOT EXISTS gestor_phone TEXT,
  ADD COLUMN IF NOT EXISTS briefing_gerado TEXT;

-- 2. Nova tabela de histórico de conversa (mystery shop + engenharia)
CREATE TABLE IF NOT EXISTS mystery_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,      -- 'M1' | 'M2A' | 'M2B' | 'ENG_V1' | 'ENG_V2' | 'ENG_V3'
  direction TEXT NOT NULL CHECK (direction IN ('SENT', 'RECEIVED')),
  message TEXT NOT NULL,
  metadata JSONB,           -- { tempo_resposta_s, is_bot, ... }
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mystery_conversations_lead_id ON mystery_conversations(lead_id);
```

---

## Módulos: O Que Muda

### 1. `wa-tester/` → **Rewrite completo** (módulo mais impactado)

**WaTesterService reescrito com:**
- `pendingMysteryShop: Map<cleanPhone, { leadId, phase, m1SentAt, m2bTimer?, mortoTimer? }>`
- Mantém `lidMap` + `pendingByName` (lógica de @lid resolution — reutilizar integralmente)
- Mantém `calcBusinessHoursDelay()` — reutilizar
- Mantém `gerarMensagemTeste()` → vira `gerarMensagemM1()` (lógica igual, só renomeia)
- Novo `gerarMensagemM2A()` — pergunta técnica difícil via OpenAI
- Novo `gerarMensagemM2B()` — cobrança simples via OpenAI
- `sendTestMessage()` → vira `sendM1()`, lógica de rate limit e motor iguais
- `handleWebhook()` → routing por phase:
  - `M1_SENT`: recebeu → cancela timer M2B → salva conversa → envia M2A → registra ms_m2a_sent
  - `M2A_SENT`: recebeu → cancela timer MORTO → salva conversa → marca ATIVO → dispara intelligence_queue
  - `M2B_SENT`: recebeu → cancela timer MORTO → salva conversa → envia M2A → registra ms_m2a_sent
  - `ENG_SENT`: recebeu → detecta phone → se phone → gestor_phone → briefing_queue; se não → aguarda
- Timers:
  - M2B timer: `[M2B_WAIT_MIN]` min após M1 sem resposta (PERGUNTA AO VITOR — ver abaixo)
  - MORTO M2A: 18h úteis (reusa `calcBusinessHoursDelay(from, 18)`)
  - MORTO M2B: 12h úteis (reusa `calcBusinessHoursDelay(from, 12)`)
  - MORTO engenharia: 6h por variação (delay via BullMQ, não setTimeout)

**WaTesterProcessor:** lógica igual — chama `sendM1()` (renomeado)
**WebhookProcessor:** sem mudança

**Replay:** manter `replayResponses()` — porém adaptar para multi-phase (ou desabilitar temporariamente para V2)

### 2. `scorer/` → **Substituído por `intelligence/`** (mesmo diretório, reescrito)

**IntelligenceService:**
- Busca `mystery_conversations` do lead_id para montar o histórico da conversa
- Chama OpenAI GPT-4o-mini com prompt:
```
Analise esta conversa de WhatsApp de mystery shopping numa casa de câmbio...
Retorne JSON: { tipo_atendimento, qualidade_resposta, dor_perfil, pontos_fracos[], pontos_fortes[], tom_atendente, tempo_resposta_m1_segundos, taxa_oferecida }
```
- Salva todos os campos no lead via `crmService.updateLead()`
- Dispara `social_eng_queue` com `{ leadId, variacao: 1 }`

**IntelligenceProcessor:** processa `run_intelligence` job → chama IntelligenceService

### 3. `approval/` → **Eliminado**
- Nenhum approval manual em V2 (binário ATIVO/MORTO)
- Arquivo pode ser mantido vazio ou deletado
- `ApprovalModule` removido do `app.module.ts`

### 4. `outreach/` → **Substituído por `social-engineering/`** (reescrito)

**SocialEngineeringService:**
- Recebe `{ leadId, variacao: 1|2|3 }`
- Busca lead com insights da IA (tipo_atendimento, dor_perfil, pontos_fracos, etc.)
- Seleciona template V1/V2/V3 (conforme plano operacional), personaliza com `[NOME]` e `[CIDADE]`
- Nota: `[NOME]` vem do nome do atendente extraído pela IA ou usa nome da empresa
- Envia via Evolution API
- Salva em `mystery_conversations` (phase: `ENG_V1`/`ENG_V2`/`ENG_V3`, direction: `SENT`)
- Atualiza lead: `status = eng_v1`, `engenharia_social_sent_at`, `engenharia_social_variacao = 1`, `status_numero = AGUARDANDO`
- Agenda `retry_social_eng` com delay de 6h úteis via BullMQ (para V2 se V1 ignorado)

**SocialEngineeringProcessor:**
- `send_social_eng` → `SocialEngineeringService.send(leadId, variacao)`
- `retry_social_eng` → verifica se status_numero ainda é AGUARDANDO → incrementa variacao → envia próxima → se variacao > 3 → MORTO

**Detecção de phone na resposta (no webhook):**
```typescript
private extractBrazilPhone(text: string): string | null {
  // Regex para números BR: DDD + 8 ou 9 dígitos
  const match = text.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/);
  if (!match) return null;
  const cleaned = match[0].replace(/\D/g, '');
  if (/^\d{10,11}$/.test(cleaned) || /^55\d{10,11}$/.test(cleaned)) return cleaned;
  return null;
}
```

### 5. `followup/` → **Eliminado**
- Lógica de retry entra no `SocialEngineeringProcessor`
- Arquivo pode ser mantido vazio ou deletado
- `FollowupModule` removido do `app.module.ts`

### 6. **Novo `briefing/`** (novo módulo)

**BriefingService:**
- Busca lead + mystery_conversations completo
- Gera briefing via OpenAI GPT-4o com prompt do plano operacional (o template exato do briefing)
- Salva `briefing_gerado` no lead
- Atualiza `status = briefing_done`

**BriefingProcessor:** processa `generate_briefing` job

### 7. `crm/crm.service.ts` → **Extendido**

Novos métodos:
- `saveMysteryMessage(leadId, phase, direction, message, metadata?)` → insere em `mystery_conversations`
- `getMysteryConversation(leadId)` → busca todos os messages do lead
- `getLeadsByTagFinal(tag)` → filtra por ATIVO/MORTO
- `getBriefings()` → leads com status `briefing_done`

Novos campos no tipo `Lead`:
- tag_final, tipo_atendimento, qualidade_resposta, dor_perfil, pontos_fracos, pontos_fortes, tom_atendente, tempo_resposta_m1, taxa_oferecida, engenharia_social_sent_at, engenharia_social_variacao, status_numero, gestor_phone, briefing_gerado

### 8. `dashboard/` → **Extendido**

Novos endpoints em `DashboardController`:
- `GET /api/briefings` → leads com status `briefing_done`, retorna: nome, cidade, phone WA, gestor_phone, briefing_gerado, tipo_atendimento, dor_perfil
- `GET /api/leads/:id/conversation` → mystery_conversations do lead
- `GET /api/leads/:id/briefing` → retorna briefing_gerado completo

**Dashboard frontend:** adicionar seção "Pronto pra Ligar" ao React build existente — lista de cards com: nome da casa, cidade, número do gestor, pontos fracos principais, e o briefing expansível. O React bundle precisará ser recompilado (`npm run build` no frontend separado ou via script).

### 9. `queue.config.ts` → **Atualizado**

Novos nomes de fila:
```typescript
MYSTERY_SHOP: 'mystery_shop_queue',  // substitui wa_test_queue
INTELLIGENCE: 'intelligence_queue',  // substitui scoring_queue
SOCIAL_ENG:   'social_eng_queue',    // substitui outreach_queue + followup_queue
BRIEFING:     'briefing_queue',      // novo
```

Antigas mantidas temporariamente: `approval_queue` (pode ser drenada), `outreach_queue`, `followup_queue`

---

## Fluxo de Filas V2

```
enrichment_queue → intel_queue → mystery_shop_queue → intelligence_queue → social_eng_queue → briefing_queue
```
(intel_queue roteamento: `enriched` → `mystery_shop_queue` em vez de `wa_test_queue`)

---

## Arquivos a Modificar

| Arquivo | Ação |
|---------|------|
| `src/app.module.ts` | Remove ApprovalModule, FollowupModule; adiciona IntelligenceModule, SocialEngineeringModule, BriefingModule |
| `src/queues/queue.config.ts` | Adiciona novos QUEUE_NAMES |
| `src/modules/crm/crm.service.ts` | Adiciona novos métodos + tipos |
| `src/modules/wa-tester/wa-tester.service.ts` | Rewrite completo (multi-turn state machine) |
| `src/modules/wa-tester/wa-tester.controller.ts` | Webhook routing por phase (minor update) |
| `src/modules/intel/intel.processor.ts` | Muda roteamento: `enriched` → `mystery_shop_queue` |
| `src/modules/dashboard/dashboard.controller.ts` | Novos endpoints |
| `src/modules/dashboard/dashboard.service.ts` | Novos métodos |

## Arquivos a Criar

| Arquivo | Descrição |
|---------|-----------|
| `src/modules/intelligence/intelligence.service.ts` | Análise IA da conversa |
| `src/modules/intelligence/intelligence.processor.ts` | Processor da fila |
| `src/modules/intelligence/intelligence.module.ts` | Módulo NestJS |
| `src/modules/social-engineering/social-engineering.service.ts` | Envio V1/V2/V3 + retry |
| `src/modules/social-engineering/social-engineering.processor.ts` | 2 processors: send + retry |
| `src/modules/social-engineering/social-engineering.module.ts` | Módulo NestJS |
| `src/modules/briefing/briefing.service.ts` | Gera briefing via OpenAI |
| `src/modules/briefing/briefing.processor.ts` | Processor da fila |
| `src/modules/briefing/briefing.module.ts` | Módulo NestJS |

## Arquivos a Eliminar (conteúdo esvaziado ou deletado)

- `src/modules/approval/` → eliminar
- `src/modules/followup/` → eliminar  
- `src/modules/scorer/` → substituído por intelligence/

---

## Timing (Confirmado)

- **M2B_WAIT**: 45 min após M1 sem resposta → envia M2B (configurável via env `WA_M2B_DELAY_MIN`, default 45)
- **MORTO M2A**: 18h úteis sem resposta ao M2A
- **MORTO M2B**: 12h úteis sem resposta ao M2B
- **Social Eng retry**: 6h úteis entre variações V1→V2→V3

---

## Ponto de Atenção: Webhook Routing por Phase

O `handleWebhook()` precisa saber em qual fase o lead está quando a mensagem chega. A chave `pendingMysteryShop` no Map deve incluir o `phase` atual para o roteamento correto.

Para os leads em fase de engenharia social, o Map deve ser diferente (`pendingSocialEng`) ou o `phase` do Map existente deve cobrir `ENG_V1/V2/V3` também.

---

## Verificação End-to-End

1. `POST /api/scraper/trigger` → scrape 1 lead com WA
2. Ver log: `enrichment → intel → mystery_shop` (M1 enviado)
3. Responder M1 no WA → ver log: M2A enviado
4. Responder M2A → ver log: `ativo`, intelligence rodando
5. Verificar DB: `leads` com campos `tipo_atendimento`, `dor_perfil`, etc. preenchidos
6. Ver log: social engineering V1 enviado
7. Responder com número de telefone → ver log: `briefing_done`
8. `GET /api/briefings` → briefing aparece com todos os dados
9. Ignorar engenharia V1 por 6h → ver V2 enviado automaticamente
