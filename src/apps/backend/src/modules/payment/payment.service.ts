import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Payment, PaymentStatus, RegistrationStatus } from '@prisma/client';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { QrTokenService } from '../registration/qr-token.service';
import { SeatService } from '../registration/seat.service';
import { PaymentGatewayClient } from './payment-gateway.client';

export interface InitiateResult {
  status: 'success' | 'failed' | 'pending' | 'unavailable';
  payment: Payment;
  qrToken?: string;
  qrImageDataUrl?: string;
  retryAfterSec?: number;
}

export interface PaymentDetailResponse {
  id: string;
  registrationId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  gatewayTxnId?: string | null;
  createdAt: Date;
  finalizedAt?: Date | null;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGatewayClient,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly qr: QrTokenService,
    private readonly seats: SeatService,
  ) {}

  /**
   * Khởi tạo payment cho registration (specs/payment.md §A).
   * Idempotent qua header `Idempotency-Key` (do IdempotencyInterceptor handle ở route level).
   */
  async initiate(
    studentUserId: string,
    registrationId: string,
    idempotencyKey: string,
  ): Promise<InitiateResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('idempotency_key_required');
    }

    const reg = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { workshop: true },
    });
    if (!reg) throw new NotFoundException('registration_not_found');
    if (reg.studentId !== studentUserId) throw new ForbiddenException('not_owner');
    if (reg.status !== RegistrationStatus.PENDING_PAYMENT) {
      throw new UnprocessableEntityException({ code: 'invalid_state', status: reg.status });
    }
    if (reg.holdExpiresAt && reg.holdExpiresAt.getTime() < Date.now()) {
      throw new UnprocessableEntityException('hold_expired');
    }

    // payments.idempotencyKey UNIQUE: nếu đã có row cũng key này → trả lại snapshot.
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return this.buildSnapshotResult(existing, reg);
    }

    // Đếm số attempt đã có cho registration này (để tăng attemptNo)
    const lastAttempt = await this.prisma.payment.findFirst({
      where: { registrationId },
      orderBy: { attemptNo: 'desc' },
    });
    if (lastAttempt?.status === PaymentStatus.SUCCESS) {
      throw new UnprocessableEntityException('already_paid');
    }
    const attemptNo = (lastAttempt?.attemptNo ?? 0) + 1;
    const requestHash = idempotencyKey; // intent đơn giản: regId + amount khoá theo key

    // Fail-fast nếu CB đang Open
    if (this.gateway.isOpen()) {
      const payment = await this.prisma.payment.create({
        data: {
          registrationId,
          attemptNo,
          amount: reg.feeAmount,
          gateway: 'mock-pg',
          status: PaymentStatus.FAILED,
          idempotencyKey,
          requestHash,
          failureReason: 'circuit_open',
          responseSnapshot: { code: 'payment_unavailable' },
        },
      });
      throw new ServiceUnavailableException({
        code: 'payment_unavailable',
        retryAfterSec: 30,
        paymentId: payment.id,
      });
    }

    // INSERT pending payment trước → đảm bảo có row dù gateway timeout
    const payment = await this.prisma.payment.create({
      data: {
        registrationId,
        attemptNo,
        amount: reg.feeAmount,
        gateway: 'mock-pg',
        status: PaymentStatus.INITIATED,
        idempotencyKey,
        requestHash,
      },
    });

    void this.audit.log({
      actorId: studentUserId,
      action: 'payment_initiated',
      resource: 'payment',
      resourceId: payment.id,
      metadata: { registrationId, attemptNo, amount: reg.feeAmount },
    });

    // Gọi gateway qua CB
    try {
      const charge = await this.gateway.charge({
        regId: registrationId,
        amount: reg.feeAmount,
        idempotencyKey,
      });

      if (charge.status === 'SUCCESS') {
        return this.completePaymentSuccess(payment.id, charge.id, reg);
      }
      if (charge.status === 'FAILED') {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            gatewayTxnId: charge.id,
            failureReason: charge.failureReason ?? 'declined',
            responseSnapshot: charge as object,
          },
        });
        await this.publishOutbox(payment.id, 'payment.failed', {
          paymentId: payment.id,
          regId: registrationId,
          studentId: studentUserId,
          reason: charge.failureReason ?? 'declined',
        });
        const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        return { status: 'failed', payment: updated };
      }
      // PENDING (hiếm)
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.PENDING, gatewayTxnId: charge.id },
      });
      const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return { status: 'pending', payment: updated };
    } catch (e) {
      const msg = (e as Error).message ?? 'unknown';
      this.logger.warn(`Gateway error for payment=${payment.id}: ${msg}`);
      if (msg.includes('timeout') || msg.startsWith('gateway_5')) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.TIMEOUT, failureReason: msg },
        });
        const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        return { status: 'pending', payment: updated };
      }
      // Breaker Open or other
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: msg },
      });
      throw new ServiceUnavailableException({ code: 'payment_unavailable', retryAfterSec: 30 });
    }
  }

  /**
   * Webhook callback từ gateway (specs/payment.md §B). HMAC verify đã làm ở controller.
   */
  async handleWebhook(payload: {
    chargeId: string;
    idempotencyKey: string;
    regId: string;
    status: 'SUCCESS' | 'FAILED' | 'PENDING';
    amount: number;
    failureReason?: string;
  }): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { idempotencyKey: payload.idempotencyKey },
      include: { registration: { include: { workshop: true } } },
    });
    if (!payment) {
      this.logger.warn(`Webhook for unknown idempotencyKey=${payload.idempotencyKey}`);
      return;
    }
    if (payment.status === PaymentStatus.SUCCESS) {
      this.logger.debug(`Webhook ignored, payment ${payment.id} already SUCCESS`);
      return;
    }

    if (payload.status === 'SUCCESS') {
      await this.completePaymentSuccess(payment.id, payload.chargeId, payment.registration);
    } else if (payload.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          gatewayTxnId: payload.chargeId,
          failureReason: payload.failureReason ?? 'declined',
        },
      });
      await this.publishOutbox(payment.id, 'payment.failed', {
        paymentId: payment.id,
        regId: payment.registrationId,
        studentId: payment.registration.studentId,
        reason: payload.failureReason ?? 'declined',
      });
    }
  }

  async getHealth() {
    return this.gateway.getHealth();
  }

  async getForStudent(studentUserId: string, paymentId: string): Promise<PaymentDetailResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { registration: true },
    });

    if (!payment) throw new NotFoundException('payment_not_found');
    if (payment.registration.studentId !== studentUserId) throw new ForbiddenException('not_owner');

    return this.toDetailResponse(payment);
  }

  // --- Internal ---

  private async completePaymentSuccess(
    paymentId: string,
    gatewayTxnId: string,
    reg: { id: string; workshopId: string; studentId: string; holdExpiresAt: Date | null; workshop: { startAt: Date; endAt: Date } },
  ): Promise<InitiateResult> {
    // Edge case: hold đã expired nhưng webhook đến muộn → mark refundable.
    const holdExpired = !!reg.holdExpiresAt && reg.holdExpiresAt.getTime() < Date.now();

    const qrToken = !holdExpired
      ? this.qr.sign({
          regId: reg.id,
          workshopId: reg.workshopId,
          studentId: reg.studentId,
          startAt: reg.workshop.startAt,
          endAt: reg.workshop.endAt,
        })
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.SUCCESS,
          gatewayTxnId,
          responseSnapshot: { ok: true, gatewayTxnId },
        },
      });

      if (!holdExpired) {
        await tx.registration.update({
          where: { id: reg.id },
          data: {
            status: RegistrationStatus.CONFIRMED,
            confirmedAt: new Date(),
            qrToken,
          },
        });
        await this.outbox.append(tx, {
          aggregate: 'payment',
          aggregateId: paymentId,
          eventType: 'payment.succeeded',
          payload: { paymentId, regId: reg.id, studentId: reg.studentId, gatewayTxnId },
        });
        await this.outbox.append(tx, {
          aggregate: 'registration',
          aggregateId: reg.id,
          eventType: 'registration.confirmed',
          payload: { regId: reg.id, workshopId: reg.workshopId, studentId: reg.studentId },
        });
      } else {
        await this.outbox.append(tx, {
          aggregate: 'payment',
          aggregateId: paymentId,
          eventType: 'payment.refundable',
          payload: { paymentId, regId: reg.id, reason: 'hold_expired_but_paid' },
        });
      }
    });

    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (holdExpired) {
      return { status: 'failed', payment: updated };
    }

    const qrImageDataUrl = qrToken ? await this.qr.toDataUrl(qrToken) : undefined;
    return { status: 'success', payment: updated, qrToken, qrImageDataUrl };
  }

  private async buildSnapshotResult(
    payment: Payment,
    reg: { id: string; workshopId: string; studentId: string; workshop: { startAt: Date; endAt: Date } },
  ): Promise<InitiateResult> {
    if (payment.status === PaymentStatus.SUCCESS) {
      const fresh = await this.prisma.registration.findUniqueOrThrow({ where: { id: reg.id } });
      const qrToken = fresh.qrToken ?? undefined;
      const qrImageDataUrl = qrToken ? await this.qr.toDataUrl(qrToken) : undefined;
      return { status: 'success', payment, qrToken, qrImageDataUrl };
    }
    if (payment.status === PaymentStatus.FAILED) {
      if (payment.failureReason === 'circuit_open') {
        throw new ServiceUnavailableException({ code: 'payment_unavailable', retryAfterSec: 30 });
      }
      return { status: 'failed', payment };
    }
    if (payment.status === PaymentStatus.TIMEOUT || payment.status === PaymentStatus.PENDING) {
      return { status: 'pending', payment };
    }
    return { status: 'pending', payment };
  }

  private toDetailResponse(payment: Payment): PaymentDetailResponse {
    const terminal =
      payment.status === PaymentStatus.SUCCESS ||
      payment.status === PaymentStatus.FAILED ||
      payment.status === PaymentStatus.REFUNDED;

    return {
      id: payment.id,
      registrationId: payment.registrationId,
      amount: payment.amount,
      currency: payment.currency,
      status: this.toUiStatus(payment.status),
      gatewayTxnId: payment.gatewayTxnId,
      createdAt: payment.createdAt,
      finalizedAt: terminal ? payment.updatedAt : null,
    };
  }

  private toUiStatus(status: PaymentStatus): PaymentDetailResponse['status'] {
    if (status === PaymentStatus.SUCCESS) return 'SUCCEEDED';
    if (status === PaymentStatus.REFUNDED) return 'REFUNDED';
    if (status === PaymentStatus.FAILED) return 'FAILED';
    return 'PENDING';
  }

  private async publishOutbox(aggregateId: string, eventType: string, payload: object): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.append(tx, {
        aggregate: 'payment',
        aggregateId,
        eventType,
        payload: payload as Record<string, unknown>,
      });
    });
  }
}
