import { describe, expect, it, vi } from 'vitest';
import { PaymentStatus, RefundStatus } from '@prisma/client';
import { PaymentRefundService } from './payment-refund.service';

function makeService(overrides: {
  gatewayOpen?: boolean;
  gatewayRefund?: { id: string; status: string };
} = {}) {
  const refundRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    paymentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    amount: 50000,
    reason: 'registration_cancelled',
    status: RefundStatus.REQUESTED,
    gatewayRefundId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const payment = {
    id: refundRow.paymentId,
    registrationId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    attemptNo: 1,
    amount: refundRow.amount,
    currency: 'VND',
    gateway: 'mock-pg',
    gatewayTxnId: 'pg_success',
    status: PaymentStatus.SUCCESS,
    idempotencyKey: 'idem',
    requestHash: 'hash',
    responseSnapshot: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    refunds: [],
  };

  const tx = {
    paymentRefund: {
      update: vi.fn().mockResolvedValue({
        ...refundRow,
        status: RefundStatus.SUCCESS,
        gatewayRefundId: overrides.gatewayRefund?.id ?? 'rf_success',
      }),
    },
    payment: { update: vi.fn().mockResolvedValue({ ...payment, status: PaymentStatus.REFUNDED }) },
  };
  const prisma = {
    payment: {
      findUnique: vi.fn().mockResolvedValue(payment),
      findMany: vi.fn().mockResolvedValue([payment]),
    },
    paymentRefund: {
      create: vi.fn().mockResolvedValue(refundRow),
      update: vi.fn().mockResolvedValue(refundRow),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn((fn: (txArg: typeof tx) => unknown) => fn(tx)),
  };
  const gateway = {
    isOpen: vi.fn().mockReturnValue(overrides.gatewayOpen ?? false),
    refund: vi.fn().mockResolvedValue(overrides.gatewayRefund ?? { id: 'rf_success', status: 'SUCCESS' }),
  };
  const outbox = { append: vi.fn().mockResolvedValue(undefined) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new PaymentRefundService(
    prisma as any,
    gateway as any,
    outbox as any,
    audit as any,
  );

  return { service, prisma, gateway, outbox, tx, refundRow };
}

describe('PaymentRefundService', () => {
  it('calls the gateway and marks the payment REFUNDED on successful refund', async () => {
    const { service, gateway, outbox, tx } = makeService();

    const refund = await service.refundPayment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'registration_cancelled');

    expect(gateway.refund).toHaveBeenCalledWith({ chargeId: 'pg_success', amount: 50000 });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      data: { status: PaymentStatus.REFUNDED },
    });
    expect(outbox.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ eventType: 'payment.refunded' }),
    );
    expect(refund?.status).toBe(RefundStatus.SUCCESS);
  });

  it('keeps refund REQUESTED when the circuit is open so the retry job can pick it up', async () => {
    const { service, gateway, prisma, refundRow } = makeService({ gatewayOpen: true });

    const refund = await service.refundPayment('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'registration_cancelled');

    expect(gateway.refund).not.toHaveBeenCalled();
    expect(prisma.paymentRefund.create).toHaveBeenCalled();
    expect(refund).toEqual(refundRow);
  });
});
