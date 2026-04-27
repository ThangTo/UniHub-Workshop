import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel as ChannelEnum, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { NotificationChannel } from './channels/notification-channel.interface';
import { renderTemplate } from './templates';

export interface DispatchInput {
  /** Event ID dùng cho idempotency (UNIQUE user×template×channel×event). */
  eventId: string;
  userId: string;
  templateId: string;
  vars: Record<string, unknown>;
  /** Override channels nếu cần (mặc định lấy từ template + user preferences). */
  channels?: ChannelEnum[];
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly registry = new Map<ChannelEnum, NotificationChannel>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailChannel,
    private readonly inApp: InAppChannel,
  ) {
    // Đăng ký channels — Strategy registry. Thêm channel mới chỉ cần inject + register ở đây.
    this.registry.set('EMAIL', this.email);
    this.registry.set('IN_APP', this.inApp);
  }

  /**
   * Dispatch notification: render template → resolve channels → INSERT notifications + send.
   * Idempotent qua UNIQUE (userId, template, channel, eventId): worker retry không tạo duplicate.
   */
  async dispatch(input: DispatchInput): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      include: { notificationPrefs: true },
    });
    if (!user) {
      this.logger.warn(`Skip dispatch — user ${input.userId} not found`);
      return;
    }

    const rendered = renderTemplate(input.templateId, input.vars);
    const prefs = user.notificationPrefs?.preferences as
      | Record<string, ChannelEnum[]>
      | undefined;
    const channels =
      input.channels ??
      (prefs?.[input.templateId] as ChannelEnum[] | undefined) ??
      rendered.defaultChannels;

    for (const ch of channels) {
      const adapter = this.registry.get(ch);
      if (!adapter) {
        this.logger.warn(`No adapter for channel=${ch}`);
        continue;
      }
      // Idempotent INSERT — bắt unique violation thì coi như đã gửi
      try {
        await this.prisma.notification.create({
          data: {
            eventId: input.eventId,
            userId: input.userId,
            channel: ch,
            template: input.templateId,
            payload: { vars: input.vars, subject: rendered.subject } as object,
            status: NotificationStatus.QUEUED,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') {
          this.logger.debug(`Notification duplicate skip: user=${input.userId} ${input.templateId}/${ch}/${input.eventId}`);
          continue;
        }
        throw e;
      }

      try {
        await adapter.send({
          to: { userId: user.id, email: user.email, fullName: user.fullName },
          subject: rendered.subject,
          bodyText: rendered.text,
          bodyHtml: rendered.html,
          metadata: { template: input.templateId, eventId: input.eventId },
        });
        await this.prisma.notification.updateMany({
          where: {
            userId: input.userId,
            template: input.templateId,
            channel: ch,
            eventId: input.eventId,
          },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        });
      } catch (e) {
        const msg = (e as Error).message ?? 'unknown';
        this.logger.warn(`Channel ${ch} send failed: ${msg}`);
        await this.prisma.notification.updateMany({
          where: {
            userId: input.userId,
            template: input.templateId,
            channel: ch,
            eventId: input.eventId,
          },
          data: {
            status: NotificationStatus.FAILED,
            attempts: { increment: 1 },
            lastError: msg,
          },
        });
      }
    }
  }
}
