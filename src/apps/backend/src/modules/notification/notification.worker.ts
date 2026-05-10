import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AmqpService } from '../../infra/amqp/amqp.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationService } from './notification.service';

interface OutboxEnvelope {
  id: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const QUEUE = 'notif.dispatcher';
const ROUTING_KEYS = [
  'registration.confirmed',
  'registration.hold_created',
  'registration.expired',
  'registration.cancelled',
  'payment.succeeded',
  'payment.failed',
  'workshop.cancelled',
  'checkin.confirmed',
  'csv.import_failed',
];

/**
 * Consumer chính cho notification: bind queue vào nhiều routing key,
 * mapping event → templateId rồi gọi NotificationService.dispatch.
 */
@Injectable()
export class NotificationWorker implements OnModuleInit {
  private readonly logger = new Logger(NotificationWorker.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly prisma: PrismaService,
    private readonly notif: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    void this.bindConsumer();
  }

  private async bindConsumer(): Promise<void> {
    // Đợi AMQP module init (channel sẵn sàng) — retry vài lần
    for (let i = 0; i < 30; i++) {
      try {
        await this.amqp.assertConsumer(QUEUE, ROUTING_KEYS);
        await this.amqp.consume<OutboxEnvelope>(QUEUE, (evt) => this.handle(evt), { prefetch: 8 });
        this.logger.log(`Consuming ${QUEUE} ← ${ROUTING_KEYS.join(',')}`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    this.logger.error('Failed to bind notification consumer after retries');
  }

  private async handle(evt: OutboxEnvelope): Promise<void> {
    switch (evt.eventType) {
      case 'registration.confirmed': {
        const { regId, workshopId, studentId } = evt.payload as {
          regId: string;
          workshopId: string;
          studentId: string;
        };
        const ws = await this.prisma.workshop.findUnique({
          where: { id: workshopId },
          include: { room: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!ws || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'registration_confirmed',
          vars: {
            userName: user.fullName,
            workshopTitle: ws.title,
            startAt: ws.startAt.toLocaleString('vi-VN'),
            roomName: ws.room?.name ?? 'Đang cập nhật',
            regId,
          },
        });
        return;
      }
      case 'payment.succeeded': {
        const { regId, studentId, gatewayTxnId } = evt.payload as {
          regId: string;
          studentId: string;
          gatewayTxnId: string;
        };
        const reg = await this.prisma.registration.findUnique({
          where: { id: regId },
          include: { workshop: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!reg || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'payment_succeeded',
          vars: {
            userName: user.fullName,
            workshopTitle: reg.workshop.title,
            amount: reg.feeAmount.toLocaleString('vi-VN'),
            gatewayTxnId,
          },
        });
        return;
      }
      case 'payment.failed': {
        const { regId, studentId, reason } = evt.payload as {
          regId: string;
          studentId: string;
          reason: string;
        };
        const reg = await this.prisma.registration.findUnique({
          where: { id: regId },
          include: { workshop: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!reg || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'payment_failed',
          vars: {
            userName: user.fullName,
            workshopTitle: reg.workshop.title,
            reason,
          },
        });
        return;
      }
      case 'registration.expired': {
        const { regId, studentId } = evt.payload as { regId: string; studentId: string };
        const reg = await this.prisma.registration.findUnique({
          where: { id: regId },
          include: { workshop: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!reg || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'hold_expired',
          vars: { userName: user.fullName, workshopTitle: reg.workshop.title },
        });
        return;
      }
      case 'registration.hold_created': {
        const { regId, workshopId, studentId, fee, holdExpiresAt } = evt.payload as {
          regId: string;
          workshopId: string;
          studentId: string;
          fee: number;
          holdExpiresAt: string;
        };
        const ws = await this.prisma.workshop.findUnique({
          where: { id: workshopId },
          include: { room: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!ws || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'registration_hold_created',
          vars: {
            userName: user.fullName,
            workshopTitle: ws.title,
            fee: fee.toLocaleString('vi-VN'),
            holdExpiresAt: new Date(holdExpiresAt).toLocaleString('vi-VN'),
            roomName: ws.room?.name ?? 'Đang cập nhật',
            regId,
          },
        });
        return;
      }
      case 'registration.cancelled': {
        const { regId, studentId, refundRequired } = evt.payload as {
          regId: string;
          studentId: string;
          refundRequired: boolean;
        };
        const reg = await this.prisma.registration.findUnique({
          where: { id: regId },
          include: { workshop: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!reg || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'registration_cancelled',
          vars: { userName: user.fullName, workshopTitle: reg.workshop.title, refundRequired },
        });
        return;
      }
      case 'checkin.confirmed': {
        const { regId, studentId, scannedAt } = evt.payload as {
          regId: string;
          studentId: string;
          scannedAt: string;
        };
        const reg = await this.prisma.registration.findUnique({
          where: { id: regId },
          include: { workshop: true },
        });
        const user = await this.prisma.user.findUnique({ where: { id: studentId } });
        if (!reg || !user) return;
        await this.notif.dispatch({
          eventId: evt.id,
          userId: studentId,
          templateId: 'checkin_succeeded',
          vars: {
            userName: user.fullName,
            workshopTitle: reg.workshop.title,
            scannedAt: new Date(scannedAt).toLocaleString('vi-VN'),
          },
        });
        return;
      }
      case 'workshop.cancelled': {
        const { workshopId, reason, registrations } = evt.payload as {
          workshopId: string;
          reason: string;
          registrations?: Array<{ id: string; studentId: string }>;
        };
        const ws = await this.prisma.workshop.findUnique({
          where: { id: workshopId },
        });
        if (!ws) return;
        // Prefer payload captured before CatalogService marks rows CANCELLED.
        const activeRegs = registrations?.length
          ? registrations
          : await this.prisma.registration.findMany({
              where: {
                workshopId,
                status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
              },
              select: { id: true, studentId: true },
            });
        for (const reg of activeRegs) {
          const user = await this.prisma.user.findUnique({ where: { id: reg.studentId } });
          if (!user) continue;
          await this.notif.dispatch({
            eventId: evt.id,
            userId: reg.studentId,
            templateId: 'workshop_cancelled',
            vars: {
              userName: user.fullName,
              workshopTitle: ws.title,
              reason: reason ?? 'Không ghi nhận',
            },
          });
        }
        return;
      }
      case 'csv.import_failed': {
        const { jobId, fileName, reason } = evt.payload as {
          jobId?: string;
          fileName?: string;
          reason?: string;
        };
        const admins = await this.prisma.user.findMany({
          where: { roles: { some: { role: { name: 'SYS_ADMIN' } } } },
          select: { id: true, fullName: true },
        });
        if (admins.length === 0) return;
        const job = jobId
          ? await this.prisma.importJob.findUnique({ where: { id: jobId } })
          : null;
        for (const admin of admins) {
          await this.notif.dispatch({
            eventId: evt.id,
            userId: admin.id,
            templateId: 'csv_import_failed',
            vars: {
              userName: admin.fullName,
              jobId: job?.id ?? jobId ?? evt.aggregateId,
              fileName: job?.fileName ?? fileName ?? 'unknown.csv',
              reason: reason ?? 'unknown',
              failedAt: (job?.finishedAt ?? new Date(evt.createdAt)).toLocaleString('vi-VN'),
            },
          });
        }
        return;
      }
      default:
        this.logger.debug(`Ignore event ${evt.eventType}`);
    }
  }
}
