import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WaTesterService } from './wa-tester.service';
import { WaTesterController } from './wa-tester.controller';
import { WaTesterProcessor } from './wa-tester.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'wa_test_queue' }),
    BullModule.registerQueue({ name: 'scoring_queue' }),
    CrmModule,
  ],
  controllers: [WaTesterController],
  providers: [WaTesterService, WaTesterProcessor],
  exports: [WaTesterService],
})
export class WaTesterModule {}
