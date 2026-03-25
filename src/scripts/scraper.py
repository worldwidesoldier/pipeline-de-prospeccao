#!/usr/bin/env python3
import asyncio
import sys
import json
import re
from urllib.parse import quote

async def scrape_google_maps(estado: str):
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig

        query = f"casa de câmbio {estado}"
        url = f"https://www.google.com/maps/search/{quote(query)}"

        browser_config = BrowserConfig(
            headless=True,
            verbose=False,
        )

        crawler_config = CrawlerRunConfig(
            wait_for="css:.Nv2PK",
            js_code="""
                // Scroll para carregar mais resultados
                const panel = document.querySelector('[role="feed"]');
                if (panel) {
                    for (let i = 0; i < 5; i++) {
                        panel.scrollTop += 2000;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            """,
            delay_before_return_html=3.0,
        )

        results = []

        async with AsyncWebCrawler(config=browser_config) as crawler:
            result = await crawler.arun(url=url, config=crawler_config)

            if result.success:
                # Extrair dados do markdown/HTML
                markdown = result.markdown or ""

                # Tentar extrair dados estruturados do HTML
                html = result.html or ""

                # Parse básico para extrair informações
                # Cada resultado do Maps tem padrão identificável
                entries = re.findall(
                    r'(?:Casa de Câmbio|Câmbio|Exchange)[^\n]*\n([^\n]+)\n([^\n]*)',
                    markdown, re.IGNORECASE
                )

                # Extrair telefones
                telefones = re.findall(r'(\+?55\s?(?:\d{2})\s?(?:9\d{4}|\d{4})-?\d{4})', markdown)

                # Extrair nomes de estabelecimentos (padrão Maps)
                nomes = re.findall(r'\*\*([^*]+(?:câmbio|exchange|cambio)[^*]*)\*\*', markdown, re.IGNORECASE)

                # Extrair ratings
                ratings = re.findall(r'(\d+[.,]\d+)\s*\((\d+)\)', markdown)

                # Montar resultados básicos
                for i, nome in enumerate(nomes[:50]):
                    entry = {
                        "nome": nome.strip(),
                        "telefone_google": telefones[i] if i < len(telefones) else None,
                        "site": None,
                        "endereco": None,
                        "cidade": estado.split()[-1] if estado else None,
                        "estado": estado,
                        "google_rating": float(ratings[i][0].replace(',', '.')) if i < len(ratings) else None,
                        "google_reviews": int(ratings[i][1]) if i < len(ratings) else None,
                    }
                    results.append(entry)

                # Se não achou por regex, tentar pelo markdown estruturado
                if not results:
                    # Fallback: criar entrada genérica para indicar que rodou mas não parseou
                    lines = [l.strip() for l in markdown.split('\n') if l.strip() and len(l.strip()) > 5]
                    for i in range(min(10, len(lines))):
                        if any(word in lines[i].lower() for word in ['câmbio', 'cambio', 'exchange', 'money']):
                            results.append({
                                "nome": lines[i],
                                "telefone_google": None,
                                "site": None,
                                "endereco": None,
                                "cidade": None,
                                "estado": estado,
                                "google_rating": None,
                                "google_reviews": None,
                            })

        print(json.dumps(results, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))

if __name__ == "__main__":
    estado = sys.argv[1] if len(sys.argv) > 1 else "Santa Catarina"
    asyncio.run(scrape_google_maps(estado))
