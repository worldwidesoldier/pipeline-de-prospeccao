import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

import { ActivityModule } from './modules/activity/activity.module';
import { MotorModule } from './modules/motor/motor.module';
import { CrmModule } from './modules/crm/crm.module';
import { ScraperModule } from './modules/scraper/scraper.module';
import { EnricherModule } from './modules/enricher/enricher.module';
import { IntelModule } from './modules/intel/intel.module';
import { WaTesterModule } from './modules/wa-tester/wa-tester.module';
import { ScorerModule } from './modules/scorer/scorer.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { OutreachModule } from './modules/outreach/outreach.module';
import { FollowupModule } from './modules/followup/followup.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisHost = (() => {
  try { return new URL(redisUrl).hostname; } catch { return 'localhost'; }
})();
const redisPort = (() => {
  try { return parseInt(new URL(redisUrl).port || '6379'); } catch { return 6379; }
})();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: { host: redisHost, port: redisPort },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),
    ActivityModule,
    MotorModule,
    CrmModule,
    ScraperModule,
    EnricherModule,
    IntelModule,
    WaTesterModule,
    ScorerModule,
    ApprovalModule,
    OutreachModule,
    FollowupModule,
    DashboardModule,
  ],
})
export class AppModule {}
