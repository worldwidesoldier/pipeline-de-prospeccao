import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { CrmService } from '../crm/crm.service';
import { spawn } from 'child_process';
import * as path from 'path';

@Processor('intel_queue')
export class IntelProcessor {
  private readonly logger = new Logger(IntelProcessor.name);

  constructor(
    @InjectQueue('wa_test_queue') private waTestQueue: Queue,
    @InjectQueue('scoring_queue') private scoringQueue: Queue,
    private crmService: CrmService,
  ) {}

  @Process('run_intel')
  async handleRunIntel(job: Job<{ leadId: string; templateId?: string }>) {
    const { leadId, templateId } = job.data;
    const lead = await this.crmService.getLeadById(leadId);
    if (!lead) return;

    this.logger.log(`Sales Intel: ${lead.nome} (${lead.status})`);

    // Rodar intel — se falhar, não bloqueia o pipeline
    try {
      await this.runIntelScript(leadId);
      this.logger.log(`Intel OK: ${lead.nome}`);
    } catch (e) {
      this.logger.warn(`Intel falhou para ${lead.nome}: ${e.message} — prosseguindo pipeline`);
    }

    // Rotear baseado no status que o enricher definiu
    if (lead.status === 'enriched') {
      await this.waTestQueue.add('test_whatsapp', { leadId, templateId }, {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30000 },
      });
      this.logger.log(`${lead.nome} → wa_test_queue`);
    } else if (lead.status === 'sem_whatsapp') {
      await this.scoringQueue.add('score_lead', { leadId }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      this.logger.log(`${lead.nome} → scoring_queue (sem WA)`);
    }
    // sem_whatsapp_fixo → para aqui (email disponível no drawer para contato manual)
  }

  private runIntelScript(leadId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '../../../outscraper_intel.py');
      const proc = spawn('python3', [scriptPath, '--lead-id', leadId], {
        timeout: 120000,
      });

      let errOutput = '';
      proc.stderr.on('data', d => { errOutput += d.toString(); });

      proc.on('close', code => {
        if (code !== 0) {
          reject(new Error(`exit ${code}: ${errOutput.substring(0, 300)}`));
        } else {
          resolve();
        }
      });
      proc.on('error', err => reject(err));
    });
  }
}
