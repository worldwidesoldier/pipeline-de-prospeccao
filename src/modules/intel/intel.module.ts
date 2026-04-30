import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { IntelProcessor } from './intel.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'intel_queue' }),
    BullModule.registerQueue({ name: 'mystery_shop_queue' }),
    CrmModule,
  ],
  providers: [IntelProcessor],
})
export class IntelModule {}
