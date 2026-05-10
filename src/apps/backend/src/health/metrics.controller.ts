import { Controller, Get, Header } from '@nestjs/common';
import { NotificationStatus, PaymentStatus, RegistrationStatus } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { PaymentGatewayClient } from '../modules/payment/payment-gateway.client';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly paymentGateway: PaymentGatewayClient,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    const [
      registrationQueueSize,
      confirmedRegistrations,
      pendingRegistrations,
      checkins,
      checkinAcceptedMetric,
      checkinDuplicates,
      checkinInvalid,
      checkinSyncDurationMs,
      notificationsSent,
      notificationsFailed,
      paymentsSucceeded,
      paymentsRefunded,
      paymentFailures,
      outboxUnpublished,
      rateLimitAllowedUser,
      rateLimitAllowedIp,
      rateLimitRejectedUser,
      rateLimitRejectedIp,
      idempotencyReplays,
      aiSummaryFailures,
      aiSummaryDurationSum,
      aiSummaryDurationCount,
    ] = await Promise.all([
      this.registrationQueueSize(),
      this.prisma.registration.count({ where: { status: RegistrationStatus.CONFIRMED } }),
      this.prisma.registration.count({ where: { status: RegistrationStatus.PENDING_PAYMENT } }),
      this.prisma.checkin.count(),
      this.metricInt('metrics:checkin_total:accepted'),
      this.metricInt('metrics:checkin_total:duplicate'),
      this.metricInt('metrics:checkin_total:invalid'),
      this.metricFloat('metrics:checkin_sync_duration_ms'),
      this.prisma.notification.count({ where: { status: NotificationStatus.SENT } }),
      this.prisma.notification.count({ where: { status: NotificationStatus.FAILED } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.SUCCESS } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.REFUNDED } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.FAILED } }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
      this.metricInt('metrics:rate_limit_allowed:user'),
      this.metricInt('metrics:rate_limit_allowed:ip'),
      this.metricInt('metrics:rate_limit_rejected:user'),
      this.metricInt('metrics:rate_limit_rejected:ip'),
      this.metricInt('metrics:idempotency_replay_total'),
      this.metricInt('metrics:ai_summary_failures_total'),
      this.metricFloat('metrics:ai_summary_duration_seconds_sum'),
      this.metricInt('metrics:ai_summary_duration_seconds_count'),
    ]);
    const circuit = this.paymentGateway.getHealth().circuit;
    const circuitState = circuit === 'open' ? 1 : circuit === 'half_open' ? 0.5 : 0;
    const checkinAccepted = Math.max(checkins, checkinAcceptedMetric);

    return [
      '# HELP registration_queue_size Number of queued registration requests.',
      '# TYPE registration_queue_size gauge',
      `registration_queue_size ${registrationQueueSize}`,
      '# HELP registrations_total Registrations by state.',
      '# TYPE registrations_total gauge',
      `registrations_total{status="CONFIRMED"} ${confirmedRegistrations}`,
      `registrations_total{status="PENDING_PAYMENT"} ${pendingRegistrations}`,
      '# HELP checkin_total Total check-ins by result.',
      '# TYPE checkin_total counter',
      `checkin_total{result="accepted"} ${checkinAccepted}`,
      `checkin_total{result="duplicate"} ${checkinDuplicates}`,
      `checkin_total{result="invalid"} ${checkinInvalid}`,
      '# HELP checkin_offline_queue_size Last reported offline queue size from check-in clients.',
      '# TYPE checkin_offline_queue_size gauge',
      'checkin_offline_queue_size 0',
      '# HELP checkin_sync_duration_ms Last reported check-in sync duration in milliseconds.',
      '# TYPE checkin_sync_duration_ms gauge',
      `checkin_sync_duration_ms ${checkinSyncDurationMs}`,
      '# HELP notifications_total Notifications by delivery state.',
      '# TYPE notifications_total gauge',
      `notifications_total{status="SENT"} ${notificationsSent}`,
      `notifications_total{status="FAILED"} ${notificationsFailed}`,
      '# HELP payments_total Payments by terminal state.',
      '# TYPE payments_total gauge',
      `payments_total{status="SUCCESS"} ${paymentsSucceeded}`,
      `payments_total{status="REFUNDED"} ${paymentsRefunded}`,
      '# HELP payment_failure_total Failed payment attempts.',
      '# TYPE payment_failure_total counter',
      `payment_failure_total ${paymentFailures}`,
      '# HELP payment_circuit_state Circuit breaker state: 0 closed, 0.5 half-open, 1 open.',
      '# TYPE payment_circuit_state gauge',
      `payment_circuit_state{name="payment-gateway"} ${circuitState}`,
      '# HELP rate_limit_allowed_total Allowed requests by scope.',
      '# TYPE rate_limit_allowed_total counter',
      `rate_limit_allowed_total{scope="user"} ${rateLimitAllowedUser}`,
      `rate_limit_allowed_total{scope="ip"} ${rateLimitAllowedIp}`,
      '# HELP rate_limit_rejected_total Rate-limited requests by scope.',
      '# TYPE rate_limit_rejected_total counter',
      `rate_limit_rejected_total{scope="user"} ${rateLimitRejectedUser}`,
      `rate_limit_rejected_total{scope="ip"} ${rateLimitRejectedIp}`,
      '# HELP idempotency_replay_total Replayed idempotent responses.',
      '# TYPE idempotency_replay_total counter',
      `idempotency_replay_total ${idempotencyReplays}`,
      '# HELP ai_summary_failures_total Failed AI summary generations.',
      '# TYPE ai_summary_failures_total counter',
      `ai_summary_failures_total ${aiSummaryFailures}`,
      '# HELP ai_summary_duration_seconds AI summary generation duration.',
      '# TYPE ai_summary_duration_seconds summary',
      `ai_summary_duration_seconds_count ${aiSummaryDurationCount}`,
      `ai_summary_duration_seconds_sum ${aiSummaryDurationSum}`,
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

  private async metricInt(key: string): Promise<number> {
    try {
      const value = await this.redis.getClient().get(key);
      return value ? parseInt(value, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  private async metricFloat(key: string): Promise<number> {
    try {
      const value = await this.redis.getClient().get(key);
      return value ? Number(value) || 0 : 0;
    } catch {
      return 0;
    }
  }
}
