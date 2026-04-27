import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ChannelSendPayload, NotificationChannel } from './notification-channel.interface';

interface InAppEvent {
  userId: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
  ts: number;
}

/**
 * In-app: emit qua RxJS Subject để SSE controller subscribe.
 * Notification record đã được dispatcher INSERT trước khi gọi send().
 */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = 'IN_APP' as const;
  private readonly logger = new Logger(InAppChannel.name);
  private readonly subject = new Subject<InAppEvent>();

  async send(payload: ChannelSendPayload): Promise<void> {
    this.subject.next({
      userId: payload.to.userId,
      subject: payload.subject,
      body: payload.bodyText,
      metadata: payload.metadata,
      ts: Date.now(),
    });
    this.logger.debug(`IN_APP push for user=${payload.to.userId}: ${payload.subject}`);
  }

  /** Stream cho SSE controller filter theo userId. */
  asObservable() {
    return this.subject.asObservable();
  }
}
