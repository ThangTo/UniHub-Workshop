import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';
import { AppConfigService } from '../../common/config/app-config.service';

/**
 * Wrapper RabbitMQ với:
 * - 1 ConfirmChannel cho publish (đảm bảo broker đã nhận message).
 * - Helper assertExchange/assertQueue được gọi 1 lần lúc init.
 * - Auto-reconnect khi mất kết nối.
 *
 * Architecture (theo design.md §3 + §5):
 *   Topic exchange `unihub.events` (durable)
 *     - registration.confirmed -> queue notif.registration.confirmed
 *     - registration.cancelled -> queue notif.registration.cancelled
 *     - workshop.updated       -> queue notif.workshop.updated
 *     - workshop.cancelled     -> queue notif.workshop.cancelled
 *     - payment.success        -> queue notif.payment.success
 *     - payment.failed         -> queue notif.payment.failed
 *     - workshop.pdf.uploaded  -> queue ai.summary.generate
 */
@Injectable()
export class AmqpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AmqpService.name);
  private connection?: amqp.Connection | any; // amqplib ChannelModel compat
  private channel?: amqp.ConfirmChannel;

  static readonly EXCHANGE = 'unihub.events';

  constructor(private readonly cfg: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (e) {
      this.logger.warn(`Error closing AMQP: ${(e as Error).message}`);
    }
  }

  private async connect(): Promise<void> {
    const url = this.cfg.rabbitmqUrl;
    try {
      const conn = (await amqp.connect(url)) as any;
      this.connection = conn;
      conn.on('error', (err: Error) => this.logger.error(`AMQP error: ${err.message}`));
      conn.on('close', () => {
        this.logger.warn('AMQP connection closed; reconnect in 3s');
        setTimeout(() => void this.connect(), 3000);
      });

      this.channel = await conn.createConfirmChannel();
      await this.channel!.assertExchange(AmqpService.EXCHANGE, 'topic', { durable: true });
      this.logger.log(`AMQP connected; exchange=${AmqpService.EXCHANGE}`);
    } catch (e) {
      this.logger.error(`AMQP connect failed: ${(e as Error).message}; retry in 3s`);
      setTimeout(() => void this.connect(), 3000);
    }
  }

  /**
   * Publish event với routing key. Đợi confirm trước khi resolve để đảm bảo broker nhận.
   */
  async publish(
    routingKey: string,
    payload: unknown,
    headers: Record<string, string> = {},
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('AMQP channel not ready');
    }
    const buf = Buffer.from(JSON.stringify(payload));
    await new Promise<void>((resolve, reject) => {
      this.channel!.publish(
        AmqpService.EXCHANGE,
        routingKey,
        buf,
        { contentType: 'application/json', persistent: true, headers },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /**
   * Đảm bảo queue tồn tại + bind vào exchange. Idempotent.
   */
  async assertConsumer(queue: string, routingKeys: string[]): Promise<void> {
    if (!this.channel) throw new Error('AMQP channel not ready');
    await this.channel.assertQueue(queue, { durable: true });
    for (const key of routingKeys) {
      await this.channel.bindQueue(queue, AmqpService.EXCHANGE, key);
    }
  }

  /**
   * Đăng ký consumer cho queue. Worker chạy `handler` cho mỗi message;
   * - resolve -> ack
   * - reject  -> nack (requeue=false để chuyển vào DLQ; dev đơn giản: log + drop)
   */
  async consume<T = unknown>(
    queue: string,
    handler: (payload: T, raw: amqp.ConsumeMessage) => Promise<void>,
    opts: { prefetch?: number } = {},
  ): Promise<void> {
    if (!this.channel) throw new Error('AMQP channel not ready');
    await this.channel.prefetch(opts.prefetch ?? 16);
    await this.channel.consume(queue, async (msg) => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString('utf8')) as T;
        await handler(payload, msg);
        this.channel?.ack(msg);
      } catch (e) {
        this.logger.error(`Consumer error on ${queue}: ${(e as Error).message}`);
        this.channel?.nack(msg, false, false);
      }
    });
  }
}
