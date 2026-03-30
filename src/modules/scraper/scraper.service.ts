import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { spawn } from 'child_process';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface ScrapeJob {
  id: string;
  query: string;
  status: 'running' | 'done' | 'error';
  leads_found: number;
  leads_new: number;
  started_at: string;
  finished_at?: string;
  error?: string;
}

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
  private jobs = new Map<string, ScrapeJob>();

  constructor(
    @InjectQueue('enrichment_queue') private enrichmentQueue: Queue,
    private crmService: CrmService,
  ) {}

  getJobs(): ScrapeJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, 20);
  }

  getJob(id: string): ScrapeJob | undefined {
    return this.jobs.get(id);
  }

  async triggerManualScrape(query: string, max = 30): Promise<ScrapeJob> {
    const job: ScrapeJob = {
      id: randomUUID(),
      query,
      status: 'running',
      leads_found: 0,
      leads_new: 0,
      started_at: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);

    // Run async — don't await
    this.runScrapeJob(job, query, max).catch(err => {
      job.status = 'error';
      job.error = err.message;
      job.finished_at = new Date().toISOString();
      this.logger.error(`Job ${job.id} falhou: ${err.message}`);
    });

    return job;
  }

  private async runScrapeJob(job: ScrapeJob, query: string, max: number) {
    try {
      this.logger.log(`Job ${job.id}: scraping "${query}" max=${max}`);
      const leads = await this.runScraper(query, max);
      job.leads_found = leads.length;

      let newCount = 0;
      for (const lead of leads) {
        const exists = lead.nome
          ? await this.crmService.leadExists(lead.nome, lead.estado || '')
          : false;
        if (exists) continue;

        const saved = await this.crmService.createLead({ ...lead, status: 'novo' });
        if (saved) {
          await this.enrichmentQueue.add(
            'enrich_lead',
            { leadId: saved.id },
            { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
          );
          newCount++;
        }
      }

      job.leads_new = newCount;
      job.status = 'done';
      job.finished_at = new Date().toISOString();
      this.logger.log(`Job ${job.id} finalizado: ${leads.length} encontrados, ${newCount} novos`);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.finished_at = new Date().toISOString();
      throw err;
    }
  }

  private async runScraper(query: string, max: number): Promise<any[]> {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '../../../src/scripts/scraper.py');
      const proc = spawn('python3', [scriptPath, query, '--max', String(max)], {
        timeout: 300000, // 5 min
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

  @Cron('0 8 * * 1-5')
  async runDailyScrape() {
    this.logger.log('Iniciando scrape diário...');
    let total = 0;
    for (const estado of ESTADOS_BRASIL) {
      const job = await this.triggerManualScrape(`casa de câmbio ${estado}`, 30);
      // Wait for job to finish before next state
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const j = this.jobs.get(job.id);
          if (j && j.status !== 'running') { clearInterval(check); resolve(); }
        }, 3000);
      });
      total += this.jobs.get(job.id)?.leads_new || 0;
      await new Promise(r => setTimeout(r, 5000));
    }
    this.logger.log(`Scrape diário finalizado. ${total} novos leads.`);
    return total;
  }
}
