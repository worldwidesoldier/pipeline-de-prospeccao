import { BullModuleOptions } from '@nestjs/bull';
import { config } from '../config/env.config';

export const redisConfig = {
  host: new URL(config.redisUrl).hostname,
  port: parseInt(new URL(config.redisUrl).port || '6379'),
};

export const defaultBullOptions: BullModuleOptions = {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
};

export const QUEUE_NAMES = {
  SCRAPER: 'scraper_queue',
  ENRICHMENT: 'enrichment_queue',
  WA_TEST: 'wa_test_queue',
  SCORING: 'scoring_queue',
  APPROVAL: 'approval_queue',
  OUTREACH: 'outreach_queue',
  FOLLOWUP: 'followup_queue',
} as const;
