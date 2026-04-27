import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { PaymentGatewayClient } from '../payment-gateway.client';
import { PaymentService } from '../payment.service';

/**
 * Cron mỗi 5 phút: reconcile payments TIMEOUT/PENDING/INITIATED >2 phút
 * (specs/payment.md §C). Gọi GET /charge/:id để chốt trạng thái.
 */
@Injectable()
export class PaymentReconcileJob {
  private readonly logger = new Logger(PaymentReconcileJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayClient,
    private readonly svc: PaymentService,
  ) {}

  @Interval(5 * 60 * 1000)
  async tick(): Promise<void> {
    if (this.running) return;
    if (this.gateway.isOpen()) {
      this.logger.debug('Skip reconcile, circuit OPEN');
      return;
    }
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - 2 * 60 * 1000);
      const stuck = await this.prisma.payment.findMany({
        where: {
          status: { in: [PaymentStatus.TIMEOUT, PaymentStatus.PENDING, PaymentStatus.INITIATED] },
          createdAt: { lt: cutoff },
        },
        take: 100,
        include: { registration: true },
      });
      if (stuck.length === 0) return;
      this.logger.log(`Reconciling ${stuck.length} stuck payments`);

      for (const p of stuck) {
        try {
          if (!p.gatewayTxnId) {
            // chưa biết txnId → mark FAILED nếu gateway không tìm thấy theo idemKey
            // Mock-pg không expose API tra theo idemKey → fallback FAILED sau 10 phút
            const ageMs = Date.now() - p.createdAt.getTime();
            if (ageMs > 10 * 60 * 1000) {
              await this.prisma.payment.update({
                where: { id: p.id },
                data: { status: PaymentStatus.FAILED, failureReason: 'reconcile_no_txn_id' },
              });
            }
            continue;
          }
          const charge = await this.gateway.getCharge(p.gatewayTxnId);
          await this.svc.handleWebhook({
            chargeId: charge.id,
            idempotencyKey: charge.idempotencyKey,
            regId: charge.regId,
            status: charge.status,
            amount: charge.amount,
            failureReason: charge.failureReason,
          });
        } catch (e) {
          this.logger.warn(`Reconcile failed payment=${p.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Reconcile tick error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
