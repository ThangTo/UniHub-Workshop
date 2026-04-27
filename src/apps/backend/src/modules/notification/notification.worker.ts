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
  'registration.expired',
  'registration.cancelled',
  'payment.succeeded',
  'payment.failed',
  'workshop.cancelled',
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
      default:
        this.logger.debug(`Ignore event ${evt.eventType}`);
    }
  }
}
