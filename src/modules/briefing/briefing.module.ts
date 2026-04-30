import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BriefingService } from './briefing.service';
import { BriefingProcessor } from './briefing.processor';
import { CrmModule } from '../crm/crm.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'briefing_queue' }),
    CrmModule,
    ActivityModule,
  ],
  providers: [BriefingService, BriefingProcessor],
  exports: [BriefingService],
})
export class BriefingModule {}
