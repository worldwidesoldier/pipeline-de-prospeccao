import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export type MotorStatus = 'running' | 'paused';

const MOTOR_STATUS_KEY  = 'wa_motor:status';
const LAST_SENT_AT_KEY  = 'wa_motor:last_sent_at';
const PAUSED_AT_KEY     = 'wa_motor:paused_at';

@Injectable()
export class MotorService {
  private readonly logger = new Logger(MotorService.name);
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: false,
      enableOfflineQueue: true,
    });
    this.redis.on('error', err => this.logger.error('Redis MotorService error:', err.message));
  }

  // ── Motor state ──────────────────────────────────────────────

  async getStatus(): Promise<MotorStatus> {
    const val = await this.redis.get(MOTOR_STATUS_KEY);
    return (val as MotorStatus) || 'running';
  }

  async isPaused(): Promise<boolean> {
    return (await this.getStatus()) === 'paused';
  }

  async pause(): Promise<void> {
    await this.redis.set(MOTOR_STATUS_KEY, 'paused');
    await this.redis.set(PAUSED_AT_KEY, new Date().toISOString());
    this.logger.warn('Motor de wa_test PAUSADO');
  }

  async resume(): Promise<void> {
    await this.redis.set(MOTOR_STATUS_KEY, 'running');
    await this.redis.del(PAUSED_AT_KEY);
    this.logger.log('Motor de wa_test RETOMADO');
  }

  // ── Rate limit persistence ───────────────────────────────────

  async getLastSentAt(): Promise<number> {
    const val = await this.redis.get(LAST_SENT_AT_KEY);
    return val ? parseInt(val, 10) : 0;
  }

  async setLastSentAt(ts: number): Promise<void> {
    // TTL de 24h — não precisa manter além disso
    await this.redis.set(LAST_SENT_AT_KEY, ts.toString(), 'EX', 86400);
  }

  // ── Stats snapshot ───────────────────────────────────────────

  async getSnapshot(pendingCount: number, todayCount: number, maxDaily: number) {
    const status = await this.getStatus();
    const lastSentAt = await this.getLastSentAt();
    const pausedAt   = await this.redis.get(PAUSED_AT_KEY);

    const minDelay   = 7 * 60 * 1000;
    const nextSendAt = lastSentAt ? new Date(lastSentAt + minDelay).toISOString() : null;

    return {
      status,
      pendingCount,
      todayCount,
      maxDaily,
      remaining: Math.max(0, maxDaily - todayCount),
      lastSentAt: lastSentAt ? new Date(lastSentAt).toISOString() : null,
      nextSendAt,
      pausedAt,
    };
  }
}
