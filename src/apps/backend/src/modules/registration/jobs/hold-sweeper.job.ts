import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RegistrationStatus } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';
import { SeatService } from '../seat.service';

/**
 * Cron mỗi 60s: dọn registration PENDING_PAYMENT đã quá hold_expires_at,
 * release ghế, publish event registration.expired (specs/registration.md §C).
 */
@Injectable()
export class HoldSweeperJob {
  private readonly logger = new Logger(HoldSweeperJob.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seats: SeatService,
    private readonly outbox: OutboxService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const expired = await this.prisma.registration.findMany({
        where: {
          status: RegistrationStatus.PENDING_PAYMENT,
          holdExpiresAt: { lt: now },
        },
        take: 500,
      });
      if (expired.length === 0) return;

      this.logger.log(`Sweeping ${expired.length} expired holds`);
      for (const reg of expired) {
        try {
          await this.prisma.$transaction(async (tx) => {
            await tx.registration.update({
              where: { id: reg.id },
              data: { status: RegistrationStatus.EXPIRED, cancelledAt: now },
            });
            await this.outbox.append(tx, {
              aggregate: 'registration',
              aggregateId: reg.id,
              eventType: 'registration.expired',
              payload: {
                regId: reg.id,
                workshopId: reg.workshopId,
                studentId: reg.studentId,
              },
            });
          });
          await this.seats.release(reg.workshopId, reg.studentId, '');
        } catch (e) {
          this.logger.warn(`Sweep failed for reg=${reg.id}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`HoldSweeper tick error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
