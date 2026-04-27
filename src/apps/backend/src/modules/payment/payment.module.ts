import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RegistrationModule } from '../registration/registration.module';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymentGatewayClient } from './payment-gateway.client';
import { PaymentReconcileJob } from './jobs/payment-reconcile.job';

@Module({
  imports: [AuthModule, RegistrationModule],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentGatewayClient, PaymentReconcileJob],
  exports: [PaymentService, PaymentGatewayClient],
})
export class PaymentModule {}
