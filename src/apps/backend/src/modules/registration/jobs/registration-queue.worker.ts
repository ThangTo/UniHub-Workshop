import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PaymentGatewayClient } from '../../payment/payment-gateway.client';
import { RegistrationQueueItem, RegistrationQueueService } from '../registration-queue.service';
import { RegistrationService } from '../registration.service';

@Injectable()
export class RegistrationQueueWorker {
  private readonly logger = new Logger(RegistrationQueueWorker.name);
  private running = false;

  constructor(
    private readonly cfg: AppConfigService,
    private readonly queue: RegistrationQueueService,
    private readonly registrations: RegistrationService,
    private readonly paymentGateway: PaymentGatewayClient,
  ) {}

  @Interval(1000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const limit = Math.max(1, this.cfg.rateLimit.globalRegistrationRps);
      const batch = await this.queue.nextBatch(limit);
      if (batch.length === 0) return;
      this.logger.log(`Draining ${batch.length} queued registration request(s)`);

      for (const item of batch) {
        await this.processItem(item);
      }
    } catch (e) {
      this.logger.error(`Registration queue drain failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async processItem(item: RegistrationQueueItem): Promise<void> {
    if (this.queue.isExpired(item)) {
      await this.queue.markFailed(item, 503, {
        code: 'registration_queue_expired',
        message: 'Queued registration expired before processing.',
      });
      return;
    }

    await this.queue.markRunning(item);
    try {
      const result = await this.registrations.create(item.userId, item.workshopId, {
        paymentCircuitOpen: item.paymentCircuitOpen || this.paymentGateway.isOpen(),
      });
      await this.queue.markSucceeded(item, {
        regId: result.registration.id,
        registrationId: result.registration.id,
        status: result.registration.status,
        paymentRequired: result.paymentRequired,
        holdExpiresAt: result.holdExpiresAt,
        qrToken: result.qrToken,
        qrImageDataUrl: result.qrImageDataUrl,
        paymentUnavailable: result.paymentUnavailable,
      });
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 500;
      const response = e instanceof HttpException
        ? e.getResponse()
        : { code: 'registration_queue_failed', message: (e as Error).message };
      await this.queue.markFailed(item, status, response);
    }
  }
}
