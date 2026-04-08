import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { ActivityService } from '../activity/activity.service';
import { spawn } from 'child_process';
import * as path from 'path';
import OpenAI from 'openai';

@Injectable()
export class EnricherService {
  private readonly logger = new Logger(EnricherService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectQueue('intel_queue') private intelQueue: Queue,
    private crmService: CrmService,
    private activity: ActivityService,
  ) {}

  async enrichLead(leadId: string, templateId?: string) {
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) {
      this.logger.warn(`Lead ${leadId} não encontrado`);
      return;
    }

    this.logger.log(`Enriquecendo lead: ${lead.nome}`);

    const enrichmentData: any = {
      lead_id: leadId,
      tem_site: false,
      site_score: 0,
      site_resumo: null,
      ig_username: null,
      ig_followers: null,
      ig_ultimo_post_dias: null,
      ig_ativo: false,
      ig_bio: null,
    };

    let whatsapp: string | null = null;
    let whatsappSource: string = 'unknown';

    let igUsernameFromSite: string | null = null;

    // 1. Enriquecer site se existir
    if (lead.site) {
      try {
        const siteData = await this.crawlSite(lead.site);
        enrichmentData.tem_site = true;
        enrichmentData.site_score = siteData.score;
        enrichmentData.site_resumo = siteData.resumo;

        if (siteData.whatsapp) {
          whatsapp = siteData.whatsapp;
          whatsappSource = 'site';
        }
        if (siteData.instagramUsername) {
          igUsernameFromSite = siteData.instagramUsername;
          this.logger.log(`Instagram encontrado no site: @${igUsernameFromSite}`);
        }
        if (siteData.email) {
          enrichmentData.email = siteData.email;
          this.logger.log(`Email encontrado no site: ${siteData.email}`);
        }
        if (siteData.facebookUrl) {
          enrichmentData.facebook_url = siteData.facebookUrl;
        }
      } catch (e) {
        this.logger.warn(`Erro ao crawlar site ${lead.site}: ${e.message}`);
      }
    }

    // 2. Enriquecer Instagram — usar do site se não veio do scraper
    const igSource = lead.instagram || (igUsernameFromSite ? `https://instagram.com/${igUsernameFromSite}` : null);
    if (igSource) {
      try {
        const igUsername = this.extractInstagramUsername(igSource);
        if (igUsername) {
          const igData = await this.getInstagramData(igUsername);
          enrichmentData.ig_username = igData.username;
          enrichmentData.ig_followers = igData.followers;
          enrichmentData.ig_ultimo_post_dias = igData.ultimo_post_dias;
          enrichmentData.ig_ativo = igData.ativo;
          enrichmentData.ig_bio = igData.bio;

          // Pegar WhatsApp da bio do IG se ainda não tem
          if (!whatsapp && (igData.whatsapp_na_bio || igData.telefone_na_bio)) {
            whatsapp = igData.whatsapp_na_bio || igData.telefone_na_bio;
            whatsappSource = 'instagram_bio';
          }
        }
      } catch (e) {
        this.logger.warn(`Erro ao buscar Instagram: ${e.message}`);
      }
    }

    // 3. Tentar usar telefone do Google Maps como WhatsApp (último recurso)
    let temNumeroFixo = false;
    if (!whatsapp && lead.telefone_google) {
      const cleaned = lead.telefone_google.replace(/[^\d+]/g, '');
      if (cleaned.match(/^(\+?55)?(\d{2})(9\d{8})$/)) {
        // Celular → pode ser WhatsApp
        whatsapp = cleaned;
        whatsappSource = 'google';
      } else if (cleaned.match(/^(\+?55)?(\d{2})(\d{8})$/)) {
        // Número fixo (8 dígitos após DDD) → guardar para contato por ligação
        temNumeroFixo = true;
        this.logger.log(`Lead ${lead.nome} tem número fixo (${cleaned}), sem WhatsApp`);
      }
    }

    // 4. Salvar enrichment
    await this.crmService.saveEnrichment(enrichmentData);

    // 5. Atualizar lead com WhatsApp encontrado + email/facebook do site
    const updateData: any = {
      whatsapp: whatsapp,
      whatsapp_source: whatsappSource,
      ...(enrichmentData.email && { email: enrichmentData.email }),
      ...(enrichmentData.facebook_url && { facebook_url: enrichmentData.facebook_url }),
    };

    // 6. Definir status e rotear para intel_queue (sempre)
    if (whatsapp) {
      updateData.status = 'enriched';
      this.activity.log('enriched', `WA encontrado via ${whatsappSource}`, lead.nome);
    } else if (temNumeroFixo) {
      updateData.status = 'sem_whatsapp_fixo';
    } else {
      updateData.status = 'sem_whatsapp';
    }

    await this.crmService.updateLead(leadId, updateData);

    // Intel roda para todos: busca reviews, emails e contatos via Outscraper
    // Depois do intel o IntelProcessor roteia para wa_test ou scoring conforme o status
    await this.intelQueue.add('run_intel', { leadId, templateId }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    });
    this.logger.log(`Lead ${lead.nome} (${updateData.status}) → intel_queue`);
  }

  private async crawlSite(url: string): Promise<{ score: number; resumo: string; whatsapp: string | null; instagramUsername: string | null; email: string | null; facebookUrl: string | null }> {
    // Usar Crawl4AI via subprocess Python
    return new Promise((resolve) => {
      const script = `
import asyncio
import sys
import json
import re
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig

def extract_wa(md):
    # 1. wa.me/NUMBER (most reliable)
    m = re.search(r'wa\\.me/([0-9]{10,14})', md, re.IGNORECASE)
    if m: return m.group(1)
    # 2. whatsapp.com/send?phone=NUMBER or api.whatsapp.com/send?phone=NUMBER
    m = re.search(r'whatsapp\\.com/send[?&]phone=([0-9]{10,14})', md, re.IGNORECASE)
    if m: return m.group(1)
    # 3. api.whatsapp.com/send?phone=NUMBER
    m = re.search(r'api\\.whatsapp\\.com/send[?&]phone=([0-9]{10,14})', md, re.IGNORECASE)
    if m: return m.group(1)
    # 4. keyword context: whatsapp/zap/wpp near number
    m = re.search(r'(?:whatsapp|\\bwpp\\b|\\bzap\\b)[^0-9+]{0,30}(\\+?[0-9]{2}[\\s.-]?[0-9]{2}[\\s.-]?9[0-9]{4}[\\s.-]?[0-9]{4})', md, re.IGNORECASE)
    if m: return m.group(1)
    # 5. Brazilian mobile number with 55 country code
    m = re.search(r'(\\+?55[\\s.-]?[0-9]{2}[\\s.-]?9[0-9]{4}[\\s.-]?[0-9]{4})', md)
    if m: return m.group(1)
    return None

def extract_ig(md):
    ig = re.search(r'instagram\\.com/([^/?\\s"\'\\)\\]<>]+)', md, re.IGNORECASE)
    username = ig.group(1).rstrip('/') if ig else None
    if username in ('p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'share', 'about', 'blog', 'help'):
        return None
    return username

def extract_email(md, html):
    # 1. mailto: links (most reliable)
    m = re.search(r'mailto:([a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,})', html or '', re.IGNORECASE)
    if m: return m.group(1).lower()
    # 2. plain text email in markdown
    m = re.search(r'\\b([a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,})\\b', md)
    if m:
        email = m.group(1).lower()
        # Skip image/asset emails
        if not re.search(r'\\.(png|jpg|gif|svg|webp|woff|css|js)$', email):
            return email
    return None

def extract_fb(md):
    m = re.search(r'(https?://(?:www\\.)?facebook\\.com/[^/?\\s"\'\\)\\]<>]+)', md, re.IGNORECASE)
    if not m: return None
    url = m.group(1).rstrip('/')
    # Skip generic FB pages
    skip = ('facebook.com/sharer', 'facebook.com/share', 'facebook.com/dialog', 'facebook.com/plugins')
    if any(s in url for s in skip): return None
    return url

def extract_links(html, base_url):
    """Extract internal links that look like contact/unit pages."""
    from urllib.parse import urljoin, urlparse
    base = urlparse(base_url)
    links = re.findall(r'href=["\\']((?:https?://[^"\\' >]+|/[^"\\' >]*))["\\'\\s]', html or '', re.IGNORECASE)
    candidates = []
    for l in links:
        full = urljoin(base_url, l)
        p = urlparse(full)
        if p.netloc != base.netloc:
            continue
        path = p.path.lower()
        # Prioritize contact/unit pages
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

        wa_raw = extract_wa(md)
        ig_username = extract_ig(md)
        email = extract_email(md, html)
        fb_url = extract_fb(md)

        # If homepage is sparse (< 400 chars), try subpages
        if len(md.strip()) < 400 and result.success:
            sublinks = extract_links(html, url)
            for sub in sublinks:
                if sub == url:
                    continue
                sub_result = await crawler.arun(url=sub, config=config)
                if sub_result.success:
                    sub_md = sub_result.markdown or ""
                    sub_html = sub_result.html or ""
                    if not wa_raw:
                        wa_raw = extract_wa(sub_md)
                    if not ig_username:
                        ig_username = extract_ig(sub_md)
                    if not email:
                        email = extract_email(sub_md, sub_html)
                    if not fb_url:
                        fb_url = extract_fb(sub_md)
                    md += "\\n" + sub_md[:1000]
                if wa_raw and email:
                    break

        print(json.dumps({
            "markdown": md[:3000],
            "whatsapp": re.sub(r'[^\\d+]', '', wa_raw) if wa_raw else None,
            "instagram_username": ig_username,
            "email": email,
            "facebook_url": fb_url,
        }))

asyncio.run(crawl(sys.argv[1]))
`;

      const proc = spawn('python3', ['-c', script, url], { timeout: 60000 });
      let output = '';
      proc.stdout.on('data', d => output += d.toString());
      proc.on('close', async () => {
        try {
          // crawl4ai prints progress lines to stdout — find last valid JSON line
          const lines = output.trim().split('\n').reverse();
          let data: any = { markdown: '', whatsapp: null };
          for (const line of lines) {
            try { data = JSON.parse(line); break; } catch {}
          }
          const markdown = data.markdown || '';

          // Usar OpenAI para analisar o site
          let score = 0;
          let resumo = 'Site não analisado';

          if (markdown.length > 50) {
            try {
              const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{
                  role: 'user',
                  content: `Analise este conteúdo de site de casa de câmbio e responda APENAS em JSON com: score (0-100, onde 100=tem preços atualizados+WhatsApp+horário de funcionamento), resumo (máximo 100 chars descrevendo o site). Conteúdo: ${markdown.substring(0, 1500)}`,
                }],
                response_format: { type: 'json_object' },
              });
              const parsed = JSON.parse(response.choices[0].message.content || '{}');
              score = parsed.score || 30;
              resumo = parsed.resumo || 'Site analisado';
            } catch {
              score = 30;
              resumo = 'Site existe com conteúdo básico';
            }
          }

          resolve({ score, resumo, whatsapp: data.whatsapp, instagramUsername: data.instagram_username || null, email: data.email || null, facebookUrl: data.facebook_url || null });
        } catch {
          resolve({ score: 0, resumo: 'Erro ao analisar site', whatsapp: null, instagramUsername: null, email: null, facebookUrl: null });
        }
      });
      proc.on('error', () => resolve({ score: 0, resumo: 'Erro ao acessar site', whatsapp: null, instagramUsername: null, email: null, facebookUrl: null }));
    });
  }

  private async getInstagramData(username: string): Promise<any> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/instagram.py');
      const proc = spawn('python3', [scriptPath, username], { timeout: 60000 });
      let output = '';
      proc.stdout.on('data', d => output += d.toString());
      proc.on('close', () => {
        try {
          resolve(JSON.parse(output.trim()));
        } catch {
          resolve({ error: 'parse_error' });
        }
      });
      proc.on('error', () => resolve({ error: 'subprocess_error' }));
    });
  }

  private extractInstagramUsername(igUrl: string): string | null {
    const match = igUrl.match(/instagram\.com\/([^/?]+)/);
    if (match) return match[1];
    if (!igUrl.includes('/') && !igUrl.includes('@')) return igUrl.replace('@', '');
    return null;
  }
}
