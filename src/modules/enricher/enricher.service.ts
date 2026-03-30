import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { spawn } from 'child_process';
import * as path from 'path';
import OpenAI from 'openai';

@Injectable()
export class EnricherService {
  private readonly logger = new Logger(EnricherService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(
    @InjectQueue('wa_test_queue') private waTestQueue: Queue,
    @InjectQueue('scoring_queue') private scoringQueue: Queue,
    private crmService: CrmService,
  ) {}

  async enrichLead(leadId: string) {
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
      } catch (e) {
        this.logger.warn(`Erro ao crawlar site ${lead.site}: ${e.message}`);
      }
    }

    // 2. Enriquecer Instagram se existir
    if (lead.instagram) {
      try {
        const igUsername = this.extractInstagramUsername(lead.instagram);
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
    if (!whatsapp && lead.telefone_google) {
      const cleaned = lead.telefone_google.replace(/[^\d+]/g, '');
      // Só considera WhatsApp se for celular (começa com 9 após o DDD)
      if (cleaned.match(/^(\+?55)?(\d{2})(9\d{8})$/)) {
        whatsapp = cleaned;
        whatsappSource = 'google';
      }
    }

    // 4. Salvar enrichment
    await this.crmService.saveEnrichment(enrichmentData);

    // 5. Atualizar lead com WhatsApp encontrado
    const updateData: any = {
      status: 'enriched',
      whatsapp: whatsapp,
      whatsapp_source: whatsappSource,
    };
    await this.crmService.updateLead(leadId, updateData);

    // 6. Rotear para próxima fila
    if (whatsapp && whatsappSource !== 'unknown') {
      await this.waTestQueue.add('test_whatsapp', { leadId }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
      });
      this.logger.log(`Lead ${lead.nome} → wa_test_queue (${whatsappSource})`);
    } else {
      await this.scoringQueue.add('score_lead', { leadId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      this.logger.log(`Lead ${lead.nome} → scoring_queue (sem WhatsApp)`);
    }
  }

  private async crawlSite(url: string): Promise<{ score: number; resumo: string; whatsapp: string | null }> {
    // Usar Crawl4AI via subprocess Python
    return new Promise((resolve) => {
      const script = `
import asyncio
import sys
import json
import re
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig

async def crawl(url):
    config = CrawlerRunConfig(word_count_threshold=10, delay_before_return_html=2.0)
    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=config)
        if result.success:
            md = result.markdown or ""
            # Busca WhatsApp
            wa = re.search(r'(?:wa\\.me/|whatsapp|zap)[^0-9+]*(\\+?[0-9]{10,14})', md, re.IGNORECASE)
            phone = re.search(r'(\\+?55\\s?[0-9]{2}\\s?9[0-9]{4}[- ]?[0-9]{4})', md)
            print(json.dumps({
                "markdown": md[:3000],
                "whatsapp": re.sub(r'[^\\d+]', '', wa.group(1)) if wa else (re.sub(r'[^\\d+]', '', phone.group(1)) if phone else None)
            }))
        else:
            print(json.dumps({"markdown": "", "whatsapp": None}))

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

          resolve({ score, resumo, whatsapp: data.whatsapp });
        } catch {
          resolve({ score: 0, resumo: 'Erro ao analisar site', whatsapp: null });
        }
      });
      proc.on('error', () => resolve({ score: 0, resumo: 'Erro ao acessar site', whatsapp: null }));
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
