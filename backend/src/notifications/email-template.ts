export type EmailConfiguration = { appUrl: string; timeZone: string };
export type EmailMessage = { subject: string; text: string; html: string };
export type NotificationEmail = {
  type: string;
  recipientName: string;
  requestId?: string | null;
  assetId?: string | null;
  occurredAt?: Date | string | null;
  expiresAt?: Date | string | null;
};

export function emailConfiguration(environment: Record<string, string | undefined>): EmailConfiguration {
  let app: URL;
  try { app = new URL(environment.APP_URL ?? ''); } catch { throw new Error('EMAIL_APP_URL_INVALID'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname);
  if (!(app.protocol === 'https:' || (app.protocol === 'http:' && loopback)) ||
      app.username || app.password || app.search || app.hash || app.pathname !== '/') {
    throw new Error('EMAIL_APP_URL_INVALID');
  }
  const timeZone = environment.APP_TIME_ZONE ?? 'Asia/Ho_Chi_Minh';
  try { new Intl.DateTimeFormat('vi-VN', { timeZone }).format(0); }
  catch { throw new Error('EMAIL_TIME_ZONE_INVALID'); }
  return { appUrl: app.origin, timeZone };
}

const events: Record<string, { title: string; description: string; target: 'request' | 'asset' }> = {
  REQUEST_SUBMITTED: { title: 'Yêu cầu mới cần phê duyệt', description: 'Có yêu cầu mới trong phạm vi bạn phụ trách. Đăng nhập để xem nội dung và quyết định phê duyệt.', target: 'request' },
  REQUEST_SECOND_APPROVAL: { title: 'Yêu cầu cần phê duyệt cấp hai', description: 'Một yêu cầu trong phạm vi bạn phụ trách đã qua cấp một. Đăng nhập để kiểm tra và đưa ra quyết định trước thời hạn.', target: 'request' },
  REQUEST_APPROVED: { title: 'Yêu cầu đã được phê duyệt', description: 'Yêu cầu của bạn đã được duyệt và đang chờ xử lý. Bạn có thể theo dõi trạng thái trong Crypta.', target: 'request' },
  REQUEST_REJECTED: { title: 'Yêu cầu đã bị từ chối', description: 'Yêu cầu của bạn đã bị từ chối. Đăng nhập để xem quyết định và lý do.', target: 'request' },
  REQUEST_COMPLETED: { title: 'Yêu cầu đã hoàn tất', description: 'Crypta đã hoàn tất xử lý yêu cầu của bạn. Đăng nhập để xem kết quả và tài sản liên quan.', target: 'request' },
  REQUEST_FAILED: { title: 'Yêu cầu kết thúc do lỗi xử lý', description: 'Quản trị viên đã đóng yêu cầu sau khi kiểm tra kết quả xử lý. Đăng nhập để xem trạng thái yêu cầu.', target: 'request' },
  REQUEST_RECONCILIATION_REQUIRED: { title: 'Kết quả xử lý cần được kiểm tra', description: 'Kết quả xử lý yêu cầu chưa được xác nhận đầy đủ. Vui lòng theo dõi trạng thái hoặc liên hệ quản trị viên trước khi gửi lại yêu cầu.', target: 'request' },
  ASSET_EXPIRING: { title: 'Tài sản sắp hết hạn', description: 'Tài sản trong phạm vi bạn theo dõi sắp hết hạn. Đăng nhập để kiểm tra thời hạn và hướng xử lý phù hợp.', target: 'asset' },
  ASSET_EXPIRED: { title: 'Tài sản đã hết hạn', description: 'Tài sản trong phạm vi bạn theo dõi đã hết hạn. Đăng nhập để kiểm tra trạng thái và hướng xử lý phù hợp.', target: 'asset' },
  ASSET_REVOKED: { title: 'Tài sản đã bị thu hồi', description: 'Tài sản của bạn đã được thu hồi. Đăng nhập để xem trạng thái và lịch sử.', target: 'asset' },
};
const escape = (value: string) => value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]!));
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function dateLabel(value: Date | string | null | undefined, config: EmailConfiguration) {
  if (value == null) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: config.timeZone, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).format(date) + ` (${config.timeZone})`;
}

function message(input: { title: string; description: string; recipientName: string; actionUrl: string; actionLabel: string; details: Array<[string, string]>; footer: string }): EmailMessage {
  const subject = `Crypta - ${input.title}`;
  const text = [`Xin chào ${input.recipientName},`, '', input.title, input.description, '',
    ...input.details.map(([label, value]) => `${label}: ${value}`), '', `${input.actionLabel}: ${input.actionUrl}`, '',
    input.footer, 'Đây là email tự động từ Crypta. Vui lòng không trả lời email này.'].join('\n');
  const detailRows = input.details.map(([label, value]) => `<p style="margin:12px 0;color:#374151"><strong>${escape(label)}:</strong> <span style="overflow-wrap:anywhere;word-break:break-word">${escape(value)}</span></p>`).join('');
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;background:#f3f4f6;color:#17202b;font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #d1d5db;border-radius:8px"><tr><td style="padding:28px 24px">
<p style="margin:0 0 24px;font-size:24px;font-weight:bold;color:#a3320d">Crypta</p>
<p style="margin:0 0 16px;overflow-wrap:anywhere;word-break:break-word">Xin chào ${escape(input.recipientName)},</p>
<h1 style="font-size:22px;line-height:1.35;margin:0 0 16px">${escape(input.title)}</h1>
<p style="margin:0 0 20px">${escape(input.description)}</p>${detailRows}
<p style="margin:24px 0"><a href="${escape(input.actionUrl)}" style="display:inline-block;background:#173b35;color:#ffffff;font-weight:bold;text-decoration:underline;padding:12px 18px;border-radius:4px">${escape(input.actionLabel)}</a></p>
<p style="margin:0 0 8px;font-size:14px;color:#374151">Nếu nút không mở được, hãy sao chép liên kết:</p>
<p style="margin:0 0 24px;overflow-wrap:anywhere;word-break:break-word;font-size:14px"><a href="${escape(input.actionUrl)}" style="color:#173b35">${escape(input.actionUrl)}</a></p>
<p style="border-top:1px solid #d1d5db;padding-top:20px;margin:0;font-size:14px;color:#4b5563">${escape(input.footer)}<br>Đây là email tự động từ Crypta. Vui lòng không trả lời email này.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export function notificationEmail(input: NotificationEmail, config: EmailConfiguration): EmailMessage {
  const event = events[input.type];
  const reference = event?.target === 'request' ? input.requestId : event?.target === 'asset' ? input.assetId : undefined;
  const actionUrl = reference && uuid.test(reference)
    ? `${config.appUrl}/${event.target === 'request' ? 'requests' : 'assets'}/${reference}`
    : `${config.appUrl}/notifications`;
  const details: Array<[string, string]> = [];
  if (reference) details.push(['Mã tham chiếu', reference]);
  const occurred = dateLabel(input.occurredAt, config);
  if (occurred) details.push(['Thời gian thông báo', occurred]);
  const expiry = event?.target === 'asset' && input.type !== 'ASSET_REVOKED' ? dateLabel(input.expiresAt, config) : undefined;
  if (expiry) details.push(['Hết hạn', expiry]);
  return message({ title: event?.title ?? 'Thông báo hệ thống', description: event?.description ?? 'Có cập nhật mới dành cho bạn. Đăng nhập Crypta để xem chi tiết.',
    recipientName: input.recipientName, actionUrl, actionLabel: reference && uuid.test(reference) ? 'Xem chi tiết trong Crypta' : 'Mở trung tâm thông báo', details,
    footer: 'Bạn cần đăng nhập và có quyền truy cập để xem chi tiết. Email này không chứa khóa bí mật hoặc nội dung chi tiết của yêu cầu.' });
}

// T07 supplies and consumes these purpose-specific, expiring tokens; this renderer never creates a session.
export function accountEmail(input: { purpose: 'INVITATION' | 'PASSWORD_RESET'; recipientName: string; actionToken: string; expiresAt: Date; issuedAt: Date }, config: EmailConfiguration): EmailMessage {
  if (!['INVITATION', 'PASSWORD_RESET'].includes(input.purpose) || !/^[A-Za-z0-9_-]{43,128}$/.test(input.actionToken) ||
      !Number.isFinite(input.expiresAt.getTime()) || !Number.isFinite(input.issuedAt.getTime()) || input.expiresAt <= input.issuedAt) throw new Error('EMAIL_ACCOUNT_ACTION_INVALID');
  const invitation = input.purpose === 'INVITATION';
  const actionUrl = `${config.appUrl}/account/${invitation ? 'activate' : 'reset-password'}#token=${encodeURIComponent(input.actionToken)}`;
  return message({ title: invitation ? 'Lời mời sử dụng Crypta' : 'Đặt lại mật khẩu Crypta',
    description: invitation ? 'Bạn được mời sử dụng Crypta. Mở liên kết để đặt mật khẩu ban đầu cho tài khoản của mình.' : 'Crypta nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Nếu bạn đã yêu cầu, hãy mở liên kết để chọn mật khẩu mới.',
    recipientName: input.recipientName, actionUrl, actionLabel: invitation ? 'Đặt mật khẩu ban đầu' : 'Đặt lại mật khẩu',
    details: [['Liên kết hết hạn', dateLabel(input.expiresAt, config)!]],
    footer: 'Liên kết chỉ dành cho bạn và chỉ dùng một lần cho thao tác này. Không chuyển tiếp email. Nếu không yêu cầu hoặc không nhận ra lời mời, hãy bỏ qua email và liên hệ quản trị viên.' });
}

export function passwordResetCompletedEmail(recipientName: string, config: EmailConfiguration): EmailMessage {
  return message({
    title: 'Mật khẩu Crypta đã được đặt lại',
    description: 'Mật khẩu của tài khoản đã thay đổi. Bạn cần đăng nhập lại bằng mật khẩu mới.',
    recipientName,
    actionUrl: config.appUrl,
    actionLabel: 'Mở Crypta',
    details: [],
    footer: 'Nếu bạn không thực hiện thay đổi này, hãy liên hệ quản trị viên ngay.',
  });
}

export function mfaSecurityChangedEmail(recipientName: string, occurredAt: Date | string | null, config: EmailConfiguration): EmailMessage {
  const occurred = dateLabel(occurredAt, config);
  return message({
    title: 'Cập nhật xác thực hai bước trong Crypta',
    description: 'Tài khoản của bạn vừa có thao tác thiết lập, thay ứng dụng xác thực, khôi phục quyền truy cập hoặc tạo bộ mã khôi phục mới.',
    recipientName,
    actionUrl: config.appUrl,
    actionLabel: 'Mở Crypta',
    details: occurred ? [['Thời gian', occurred]] : [],
    footer: 'Nếu bạn không thực hiện thao tác này, hãy liên hệ quản trị viên ngay.',
  });
}
