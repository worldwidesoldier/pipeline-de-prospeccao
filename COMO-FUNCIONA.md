# Como Funciona o Pipeline de Prospecção — Fair Assist

> Guia de referência para o criador do sistema. Explica cada etapa do pipeline, a lógica por trás das decisões, o que é automático, o que é manual, e o que pode dar errado.

---

## Visão Geral

O sistema é uma máquina de prospecção B2B para casas de câmbio. Ele:

1. Busca empresas no Google Maps
2. Enriquece cada lead (site, Instagram, WhatsApp)
3. Faz um **mystery shopping** via WhatsApp — manda uma mensagem fingindo ser cliente
4. Pontua o lead com base nos dados coletados
5. Apresenta os melhores leads para **você aprovar manualmente**
6. Envia a mensagem de outreach e faz followup automático

Nenhum lead recebe mensagem de venda sem você aprovar.

---

## Infraestrutura

| Componente | O que faz |
|---|---|
| **NestJS** (Node.js) | Backend principal, API, filas |
| **Supabase** | Banco de dados (PostgreSQL) — todos os leads, testes, scores |
| **Redis** | Filas de processamento (Bull), estado do motor |
| **Evolution API** | Conexão com o WhatsApp |
| **OpenAI** | Análise de sites, geração de mensagens, avaliação de respostas |
| **Outscraper** | Scraping do Google Maps e reviews |
| **PM2** | Mantém o servidor rodando em produção |

O servidor roda na **porta 3001**. O dashboard fica em `http://localhost:3001`.

---

## O Fluxo Completo

### Etapa 1 — Você dispara uma campanha

No dashboard, aba **Campanhas**, você cola uma query do Google Maps (ex: `casa de câmbio Porto Alegre`) e clica em Disparar.

O sistema chama o Outscraper que busca no Google Maps e retorna os resultados. Leads já existentes no banco são ignorados automaticamente (deduplicação por nome + cidade).

---

### Etapa 2 — Enriquecimento (~1-2 min por lead)

Para cada lead novo, o sistema:

1. **Crawl no site** — acessa o site da empresa, analisa o conteúdo com IA e dá uma nota
2. **Busca no Instagram** — tenta achar o perfil, verifica se está ativo, conta seguidores e dias desde o último post
3. **Resolve o WhatsApp** — tenta achar o número nessa ordem: site → Instagram → Google Maps

Se achou WhatsApp → vai para o mystery shopping.
Se não achou → status `sem_whatsapp`, salvo no banco, mas não avança no fluxo.

---

### Etapa 3 — Mystery Shopping (motor de WA test)

O sistema manda uma mensagem fingindo ser um cliente querendo fazer câmbio. O objetivo é medir a qualidade do atendimento daquela empresa no WhatsApp.

**Regras de envio:**
- Só envia **segunda a sexta, das 5h às 22h** (horário de Brasília)
- Máximo de **20 mensagens por dia** (configurável via `WA_DAILY_LIMIT` no `.env`)
- Intervalo **aleatório de 7 a 12 minutos** entre cada envio (imita comportamento humano, protege contra ban)

**O que acontece depois de enviar:**
- O sistema aguarda **18 horas úteis** pela resposta
- Se respondeu → registra o tempo de resposta e a qualidade
- Se não respondeu → registra como "sem resposta"
- Em ambos os casos → vai para o scoring

**Sobre o número de WhatsApp:**
O número conectado à Evolution API é o ativo mais frágil do sistema. Se levar ban, tudo para. Nunca reduza os intervalos sem pensar. Números novos (< 30 dias) suportam ~20/dia. Números antigos (> 3 meses) suportam 100+/dia.

---

### Etapa 4 — Scoring

O sistema dá uma nota de 0 a 100 para o lead com base em 4 critérios:

#### Google Maps — 35% do score

| Situação | Nota |
|---|---|
| Sem avaliações, nota < 4.5 | 15 |
| Sem avaliações, nota ≥ 4.5 | 25 |
| Menos de 10 avaliações | 40 |
| 10 a 50 avaliações | 65 |
| Mais de 50 avaliações + nota ≥ 4.0 | 100 |

*Lógica: empresa com muito movimento = mais clientes fazendo câmbio = mais potencial de venda.*

#### Site — 25% do score

A IA analisa o site e dá uma nota baseada na qualidade do conteúdo. Sem site = 0.

#### Instagram — 20% do score

| Situação | Nota |
|---|---|
| Sem Instagram | 0 |
| Sem post há mais de 90 dias | 20 |
| Sem post há 30-90 dias | 50 |
| Ativo, menos de 500 seguidores | 70 |
| Ativo e engajado | 100 |

*Lógica: Instagram abandonado = empresa em dificuldade com marketing = mais precisa do produto.*

#### Resposta ao WA (mystery shopping) — 20% do score

| Situação | Nota | Por quê |
|---|---|---|
| É bot | 0 | Já tem automação, não precisa |
| Respondeu em menos de 5 min | 10 | Atendimento excelente, não precisa do produto |
| Respondeu em menos de 15 min | 25 | Atende bem |
| Respondeu em até 1 hora | 50 | Razoável |
| Respondeu em 1 a 4 horas | 75 | Dor média-alta |
| Não respondeu OU respondeu muito tarde (+4h) | 100 | Atendimento ruim = dor alta = cliente ideal |

**A lógica central do negócio:** você vende um produto de atendimento via WhatsApp. Quem não responde ou responde mal é exatamente quem mais precisa do que você oferece.

---

### Etapa 5 — Aprovação Manual (você decide)

Após o scoring, o lead aparece no seu **inbox** no dashboard para aprovação manual. Você vê:
- Score total e breakdown por critério
- Dados da empresa (site, Instagram, avaliações Google)
- Resultado do mystery shopping (respondeu? em quanto tempo?)
- Sales intel (análise de reviews e perfil do cliente)

Você aprova ou descarta. Nenhuma mensagem de venda é enviada sem sua aprovação.

---

### Etapa 6 — Outreach (mensagem de venda)

Após aprovação, o sistema seleciona automaticamente um dos 3 templates baseado no resultado do mystery shopping:

| Template | Quando usa |
|---|---|
| **V1 — Resposta lenta** | Respondeu, mas demorou. Cita o tempo de resposta. |
| **V2 — Sem resposta** | Não respondeu nenhuma vez. |
| **V3 — Resposta ruim** | Respondeu, mas com qualidade baixa (avaliada por IA). |

Os textos dos templates são editáveis no dashboard, aba **Templates**.

---

### Etapa 7 — Followup Automático

Depois que a primeira mensagem é enviada, o sistema agenda automaticamente:

| Mensagem | Quando |
|---|---|
| Msg 2 | 2 dias depois, se não respondeu |
| Msg 3 | 5 dias depois, se ainda não respondeu |
| Msg 4 | 7 dias depois — última tentativa |

Se o lead responder em qualquer ponto, o followup para. Os textos dos followups também são editáveis no dashboard.

---

## Status dos Leads

Cada lead tem um status que mostra em que ponto do pipeline ele está:

| Status | Significa |
|---|---|
| `novo` | Acabou de ser scraped |
| `enriched` | Enriquecimento concluído, aguardando mystery shopping |
| `sem_whatsapp` | Não foi encontrado WhatsApp, salvo mas fora do fluxo principal |
| `sem_whatsapp_fixo` | Número inválido confirmado |
| `scored` | Score calculado, aguardando aprovação |
| `pending_approval` | No inbox, esperando você aprovar |
| `approved` | Aprovado, aguardando envio da mensagem |
| `outreach` | Primeira mensagem enviada, followups agendados |
| `convertido` | Virou cliente |
| `descartado` | Descartado manualmente por você |
| `descartado_bot` | Respondeu ao mystery shopping com bot |

**Importante:** nenhum status apaga o lead. Tudo fica salvo no banco para sempre.

---

## O Motor de Envio WA

O motor é o coração do sistema — ele controla o ritmo dos envios para proteger o número.

**Estado do motor** (visível no dashboard, aba Campanhas):
- **Rodando** — enviando normalmente
- **Pausado** — você pausou manualmente, leads ficam aguardando na fila
- **Limite atingido** — atingiu o máximo do dia, retoma automaticamente no dia seguinte às 5h30

**Controles:**
- Botão **Pausar** — para todos os envios imediatamente
- Botão **Retomar** — volta a enviar de onde parou
- Botão **Re-enfileirar** — pega todos os leads `enriched` com WhatsApp que estão presos (sem job na fila) e os coloca de volta

**Estado persistido no Redis:**
- `wa_motor:status` — running ou paused
- `wa_motor:last_sent_at` — timestamp do último envio (sobrevive a restart do PM2)

---

## O Que Sobrevive a um Restart

| Dado | Sobrevive? |
|---|---|
| Leads, scores, wa_tests no banco | ✅ Sempre (Supabase) |
| Templates de mensagem | ✅ Sempre (arquivos em `data/`) |
| Estado do motor (pausado/rodando) | ✅ Redis |
| Último envio (rate limit) | ✅ Redis |
| Leads pendentes no mystery shopping | ⚠️ Reconstrói do banco ao reiniciar |
| Jobs na fila de enriquecimento | ❌ Perdem a vez (Redis reiniciado) |
| Activity log (feed de atividade) | ❌ Some (memória) |

Se o servidor reiniciar com leads na fila de enriquecimento, eles ficam travados. Use o botão **Re-enfileirar** no dashboard ou chame manualmente `POST /api/leads/requeue-for-wa-test`.

---

## Configurações Importantes (arquivo `.env`)

| Variável | Padrão | O que faz |
|---|---|---|
| `WA_DAILY_LIMIT` | `20` | Máximo de mystery shoppings por dia |
| `PORT` | `3001` | Porta do servidor |
| `NODE_ENV` | `production` | Ambiente |
| `EVOLUTION_INSTANCE_PROSPECCAO` | `prospeccao` | Nome da instância WA na Evolution API |

Para mudar o limite diário:
```bash
# Editar .env
WA_DAILY_LIMIT=30

# Reiniciar
pm2 restart fair-assist-prospeccao --update-env
```

---

## Comandos Úteis no Servidor

```bash
# Ver status do servidor
pm2 status

# Ver logs em tempo real
pm2 logs fair-assist-prospeccao

# Reiniciar após mudança de código
npx nest build && pm2 restart fair-assist-prospeccao --update-env

# Re-enfileirar leads travados
curl -X POST http://localhost:3001/api/leads/requeue-for-wa-test

# Ver status do motor
curl http://localhost:3001/api/motor/status

# Pausar motor
curl -X POST http://localhost:3001/api/motor/pause

# Retomar motor
curl -X POST http://localhost:3001/api/motor/resume

# Rodar intel manual em leads sem análise
python3 outscraper_intel.py --all --limit 200
```

---

## Limites Recomendados por Fase do Número WA

| Tempo de uso | Limite diário seguro |
|---|---|
| Novo (< 30 dias) | 20-30 |
| Médio (1-3 meses) | 50-80 |
| Estabelecido (> 3 meses) | 100+ |

Sinais de risco de ban: muitas mensagens sem resposta em sequência, mensagens marcadas como spam, volume alto em pouco tempo.

---

## O Que Ainda Está Pendente

- **Migration SQL no Supabase** — adicionar colunas `campaign_name`, `location`, `niche` na tabela `scraper_jobs` para rastrear de onde cada lead veio. SQL a executar no Supabase Dashboard:
  ```sql
  ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS campaign_name text;
  ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS location text;
  ALTER TABLE scraper_jobs ADD COLUMN IF NOT EXISTS niche text;
  ```
- **Activity log persistente** — hoje o feed de atividade some ao reiniciar
- **172 leads sem intel** — rodar `python3 outscraper_intel.py --all --limit 200` no servidor

---

## Arquitetura de Filas

O sistema usa filas para processar tudo de forma assíncrona e com retry automático:

```
enrichment_queue  → enriquece o lead (site, IG, WA)
intel_queue       → análise de reviews Google + IA
wa_test_queue     → mystery shopping (controlado pelo motor)
scoring_queue     → calcula o score
approval_queue    → coloca no inbox
outreach_queue    → envia a primeira mensagem de venda
followup_queue    → followups em 2, 5 e 7 dias
webhook_queue     → processa respostas recebidas no WA
```

Todas as filas ficam no Redis. Se o Redis reiniciar, jobs pendentes podem ser perdidos — os leads em si ficam salvos no Supabase.
