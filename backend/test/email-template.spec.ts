import { describe, expect, it } from 'vitest';
import { accountEmail, emailConfiguration, notificationEmail } from '../src/notifications/email-template';

const config = emailConfiguration({ APP_URL: 'https://crypta.example.test', APP_TIME_ZONE: 'Asia/Ho_Chi_Minh' });
const requestId = '11111111-1111-1111-1111-111111111111', assetId = '22222222-2222-2222-2222-222222222222';

describe('email environment and notification content', () => {
  it.each([undefined, 'javascript:alert(1)', 'http://example.test', 'https://user:secret@example.test',
    'https://example.test/?token=secret', 'https://example.test/#secret', 'https://example.test/subpath'])('rejects unsafe application origin %s without echoing it', appUrl => {
    expect(() => emailConfiguration({ APP_URL: appUrl })).toThrow('EMAIL_APP_URL_INVALID');
  });
  it.each(['http://localhost:8080', 'http://127.0.0.1:18080', 'http://[::1]:8080', 'https://example.test/'])('allows a configured HTTPS or loopback origin %s', appUrl => {
    expect(emailConfiguration({ APP_URL: appUrl }).appUrl).toBe(new URL(appUrl).origin);
  });
  it('rejects an invalid timezone before preparing mail', () => {
    expect(() => emailConfiguration({ APP_URL: config.appUrl, APP_TIME_ZONE: 'unknown' })).toThrow('EMAIL_TIME_ZONE_INVALID');
  });
  it.each(['REQUEST_SUBMITTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_COMPLETED', 'REQUEST_RECONCILIATION_REQUIRED', 'REQUEST_FAILED', 'ASSET_EXPIRING', 'ASSET_EXPIRED', 'ASSET_REVOKED'])('renders %s with only its recipient, correct route and explicit timezone', type => {
    const message = notificationEmail({ type, recipientName: '<img src=x onerror=alert(1)> Nguyễn & "A"', requestId, assetId,
      occurredAt: new Date('2026-11-06T01:02:00Z'), expiresAt: new Date('2026-12-01T01:02:00Z') }, config);
    const route = type.startsWith('REQUEST_') ? `/requests/${requestId}` : `/assets/${assetId}`;
    expect(message.html).toContain(`href="${config.appUrl}${route}"`);
    expect(message.text).toContain(config.appUrl + route);
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
    expect(message.text).toContain('08:02');
    expect(message.text).toContain('(Asia/Ho_Chi_Minh)');
    expect(message.html).not.toContain(type.startsWith('REQUEST_') ? assetId : requestId);
    expect(message.html).not.toMatch(/<script|<iframe/);
  });
  it('keeps independent recipients isolated and omits invalid/missing legacy dates', () => {
    const first = notificationEmail({ type: 'REQUEST_APPROVED', recipientName: 'Recipient A', requestId, occurredAt: 'invalid' }, config);
    const second = notificationEmail({ type: 'ASSET_EXPIRED', recipientName: 'Recipient B', assetId }, config);
    expect(second.html).not.toContain('Recipient A'); expect(first.html).not.toContain('Recipient B');
    expect(first.html).not.toContain('Invalid Date'); expect(second.text).not.toContain('Thời gian thông báo:');
    expect(notificationEmail({ type: 'UNKNOWN', recipientName: 'A', requestId: '<script>' }, config).text).toContain(config.appUrl + '/notifications');
  });
  it('makes approved and reconciliation messages describe their actual stage', () => {
    expect(notificationEmail({ type: 'REQUEST_APPROVED', recipientName: 'A' }, config).text).toContain('đang chờ xử lý');
    expect(notificationEmail({ type: 'REQUEST_RECONCILIATION_REQUIRED', recipientName: 'A' }, config).text).toContain('trước khi gửi lại');
  });
});

describe('purpose-specific account templates awaiting the T07 flow', () => {
  const action = { recipientName: 'Nguyễn A', actionToken: 'A'.repeat(43), expiresAt: new Date('2026-11-06T02:00:00Z'), issuedAt: new Date('2026-11-06T01:00:00Z') };
  it.each(['INVITATION', 'PASSWORD_RESET'] as const)('renders only the %s action and expiration', purpose => {
    const message = accountEmail({ ...action, purpose }, config);
    expect(message.text).toContain(`/account/${purpose === 'INVITATION' ? 'activate' : 'reset-password'}#token=${action.actionToken}`);
    expect(message.text).toContain('09:00'); expect(message.text).toContain('(Asia/Ho_Chi_Minh)'); expect(message.text).toContain('chỉ dùng một lần');
    expect(message.html).not.toContain('/requests/');
  });
  it.each(['short', 'a'.repeat(129), 'x'.repeat(42) + '"', 'x'.repeat(42) + '\n'])('rejects malformed account tokens', actionToken => {
    expect(() => accountEmail({ ...action, purpose: 'PASSWORD_RESET', actionToken }, config)).toThrow('EMAIL_ACCOUNT_ACTION_INVALID');
  });
  it('rejects an invalid purpose or nonpositive expiration', () => {
    expect(() => accountEmail({ ...action, purpose: 'SESSION' as 'INVITATION' }, config)).toThrow('EMAIL_ACCOUNT_ACTION_INVALID');
    expect(() => accountEmail({ ...action, purpose: 'INVITATION', expiresAt: action.issuedAt }, config)).toThrow('EMAIL_ACCOUNT_ACTION_INVALID');
  });
});
