import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';

import { CrmModule } from './modules/crm/crm.module';
import { ScraperModule } from './modules/scraper/scraper.module';
import { EnricherModule } from './modules/enricher/enricher.module';
import { WaTesterModule } from './modules/wa-tester/wa-tester.module';
import { ScorerModule } from './modules/scorer/scorer.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { OutreachModule } from './modules/outreach/outreach.module';
import { FollowupModule } from './modules/followup/followup.module';

// Redis config via Colima
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisHost = (() => {
  try { return new URL(redisUrl).hostname; } catch { return 'localhost'; }
})();
const redisPort = (() => {
  try { return parseInt(new URL(redisUrl).port || '6379'); } catch { return 6379; }
})();

@Module({
  imports: [
    // Config global
    ConfigModule.forRoot({ isGlobal: true }),

    // Cron jobs (@Cron decorators)
    ScheduleModule.forRoot(),

    // BullMQ com Redis (Colima)
    BullModule.forRoot({
      redis: { host: redisHost, port: redisPort },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    }),

    // Módulos do sistema (ordem importa para dependências)
    CrmModule,
    ScraperModule,
    EnricherModule,
    WaTesterModule,
    ScorerModule,
    TelegramModule,
    OutreachModule,
    FollowupModule,
  ],
})
export class AppModule {}
