import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IntelProcessor } from './intel.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'intel_queue' }),
    BullModule.registerQueue({ name: 'wa_test_queue' }),
    BullModule.registerQueue({ name: 'scoring_queue' }),
    CrmModule,
  ],
  providers: [IntelProcessor],
})
export class IntelModule {}
