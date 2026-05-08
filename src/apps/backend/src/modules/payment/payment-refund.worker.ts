import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AmqpService } from '../../infra/amqp/amqp.service';
import { PaymentRefundService } from './payment-refund.service';

interface OutboxEnvelope {
  id: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const QUEUE = 'payment.refunds';
const ROUTING_KEYS = ['payment.refundable', 'registration.cancelled', 'workshop.cancelled'];

@Injectable()
export class PaymentRefundWorker implements OnModuleInit {
  private readonly logger = new Logger(PaymentRefundWorker.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly refunds: PaymentRefundService,
  ) {}

  async onModuleInit(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        await this.amqp.assertConsumer(QUEUE, ROUTING_KEYS);
        await this.amqp.consume<OutboxEnvelope>(QUEUE, (evt) => this.handle(evt), { prefetch: 4 });
        this.logger.log(`Consuming ${QUEUE} ← ${ROUTING_KEYS.join(',')}`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    this.logger.error('Failed to bind payment refund consumer after retries');
  }

  private async handle(evt: OutboxEnvelope): Promise<void> {
    switch (evt.eventType) {
      case 'payment.refundable': {
        const { paymentId, reason } = evt.payload as { paymentId: string; reason?: string };
        await this.refunds.refundPayment(paymentId, reason ?? 'payment_refundable');
        return;
      }
      case 'registration.cancelled': {
        const { regId, refundRequired } = evt.payload as {
          regId: string;
          refundRequired?: boolean;
        };
        if (refundRequired) {
          await this.refunds.refundRegistration(regId, 'registration_cancelled');
        }
        return;
      }
      case 'workshop.cancelled': {
        const { workshopId, reason } = evt.payload as { workshopId: string; reason?: string };
        const count = await this.refunds.refundWorkshop(workshopId, reason ?? 'workshop_cancelled');
        if (count > 0) this.logger.log(`Triggered ${count} refund(s) for cancelled workshop=${workshopId}`);
        return;
      }
      default:
        this.logger.debug(`Ignore event ${evt.eventType}`);
    }
  }
}
