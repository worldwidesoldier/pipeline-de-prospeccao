import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { WaTesterService } from './wa-tester.service';
import { WaTesterController } from './wa-tester.controller';
import { WaTesterProcessor } from './wa-tester.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'wa_test_queue',
      limiter: { max: 1, duration: 7 * 60 * 1000 }, // 1 message per 7 minutes
    }),
    BullModule.registerQueue({ name: 'scoring_queue' }),
    CrmModule,
  ],
  controllers: [WaTesterController],
  providers: [WaTesterService, WaTesterProcessor],
  exports: [WaTesterService],
})
export class WaTesterModule {}
