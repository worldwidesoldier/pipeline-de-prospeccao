#!/usr/bin/env python3
"""
Sales Intelligence via Outscraper
Coleta emails, redes sociais, reviews do Google e gera análise BANT com GPT.

Uso:
  python outscraper_intel.py --lead-id <UUID>
  python outscraper_intel.py --all          # processa todos leads sem ai_summary
  python outscraper_intel.py --query "Casa de Câmbio São Paulo" --limit 20

Variáveis de ambiente necessárias (.env):
  OUTSCRAPER_API_KEY=...
  OPENAI_API_KEY=...
  SUPABASE_URL=...
  SUPABASE_SERVICE_KEY=...
"""

import os
import sys
import json
import argparse
import requests
from openai import OpenAI
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

OUTSCRAPER_KEY = os.environ["OUTSCRAPER_API_KEY"]
OPENAI_KEY     = os.environ["OPENAI_API_KEY"]
SUPABASE_URL   = os.environ["SUPABASE_URL"]
SUPABASE_KEY   = os.environ["SUPABASE_SERVICE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
openai   = OpenAI(api_key=OPENAI_KEY)


# ── Outscraper ─────────────────────────────────────────────────────────────

def outscraper_search(query: str, limit: int = 20) -> list[dict]:
    """Busca empresas no Google Maps via Outscraper."""
    url = "https://api.app.outscraper.com/maps/search-v3"
    params = {
        "query":           query,
        "limit":           limit,
        "language":        "pt",
        "region":          "BR",
        "reviewsLimit":    50,
        "fields":          "name,full_address,city,state,postal_code,phone,site,email,social_networks,rating,reviews,reviews_data",
    }
    headers = {"X-API-KEY": OUTSCRAPER_KEY}
    r = requests.get(url, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json()
    # Outscraper retorna {"data": [...]}
    return data.get("data", []) if isinstance(data, dict) else data


def outscraper_by_place_id(place_id: str) -> dict | None:
    """Busca dados de um lugar específico pelo Place ID."""
    url = "https://api.app.outscraper.com/maps/search-v3"
    params = {
        "query":        place_id,
        "limit":        1,
        "language":     "pt",
        "reviewsLimit": 50,
        "fields":       "name,full_address,city,state,postal_code,phone,site,email,social_networks,rating,reviews,reviews_data",
    }
    headers = {"X-API-KEY": OUTSCRAPER_KEY}
    r = requests.get(url, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    data = r.json().get("data", [])
    return data[0] if data else None


# ── Análise BANT com GPT ───────────────────────────────────────────────────

def analisar_reviews(nome: str, reviews: list[dict]) -> dict:
    """Envia as reviews para o GPT e retorna análise BANT."""
    if not reviews:
        return {"is_hot": False, "pain_points": [], "ai_summary": "Sem avaliações disponíveis para análise."}

    textos = []
    for r in reviews[:50]:
        rating = r.get("rating", "?")
        text   = r.get("text") or r.get("review_text") or ""
        if text:
            textos.append(f"[{rating}★] {text[:300]}")

    reviews_str = "\n".join(textos) if textos else "Sem texto nas avaliações."

    prompt = f"""Você é um analista de vendas B2B especializado em identificar oportunidades de mercado.

Analise as avaliações do Google da empresa "{nome}" abaixo e retorne um JSON estrito com:
- "is_hot": true se há reclamações recorrentes sobre ATENDIMENTO LENTO, FALTA DE RESPOSTA, DEMORA, ou ERROS no processo — ou seja, problemas que uma solução como um bot de WhatsApp 24h resolveria. False caso contrário.
- "pain_points": array de strings com as dores específicas identificadas (máx 5, em português, frases curtas e diretas)
- "ai_summary": parágrafo de 2-3 frases resumindo o perfil do negócio e as principais oportunidades de melhoria que uma solução de automação de atendimento poderia resolver

Avaliações:
{reviews_str}

Retorne APENAS o JSON, sem explicações.
Exemplo: {{"is_hot": true, "pain_points": ["Demora para responder", "Sem atendimento fora do horário"], "ai_summary": "Casa de câmbio com bom volume de clientes mas atendimento inconsistente..."}}"""

    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    return json.loads(response.choices[0].message.content or "{}")


# ── Supabase helpers ───────────────────────────────────────────────────────

def get_lead(lead_id: str) -> dict | None:
    res = supabase.table("leads").select("*").eq("id", lead_id).single().execute()
    return res.data


def get_leads_sem_intel(limit: int = 50) -> list[dict]:
    res = (
        supabase.table("leads")
        .select("id, nome, telefone_google, cidade, estado")
        .is_("ai_summary", "null")
        .not_.in_("status", ["descartado", "descartado_bot"])
        .limit(limit)
        .execute()
    )
    return res.data or []


def salvar_intel(lead_id: str, outscraper_data: dict, intel: dict, reviews_raw: list) -> None:
    socials = outscraper_data.get("social_networks") or {}
    update = {
        "email":               outscraper_data.get("email") or None,
        "cep":                 outscraper_data.get("postal_code") or None,
        "facebook_url":        socials.get("facebook") or None,
        "x_url":               socials.get("twitter") or None,
        "is_hot":              bool(intel.get("is_hot", False)),
        "pain_points":         intel.get("pain_points", []),
        "ai_summary":          intel.get("ai_summary", ""),
        "google_reviews_raw":  reviews_raw[:50],
    }
    # Remove Nones para não sobrescrever dados existentes com null
    update = {k: v for k, v in update.items() if v is not None}
    supabase.table("leads").update(update).eq("id", lead_id).execute()
    print(f"  ✓ Lead atualizado: {update.get('email', '—')} | hot={update['is_hot']} | {len(update.get('pain_points', []))} dores")


# ── Processamento ──────────────────────────────────────────────────────────

def processar_lead(lead: dict) -> None:
    nome = lead["nome"]
    cidade = lead.get("cidade") or lead.get("estado") or "Brasil"
    print(f"\n→ Processando: {nome} ({cidade})")

    query = f"{nome} {cidade}"
    resultados = outscraper_search(query, limit=3)

    if not resultados:
        print(f"  ✗ Nenhum resultado Outscraper para: {query}")
        return

    # Pega o primeiro resultado (mais relevante)
    dado = resultados[0]
    reviews_raw = dado.get("reviews_data") or []

    # Normaliza formato de reviews
    reviews_normalizados = []
    for r in reviews_raw:
        reviews_normalizados.append({
            "author": r.get("author_title") or r.get("name") or "Anônimo",
            "rating": r.get("review_rating") or r.get("rating") or 0,
            "text":   r.get("review_text") or r.get("text") or "",
            "date":   r.get("review_datetime_utc") or r.get("date") or "",
        })

    print(f"  → {len(reviews_normalizados)} avaliações encontradas")

    intel = analisar_reviews(nome, reviews_normalizados)
    print(f"  → is_hot={intel.get('is_hot')} | {len(intel.get('pain_points', []))} dores")

    salvar_intel(lead["id"], dado, intel, reviews_normalizados)


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Outscraper Sales Intelligence para Fair Assist")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--lead-id",  help="ID do lead específico a processar")
    group.add_argument("--all",      action="store_true", help="Processa todos leads sem ai_summary")
    group.add_argument("--query",    help="Busca nova query no Outscraper e importa leads")
    parser.add_argument("--limit",   type=int, default=20, help="Limite de leads/resultados (default: 20)")
    args = parser.parse_args()

    if args.lead_id:
        lead = get_lead(args.lead_id)
        if not lead:
            print(f"Lead {args.lead_id} não encontrado.")
            sys.exit(1)
        processar_lead(lead)

    elif args.all:
        leads = get_leads_sem_intel(args.limit)
        print(f"Processando {len(leads)} leads sem Sales Intelligence...")
        for lead in leads:
            try:
                processar_lead(lead)
            except Exception as e:
                print(f"  ✗ Erro em {lead['nome']}: {e}")

    elif args.query:
        print(f"Buscando '{args.query}' no Outscraper (limit={args.limit})...")
        resultados = outscraper_search(args.query, args.limit)
        print(f"  → {len(resultados)} resultados encontrados")
        # Aqui você pode importar os resultados diretamente para o banco se quiser


if __name__ == "__main__":
    main()
