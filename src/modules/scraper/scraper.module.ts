import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScraperService } from './scraper.service';
import { ScraperProcessor } from './scraper.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'enrichment_queue' }),
    BullModule.registerQueue({ name: 'scraper_queue' }),
    CrmModule,
  ],
  providers: [ScraperService, ScraperProcessor],
  exports: [ScraperService],
})
export class ScraperModule {}
