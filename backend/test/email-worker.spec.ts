import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { EmailWorkerService } from '../src/notifications/email-worker.service';

const job = { id: 'notification-1', attempt_count: 1, type: 'REQUEST_APPROVED', recipient_email: 'user@example.test', recipient_name: 'User', request_id: 'request-1', asset_id: null };

function setup(sendMail: () => Promise<unknown>, update: (sql: string, values?: unknown[]) => Promise<unknown> = async () => ({ rowCount: 1 })) {
  const query = vi.fn(update);
  const client = { query, on: vi.fn(), removeListener: vi.fn(), release: vi.fn() };
  const worker = new EmailWorkerService({ query, connect: async () => client } as unknown as Pool);
  Object.assign(worker, { transporter: { sendMail: vi.fn(sendMail) } });
  const previous = process.env.SMTP_FROM, previousUrl = process.env.APP_URL;
  process.env.SMTP_FROM = 'Crypta <notify@example.test>';
  process.env.APP_URL = 'http://localhost:8080';
  return { worker, query, restore: () => { if (previous === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = previous;
    if (previousUrl === undefined) delete process.env.APP_URL; else process.env.APP_URL = previousUrl; } };
}

describe('email delivery uncertainty', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('waits for the SMTP result and its database acknowledgement without claiming another email', async () => {
    let sending!: () => void;
    let accept!: () => void;
    const sent = new Promise<void>(resolve => { sending = resolve; });
    const smtpResult = new Promise<void>(resolve => { accept = resolve; });
    const { worker, query, restore } = setup(async () => { sending(); await smtpResult; return { accepted: [job.recipient_email] }; });
    const claim = vi.fn().mockResolvedValueOnce(job).mockResolvedValue(undefined);
    Object.assign(worker, { claim });
    try {
      const active = worker['processBatch']();
      await sent;
      worker.onModuleDestroy();
      const drained = vi.fn();
      const shutdown = worker.beforeApplicationShutdown().then(drained);
      await worker['processBatch']();
      expect(drained).not.toHaveBeenCalled();
      expect(query.mock.calls.some(([sql]) => sql.includes("delivery_status='SENT'"))).toBe(false);
      accept();
      await Promise.all([active, shutdown]);
      expect(claim).toHaveBeenCalledOnce();
      expect(query.mock.calls.filter(([sql]) => sql.includes("delivery_status='SENT'"))).toHaveLength(1);
      expect(drained).toHaveBeenCalledOnce();
    } finally { accept(); restore(); }
  });
  it('does not send an expiry alert after the recipient loses eligibility', async () => {
    const send = vi.fn(async () => ({}));
    const { worker, query, restore } = setup(send, async sql => ({ rowCount: sql.includes("role.code='APPROVER'") ? 0 : 1 }));
    try {
      await worker['deliver']({ ...job, type: 'ASSET_EXPIRED', asset_id: 'asset-1', request_id: null });
      expect(send).not.toHaveBeenCalled();
      const eligibility = query.mock.calls.find(([sql]) => sql.includes("role.code='APPROVER'"));
      expect(eligibility?.[1]).toEqual([job.id]);
      expect(query.mock.calls.some(([sql]) => sql.includes("delivery_status='FAILED'"))).toBe(true);
    } finally { restore(); }
  });
  it('marks invalid application URL as known unsent without contacting SMTP', async () => {
    const send = vi.fn(async () => ({}));
    const { worker, query, restore } = setup(send);
    process.env.APP_URL = 'https://user:secret@example.test/?token=secret';
    try {
      await worker['deliver'](job);
      expect(send).not.toHaveBeenCalled();
      const failure = query.mock.calls.find(([sql]) => sql.includes("delivery_status='FAILED'"));
      expect(failure?.[1]).toEqual(['notification-1', 'Email content could not be prepared']);
    } finally { restore(); }
  });

  it('does not retry when SMTP accepted but database acknowledgement failed', async () => {
    const { worker, query, restore } = setup(async () => ({ accepted: ['user@example.test'] }), async sql => {
      if (sql.includes("delivery_status='SENT'")) throw new Error('DB unavailable');
      return { rowCount: 1 };
    });
    try {
      await worker['deliver'](job);
      expect(query.mock.calls.filter(([sql]) => sql.includes("delivery_status='SENT'"))).toHaveLength(1);
      expect(query.mock.calls.some(([sql]) => sql.includes("delivery_status='PENDING'"))).toBe(false);
      expect(query).toHaveBeenCalledWith('ROLLBACK');
    } finally { restore(); }
  });

  it('marks a network-ambiguous SMTP failure for reconciliation', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const secret = 'synthetic-smtp-credential';
    const { worker, query, restore } = setup(async () => { throw new Error(`connection reset: ${secret}`); });
    try {
      await worker['deliver'](job);
      expect(query.mock.calls.some(([sql]) => sql.includes("delivery_status='RECONCILIATION_REQUIRED'"))).toBe(true);
      expect(JSON.stringify(query.mock.calls)).not.toContain(secret);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally { restore(); }
  });

  it('retries only after an explicit temporary SMTP rejection', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const secret = 'synthetic-smtp-recipient';
    const { worker, query, restore } = setup(async () => {
      throw Object.assign(new Error(`temporary rejection: ${secret}`), { responseCode: 451 });
    });
    try {
      await worker['deliver'](job);
      const retry = query.mock.calls.find(([sql]) => sql.includes("ELSE 'PENDING'"));
      expect(retry?.[1]).toEqual(['notification-1', 'SMTP rejected delivery (451)', 451]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    } finally { restore(); }
  });

  it('does not reach SMTP after the claimed attempt is replaced', async () => {
    const send = vi.fn();
    const { worker, query, restore } = setup(send, async sql => ({ rowCount: sql.includes('FOR UPDATE') ? 0 : 1 }));
    try {
      await worker['deliver'](job);
      expect(send).not.toHaveBeenCalled();
      const fence = query.mock.calls.find(([sql]) => sql.includes('FOR UPDATE'));
      expect(fence?.[1]).toEqual([job.id, job.attempt_count]);
      expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
    } finally { restore(); }
  });

  it('holds an unconfirmed SMTP reply for reconciliation even if sendMail resolves', async () => {
    const { worker, query, restore } = setup(async () => ({ accepted: ['other@example.test'] }));
    try {
      await worker['deliver'](job);
      const writes = query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));
      expect(writes).toHaveLength(1);
      expect(writes[0][0]).toContain("delivery_status='RECONCILIATION_REQUIRED'");
    } finally { restore(); }
  });
});
