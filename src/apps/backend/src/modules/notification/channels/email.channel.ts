import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppConfigService } from '../../../common/config/app-config.service';
import { ChannelSendPayload, NotificationChannel } from './notification-channel.interface';

/**
 * Gửi email qua SMTP. Dev dùng Mailhog (host=localhost, port=1025).
 */
@Injectable()
export class EmailChannel implements NotificationChannel, OnModuleInit {
  readonly name = 'EMAIL' as const;
  private readonly logger = new Logger(EmailChannel.name);
  private transporter!: nodemailer.Transporter;

  constructor(private readonly cfg: AppConfigService) {}

  onModuleInit(): void {
    const { host, port } = this.cfg.smtp;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      ignoreTLS: true, // mailhog không yêu cầu TLS
    });
    this.logger.log(`SMTP transport ready ${host}:${port}`);
  }

  async send(payload: ChannelSendPayload): Promise<void> {
    if (!payload.to.email) {
      this.logger.debug(`Skip EMAIL for user=${payload.to.userId}: no email`);
      return;
    }
    await this.transporter.sendMail({
      from: this.cfg.smtp.from,
      to: payload.to.email,
      subject: payload.subject,
      text: payload.bodyText,
      html: payload.bodyHtml,
    });
    this.logger.debug(`EMAIL sent to ${payload.to.email}: ${payload.subject}`);
  }
}
