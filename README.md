# Fair Assist Prospecção

Sistema de prospecção automática B2B para casas de câmbio.

## Setup

### 1. Preencher credenciais
```bash
cp .env .env.local
# Editar .env com suas credenciais
```

### 2. Subir infraestrutura
```bash
colima start
DOCKER_HOST="unix:///Users/solonca/.colima/default/docker.sock" docker compose up -d redis
```

### 3. Migrations Supabase
Rodar o SQL do PROMPT_SUPREMO.md no editor SQL do Supabase.

### 4. Build e start
```bash
npm run build
pm2 start ecosystem.config.js
pm2 logs fair-assist-prospeccao
```

### 5. Configurar webhook Evolution API
No painel da Evolution API, configurar webhook da instância de prospecção para:
```
https://SEU_IP_OU_NGROK/webhook/evolution
```

## Estrutura das filas
```
scraper_queue → enrichment_queue → wa_test_queue → scoring_queue → approval_queue → outreach_queue → followup_queue
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
