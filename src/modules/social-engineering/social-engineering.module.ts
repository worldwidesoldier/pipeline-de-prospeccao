import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SocialEngineeringService } from './social-engineering.service';
import { SocialEngineeringProcessor } from './social-engineering.processor';
import { CrmModule } from '../crm/crm.module';
import { ActivityModule } from '../activity/activity.module';
import { WaTesterModule } from '../wa-tester/wa-tester.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'social_eng_queue' }),
    BullModule.registerQueue({ name: 'briefing_queue' }),
    CrmModule,
    ActivityModule,
    WaTesterModule,
  ],
  providers: [SocialEngineeringService, SocialEngineeringProcessor],
  exports: [SocialEngineeringService],
})
export class SocialEngineeringModule {}
