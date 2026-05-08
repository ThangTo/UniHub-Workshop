import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PaymentGatewayClient } from '../payment-gateway.client';
import { PaymentRefundService } from '../payment-refund.service';

@Injectable()
export class PaymentRefundRetryJob {
  private readonly logger = new Logger(PaymentRefundRetryJob.name);
  private running = false;

  constructor(
    private readonly gateway: PaymentGatewayClient,
    private readonly refunds: PaymentRefundService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    if (this.gateway.isOpen()) return;
    this.running = true;
    try {
      const done = await this.refunds.retryRequested();
      if (done > 0) this.logger.log(`Retried ${done} refund(s) successfully`);
    } catch (e) {
      this.logger.warn(`Refund retry failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
