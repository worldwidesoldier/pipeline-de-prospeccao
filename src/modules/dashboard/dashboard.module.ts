import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CrmModule } from '../crm/crm.module';
import { ScraperModule } from '../scraper/scraper.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'outreach_queue' }),
    CrmModule,
    ScraperModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
