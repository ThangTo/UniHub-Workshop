import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistrationModule } from '../registration/registration.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import { PaymentReconcileJob } from './jobs/payment-reconcile.job';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentRefundWorker } from './payment-refund.worker';
import { PaymentRefundRetryJob } from './jobs/payment-refund-retry.job';

@Module({
  imports: [AuthModule, forwardRef(() => RegistrationModule)],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymentGatewayClient,
    PaymentReconcileJob,
    PaymentRefundService,
    PaymentRefundWorker,
    PaymentRefundRetryJob,
  ],
  exports: [PaymentService, PaymentGatewayClient, PaymentRefundService],
})
export class PaymentModule {}
