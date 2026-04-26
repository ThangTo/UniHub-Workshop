import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AmqpService } from '../../infra/amqp/amqp.service';

/**
 * Transactional Outbox Relay (design.md §3.2).
 *
 * Mỗi 1 giây, đọc tối đa 100 events chưa publish, publish ra RabbitMQ với
 * routing key = eventType, đợi confirm, rồi đánh dấu `published_at`.
 *
 * Chấp nhận at-least-once: nếu publish thành công nhưng update DB fail,
 * lần kế tiếp sẽ publish lại. Consumer phải idempotent (notification table
 * có UNIQUE (user, template, channel, event)).
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit {
  private readonly logger = new Logger(OutboxRelayService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpService,
  ) {}

  onModuleInit(): void {
    this.logger.log('OutboxRelay initialized; will poll every 1s');
  }

  @Interval(1000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: 100,
      });
      if (batch.length === 0) return;

      for (const evt of batch) {
        try {
          await this.amqp.publish(evt.eventType, {
            id: evt.id,
            aggregate: evt.aggregate,
            aggregateId: evt.aggregateId,
            eventType: evt.eventType,
            payload: evt.payload,
            createdAt: evt.createdAt.toISOString(),
          });
          await this.prisma.outboxEvent.update({
            where: { id: evt.id },
            data: { publishedAt: new Date() },
          });
        } catch (e) {
          this.logger.warn(`Outbox publish failed id=${evt.id}: ${(e as Error).message}`);
          // Giữ nguyên publishedAt=NULL → retry tick sau.
        }
      }
    } catch (e) {
      this.logger.error(`OutboxRelay tick error: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
