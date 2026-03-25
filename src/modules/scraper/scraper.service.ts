import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bullmq';
import { spawn } from 'child_process';
import { Cron } from '@nestjs/schedule';
import { CrmService } from '../crm/crm.service';
import * as path from 'path';

const ESTADOS_BRASIL = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará',
  'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão',
  'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará',
  'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro',
  'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima',
  'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'
];

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    @InjectQueue('enrichment_queue') private enrichmentQueue: Queue,
    private crmService: CrmService,
  ) {}

  @Cron('0 8 * * 1-5')
  async runDailyScrape() {
    this.logger.log('Iniciando scrape diário de casas de câmbio...');
    let totalLeads = 0;

    for (const estado of ESTADOS_BRASIL) {
      try {
        this.logger.log(`Scraping: ${estado}`);
        const leads = await this.scrapeEstado(estado);

        for (const lead of leads) {
          // Verifica se lead já existe (por nome + estado)
          const exists = await this.crmService.leadExists(lead.nome, lead.estado);
          if (exists) continue;

          // Salva no Supabase
          const savedLead = await this.crmService.createLead({
            ...lead,
            status: 'novo',
          });

          if (savedLead) {
            // Joga na fila de enrichment
            await this.enrichmentQueue.add('enrich_lead', { leadId: savedLead.id }, {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            });
            totalLeads++;
          }
        }

        // Pausa entre estados para não sobrecarregar
        await new Promise(r => setTimeout(r, 3000));
      } catch (err) {
        this.logger.error(`Erro no estado ${estado}: ${err.message}`);
      }
    }

    this.logger.log(`Scrape diário finalizado. ${totalLeads} novos leads encontrados.`);
    return totalLeads;
  }

  private async scrapeEstado(estado: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../scripts/scraper.py');
      const proc = spawn('python3', [scriptPath, estado], {
        timeout: 120000, // 2 minutos por estado
      });

      let output = '';
      let errorOutput = '';

      proc.stdout.on('data', (data) => { output += data.toString(); });
      proc.stderr.on('data', (data) => { errorOutput += data.toString(); });

      proc.on('close', (code) => {
        try {
          const result = JSON.parse(output.trim());
          if (result.error) {
            this.logger.warn(`Scraper retornou erro para ${estado}: ${result.error}`);
            resolve([]);
          } else {
            resolve(Array.isArray(result) ? result : []);
          }
        } catch (e) {
          this.logger.error(`Falha ao parsear output do scraper para ${estado}: ${e.message}`);
          resolve([]);
        }
      });

      proc.on('error', (err) => {
        this.logger.error(`Erro ao executar scraper.py: ${err.message}`);
        resolve([]);
      });
    });
  }
}
