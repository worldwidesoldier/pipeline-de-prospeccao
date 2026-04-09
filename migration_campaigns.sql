-- Migration: add campaign context to scraper_jobs
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/uhjoirnijcqiubgxconv/sql

ALTER TABLE scraper_jobs
  ADD COLUMN IF NOT EXISTS campaign_name text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS niche text;
