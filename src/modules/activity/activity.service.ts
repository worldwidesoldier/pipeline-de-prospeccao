import { Injectable } from '@nestjs/common';

export type ActivityType = 'sending' | 'sent' | 'responded' | 'bot' | 'no_response' | 'enriched' | 'error';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  message: string;
  lead_nome?: string;
  timestamp: string;
}

@Injectable()
export class ActivityService {
  private events: ActivityEvent[] = [];
  private readonly MAX = 100;

  log(type: ActivityType, message: string, lead_nome?: string) {
    this.events.unshift({
      id: Math.random().toString(36).slice(2, 9),
      type,
      message,
      lead_nome,
      timestamp: new Date().toISOString(),
    });
    if (this.events.length > this.MAX) this.events.length = this.MAX;
  }

  getRecent(limit = 50): ActivityEvent[] {
    return this.events.slice(0, limit);
  }
}
