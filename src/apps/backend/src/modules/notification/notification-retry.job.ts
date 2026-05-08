import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationService } from './notification.service';

@Injectable()
export class NotificationRetryJob {
  private readonly logger = new Logger(NotificationRetryJob.name);
  private running = false;

  constructor(private readonly notifications: NotificationService) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.notifications.retryFailed();
      if (sent > 0) this.logger.log(`Retried ${sent} failed notification(s)`);
    } catch (e) {
      this.logger.warn(`Notification retry failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
