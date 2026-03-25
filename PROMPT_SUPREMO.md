# Sistema de Prospecção Automática — Fair Assist
## Prompt Supremo para Claude Code no Mac Mini

---

## O que é este sistema

Sistema de prospecção automática B2B que roda 24/7 no Mac Mini local. O objetivo é encontrar casas de câmbio em todo o Brasil que precisam de um bot WhatsApp com IA, testar o atendimento delas automaticamente, dar uma nota para cada uma, pedir aprovação com 1 clique e enviar mensagem de vendas personalizada.

O produto sendo vendido é o **Fair Assist** — bot WhatsApp com IA já em produção, com clientes reais satisfeitos, que atende clientes de casas de câmbio 24/7 respondendo cotações, dúvidas e fazendo handoff para atendente humano.

O argumento de vendas central é: **"Testei seu atendimento e vi que vocês demoram X horas para responder. Nosso bot responde em segundos, 24h por dia. 7 dias grátis."**

---

## Infraestrutura disponível no Mac Mini (já instalado)

- **Colima** — runtime Docker para Mac (substituiu Docker Desktop)
- **Docker** — configurado via Colima
- **Ollama** — rodando como serviço, modelos de IA local disponíveis
- **Crawl4AI** — biblioteca Python de scraping com IA, já instalada
- **Evolution API** — instalada localmente (~/.evolution/)
- **n8n** — instalado com banco SQLite (~/.n8n/), NÃO será usado
- **Tailscale** — VPN instalada
- **~/Projects/prospecao/** — pasta existente com template de outreach (será reaproveitada)

---

## Stack do sistema

| Componente | Ferramenta | Por quê |
|---|---|---|
| Backend | NestJS + TypeScript | Mesmo padrão do Fair Assist, já dominamos |
| Scraping Google Maps | Crawl4AI (Python) | Já instalado, IA-native, anti-detecção built-in |
| Enrichment de sites | Crawl4AI | Retorna markdown estruturado pronto para IA |
| Enrichment Instagram | Instaloader (Python) | Mais estável para perfis públicos em 2026 |
| Fila de jobs | BullMQ + Redis | Delayed jobs nativos para follow-ups |
| Redis | Docker via Colima | Já temos Colima instalado |
| WhatsApp | Evolution API (Render) | Já temos rodando em produção |
| Banco/CRM | Supabase | PostgreSQL + interface visual grátis |
| IA — scoring | Ollama local (llama3) | Grátis, já rodando no Mac Mini |
| IA — mensagens | OpenAI GPT-4.1-mini | Qualidade para mensagens de vendas |
| Aprovação + relatório | Telegram Bot | InlineKeyboard, 1 clique |

**Custo estimado:** menos de $10/mês (só OpenAI para mensagens finais)

---

## Regra crítica — número de WhatsApp

O Google Maps frequentemente retorna telefone fixo das empresas. O número de WhatsApp pode ser completamente diferente.

**O enricher deve buscar o WhatsApp nesta ordem de prioridade:**
1. Site da empresa (rodapé, página de contato, botão WhatsApp)
2. Bio do Instagram
3. Número secundário no Google Maps
4. Se não encontrar nenhum → marcar `whatsapp_source: 'unknown'` e NÃO realizar o teste de atendimento

Nunca tentar enviar mensagem de teste para telefone fixo.

---

## Estrutura de pastas do projeto

```
~/Projects/fair-assist-prospeccao/
├── src/
│   ├── modules/
│   │   ├── scraper/
│   │   │   ├── scraper.module.ts
│   │   │   ├── scraper.service.ts       ← Crawl4AI subprocess, busca Google Maps por estado
│   │   │   └── scraper.processor.ts     ← BullMQ worker
│   │   ├── enricher/
│   │   │   ├── enricher.module.ts
│   │   │   ├── enricher.service.ts      ← Crawl4AI no site + extração de WhatsApp
│   │   │   ├── instagram.service.ts     ← Instaloader subprocess
│   │   │   └── enricher.processor.ts    ← BullMQ worker
│   │   ├── wa-tester/
│   │   │   ├── wa-tester.module.ts
│   │   │   ├── wa-tester.service.ts     ← Envia msg simulando cliente via Evolution API
│   │   │   ├── wa-tester.controller.ts  ← Webhook listener para receber respostas
│   │   │   └── wa-tester.processor.ts   ← BullMQ worker
│   │   ├── scorer/
│   │   │   ├── scorer.module.ts
│   │   │   ├── scorer.service.ts        ← Calcula nota 0-100 com Ollama local
│   │   │   └── scorer.processor.ts      ← BullMQ worker
│   │   ├── outreach/
│   │   │   ├── outreach.module.ts
│   │   │   ├── outreach.service.ts      ← OpenAI gera msg personalizada, Evolution envia
│   │   │   └── outreach.processor.ts    ← BullMQ worker
│   │   ├── followup/
│   │   │   ├── followup.module.ts
│   │   │   └── followup.service.ts      ← BullMQ delayed jobs: dia 2, 5, 7
│   │   ├── telegram/
│   │   │   ├── telegram.module.ts
│   │   │   └── telegram.service.ts      ← Bot com InlineKeyboard + relatório 21h
│   │   └── crm/
│   │       ├── crm.module.ts
│   │       └── crm.service.ts           ← Interface com Supabase
│   ├── queues/
│   │   └── queue.config.ts              ← Definição de todas as filas BullMQ
│   ├── config/
│   │   └── env.config.ts
│   ├── scripts/
│   │   ├── scraper.py                   ← Script Python Crawl4AI para Google Maps
│   │   └── instagram.py                 ← Script Python Instaloader
│   └── main.ts
├── docker-compose.yml                   ← Redis
├── .env
└── package.json
```

---

## Tabelas Supabase (migrations completas)

```sql
-- Leads brutos do Google Maps
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  telefone_google text,
  whatsapp text,
  whatsapp_source text CHECK (whatsapp_source IN ('site', 'instagram_bio', 'google', 'unknown')),
  site text,
  instagram text,
  endereco text,
  cidade text,
  estado text,
  google_rating numeric,
  google_reviews int,
  status text DEFAULT 'novo' CHECK (status IN ('novo','enriched','tested','scored','approved','outreach','converted','descartado')),
  criado_em timestamptz DEFAULT now()
);

-- Resultado do enrichment
CREATE TABLE enrichment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  tem_site boolean DEFAULT false,
  site_score int CHECK (site_score BETWEEN 0 AND 100),
  site_resumo text,
  ig_username text,
  ig_followers int,
  ig_ultimo_post_dias int,
  ig_ativo boolean DEFAULT false,
  ig_bio text,
  atualizado_em timestamptz DEFAULT now()
);

-- Testes de atendimento WhatsApp
CREATE TABLE wa_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  numero_testado text,
  mensagem_enviada text,
  enviado_em timestamptz DEFAULT now(),
  respondido_em timestamptz,
  tempo_resposta_min int,
  respondeu boolean DEFAULT false,
  qualidade_resposta int CHECK (qualidade_resposta BETWEEN 0 AND 100),
  resposta_texto text
);

-- Scores
CREATE TABLE scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  score_total int CHECK (score_total BETWEEN 0 AND 100),
  score_resposta int,
  score_site int,
  score_instagram int,
  score_google int,
  calculado_em timestamptz DEFAULT now()
);

-- Outreach e follow-ups
CREATE TABLE outreach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  aprovado_por text DEFAULT 'vitor',
  aprovado_em timestamptz,
  msg1_enviada_em timestamptz,
  msg2_enviada_em timestamptz,
  msg3_enviada_em timestamptz,
  msg4_enviada_em timestamptz,
  respondeu boolean DEFAULT false,
  respondeu_em timestamptz,
  interesse_nivel text CHECK (interesse_nivel IN ('alto','medio','baixo','nao_respondeu')),
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','convertido','perdido'))
);

-- Relatórios diários
CREATE TABLE relatorios_diarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date UNIQUE,
  leads_prospectados int DEFAULT 0,
  leads_enriquecidos int DEFAULT 0,
  leads_testados int DEFAULT 0,
  leads_aprovados int DEFAULT 0,
  mensagens_enviadas int DEFAULT 0,
  respostas_recebidas int DEFAULT 0,
  interessados int DEFAULT 0,
  convertidos int DEFAULT 0,
  criado_em timestamptz DEFAULT now()
);
```

---

## Scoring — Pesos e Critérios detalhados

| Critério | Peso | Pontuação |
|---|---|---|
| Tempo de resposta WA | 40% | Não tem WA=0 \| Não respondeu em 4h=10 \| >4h=20 \| 1h-4h=40 \| 15min-1h=60 \| 5-15min=80 \| <5min=100 |
| Qualidade do site | 20% | Sem site=0 \| Site existe mas vazio=30 \| Tem info básica=60 \| Tem preços+WA+horário=100 |
| Atividade Instagram | 20% | Sem IG=0 \| IG existe mas >90 dias sem post=20 \| 30-90 dias=50 \| <30 dias+<500 seg=70 \| <30 dias+>500 seg=100 |
| Presença Google | 20% | Sem avaliações=0 \| <10 reviews=30 \| 10-50 reviews=60 \| >50 reviews+rating>4=100 |

**Regras de corte:**
- Score **≥70** → aprovação automática no Telegram (lead quente)
- Score **40-69** → aprovação manual no Telegram (você decide)
- Score **<40** → descartado automaticamente, sem notificação

---

## Fluxo completo do pipeline

```
CRON 08:00 (segunda a sexta)
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 1: SCRAPER                               │
│ Crawl4AI busca Google Maps para cada estado     │
│ Query: "casa de câmbio [estado]" + "câmbio"     │
│ Extrai: nome, telefone, site, endereço,         │
│ cidade, estado, rating, reviews                 │
│ Salva em leads (status: 'novo')                 │
│ Joga na fila: enrichment_queue                  │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 2: ENRICHER                              │
│ Para cada lead da fila:                         │
│                                                 │
│ → Crawl4AI no site: extrai markdown             │
│   Ollama analisa: tem preços? WhatsApp? email?  │
│                                                 │
│ → Instaloader no Instagram: seguidores,         │
│   último post, bio, username                    │
│                                                 │
│ → Busca número WhatsApp real:                   │
│   1. site (botão WA, link wa.me, texto)         │
│   2. bio do Instagram                           │
│   3. Google Maps número secundário              │
│   4. se não achar → whatsapp_source: 'unknown'  │
│                                                 │
│ Salva em enrichment (status: 'enriched')        │
│ Se tem WhatsApp → joga em wa_test_queue         │
│ Se não tem → joga direto em scoring_queue       │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 3: WA TESTER                             │
│ Envia via Evolution API (número de prospecção): │
│ "Oi, tudo bem? Queria saber o valor do dólar    │
│ hoje pra compra. Obrigado!"                     │
│                                                 │
│ Registra horário de envio                       │
│ Webhook listener aguarda resposta por 4h        │
│ Se responder: registra tempo + texto            │
│ Ollama avalia qualidade da resposta (0-100)     │
│ Após 4h sem resposta: registra como não-resp    │
│                                                 │
│ Salva em wa_tests (status: 'tested')            │
│ Joga na fila: scoring_queue                     │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 4: SCORER                                │
│ Calcula nota 0-100 com os pesos definidos       │
│ Salva em scores (status: 'scored')              │
│                                                 │
│ Score ≥70 → joga em approval_queue (automático) │
│ Score 40-69 → joga em approval_queue (manual)   │
│ Score <40 → status: 'descartado', fim           │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 5: TELEGRAM — APROVAÇÃO                  │
│ Envia mensagem formatada:                       │
│                                                 │
│ 🏦 [Nome da Corretora] — [Cidade]/[Estado]      │
│ 📊 Score: 87/100 (QUENTE 🔥)                    │
│ ⏱ WhatsApp: demorou 3h12min pra responder       │
│ 🌐 Site: existe mas sem preços nem WhatsApp     │
│ 📸 Instagram: último post há 45 dias (820 seg)  │
│ ⭐ Google: 4.2 estrelas (23 avaliações)          │
│ 📞 Número: +55 48 99999-9999                    │
│                                                 │
│ [✅ Aprovar e Enviar] [❌ Descartar]             │
│                                                 │
│ Se score ≥70: marca como automático na msg      │
└─────────────────────────────────────────────────┘
    ↓ (Vitor aperta Aprovar)
┌─────────────────────────────────────────────────┐
│ MÓDULO 6: OUTREACH                              │
│ OpenAI GPT-4.1-mini gera mensagem               │
│ personalizada baseada nos dados coletados        │
│ (menciona especificamente o problema do lead)   │
│                                                 │
│ Envia mensagem 1 via Evolution API              │
│ Salva em outreach (status: 'em_andamento')      │
│ Agenda no BullMQ:                               │
│   → Job delayed 2 dias: followup_msg2           │
│   → Job delayed 5 dias: followup_msg3           │
│   → Job delayed 7 dias: followup_msg4           │
└─────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────┐
│ MÓDULO 7: FOLLOW-UP (BullMQ delayed jobs)       │
│                                                 │
│ Dia 2: se não respondeu → envia msg 2           │
│ Dia 5: se não respondeu → envia msg 3           │
│ Dia 7: se não respondeu → envia msg 4 (última)  │
│                                                 │
│ SE RESPONDER A QUALQUER MOMENTO:                │
│ → Webhook Evolution API detecta resposta        │
│ → Cancela todos os jobs pendentes deste lead    │
│ → Notifica Vitor no Telegram                    │
│ → Marca interesse_nivel baseado na resposta     │
└─────────────────────────────────────────────────┘

CRON 21:00 (todo dia)
┌─────────────────────────────────────────────────┐
│ MÓDULO 8: RELATÓRIO DIÁRIO                      │
│ Telegram envia resumo:                          │
│                                                 │
│ 📊 Relatório Fair Assist Prospecção — 24/03     │
│ 🔍 Prospectados hoje: 47                        │
│ ✅ Enriquecidos: 43                             │
│ 📱 Testados no WA: 31                           │
│ 🔥 Aprovados: 12                                │
│ 📤 Mensagens enviadas: 8                        │
│ 💬 Responderam: 3                               │
│ 👀 Interessados: 1                              │
│ 🎯 Convertidos total: 0                         │
└─────────────────────────────────────────────────┘
```

---

## Templates de mensagens

### Teste de atendimento (simula cliente)
```
Oi, tudo bem? Queria saber o valor do dólar hoje pra compra. Obrigado!
```

### Mensagem 1 — Outreach (gerada pelo OpenAI com dados reais)
Prompt para o OpenAI:
```
Gere uma mensagem de WhatsApp de vendas para uma casa de câmbio chamada [NOME].
Dados coletados: [DADOS DO LEAD].
A mensagem deve:
- Ser direta, empática e profissional
- Mencionar especificamente o problema identificado (tempo de resposta, site desatualizado, etc)
- Apresentar o Fair Assist como solução
- Oferecer 7 dias grátis sem compromisso
- Máximo 5 linhas
- Tom de conversa real, não de vendedor
- Assinar como "Vitor — Fair Assist"
```

### Mensagem 2 — Follow-up dia 2
```
Oi [nome]! Só passando pra ver se você viu minha mensagem anterior.

A gente atende casas de câmbio no Sul e os clientes adoraram — o bot responde enquanto a equipe dorme. 😄

Topa testar 7 dias grátis?
```

### Mensagem 3 — Follow-up dia 5
```
Oi [nome], última tentativa da minha parte!

Se tiver interesse em automatizar o atendimento do WhatsApp de vocês, é só me responder aqui.

7 dias grátis, sem cartão, sem compromisso.
```

### Mensagem 4 — Follow-up dia 7
```
Tudo bem [nome]! Vou deixar você em paz depois dessa. 😊

Se um dia quiser ver como o bot funciona na prática, é só chamar.

Abraço, Vitor — Fair Assist
```

---

## Variáveis de ambiente (.env)

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Evolution API (produção — já temos)
EVOLUTION_API_URL=https://evolution-api-fy3c.onrender.com
EVOLUTION_API_KEY=92a88c75c2d93b9b656dacba0a47502db0cff4f99e39f91f2f3996ef04d9ae55
EVOLUTION_INSTANCE_PROSPECCAO=   # nome da instância do número do Vitor

# OpenAI (só para mensagens de outreach)
OPENAI_API_KEY=

# Ollama (local — scoring e análise)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Redis (local via Docker/Colima)
REDIS_URL=redis://localhost:6379

# App
PORT=3001
NODE_ENV=production
```

---

## Plano de construção passo a passo

### Dia 1 — Infraestrutura
1. Subir Colima: `colima start`
2. Criar `docker-compose.yml` com Redis
3. Subir Redis: `docker compose up -d redis`
4. Criar repositório privado no GitHub: `fair-assist-prospeccao`
5. Inicializar NestJS: `nest new fair-assist-prospeccao`
6. Criar projeto Supabase (novo, separado do Fair Assist)
7. Rodar migrations das 6 tabelas no Supabase
8. Configurar `.env` com todas as credenciais
9. Instalar dependências:
```bash
npm install @nestjs/bull bullmq ioredis @supabase/supabase-js node-telegram-bot-api openai axios
pip3 install crawl4ai instaloader
```
10. Testar conexão com Supabase, Redis e Ollama

### Dia 2 — Scraper + Enricher
11. Criar `scripts/scraper.py` com Crawl4AI buscando Google Maps
12. Implementar `scraper.service.ts` chamando o script Python
13. Implementar `enricher.service.ts` com Crawl4AI para sites
14. Implementar `instagram.service.ts` com Instaloader
15. Implementar lógica de extração de número WhatsApp
16. Testar com 10 leads reais de Santa Catarina

### Dia 3 — WA Tester + Scorer
17. Configurar instância da Evolution API para número de prospecção
18. Implementar `wa-tester.service.ts` com envio e webhook listener
19. Implementar `scorer.service.ts` com os pesos definidos + Ollama
20. Testar com 5 casas de câmbio reais e validar scores

### Dia 4 — Telegram + Outreach + Follow-up
21. Criar Telegram Bot via @BotFather
22. Implementar `telegram.service.ts` com InlineKeyboard
23. Implementar `outreach.service.ts` com OpenAI + Evolution API
24. Implementar `followup.service.ts` com BullMQ delayed jobs
25. Testar aprovação e envio end-to-end

### Dia 5 — Relatório + Produção
26. Implementar cron de relatório diário às 21h
27. Testar pipeline completo com 20 leads reais
28. Ajustar mensagens e scoring
29. Configurar PM2 para rodar o sistema 24/7 no Mac Mini
30. Configurar cron do sistema operacional para disparar às 08h

---

## Contexto adicional para o desenvolvedor

**Por que NestJS e não scripts simples?**
Porque o sistema precisa rodar 24/7, gerenciar filas com retry, lidar com webhooks de entrada (Evolution API respondendo), e escalar para outros produtos no futuro. NestJS com BullMQ dá essa robustez.

**Por que Ollama local para scoring?**
Scoring e análise de texto acontecem centenas de vezes por dia. Usar OpenAI para isso custaria $30-50/mês desnecessariamente. Ollama com llama3 roda no Mac Mini gratuitamente e é suficiente para analisar sites e calcular scores.

**Por que OpenAI apenas para outreach?**
Mensagens de vendas precisam de qualidade máxima. São poucas mensagens por dia (apenas leads aprovados). Vale o custo.

**Por que não usar o n8n que já está instalado?**
O n8n é uma ferramenta visual de low-code. Para um sistema com lógica complexa (retry, webhooks, filas, scoring), código NestJS é muito mais controlável, debugável e escalável.

**Relação com o Fair Assist:**
Este é um projeto completamente separado. Usa a mesma Evolution API de produção mas com uma instância diferente (número do Vitor para prospecção). Tem seu próprio Supabase, seu próprio repositório e roda no Mac Mini (não no Render).
