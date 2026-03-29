# Fair Assist — Pipeline de Prospecção
## Briefing Completo — Estado Atual + O Que Falta

---

## O QUE É ESSE PRODUTO

Sistema de prospecção B2B 100% automatizado para **casas de câmbio brasileiras**.

O pipeline funciona assim:
1. **Scraper** — busca casas de câmbio no Google Maps (todos os 27 estados)
2. **Enricher** — enriquece cada lead com dados do site, Instagram, Google
3. **WA Tester** — envia mensagem fingindo ser cliente ("qual o valor do dólar hoje?") e mede se responderam, quanto tempo levou, e a qualidade da resposta
4. **Scorer** — calcula score 0-100 com base em: WA (40%) + site (20%) + Instagram (20%) + Google (20%)
5. **Approval** — score ≥ 70 aprova automático, score 40-69 vai pro dashboard pra aprovação manual
6. **Outreach** — envia mensagem de vendas personalizada via WhatsApp (gerada por OpenAI) mencionando exatamente o problema encontrado (ex: "vi que vocês demoram 2h pra responder no WA")
7. **Follow-up** — sequência automática nos dias 2, 5 e 7 se não responder

O diferencial: a gente mystery-shop a casa de câmbio ANTES de abordá-la. Quando chega a mensagem de vendas, a gente já sabe exatamente como eles atendem.

---

## INFRAESTRUTURA — VPS HETZNER

**IP do VPS:** `49.13.126.219`
**Usuário:** `dev`
**SSH:** `ssh dev@49.13.126.219`

### Serviços rodando (Docker):
```
evolution-api     → porta 8080  (WhatsApp API)
evolution-postgres → porta 5432  (banco do Evolution)
prospeccao-redis  → porta 6379  (filas Bull/BullMQ)
```

### App rodando (PM2):
```
fair-assist-prospeccao → porta 3001
```

### Comandos úteis no VPS:
```bash
pm2 logs fair-assist-prospeccao   # ver logs em tempo real
pm2 restart fair-assist-prospeccao # reiniciar app
pm2 status                         # status geral
docker ps                          # ver containers
```

---

## CREDENCIAIS (.env já configurado em /home/dev/pipeline-de-prospeccao/.env)

```
SUPABASE_URL=https://uhjojrnijcqiubgxconv.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci... (configurado)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=prospeccao-api-key-2026
EVOLUTION_INSTANCE_PROSPECCAO=prospeccao
OPENAI_API_KEY=sk-proj-... (configurado)
REDIS_URL=redis://localhost:6379
PORT=3001
NODE_ENV=production
```

---

## O QUE JÁ FOI FEITO

### Código — refatoração completa:
- ✅ **Telegram removido** — era usado pra notificações e aprovações. Virou lixo.
- ✅ **Dashboard construído** — http://49.13.126.219:3001 — mostra pipeline, stats do dia, aprovações pendentes com botões Aprovar/Descartar, tabela de leads
- ✅ **ApprovalModule criado** — substitui o Telegram: score ≥ 70 aprova automático, 40-69 fica pendente no dashboard
- ✅ **WA Tester melhorado** — agora usa OpenAI pra gerar mensagem de teste diferente a cada vez (não parece bot)
- ✅ **Ollama removido** — tudo usa OpenAI agora
- ✅ **Env validation** — app não sobe se faltar chave
- ✅ **Deploy** — app rodando em produção via PM2

### Infrastructure:
- ✅ Redis rodando (Docker)
- ✅ Evolution API rodando (Docker) na porta 8080
- ✅ App buildado e rodando na porta 3001
- ✅ Dashboard acessível em http://49.13.126.219:3001

---

## O QUE FALTA — EM ORDEM DE PRIORIDADE

### 🔴 1. CONECTAR WHATSAPP (CRÍTICO — SEM ISSO NADA FUNCIONA)

A instância `prospeccao` existe mas está **desconectada** (`connectionStatus: close`).

**Como fazer:**
1. Abre http://49.13.126.219:8080 no browser
2. Loga com a API key: `prospeccao-api-key-2026`
3. Clica na instância `prospeccao`
4. Clica em "Connect" ou "QR Code"
5. Escaneia com o WhatsApp do número que vai ser usado pra prospecção
6. **IMPORTANTE:** usar um número separado, nunca o número pessoal

Ou via API direto:
```bash
curl -X GET http://49.13.126.219:8080/instance/connect/prospeccao \
  -H "apikey: prospeccao-api-key-2026"
```
Isso retorna um QR code em base64 ou URL pra escanear.

### 🔴 2. CONFIGURAR WEBHOOK DO EVOLUTION (CRÍTICO)

O Evolution API precisa avisar o nosso app quando receber mensagens de resposta.
Sem isso, o WA Tester nunca vai saber se o lead respondeu.

**Como fazer** (rodar no VPS ou via curl):
```bash
curl -X POST http://localhost:8080/webhook/set/prospeccao \
  -H "apikey: prospeccao-api-key-2026" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3001/webhook/evolution",
    "webhook_by_events": false,
    "webhook_base64": false,
    "events": ["MESSAGES_UPSERT"]
  }'
```

### 🔴 3. RODAR MIGRATIONS DO SUPABASE

O banco Supabase precisa das tabelas criadas. O schema completo está em `PROMPT_SUPREMO.md`.

**Como fazer:**
1. Acessa https://supabase.com → seu projeto → SQL Editor
2. Abre o arquivo `/home/dev/pipeline-de-prospeccao/PROMPT_SUPREMO.md`
3. Copia o SQL de criação das tabelas e roda no editor

Tabelas necessárias:
- `leads`
- `enrichment`
- `wa_tests`
- `scores`
- `outreach`
- `relatorios_diarios`

### 🟡 4. INSTALAR DEPENDÊNCIAS PYTHON

O scraper e o enricher usam scripts Python. Precisam de dependências instaladas no VPS.

```bash
pip3 install crawl4ai instagrapi playwright 2>&1
playwright install chromium
```

Ou criar um `requirements.txt`:
```
crawl4ai
instagrapi
playwright
```

### 🟡 5. TESTAR O PIPELINE DE PONTA A PONTA

Depois de tudo configurado, fazer um teste manual:

```bash
# No VPS, via curl — trigga o scraper manualmente pra um estado só
curl -X POST http://localhost:3001/api/scraper/trigger \
  -H "Content-Type: application/json" \
  -d '{"estado": "São Paulo"}'
```
**Nota:** esse endpoint ainda não existe — pode ser necessário criar um trigger manual no dashboard.

### 🟢 6. OPCIONAL — CONFIGURAR PM2 STARTUP

Pra o app reiniciar automaticamente se o VPS reiniciar:
```bash
pm2 startup   # vai pedir pra rodar um comando com sudo
pm2 save
```

---

## ARQUITETURA DO CÓDIGO

```
/home/dev/pipeline-de-prospeccao/
├── src/
│   ├── modules/
│   │   ├── scraper/       # Busca leads no Google Maps (roda 8h dias úteis)
│   │   ├── enricher/      # Enriquece site + Instagram + extrai WhatsApp
│   │   ├── wa-tester/     # Envia mensagem teste + recebe resposta via webhook
│   │   ├── scorer/        # Calcula score 0-100
│   │   ├── approval/      # Aprovação automática (≥70) ou manual (40-69)
│   │   ├── outreach/      # Envia mensagem de vendas personalizada
│   │   ├── followup/      # Follow-ups nos dias 2, 5 e 7
│   │   ├── dashboard/     # API + serve o HTML do dashboard
│   │   └── crm/           # Todas as operações no Supabase
│   ├── public/
│   │   └── index.html     # Dashboard web
│   └── config/
│       └── env.config.ts  # Configuração + validação de env vars
├── .env                   # Credenciais (NÃO commitar)
├── ecosystem.config.js    # Configuração PM2
└── PROMPT_SUPREMO.md      # Schema do banco + documentação original
```

---

## FLUXO DE FILAS (Bull/Redis)

```
scraper_queue → enrichment_queue → wa_test_queue → scoring_queue → approval_queue → outreach_queue → followup_queue
```

Cada fila tem retry automático (3x com backoff exponencial).

---

## DASHBOARD — http://49.13.126.219:3001

O que já funciona:
- Stats do dia (prospectados, testados, enviados, responderam, convertidos)
- Pipeline funnel (quantidade por etapa)
- Tabela de leads com filtro por status
- Aprovações pendentes com botão Aprovar/Descartar

---

## RESUMO DO QUE FAZER QUANDO VOLTAR

1. **Conectar WhatsApp** → http://49.13.126.219:8080 → instância `prospeccao` → QR code
2. **Configurar webhook** → curl acima pra apontar Evolution → nosso app
3. **Criar tabelas no Supabase** → SQL do PROMPT_SUPREMO.md
4. **Instalar Python deps** → pip3 install crawl4ai instagrapi playwright
5. **Testar pipeline** → verificar se um lead entra e passa por todas as etapas
6. **PM2 startup** → pra sobreviver a reboots

Depois disso tudo: **o produto está funcionando**.
