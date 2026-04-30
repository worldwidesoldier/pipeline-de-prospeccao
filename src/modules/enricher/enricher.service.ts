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

          // Pegar WhatsApp da bio do IG, external_url ou business_phone se ainda não tem
          if (!whatsapp && (igData.whatsapp_na_bio || igData.telefone_na_bio || igData.business_phone)) {
            whatsapp = igData.whatsapp_na_bio || igData.telefone_na_bio || igData.business_phone;
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
    // Crawl4AI via script Python externo (evita problemas de escape com -c)
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../scripts/site_crawler.py');
      const proc = spawn('python3', [scriptPath, url], { timeout: 60000 });
      let output = '';
      let stderr = '';
      proc.stdout.on('data', d => output += d.toString());
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', async () => {
        try {
          // crawl4ai imprime linhas de progresso no stdout — pegar a última linha JSON válida
          const lines = output.trim().split('\n').reverse();
          let data: any = { markdown: '', whatsapp: null };
          for (const line of lines) {
            try { data = JSON.parse(line); break; } catch {}
          }
          if (!data.fetch_ok && stderr) {
            this.logger.warn(`Site crawl ${url}: fetch falhou — ${(data.fetch_error || stderr).substring(0, 150)}`);
          }
          const markdown = data.markdown || '';

          // Usar OpenAI para analisar o site
          let score = 0;
          let resumo = 'Site não analisado';

          let whatsapp = data.whatsapp || null;

          if (markdown.length > 50) {
            try {
              const needsWa = !whatsapp;
              const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{
                  role: 'user',
                  content: `Analise este conteúdo de site de casa de câmbio e responda APENAS em JSON com:
- score (0-100, onde 100=tem preços atualizados+WhatsApp+horário de funcionamento)
- resumo (máximo 100 chars descrevendo o site)
${needsWa ? '- whatsapp: número de WhatsApp encontrado no conteúdo (apenas dígitos, sem formatação), ou null se não houver. IMPORTANTE: WhatsApp Business aceita tanto celular (9 dígitos: DDD + 9XXXX-XXXX) quanto número fixo (8 dígitos: DDD + XXXX-XXXX). Procure qualquer número próximo a ícone, imagem ou texto de "WhatsApp", "WPP" ou "Zap". Ex: "(55) 3028-8882" → "5530288882", "(51) 9 9999-1234" → "5199991234".' : '- whatsapp: null'}
Conteúdo: ${markdown.substring(0, 2000)}`,
                }],
                response_format: { type: 'json_object' },
              });
              const parsed = JSON.parse(response.choices[0].message.content || '{}');
              score = parsed.score || 30;
              resumo = parsed.resumo || 'Site analisado';
              if (needsWa && parsed.whatsapp) {
                whatsapp = String(parsed.whatsapp).replace(/\D/g, '');
                // Validar: número BR com DDD (10-11 dígitos) ou com código 55 (12-13 dígitos)
                // Aceita celular (9XXXXXXXX) e fixo (XXXXXXXX) — WA Business roda em ambos
                if (!/^(55)?\d{10,11}$/.test(whatsapp)) whatsapp = null;
              }
            } catch {
              score = 30;
              resumo = 'Site existe com conteúdo básico';
            }
          }

          resolve({ score, resumo, whatsapp, instagramUsername: data.instagram_username || null, email: data.email || null, facebookUrl: data.facebook_url || null });
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
