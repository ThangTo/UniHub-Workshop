import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/inapp.channel';
import { NotificationController } from './notification.controller';
import { NotificationRetryJob } from './notification-retry.job';
import { NotificationService } from './notification.service';
import { NotificationWorker } from './notification.worker';

/**
 * Notification module — Strategy Pattern (specs/notification.md).
 * Đăng ký mỗi NotificationChannel làm provider; thêm channel mới chỉ cần thêm 1 class.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    EmailChannel,
    InAppChannel,
    NotificationService,
    NotificationWorker,
    NotificationRetryJob,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
