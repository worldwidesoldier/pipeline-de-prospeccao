import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ApprovalProcessor } from './approval.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'approval_queue' }),
    BullModule.registerQueue({ name: 'outreach_queue' }),
    CrmModule,
  ],
  providers: [ApprovalProcessor],
})
export class ApprovalModule {}
