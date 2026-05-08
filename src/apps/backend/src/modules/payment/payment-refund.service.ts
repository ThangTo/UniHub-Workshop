import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Payment, PaymentRefund, PaymentStatus, RefundStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { PaymentGatewayClient } from './payment-gateway.client';

type RefundablePayment = Payment & { refunds: PaymentRefund[] };

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayClient,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async refundPayment(paymentId: string, reason: string): Promise<PaymentRefund | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });
    if (!payment) throw new NotFoundException('payment_not_found');
    return this.refundLoadedPayment(payment, reason);
  }

  async refundRegistration(registrationId: string, reason: string): Promise<PaymentRefund[]> {
    const payments = await this.prisma.payment.findMany({
      where: {
        registrationId,
        status: PaymentStatus.SUCCESS,
      },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });

    const refunds: PaymentRefund[] = [];
    for (const payment of payments) {
      const refund = await this.refundLoadedPayment(payment, reason);
      if (refund) refunds.push(refund);
    }
    return refunds;
  }

  async refundWorkshop(workshopId: string, reason: string): Promise<number> {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCESS,
        registration: { workshopId },
      },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });

    let count = 0;
    for (const payment of payments) {
      const refund = await this.refundLoadedPayment(payment, reason);
      if (refund) count++;
    }
    return count;
  }

  async retryRequested(limit = 50): Promise<number> {
    if (this.gateway.isOpen()) return 0;
    const refunds = await this.prisma.paymentRefund.findMany({
      where: { status: { in: [RefundStatus.REQUESTED, RefundStatus.PENDING] } },
      include: { payment: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let done = 0;
    for (const refund of refunds) {
      const refreshed = await this.prisma.payment.findUnique({
        where: { id: refund.paymentId },
        include: { refunds: { orderBy: { createdAt: 'desc' } } },
      });
      if (!refreshed) continue;
      const next = await this.refundLoadedPayment(refreshed, refund.reason ?? 'retry_requested_refund');
      if (next?.status === RefundStatus.SUCCESS) done++;
    }
    return done;
  }

  async handleRefundWebhook(payload: {
    refundId: string;
    chargeId: string;
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    amount: number;
  }): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayTxnId: payload.chargeId },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });
    if (!payment) {
      this.logger.warn(`Refund webhook for unknown chargeId=${payload.chargeId}`);
      return;
    }

    const refund =
      payment.refunds.find((r) => r.gatewayRefundId === payload.refundId) ??
      payment.refunds.find((r) => r.status === RefundStatus.REQUESTED || r.status === RefundStatus.PENDING);
    if (!refund) {
      this.logger.warn(`Refund webhook has no local row payment=${payment.id}`);
      return;
    }

    if (payload.status === 'SUCCESS') {
      await this.markRefundSuccess(refund.id, payment.id, payload.refundId);
    } else if (payload.status === 'FAILED') {
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.FAILED, gatewayRefundId: payload.refundId },
      });
    }
  }

  private async refundLoadedPayment(
    payment: RefundablePayment,
    reason: string,
  ): Promise<PaymentRefund | null> {
    if (payment.status === PaymentStatus.REFUNDED) {
      return payment.refunds.find((r) => r.status === RefundStatus.SUCCESS) ?? null;
    }
    if (payment.status !== PaymentStatus.SUCCESS) return null;
    if (!payment.gatewayTxnId) {
      this.logger.warn(`Payment ${payment.id} has no gatewayTxnId; cannot refund yet`);
      return null;
    }

    const reusableStatuses = new Set<RefundStatus>([
      RefundStatus.SUCCESS,
      RefundStatus.REQUESTED,
      RefundStatus.PENDING,
    ]);
    const existing = payment.refunds.find((r) => reusableStatuses.has(r.status));
    let refund = existing;
    if (!refund) {
      refund = await this.prisma.paymentRefund.create({
        data: {
          paymentId: payment.id,
          amount: payment.amount,
          reason,
          status: RefundStatus.REQUESTED,
        },
      });
    }

    if (refund.status === RefundStatus.SUCCESS) return refund;
    if (this.gateway.isOpen()) {
      this.logger.warn(`Refund deferred because circuit is OPEN payment=${payment.id}`);
      return refund;
    }

    await this.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: { status: RefundStatus.PENDING },
    });

    try {
      const gatewayRefund = await this.gateway.refund({
        chargeId: payment.gatewayTxnId,
        amount: refund.amount,
      });
      if (gatewayRefund.status !== 'SUCCESS') {
        throw new Error(`refund_${gatewayRefund.status}`);
      }
      return this.markRefundSuccess(refund.id, payment.id, gatewayRefund.id);
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown';
      const retryable =
        msg.includes('timeout') ||
        msg.includes('EAI_AGAIN') ||
        msg.includes('ECONN') ||
        msg.startsWith('gateway_5') ||
        this.gateway.isOpen();
      await this.prisma.paymentRefund.update({
        where: { id: refund.id },
        data: { status: retryable ? RefundStatus.REQUESTED : RefundStatus.FAILED },
      });
      this.logger.warn(`Refund ${refund.id} failed payment=${payment.id}: ${msg}`);
      return refund;
    }
  }

  private async markRefundSuccess(
    refundId: string,
    paymentId: string,
    gatewayRefundId: string,
  ): Promise<PaymentRefund> {
    const refund = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.paymentRefund.update({
        where: { id: refundId },
        data: {
          status: RefundStatus.SUCCESS,
          gatewayRefundId,
        },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.REFUNDED },
      });
      await this.outbox.append(tx, {
        aggregate: 'payment',
        aggregateId: paymentId,
        eventType: 'payment.refunded',
        payload: {
          paymentId,
          refundId,
          gatewayRefundId,
          amount: updated.amount,
        },
      });
      return updated;
    });

    void this.audit.log({
      actorId: null,
      action: 'payment_refunded',
      resource: 'payment',
      resourceId: paymentId,
      metadata: { refundId, gatewayRefundId, amount: refund.amount },
    });

    return refund;
  }
}
