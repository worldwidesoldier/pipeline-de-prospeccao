-- Sales Intelligence: novas colunas na tabela leads
-- Execute no SQL Editor do Supabase

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS email            TEXT,
  ADD COLUMN IF NOT EXISTS cep              TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url     TEXT,
  ADD COLUMN IF NOT EXISTS x_url            TEXT,
  ADD COLUMN IF NOT EXISTS is_hot           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pain_points      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary       TEXT,
  ADD COLUMN IF NOT EXISTS cold_email_draft TEXT,
  ADD COLUMN IF NOT EXISTS google_reviews_raw JSONB DEFAULT '[]'::jsonb;

-- Índice para busca por is_hot (leads quentes)
CREATE INDEX IF NOT EXISTS idx_leads_is_hot ON leads (is_hot) WHERE is_hot = TRUE;
