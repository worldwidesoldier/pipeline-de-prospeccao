#!/usr/bin/env python3
"""One-off: limpa URLs malformadas (com %3F encoded) que vieram do Outscraper."""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
SB = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


def clean(url):
    if not url:
        return None
    u = url.strip()
    for marker in ("/%3F", "%3F", "/?", "?"):
        idx = u.lower().find(marker.lower())
        if idx > 0:
            u = u[:idx + (1 if marker.startswith("/") else 0)]
            break
    return u.rstrip("/") + "/" if u else None


# Find leads with malformed sites
res = SB.table("leads").select("id,nome,site").like("site", "%\\%3F%").execute()
bad = res.data or []
print(f"Leads com URL malformada: {len(bad)}")
for lead in bad:
    new = clean(lead["site"])
    print(f"  {lead['nome'][:40]:40s}")
    print(f"    OLD: {lead['site']}")
    print(f"    NEW: {new}")
    SB.table("leads").update({"site": new}).eq("id", lead["id"]).execute()
print(f"\nLimpos: {len(bad)}")
