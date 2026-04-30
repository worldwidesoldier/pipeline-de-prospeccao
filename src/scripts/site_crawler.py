#!/usr/bin/env python3
"""
Crawl4AI website crawler para enrichment de leads.
Extrai: WhatsApp, Instagram username, email, Facebook URL, markdown.

Uso: python3 site_crawler.py <URL>
Output: JSON em stdout com {markdown, whatsapp, instagram_username, email, facebook_url}
"""
import asyncio
import sys
import json
import re
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig


def normalize_phone(raw):
    """Normaliza qualquer formato BR -> só dígitos sem código de país."""
    digits = re.sub(r'[^\d]', '', str(raw))
    if digits.startswith('0'):
        digits = digits[1:]
    if digits.startswith('55') and len(digits) > 11:
        digits = digits[2:]
    return digits if 8 <= len(digits) <= 11 else None


def is_valid_br(n):
    """DDD válido (11-99) + 8 dígitos fixo ou 9 dígitos celular."""
    return bool(n and re.match(r'^[1-9][0-9]\d{8,9}$', n))


def extract_wa(html, md):
    """Pipeline de extração de WhatsApp, ordem decrescente de confiança."""
    H = html or ''
    M = md or ''

    # Nível 1: links explícitos de WhatsApp em href/src
    for pat in [r'wa\.me/([0-9+]{8,15})',
                r'whatsapp\.com/send[?&]phone=([0-9+]{8,15})',
                r'api\.whatsapp\.com/send[?&]phone=([0-9+]{8,15})']:
        for src in [H, M]:
            for m in re.finditer(pat, src, re.IGNORECASE):
                n = normalize_phone(m.group(1))
                if is_valid_br(n):
                    return n

    wa_kw = re.compile(r'whatsapp|\bwpp\b|\bzap\b', re.IGNORECASE)

    def closest_to_wa(candidates, text):
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0][1]
        wa_positions = [m.start() for m in wa_kw.finditer(text)]
        if not wa_positions:
            return candidates[0][1]
        best = min(candidates, key=lambda t: min(abs(t[0] - wp) for wp in wa_positions))
        return best[1]

    has_wa_mention = bool(wa_kw.search(H + M))
    phone_re = re.compile(r'\(?([0-9]{2})\)?[\s.-]?([0-9]{4,5})[\s.-]?([0-9]{4})')

    # Nível 2: tel: links próximos a menção WA
    if has_wa_mention:
        tel_candidates = []
        tel_pat = re.compile(r'href=["\']?\s*(tel:[+0-9().\s-]{4,20})["\'\s>]', re.IGNORECASE)
        for m in tel_pat.finditer(H):
            n = normalize_phone(m.group(1).replace('tel:', '').replace('Tel:', ''))
            if is_valid_br(n):
                tel_candidates.append((m.start(), n))
        result = closest_to_wa(tel_candidates, H)
        if result:
            return result

    # Nível 3: JSON-LD telephone
    if has_wa_mention:
        for m in re.finditer(r'"telephone"\s*:\s*"([^"]{6,20})"', H, re.IGNORECASE):
            n = normalize_phone(m.group(1))
            if is_valid_br(n):
                return n

    # Nível 4: contexto whatsapp/wpp/zap + número próximo
    wa_ctx = re.compile(r'.{0,30}(?:whatsapp|\bwpp\b|\bzap\b|\bwa\b).{0,300}', re.IGNORECASE | re.DOTALL)
    for src in [H, M]:
        for snip_m in wa_ctx.finditer(src):
            snip = snip_m.group()
            kw_m = re.search(r'whatsapp|\bwpp\b|\bzap\b|\bwa\b', snip, re.IGNORECASE)
            kw_pos = kw_m.start() if kw_m else 30
            candidates = []
            for pm in phone_re.finditer(snip):
                n = normalize_phone(pm.group(1) + pm.group(2) + pm.group(3))
                if is_valid_br(n):
                    candidates.append((abs(pm.start() - kw_pos), n))
            if candidates:
                candidates.sort(key=lambda x: x[0])
                return candidates[0][1]

    # Nível 5: footer HTML — múltiplos números, prefere celular próximo a WA
    footer_m = re.search(r'<footer[^>]*>(.+?)</footer>', H, re.IGNORECASE | re.DOTALL)
    if footer_m:
        footer = footer_m.group(1)
        footer_candidates = [(m.start(), normalize_phone(m.group(1) + m.group(2) + m.group(3)))
                             for m in phone_re.finditer(footer)
                             if normalize_phone(m.group(1) + m.group(2) + m.group(3))]
        footer_candidates = [(pos, n) for pos, n in footer_candidates if is_valid_br(n)]
        cells = [(pos, n) for pos, n in footer_candidates if len(n) == 11]
        result = closest_to_wa(cells, footer) or closest_to_wa(footer_candidates, footer)
        if result:
            return result

    # Nível 6: +55 + celular no markdown
    m = re.search(r'\+?55[\s.-]?\(?([0-9]{2})\)?[\s.-]?(9[0-9]{4})[\s.-]?([0-9]{4})', M)
    if m:
        n = normalize_phone(m.group(1) + m.group(2) + m.group(3))
        if is_valid_br(n):
            return n

    return None


SKIP_IG = {'p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'share', 'about', 'blog', 'help'}


def extract_ig(md):
    ig = re.search(r'instagram\.com/([^/?\s"\'\)\]<>]+)', md, re.IGNORECASE)
    if not ig:
        return None
    username = ig.group(1).rstrip('/')
    if username in SKIP_IG:
        return None
    return username


def extract_email(md, html):
    m = re.search(r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})', html or '', re.IGNORECASE)
    if m:
        return m.group(1).lower()
    m = re.search(r'\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b', md)
    if m:
        email = m.group(1).lower()
        if not re.search(r'\.(png|jpg|gif|svg|webp|woff|css|js)$', email):
            return email
    return None


SKIP_FB = ('facebook.com/sharer', 'facebook.com/share', 'facebook.com/dialog', 'facebook.com/plugins')


def extract_fb(md):
    m = re.search(r'(https?://(?:www\.)?facebook\.com/[^/?\s"\'\)\]<>]+)', md, re.IGNORECASE)
    if not m:
        return None
    url = m.group(1).rstrip('/')
    if any(s in url for s in SKIP_FB):
        return None
    return url


def extract_links(html, base_url):
    """Internal links that look like contact/unit pages."""
    from urllib.parse import urljoin, urlparse
    base = urlparse(base_url)
    links = re.findall(r'href=["\']((?:https?://[^"\'>\s]+|/[^"\'>\s]*))["\'\s]', html or '', re.IGNORECASE)
    candidates = []
    for l in links:
        full = urljoin(base_url, l)
        p = urlparse(full)
        if p.netloc != base.netloc:
            continue
        path = p.path.lower()
        score = 0
        for kw in ('contato', 'contact', 'unidade', 'loja', 'whatsapp', 'fale', 'atend', 'onde', 'endereco'):
            if kw in path:
                score += 2
        if score > 0:
            candidates.append((score, full))
    candidates.sort(key=lambda x: -x[0])
    return [c[1] for c in candidates[:3]]


async def crawl(url):
    config = CrawlerRunConfig(word_count_threshold=5, delay_before_return_html=2.0)
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)
        md = (result.markdown or "") if result.success else ""
        html = (result.html or "") if result.success else ""

        wa_raw = extract_wa(html, md)
        ig_username = extract_ig(md)
        email = extract_email(md, html)
        fb_url = extract_fb(md)

        # Se não achou WA na home, tenta subpáginas de contato
        if not wa_raw and result.success:
            sublinks = extract_links(html, url)
            for sub in sublinks:
                if sub == url:
                    continue
                try:
                    sub_result = await crawler.arun(url=sub, config=config)
                except Exception:
                    continue
                if sub_result.success:
                    sub_md = sub_result.markdown or ""
                    sub_html = sub_result.html or ""
                    if not wa_raw:
                        wa_raw = extract_wa(sub_html, sub_md)
                    if not ig_username:
                        ig_username = extract_ig(sub_md)
                    if not email:
                        email = extract_email(sub_md, sub_html)
                    if not fb_url:
                        fb_url = extract_fb(sub_md)
                    md += "\n" + sub_md[:1000]
                if wa_raw and email:
                    break

        # Sinaliza erro de DNS / fetch para o caller distinguir de "site sem nada"
        result_obj = {
            "markdown": md[:3000],
            "whatsapp": wa_raw,
            "instagram_username": ig_username,
            "email": email,
            "facebook_url": fb_url,
            "fetch_ok": bool(result.success),
        }
        if not result.success:
            result_obj["fetch_error"] = (result.error_message or "unknown")[:200]

        print(json.dumps(result_obj, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "url required"}))
        sys.exit(1)
    asyncio.run(crawl(sys.argv[1]))
