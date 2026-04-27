import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SeatService } from './seat.service';
import { QrTokenService } from './qr-token.service';
import { HoldSweeperJob } from './jobs/hold-sweeper.job';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationController],
  providers: [RegistrationService, SeatService, QrTokenService, HoldSweeperJob],
  exports: [RegistrationService, SeatService, QrTokenService],
})
export class RegistrationModule {}
