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
      const touchedWorkshopIds = new Set<string>();
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
          // Seat release nằm ngoài TX — retry nếu Redis tạm lỗi,
          // tránh ghế bị hold vĩnh viễn khi DB đã EXPIRED nhưng Redis chưa release.
          let released = false;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              await this.seats.release(reg.workshopId, reg.studentId, '');
              released = true;
              break;
            } catch (e) {
              this.logger.warn(
                `Seat release attempt ${attempt}/3 failed for reg=${reg.id}: ${(e as Error).message}`,
              );
              if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 500));
            }
          }
          if (!released) {
            this.logger.error(
              `⚠️ Seat NOT released after 3 attempts for reg=${reg.id} workshop=${reg.workshopId} — manual fix required`,
            );
          }
          touchedWorkshopIds.add(reg.workshopId);
        } catch (e) {
          this.logger.warn(`Sweep failed for reg=${reg.id}: ${(e as Error).message}`);
        }
      }
      for (const workshopId of touchedWorkshopIds) {
        await this.seats.reconcileFromDb(workshopId);
      }
    } catch (e) {
      this.logger.error(`HoldSweeper tick error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
