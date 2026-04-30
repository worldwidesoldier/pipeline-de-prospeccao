#!/usr/bin/env python3
"""
Sales Intelligence via Outscraper — Fair Assist
Usa as APIs dedicadas:
  • Google Maps Reviews Scraper  (/maps/reviews-v3)
  • Emails & Contacts Scraper    (/emails-and-contacts)

Fluxo por lead:
  1. maps/search-v3 (limit=1, sem reviews) → place_id, site, dados básicos
  2. maps/reviews-v3 com place_id          → reviews completas
  3. emails-and-contacts com site          → emails + redes sociais enriquecidas
  4. GPT analisa reviews                  → is_hot, pain_points, ai_summary
  5. Supabase update

Uso:
  python outscraper_intel.py --lead-id <UUID>
  python outscraper_intel.py --all            # todos leads sem ai_summary
  python outscraper_intel.py --query "Casa de Câmbio São Paulo" --limit 20

Variáveis de ambiente (.env):
  OUTSCRAPER_API_KEY=...
  OPENAI_API_KEY=...
  SUPABASE_URL=...
  SUPABASE_SERVICE_KEY=...
"""

import os
import sys
import json
import time
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

BASE_URL = "https://api.app.outscraper.com"
HEADERS  = {"X-API-KEY": OUTSCRAPER_KEY}


# ── Outscraper helpers ─────────────────────────────────────────────────────

def _poll_job(job_id: str, max_wait: int = 180) -> dict:
    """Aguarda job assíncrono do Outscraper (poll a cada 5s)."""
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


def _get_data(response: dict) -> list:
    """Extrai lista de dados de resposta síncrona ou assíncrona."""
    if response.get("status") in ("Pending", "Running"):
        response = _poll_job(response["id"])

    raw = response.get("data", response) if isinstance(response, dict) else response

    # Outscraper v3 retorna list[list] (uma sublista por query) ou list[dict]
    if raw and isinstance(raw, list) and isinstance(raw[0], list):
        raw = raw[0]

    return raw or []


def maps_find(query: str) -> dict | None:
    """
    Busca um lugar no Google Maps (sem reviews) para obter place_id e site.
    Retorna o primeiro resultado ou None.
    """
    params = {
        "query":        query,
        "limit":        1,
        "language":     "pt",
        "region":       "BR",
        "reviewsLimit": 0,
        "fields":       "place_id,name,full_address,city,state,postal_code,phone,website,email,social_networks,rating,reviews",
    }
    r = requests.get(f"{BASE_URL}/maps/search-v3", params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    data = _get_data(r.json())
    return data[0] if data else None


def maps_reviews(place_id: str, limit: int = 50) -> list[dict]:
    """
    Busca reviews via API dedicada de reviews usando o place_id do Google Maps.
    Retorna lista de reviews normalizadas.
    """
    params = {
        "query":    place_id,
        "limit":    limit,
        "language": "pt",
        "sort":     "newest",
    }
    r = requests.get(f"{BASE_URL}/maps/reviews-v3", params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    raw = _get_data(r.json())

    reviews = []
    for item in raw:
        # reviews-v3 retorna objetos com campo "reviews_data" ou diretamente review fields
        review_list = item.get("reviews_data") or []
        for rev in review_list[:20]:
            reviews.append({
                "author": rev.get("author_title") or rev.get("name") or "Anônimo",
                "rating": rev.get("review_rating") or rev.get("rating") or 0,
                "text":   rev.get("review_text") or rev.get("text") or "",
                "date":   rev.get("review_datetime_utc") or rev.get("date") or "",
            })
    return reviews[:20]


def emails_and_contacts(site: str) -> dict:
    """
    Enriquece dados de contato usando o Emails & Contacts Scraper do Outscraper.
    Retorna dict com emails, redes sociais.
    """
    params = {
        "query":  site,
        "fields": "emails,social_networks,phones",
    }
    r = requests.get(f"{BASE_URL}/emails-and-contacts", params=params, headers=HEADERS, timeout=60)
    r.raise_for_status()
    data = _get_data(r.json())
    return data[0] if data else {}


# ── Análise GPT ────────────────────────────────────────────────────────────

def analisar_reviews(nome: str, reviews: list[dict]) -> dict:
    """Analisa reviews com GPT e retorna is_hot, pain_points, ai_summary."""
    if not reviews:
        return {
            "is_hot": False,
            "pain_points": [],
            "ai_summary": "Sem avaliações disponíveis para análise.",
        }

    textos = []
    for rev in reviews[:50]:
        text = rev.get("text", "").strip()
        if text:
            textos.append(f"[{rev.get('rating', '?')}★] {text[:300]}")

    reviews_str = "\n".join(textos) if textos else "Sem texto nas avaliações."

    prompt = f"""Você é um analista de vendas B2B especializado em identificar oportunidades de mercado.

Analise as avaliações do Google da empresa "{nome}" e retorne um JSON estrito com:
- "is_hot": true se há reclamações recorrentes sobre ATENDIMENTO LENTO, FALTA DE RESPOSTA, DEMORA, ou ERROS — problemas que um bot de WhatsApp 24h resolveria. False caso contrário.
- "pain_points": array de strings com as dores específicas (máx 5, em português, frases curtas e diretas)
- "ai_summary": parágrafo de 2-3 frases resumindo o perfil e as principais oportunidades que automação de atendimento resolveria

Avaliações:
{reviews_str}

Retorne APENAS o JSON, sem explicações.
Exemplo: {{"is_hot": true, "pain_points": ["Demora para responder", "Sem atendimento fora do horário"], "ai_summary": "Casa de câmbio com bom volume mas atendimento inconsistente..."}}"""

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
        .select("id, nome, telefone_google, cidade, estado, site")
        .is_("ai_summary", "null")
        .not_.in_("status", ["descartado", "descartado_bot"])
        .limit(limit)
        .execute()
    )
    return res.data or []


def salvar_intel(lead_id: str, lead: dict, maps_data: dict, contacts: dict, intel: dict, reviews_raw: list) -> None:
    """Consolida dados do Maps, Emails & Contacts e GPT e salva no Supabase."""
    import re as _re

    # Socials: prioriza emails-and-contacts (mais completo), cai back para maps
    maps_socials     = maps_data.get("social_networks") or {}
    contacts_socials = contacts.get("social_networks") or {}

    def pick(key: str) -> str | None:
        return contacts_socials.get(key) or maps_socials.get(key) or None

    # Email: emails-and-contacts retorna lista, maps retorna string
    raw_emails = contacts.get("emails") or []
    email = None
    if isinstance(raw_emails, list) and raw_emails:
        first = raw_emails[0]
        email = first.get("value") or first if isinstance(first, dict) else first
    if not email:
        email = maps_data.get("email") or None

    # Site: salva se Intel encontrou e lead não tinha (Outscraper usa "website")
    site_found = maps_data.get("website") or maps_data.get("site") or None
    if site_found and not lead.get("site"):
        print(f"  ✓ Site descoberto pelo Intel: {site_found}")

    update = {
        "email":              email,
        "cep":                maps_data.get("postal_code") or None,
        "instagram":          pick("instagram"),
        "facebook_url":       pick("facebook"),
        "x_url":              pick("twitter"),
        "is_hot":             bool(intel.get("is_hot", False)),
        "pain_points":        intel.get("pain_points", []),
        "ai_summary":         intel.get("ai_summary", ""),
        "google_reviews_raw": reviews_raw[:20],
        # Salva site se o lead não tinha (encontrado pelo maps_find do Intel)
        **({"site": site_found} if site_found and not lead.get("site") else {}),
    }

    # ── Tenta encontrar WhatsApp via phones do Outscraper Contacts ──────────
    # Só entra se o lead ainda não tem WhatsApp (sem_whatsapp / sem_whatsapp_fixo)
    if not lead.get("whatsapp"):
        # Candidatos: phones do E&C + phone do Maps (pode ser celular)
        raw_phones = contacts.get("phones") or []
        maps_phone = maps_data.get("phone")
        if maps_phone:
            raw_phones = raw_phones + [{"value": maps_phone, "_src": "maps"}]

        for phone_entry in raw_phones:
            phone_val = phone_entry.get("value") if isinstance(phone_entry, dict) else str(phone_entry)
            if not phone_val:
                continue
            cleaned = _re.sub(r"[^\d+]", "", str(phone_val))
            # Valida celular BR: +55DDXXXXXXXXX (13d), 55DDXXXXXXXXX (12d) ou DDXXXXXXXXX (11d)
            if _re.match(r"^(\+?55)?(\d{2})(9\d{8})$", cleaned):
                if cleaned.startswith("+"):
                    wa_number = cleaned
                elif cleaned.startswith("55") and len(cleaned) >= 12:
                    wa_number = "+" + cleaned
                else:
                    wa_number = "+55" + cleaned
                src = phone_entry.get("_src", "outscraper_contacts") if isinstance(phone_entry, dict) else "outscraper_contacts"
                update["whatsapp"]        = wa_number
                update["whatsapp_source"] = src
                update["status"]          = "enriched"
                print(f"  ✓ WhatsApp via {src}: {wa_number}")
                break

    # Remove Nones para não sobrescrever dados existentes com null
    update = {k: v for k, v in update.items() if v is not None}

    supabase.table("leads").update(update).eq("id", lead_id).execute()
    wa_found = "✓ " + update["whatsapp"] if update.get("whatsapp") else "—"
    print(
        f"  ✓ Salvo: email={update.get('email', '—')} | "
        f"instagram={'✓' if update.get('instagram') else '—'} | "
        f"wa={wa_found} | "
        f"hot={update['is_hot']} | "
        f"{len(update.get('pain_points', []))} dores | "
        f"{len(reviews_raw)} reviews"
    )


# ── Processamento ──────────────────────────────────────────────────────────

def processar_lead(lead: dict) -> None:
    nome   = lead["nome"]
    cidade = lead.get("cidade") or lead.get("estado") or "Brasil"
    site   = lead.get("site")
    print(f"\n→ {nome} ({cidade})")

    # 1. Encontra o lugar no Maps para pegar place_id e site
    query      = f"{nome} {cidade}"
    maps_data  = maps_find(query)
    if not maps_data:
        print(f"  ✗ Não encontrado no Maps: {query}")
        return

    place_id  = maps_data.get("place_id")
    site      = site or maps_data.get("website") or maps_data.get("site")
    print(f"  → place_id={place_id or '—'} | site={site or '—'}")

    # 2. Reviews via API dedicada
    reviews = []
    if place_id:
        try:
            reviews = maps_reviews(place_id, limit=20)
            print(f"  → {len(reviews)} reviews obtidas")
        except Exception as e:
            print(f"  ! Reviews falhou: {e} — usando campo rating/reviews do Maps")

    # 3. Emails & Contacts — usa site se disponível, senão query de negócio
    # A API aceita URL OU query Maps: encontra o site e raspa contatos de qualquer forma
    contacts = {}
    ec_query = site or f"{nome} {cidade}"
    try:
        contacts = emails_and_contacts(ec_query)
        print(f"  → contacts (query={ec_query!r}): {bool(contacts.get('emails'))} emails, phones={len(contacts.get('phones') or [])}, socials={list((contacts.get('social_networks') or {}).keys())}")
    except Exception as e:
        print(f"  ! Emails & Contacts falhou: {e}")

    # 4. Análise GPT
    intel = analisar_reviews(nome, reviews)
    print(f"  → is_hot={intel.get('is_hot')} | {len(intel.get('pain_points', []))} dores")

    # 5. Salvar
    salvar_intel(lead["id"], lead, maps_data, contacts, intel, reviews)


# ── CLI ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Outscraper Sales Intelligence — Fair Assist")
    group  = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--lead-id", help="ID do lead específico")
    group.add_argument("--all",     action="store_true", help="Todos leads sem ai_summary")
    group.add_argument("--query",   help="Busca nova no Maps e exibe resultados (não salva)")
    parser.add_argument("--limit",  type=int, default=20, help="Limite (default: 20)")
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
        print(f"Buscando '{args.query}' no Maps...")
        result = maps_find(args.query)
        if result:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print("Nenhum resultado.")


if __name__ == "__main__":
    main()
