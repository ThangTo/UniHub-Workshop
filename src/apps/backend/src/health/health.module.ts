import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';
import { PaymentModule } from '../modules/payment/payment.module';

@Module({
  imports: [TerminusModule, PaymentModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
