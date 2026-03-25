import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScorerService } from './scorer.service';
import { ScorerProcessor } from './scorer.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'scoring_queue' }),
    BullModule.registerQueue({ name: 'approval_queue' }),
    CrmModule,
  ],
  providers: [ScorerService, ScorerProcessor],
  exports: [ScorerService],
})
export class ScorerModule {}
