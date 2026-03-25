import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FollowupService } from './followup.service';
import { FollowupProcessor } from './followup.processor';
import { CrmModule } from '../crm/crm.module';
import { OutreachModule } from '../outreach/outreach.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'followup_queue' }),
    CrmModule,
    forwardRef(() => OutreachModule),
    TelegramModule,
  ],
  providers: [FollowupService, FollowupProcessor],
  exports: [FollowupService],
})
export class FollowupModule {}
