#!/usr/bin/env python3
"""
Outscraper Maps Scraper — substitui scraper.py (Playwright)
Busca casas de câmbio no Google Maps via API do Outscraper.

Uso:
  python3 outscraper_scraper.py "casa de câmbio São Paulo" --max 30

Output: JSON array de leads (stdout), mesmo formato do scraper.py + campos extras
  (email, cep, facebook_url, x_url, instagram)

Variáveis de ambiente:
  OUTSCRAPER_API_KEY=...
"""

import os
import sys
import json
import time
import argparse
import re
import requests
from dotenv import load_dotenv

load_dotenv()

OUTSCRAPER_KEY = os.environ.get("OUTSCRAPER_API_KEY")
if not OUTSCRAPER_KEY:
    print(json.dumps({"error": "OUTSCRAPER_API_KEY não configurada"}))
    sys.exit(1)

BASE_URL = "https://api.app.outscraper.com"
HEADERS  = {"X-API-KEY": OUTSCRAPER_KEY}


def maps_search(queries: list[str], limit: int) -> list[dict]:
    """Busca no Google Maps via Outscraper e retorna lista de resultados brutos.
    Aceita múltiplas queries — o Outscraper as processa em paralelo e retorna
    uma sublista por query que é achatada aqui.
    """
    params = {
        "query":        queries,  # lista → Outscraper aceita array de queries
        "limit":        limit,
        "language":     "pt",
        "region":       "BR",
        "reviewsLimit": 0,  # sem reviews aqui — custo menor, reviews vêm via outscraper_intel.py
        "fields":       "name,full_address,city,state,postal_code,phone,site,email,social_networks,rating,reviews",
    }
    r = requests.get(f"{BASE_URL}/maps/search-v3", params=params, headers=HEADERS, timeout=120)
    r.raise_for_status()
    data = r.json()

    # Outscraper pode retornar síncrono {"data": [...]} ou async {"id": ..., "status": "Pending"}
    if isinstance(data, dict) and data.get("status") in ("Pending", "Running"):
        data = _poll_job(data["id"])

    raw = data.get("data", data) if isinstance(data, dict) else data

    # Outscraper v3 retorna list[list] (uma sublista por query) — achata tudo
    if raw and isinstance(raw[0], list):
        flat = []
        for sublist in raw:
            flat.extend(sublist)
        raw = flat

    return raw or []


def _poll_job(job_id: str, max_wait: int = 300) -> dict:
    """Aguarda um job assíncrono do Outscraper concluir (poll a cada 5s)."""
    waited = 0
    while waited < max_wait:
        time.sleep(5)
        waited += 5
        r = requests.get(f"{BASE_URL}/requests/{job_id}", headers=HEADERS, timeout=30)
        r.raise_for_status()
        data = r.json()
        if data.get("status") not in ("Pending", "Running"):
            return data
    raise TimeoutError(f"Job {job_id} não concluiu em {max_wait}s")


def _normalize_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    cleaned = re.sub(r"[^\d+]", "", phone)
    if not cleaned:
        return None
    if not cleaned.startswith("+"):
        if cleaned.startswith("55") and len(cleaned) >= 12:
            cleaned = "+" + cleaned
        else:
            cleaned = "+55" + cleaned
    return cleaned


def _to_lead(item: dict) -> dict:
    """Converte resultado bruto do Outscraper para o formato de lead do pipeline."""
    socials = item.get("social_networks") or {}
    return {
        "nome":            item.get("name")         or "",
        "telefone_google": _normalize_phone(item.get("phone")),
        "site":            item.get("site")          or None,
        "instagram":       socials.get("instagram")  or None,
        "facebook_url":    socials.get("facebook")   or None,
        "x_url":           socials.get("twitter")    or None,
        "email":           item.get("email")         or None,
        "endereco":        item.get("full_address")  or None,
        "cidade":          item.get("city")          or None,
        "estado":          item.get("state")         or None,
        "cep":             item.get("postal_code")   or None,
        "google_rating":   item.get("rating")        or None,
        "google_reviews":  item.get("reviews")       or None,
    }


def main():
    parser = argparse.ArgumentParser(description="Outscraper Maps scraper para Fair Assist")
    parser.add_argument("query", help="Query de busca (ex: 'casa de câmbio São Paulo')")
    parser.add_argument("--max", type=int, default=30, help="Limite de resultados (default: 30)")
    args = parser.parse_args()

    try:
        queries = [q.strip() for q in args.query.split('\n') if q.strip()]
        if not queries:
            print(json.dumps([]))
            return
        print(f"Queries ({len(queries)}): {queries}", file=sys.stderr)
        raw   = maps_search(queries, args.max)
        leads = [_to_lead(item) for item in raw if item.get("name")]
        print(json.dumps(leads, ensure_ascii=False))
    except Exception as e:
        import traceback
        print(json.dumps({"error": str(e), "trace": traceback.format_exc()}), file=sys.stderr)
        print(json.dumps([]))
        sys.exit(1)


if __name__ == "__main__":
    main()
