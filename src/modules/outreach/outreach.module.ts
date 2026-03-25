import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OutreachService } from './outreach.service';
import { OutreachProcessor } from './outreach.processor';
import { CrmModule } from '../crm/crm.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'outreach_queue' }),
    BullModule.registerQueue({ name: 'followup_queue' }),
    CrmModule,
    TelegramModule,
  ],
  providers: [OutreachService, OutreachProcessor],
  exports: [OutreachService],
})
export class OutreachModule {}
