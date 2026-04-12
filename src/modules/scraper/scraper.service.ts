import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { spawn } from 'child_process';
import { CrmService, ScrapeJobRow } from '../crm/crm.service';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type ScrapeJob = ScrapeJobRow;

const ESTADOS_BRASIL = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará',
  'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão',
  'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará',
  'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro',
  'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima',
  'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins',
];

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);
  // Only holds in-flight jobs for polling in runDailyScrape
  private runningJobs = new Map<string, ScrapeJob>();

  constructor(
    @InjectQueue('enrichment_queue') private enrichmentQueue: Queue,
    private crmService: CrmService,
  ) {}

  async getJobs(): Promise<ScrapeJob[]> {
    return this.crmService.getScrapeJobs();
  }

  async getJob(id: string): Promise<ScrapeJob | undefined> {
    // Check in-flight first for live status, fall back to DB
    if (this.runningJobs.has(id)) return this.runningJobs.get(id);
    return (await this.crmService.getScrapeJobById(id)) ?? undefined;
  }

  async triggerManualScrape(
    query: string,
    max = 30,
    templateId?: string,
    campaignName?: string,
    location?: string,
    niche?: string,
  ): Promise<ScrapeJob> {
    const job: ScrapeJob = {
      id: randomUUID(),
      query,
      campaign_name: campaignName || query,
      location: location || null,
      niche: niche || null,
      status: 'running',
      leads_found: 0,
      leads_new: 0,
      started_at: new Date().toISOString(),
    };
    this.runningJobs.set(job.id, job);
    await this.crmService.createScrapeJob(job);

    // Run async — don't await
    this.runScrapeJob(job, query, max, templateId).catch(err => {
      job.status = 'error';
      job.error = err.message;
      job.finished_at = new Date().toISOString();
      this.logger.error(`Job ${job.id} falhou: ${err.message}`);
      this.crmService.updateScrapeJob(job.id, { status: job.status, error: job.error, finished_at: job.finished_at });
      this.runningJobs.delete(job.id);
    });

    return job;
  }

  private async runScrapeJob(job: ScrapeJob, query: string, max: number, templateId?: string) {
    try {
      // Suporta múltiplas queries separadas por quebra de linha
      const queries = query.split('\n').map(q => q.trim()).filter(Boolean);
      this.logger.log(`Job ${job.id}: ${queries.length} quer${queries.length > 1 ? 'ies' : 'y'}, max=${max} por query — enviando em lote único ao Outscraper`);

      // Envia TODAS as queries em um único subprocess → uma API call ao Outscraper
      // O Outscraper processa as queries em paralelo, muito mais rápido e sem rate limit
      const leads = await this.runScraper(queries.join('\n'), max);
      const totalFound = leads.length;

      this.logger.log(`Job ${job.id}: ${totalFound} resultados recebidos — processando dedup e salvando`);

      let newCount = 0;
      for (const lead of leads) {
        const exists = lead.nome
          ? await this.crmService.leadExists(lead.nome, lead.estado || '', lead.telefone_google)
          : false;
        if (exists) continue;

        const saved = await this.crmService.createLead({ ...lead, status: 'novo', campaign_id: job.id });
        if (saved) {
          await this.enrichmentQueue.add(
            'enrich_lead',
            { leadId: saved.id, templateId },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
          );
          newCount++;
        }
      }

      // Atualiza o contador no final
      job.leads_found = totalFound;
      job.leads_new = newCount;

      job.status = 'done';
      job.finished_at = new Date().toISOString();
      this.logger.log(`Job ${job.id} finalizado: ${totalFound} encontrados, ${newCount} novos (${queries.length} queries em lote)`);
      await this.crmService.updateScrapeJob(job.id, {
        status: job.status,
        leads_found: totalFound,
        leads_new: newCount,
        finished_at: job.finished_at,
      });
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.finished_at = new Date().toISOString();
      await this.crmService.updateScrapeJob(job.id, { status: job.status, error: job.error, finished_at: job.finished_at });
      throw err;
    } finally {
      this.runningJobs.delete(job.id);
    }
  }

  private async runScraper(query: string, max: number): Promise<any[]> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../../outscraper_scraper.py');
      const proc = spawn('python3', [scriptPath, query, '--max', String(max)], {
        timeout: 600000, // 10 min — lotes grandes de queries podem levar mais tempo
      });

      let output = '';
      let errOutput = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { errOutput += d.toString(); });

      proc.on('close', () => {
        try {
          const result = JSON.parse(output.trim());
          if (result.error) {
            this.logger.warn(`Scraper error: ${result.error}`);
            resolve([]);
          } else {
            resolve(Array.isArray(result) ? result : []);
          }
        } catch {
          this.logger.error(`Parse error. stderr: ${errOutput.substring(0, 500)}`);
          resolve([]);
        }
      });

      proc.on('error', err => {
        this.logger.error(`Spawn error: ${err.message}`);
        resolve([]);
      });
    });
  }

}

