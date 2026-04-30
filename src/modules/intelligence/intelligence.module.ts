import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IntelligenceService } from './intelligence.service';
import { IntelligenceProcessor } from './intelligence.processor';
import { CrmModule } from '../crm/crm.module';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'intelligence_queue' }),
    BullModule.registerQueue({ name: 'social_eng_queue' }),
    CrmModule,
    ActivityModule,
  ],
  providers: [IntelligenceService, IntelligenceProcessor],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}
