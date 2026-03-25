import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScraperService } from './scraper.service';

@Processor('scraper_queue')
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(private scraperService: ScraperService) {}

  @Process('run_scrape')
  async handleRunScrape(job: Job) {
    this.logger.log('Processando job de scrape...');
    const total = await this.scraperService.runDailyScrape();
    return { leadsEncontrados: total };
  }
}
