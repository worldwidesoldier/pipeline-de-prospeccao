#!/usr/bin/env python3
"""
Google Maps scraper — Playwright direto, sem regex frágil.
Uso: python3 scraper.py "casa de câmbio São Paulo" --max 30
     python3 scraper.py "https://www.google.com/maps/search/..." --max 30
"""
import asyncio
import sys
import json
import re
import argparse
from urllib.parse import quote


async def scrape(query: str, max_results: int = 30):
    from playwright.async_api import async_playwright

    if query.startswith('http'):
        url = query
    else:
        url = f"https://www.google.com/maps/search/{quote(query)}?hl=pt-BR"

    results = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1366,768',
            ]
        )
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            locale='pt-BR',
            viewport={'width': 1366, 'height': 768},
        )
        # Hide automation signals
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            delete navigator.__proto__.webdriver;
        """)
        page = await context.new_page()

        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=30000)

            # Handle Google consent page ("Antes de ir para o Google Maps")
            try:
                await page.wait_for_selector('button[aria-label*="Aceitar"]', timeout=5000)
                await page.click('button[aria-label*="Aceitar"]')
                await asyncio.sleep(1.5)
            except Exception:
                # No consent page, or already accepted
                pass

            # Wait for results feed
            try:
                await page.wait_for_selector('[role="feed"]', timeout=20000)
            except Exception:
                print(json.dumps({'error': 'Feed não encontrado — possivelmente CAPTCHA ou layout diferente'}), file=sys.stderr)
                print(json.dumps([]))
                await browser.close()
                return

            # Scroll to load results
            for i in range(10):
                count = await page.evaluate("document.querySelectorAll('[role=\"feed\"] > div').length")
                if count >= max_results + 5:
                    break
                await page.evaluate("const f = document.querySelector('[role=\"feed\"]'); if(f) f.scrollTop += 3000;")
                await asyncio.sleep(1.5)
                end = await page.evaluate("!!document.querySelector('.HlvSq')")
                if end:
                    break

            # Extract all cards
            cards = await page.evaluate("""(maxResults) => {
                const results = [];
                const cards = document.querySelectorAll('[role="feed"] > div');
                for (const card of cards) {
                    if (results.length >= maxResults) break;

                    const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall');
                    if (!nameEl) continue;
                    const name = nameEl.textContent.trim();
                    if (!name || name.length < 2) continue;

                    const ratingEl = card.querySelector('.MW4etd');
                    const reviewsEl = card.querySelector('.UY7F9');
                    const link = card.querySelector('a.hfpxzc');

                    const infoItems = Array.from(card.querySelectorAll('.W4Etd, .Io6YT'))
                        .map(el => el.textContent.trim())
                        .filter(t => t && t.length > 2);

                    results.push({
                        nome: name,
                        maps_url: link ? link.href : null,
                        google_rating: ratingEl ? parseFloat(ratingEl.textContent.replace(',', '.')) : null,
                        google_reviews: reviewsEl ? parseInt(reviewsEl.textContent.replace(/[^0-9]/g, '') || '0') : null,
                        endereco_raw: infoItems[0] || null,
                        categoria: infoItems[1] || null,
                    });
                }
                return results;
            }""", max_results)

            # Visit detail pages to get phone + website (batched, 5 at a time)
            async def get_details(place):
                if not place.get('maps_url'):
                    return place
                try:
                    dp = await context.new_page()
                    await dp.goto(place['maps_url'], wait_until='domcontentloaded', timeout=20000)
                    await asyncio.sleep(0.8)
                    details = await dp.evaluate("""() => {
                        let phone = null, website = null, endereco = null, reviews = null;

                        document.querySelectorAll('[data-item-id]').forEach(el => {
                            const id = el.getAttribute('data-item-id') || '';
                            if (id.startsWith('phone:tel:')) phone = id.replace('phone:tel:', '');
                        });

                        const wsEl = document.querySelector('a[data-item-id*="authority"]');
                        if (wsEl) website = wsEl.href;

                        document.querySelectorAll('[data-item-id]').forEach(el => {
                            const id = el.getAttribute('data-item-id') || '';
                            if (id.includes('address') && !endereco) {
                                const t = el.querySelector('.fontBodyMedium, .Io6YT')?.textContent?.trim();
                                if (t) endereco = t;
                            }
                        });

                        // Review count from button aria-label e.g. "543 avaliações"
                        const reviewBtn = document.querySelector('button[aria-label*="avalia"]');
                        if (reviewBtn) {
                            const m = reviewBtn.getAttribute('aria-label').match(/([0-9.,]+)\\s*avalia/);
                            if (m) reviews = parseInt(m[1].replace(/[.,]/g, ''));
                        }

                        return { phone, website, endereco, reviews };
                    }""")
                    await dp.close()
                    place['telefone_google'] = details.get('phone')
                    place['site'] = details.get('website')
                    if details.get('endereco'):
                        place['endereco_raw'] = details['endereco']
                    if details.get('reviews') is not None:
                        place['google_reviews'] = details['reviews']
                except Exception as e:
                    place['telefone_google'] = None
                    place['site'] = None
                return place

            # Process in batches of 5
            enriched = []
            for i in range(0, len(cards), 5):
                batch = cards[i:i+5]
                batch_results = await asyncio.gather(*[get_details(pl) for pl in batch])
                enriched.extend(batch_results)
                await asyncio.sleep(0.5)

            # Parse city/state and clean up
            final = []
            for r in enriched:
                addr = r.get('endereco_raw') or ''
                parts = [pt.strip() for pt in addr.split(',')]
                cidade = None
                estado_str = None
                if len(parts) >= 3:
                    cidade = parts[-2].strip()
                    estado_str = re.sub(r'^\d{5}-?\d{3}', '', parts[-1]).strip().split('-')[0].strip()
                elif len(parts) == 2:
                    cidade = parts[-1].strip()

                phone = r.get('telefone_google')
                if phone:
                    phone = re.sub(r'[^\d+]', '', phone)
                    if not phone.startswith('+'):
                        phone = '+55' + phone if not phone.startswith('55') else '+' + phone

                final.append({
                    'nome': r['nome'],
                    'telefone_google': phone,
                    'site': r.get('site'),
                    'instagram': None,
                    'endereco': addr,
                    'cidade': cidade,
                    'estado': estado_str or (query.split()[-1] if not query.startswith('http') else None),
                    'google_rating': r.get('google_rating'),
                    'google_reviews': r.get('google_reviews') or None,
                })

            results = final

        except Exception as e:
            import traceback
            print(json.dumps({'error': str(e), 'trace': traceback.format_exc()}), file=sys.stderr)
            results = []
        finally:
            await browser.close()

    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('query', help='Search query or Google Maps URL')
    parser.add_argument('--max', type=int, default=30)
    args = parser.parse_args()
    asyncio.run(scrape(args.query, args.max))
