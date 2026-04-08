import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EnricherService } from './enricher.service';
import { EnricherProcessor } from './enricher.processor';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'enrichment_queue' }),
    BullModule.registerQueue({ name: 'intel_queue' }),
    CrmModule,
  ],
  providers: [EnricherService, EnricherProcessor],
  exports: [EnricherService],
})
export class EnricherModule {}
