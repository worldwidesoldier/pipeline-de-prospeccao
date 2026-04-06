import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ScraperService } from './scraper.service';

@Processor('scraper_queue')
export class ScraperProcessor {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(private scraperService: ScraperService) {}

  @Process('run_scrape')
  async handleRunScrape(_job: Job) {
    this.logger.log('Job de scrape ignorado — use o endpoint /api/scraper/trigger');
    return { ok: true };
  }
}
