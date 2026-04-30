import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CrmModule } from '../crm/crm.module';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'enrichment_queue' }),
    BullModule.registerQueue({ name: 'mystery_shop_queue' }),
    BullModule.registerQueue({ name: 'social_eng_queue' }),
    CrmModule,
    ScraperModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
