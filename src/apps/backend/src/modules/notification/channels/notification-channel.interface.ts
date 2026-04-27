/**
 * Strategy Pattern: mỗi channel implement interface này.
 * Thêm channel mới (TelegramChannel, ZaloChannel, ...) chỉ cần thêm 1 class
 * + đăng ký provider, không sửa logic nghiệp vụ (specs/notification.md).
 */
export interface NotificationChannel {
  readonly name: 'EMAIL' | 'IN_APP' | 'TELEGRAM';
  send(payload: ChannelSendPayload): Promise<void>;
}

export interface ChannelSendPayload {
  to: { userId: string; email?: string | null; fullName?: string | null };
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  metadata?: Record<string, unknown>;
}
