import { Controller, Get, Header } from '@nestjs/common';
import { NotificationStatus, PaymentStatus, RegistrationStatus } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const [
      registrationQueueSize,
      confirmedRegistrations,
      pendingRegistrations,
      checkins,
      notificationsSent,
      notificationsFailed,
      paymentsSucceeded,
      paymentsRefunded,
      outboxUnpublished,
    ] = await Promise.all([
      this.registrationQueueSize(),
      this.prisma.registration.count({ where: { status: RegistrationStatus.CONFIRMED } }),
      this.prisma.registration.count({ where: { status: RegistrationStatus.PENDING_PAYMENT } }),
      this.prisma.checkin.count(),
      this.prisma.notification.count({ where: { status: NotificationStatus.SENT } }),
      this.prisma.notification.count({ where: { status: NotificationStatus.FAILED } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.SUCCESS } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.REFUNDED } }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
    ]);

    return [
      '# HELP registration_queue_size Number of queued registration requests.',
      '# TYPE registration_queue_size gauge',
      `registration_queue_size ${registrationQueueSize}`,
      '# HELP registrations_total Registrations by state.',
      '# TYPE registrations_total gauge',
      `registrations_total{status="CONFIRMED"} ${confirmedRegistrations}`,
      `registrations_total{status="PENDING_PAYMENT"} ${pendingRegistrations}`,
      '# HELP checkin_total Total successful check-ins.',
      '# TYPE checkin_total counter',
      `checkin_total ${checkins}`,
      '# HELP notifications_total Notifications by delivery state.',
      '# TYPE notifications_total gauge',
      `notifications_total{status="SENT"} ${notificationsSent}`,
      `notifications_total{status="FAILED"} ${notificationsFailed}`,
      '# HELP payments_total Payments by terminal state.',
      '# TYPE payments_total gauge',
      `payments_total{status="SUCCESS"} ${paymentsSucceeded}`,
      `payments_total{status="REFUNDED"} ${paymentsRefunded}`,
      '# HELP outbox_unpublished_total Unpublished outbox events waiting for relay.',
      '# TYPE outbox_unpublished_total gauge',
      `outbox_unpublished_total ${outboxUnpublished}`,
      '',
    ].join('\n');
  }

  private async registrationQueueSize(): Promise<number> {
    try {
      const client = this.redis.getClient();
      const workshopIds = await client.smembers('regqueue:active_workshops');
      let total = 0;
      for (const workshopId of workshopIds) {
        total += await client.llen(`regqueue:${workshopId}`);
      }
      return total;
    } catch {
      return 0;
    }
  }
}
