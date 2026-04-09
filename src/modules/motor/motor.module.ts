import { Module, Global } from '@nestjs/common';
import { MotorService } from './motor.service';

@Global()
@Module({
  providers: [MotorService],
  exports:   [MotorService],
})
export class MotorModule {}
