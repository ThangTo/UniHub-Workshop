import * as Handlebars from 'handlebars';
import { NotificationChannel } from '@prisma/client';

export interface RenderedTemplate {
  subject: string;
  text: string;
  html: string;
  defaultChannels: NotificationChannel[];
}

interface TemplateDef {
  subject: string;
  text: string;
  html: string;
  defaultChannels: NotificationChannel[];
}

/** Phiên bản 1.0 — bốn template phục vụ Phase 2 (specs/notification.md §Templates). */
const RAW_TEMPLATES: Record<string, TemplateDef> = {
  registration_confirmed: {
    subject: '✅ Đăng ký workshop "{{workshopTitle}}" thành công',
    text: 'Chào {{userName}},\n\nBạn đã đăng ký thành công workshop "{{workshopTitle}}" diễn ra lúc {{startAt}} tại {{roomName}}.\n\nMã đăng ký: {{regId}}\n\nVui lòng giữ QR check-in trong tài khoản UniHub.',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Bạn đã đăng ký thành công workshop <b>"{{workshopTitle}}"</b> diễn ra lúc <b>{{startAt}}</b> tại <b>{{roomName}}</b>.</p>' +
      '<p>Mã đăng ký: <code>{{regId}}</code></p>' +
      '<p>Vui lòng giữ QR check-in trong tài khoản UniHub.</p>',
    defaultChannels: ['EMAIL', 'IN_APP'],
  },
  payment_succeeded: {
    subject: '💳 Thanh toán workshop "{{workshopTitle}}" thành công',
    text: 'Chào {{userName}},\n\nThanh toán {{amount}} VND cho workshop "{{workshopTitle}}" đã thành công.\nMã giao dịch: {{gatewayTxnId}}',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Thanh toán <b>{{amount}} VND</b> cho workshop <b>"{{workshopTitle}}"</b> đã thành công.</p>' +
      '<p>Mã giao dịch: <code>{{gatewayTxnId}}</code></p>',
    defaultChannels: ['EMAIL', 'IN_APP'],
  },
  payment_failed: {
    subject: '⚠️ Thanh toán workshop "{{workshopTitle}}" thất bại',
    text: 'Chào {{userName}},\n\nThanh toán cho workshop "{{workshopTitle}}" thất bại ({{reason}}). Vui lòng thử lại trước khi hết hạn giữ ghế.',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Thanh toán cho workshop <b>"{{workshopTitle}}"</b> thất bại: <i>{{reason}}</i>.</p>' +
      '<p>Vui lòng thử lại trước khi hết hạn giữ ghế.</p>',
    defaultChannels: ['EMAIL'],
  },
  hold_expired: {
    subject: '⏰ Ghế giữ cho workshop "{{workshopTitle}}" đã hết hạn',
    text: 'Chào {{userName}},\n\nGhế giữ cho workshop "{{workshopTitle}}" đã hết hạn do bạn chưa hoàn tất thanh toán. Bạn có thể đăng ký lại nếu còn ghế.',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Ghế giữ cho workshop <b>"{{workshopTitle}}"</b> đã hết hạn do bạn chưa hoàn tất thanh toán.</p>' +
      '<p>Bạn có thể đăng ký lại nếu còn ghế.</p>',
    defaultChannels: ['IN_APP'],
  },
  checkin_succeeded: {
    subject: '🎫 Bạn đã check-in workshop "{{workshopTitle}}"',
    text: 'Chào {{userName}},\n\nBạn vừa check-in thành công workshop "{{workshopTitle}}" lúc {{scannedAt}}. Chúc bạn có buổi học hữu ích!',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Bạn vừa check-in thành công workshop <b>"{{workshopTitle}}"</b> lúc <b>{{scannedAt}}</b>.</p>' +
      '<p>Chúc bạn có buổi học hữu ích!</p>',
    defaultChannels: ['IN_APP'],
  },
  registration_cancelled: {
    subject: '❌ Bạn đã huỷ đăng ký workshop "{{workshopTitle}}"',
    text: 'Chào {{userName}},\n\nBạn vừa huỷ đăng ký workshop "{{workshopTitle}}". {{#if refundRequired}}Hệ thống sẽ tự hoàn tiền trong 1-3 ngày làm việc.{{/if}}',
    html:
      '<p>Chào <b>{{userName}}</b>,</p>' +
      '<p>Bạn vừa huỷ đăng ký workshop <b>"{{workshopTitle}}"</b>.</p>' +
      '{{#if refundRequired}}<p>Hệ thống sẽ tự hoàn tiền trong 1-3 ngày làm việc.</p>{{/if}}',
    defaultChannels: ['EMAIL', 'IN_APP'],
  },
};

const COMPILED = new Map<
  string,
  {
    subject: HandlebarsTemplateDelegate;
    text: HandlebarsTemplateDelegate;
    html: HandlebarsTemplateDelegate;
    defaults: NotificationChannel[];
  }
>();

for (const [k, v] of Object.entries(RAW_TEMPLATES)) {
  COMPILED.set(k, {
    subject: Handlebars.compile(v.subject),
    text: Handlebars.compile(v.text),
    html: Handlebars.compile(v.html),
    defaults: v.defaultChannels,
  });
}

export function renderTemplate(
  templateId: string,
  vars: Record<string, unknown>,
): RenderedTemplate {
  const t = COMPILED.get(templateId);
  if (!t) throw new Error(`unknown_template: ${templateId}`);
  return {
    subject: t.subject(vars),
    text: t.text(vars),
    html: t.html(vars),
    defaultChannels: t.defaults,
  };
}

export const ALL_TEMPLATE_IDS = Object.keys(RAW_TEMPLATES);
