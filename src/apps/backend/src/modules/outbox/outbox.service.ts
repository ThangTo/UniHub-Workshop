import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Helper ghi outbox event TRONG cùng transaction Prisma.
 * Dùng cho mọi side-effect cross-module: registration confirmed, payment success, ...
 *
 * Caller chịu trách nhiệm cung cấp `tx` (Prisma.TransactionClient) để cùng commit.
 *
 * @example
 * await prisma.$transaction(async (tx) => {
 *   await tx.registration.update({ ... });
 *   await outbox.append(tx, {
 *     aggregate: 'registration', aggregateId: regId,
 *     eventType: 'registration.confirmed', payload: {...}
 *   });
 * });
 */
@Injectable()
export class OutboxService {
  async append(
    tx: Prisma.TransactionClient,
    evt: {
      aggregate: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregate: evt.aggregate,
        aggregateId: evt.aggregateId,
        eventType: evt.eventType,
        payload: evt.payload as Prisma.InputJsonValue,
      },
    });
  }
}
