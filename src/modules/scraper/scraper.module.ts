import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScraperService } from './scraper.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'enrichment_queue' }),
    CrmModule,
  ],
  providers: [ScraperService],
  exports: [ScraperService],
})
export class ScraperModule {}
