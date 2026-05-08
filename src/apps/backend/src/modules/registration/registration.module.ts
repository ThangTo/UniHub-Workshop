import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PaymentModule } from '../payment/payment.module';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SeatService } from './seat.service';
import { QrTokenService } from './qr-token.service';
import { HoldSweeperJob } from './jobs/hold-sweeper.job';
import { RegistrationQueueService } from './registration-queue.service';
import { RegistrationQueueWorker } from './jobs/registration-queue.worker';

@Module({
  imports: [AuthModule, forwardRef(() => PaymentModule)],
  controllers: [RegistrationController],
  providers: [
    RegistrationService,
    SeatService,
    QrTokenService,
    HoldSweeperJob,
    RegistrationQueueService,
    RegistrationQueueWorker,
  ],
  exports: [RegistrationService, SeatService, QrTokenService],
})
export class RegistrationModule {}
