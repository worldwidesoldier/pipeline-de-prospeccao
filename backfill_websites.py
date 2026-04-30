#!/usr/bin/env python3
"""
Backfill: descobre website (campo `site`) para leads que estão sem.
Usa Outscraper Maps Search com a query `nome cidade` por lead.
Após popular o campo, basta re-enfileirar para enrichment_queue para
o Crawl4AI extrair WhatsApp do site.
"""
import os, sys, time, json, requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
KEY = os.environ["OUTSCRAPER_API_KEY"]
SB  = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
H   = {"X-API-KEY": KEY}
BASE = "https://api.app.outscraper.com"


def poll(jid, max_wait=180):
    for _ in range(max_wait // 5):
        time.sleep(5)
        r = requests.get(f"{BASE}/requests/{jid}", headers=H, timeout=30).json()
        if r.get("status") not in ("Pending", "Running"):
            return r
    raise TimeoutError(f"job {jid} timeout")


def clean_site_url(url):
    if not url:
        return None
    u = url.strip()
    for marker in ("/%3F", "%3F", "/?", "?"):
        idx = u.lower().find(marker.lower())
        if idx > 0:
            u = u[:idx + (1 if marker.startswith("/") else 0)]
            break
    return u.rstrip("/") + "/" if u else None


def maps_find(query):
    r = requests.get(f"{BASE}/maps/search-v3", params={
        "query": query, "limit": 1, "language": "pt", "region": "BR", "reviewsLimit": 0,
        "fields": "name,phone,website,social_networks,city,state",
    }, headers=H, timeout=60).json()
    if r.get("status") in ("Pending", "Running"):
        r = poll(r["id"])
    data = r.get("data", r)
    if data and isinstance(data[0], list):
        data = data[0]
    return data[0] if data else None


def main():
    dry = "--dry-run" in sys.argv
    res = SB.table("leads").select("id,nome,cidade,estado,site,instagram,facebook_url").is_("site", "null").execute()
    leads = res.data or []
    print(f"Leads sem site: {len(leads)}")
    if dry:
        print("[DRY RUN] não escreve nada.")

    found_site = found_ig = found_fb = errors = 0
    for i, lead in enumerate(leads, 1):
        cidade = lead.get("cidade") or lead.get("estado") or "Brasil"
        query  = f"{lead['nome']} {cidade}"
        try:
            m = maps_find(query)
            if not m:
                print(f"[{i:02d}/{len(leads)}] {lead['nome'][:50]:50s} -> NOT FOUND")
                continue

            socials = m.get("social_networks") or {}
            update = {}
            site_clean = clean_site_url(m.get("website"))
            if site_clean and not lead.get("site"):
                update["site"] = site_clean
                found_site += 1
            if socials.get("instagram") and not lead.get("instagram"):
                update["instagram"] = socials["instagram"]
                found_ig += 1
            if socials.get("facebook") and not lead.get("facebook_url"):
                update["facebook_url"] = socials["facebook"]
                found_fb += 1

            tags = []
            if "site" in update:      tags.append(f"site={update['site'][:40]}")
            if "instagram" in update: tags.append(f"ig={update['instagram'][:40]}")
            if "facebook_url" in update: tags.append("fb=ok")
            print(f"[{i:02d}/{len(leads)}] {lead['nome'][:50]:50s} -> {' | '.join(tags) if tags else '(nada novo)'}")

            if update and not dry:
                SB.table("leads").update(update).eq("id", lead["id"]).execute()
        except Exception as e:
            errors += 1
            print(f"[{i:02d}/{len(leads)}] {lead['nome'][:50]:50s} ERROR: {e}")

    print(f"\n=== RESUMO ===")
    print(f"Sites descobertos:    {found_site}")
    print(f"Instagram descoberto: {found_ig}")
    print(f"Facebook descoberto:  {found_fb}")
    print(f"Erros:                {errors}")


if __name__ == "__main__":
    main()
