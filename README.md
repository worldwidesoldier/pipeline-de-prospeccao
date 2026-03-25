# Fair Assist Prospecção

Sistema de prospecção automática B2B para casas de câmbio. Roda 24/7 no Mac Mini.

## Fluxo do pipeline

```
scraper_queue → enrichment_queue → wa_test_queue → scoring_queue → [DASHBOARD] → outreach_queue → followup_queue
```

Leads chegam com status `scored` e ficam aguardando aprovação no dashboard.
O operador aprova ou descarta. Aprovados disparam o outreach automaticamente.

## Credenciais necessárias (.env)

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Service role key |
| `EVOLUTION_API_URL` | URL da Evolution API |
| `EVOLUTION_API_KEY` | Chave da Evolution API |
| `EVOLUTION_INSTANCE_PROSPECCAO` | Nome da instância de prospecção |
| `OPENAI_API_KEY` | Para gerar mensagens de outreach |
| `OLLAMA_URL` | Ollama local (scoring e análise) |
| `REDIS_URL` | Redis local via Colima |

## Setup

### 1. Subir infraestrutura
```bash
colima start
DOCKER_HOST="unix:///Users/solonca/.colima/default/docker.sock" docker compose up -d redis
```

### 2. Migrations Supabase
Rodar o SQL do PROMPT_SUPREMO.md no editor SQL do Supabase.

### 3. Build e start
```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 logs fair-assist-prospeccao
```

### 4. Configurar webhook Evolution API
No painel da Evolution API, configurar webhook da instância de prospecção para:
```
http://SEU_IP_LOCAL:3001/webhook/evolution
```

## Comandos úteis
```bash
# Ver status das filas Redis
DOCKER_HOST="unix:///Users/solonca/.colima/default/docker.sock" docker exec fair-assist-redis redis-cli info keyspace

# Logs em tempo real
pm2 logs fair-assist-prospeccao --lines 50

# Reiniciar
pm2 restart fair-assist-prospeccao
```
