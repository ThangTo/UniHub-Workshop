import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
