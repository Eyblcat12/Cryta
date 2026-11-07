import 'reflect-metadata';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { EmailTestService } from '../src/notifications/email-test.service';
import { EmailWorkerService } from '../src/notifications/email-worker.service';

const admin = { id: '11111111-1111-4111-8111-111111111111', roles: ['ADMIN'], tokenVersion: 1 } as unknown as AuthUser;
// This suite exercises the real nodemailer transport against an in-process SMTP
// server bound to IPv4 loopback. It does not use Docker, DNS or an external inbox.
async function fixture(mode: 'accept' | 'reject' | 'disconnect', failResultAudit = false) {
  const sockets = new Set<Socket>(), messages: string[] = [], commands: string[] = [];
  const server = createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setEncoding('utf8'); socket.write('220 localhost SMTP fixture\r\n');
    let buffer = '', body = '', inData = false;
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            messages.push(body); body = ''; inData = false;
            if (mode === 'disconnect') socket.destroy(); else socket.write('250 accepted locally\r\n');
          } else body += line + '\r\n';
        } else {
          commands.push(line.split(/[ :]/, 1)[0].toUpperCase());
          if (/^RCPT TO:/i.test(line)) socket.write(mode === 'reject' ? '550 synthetic-private-smtp-response\r\n' : '250 recipient ok\r\n');
          else if (line === 'DATA') { inData = true; socket.write('354 send body\r\n'); }
          else if (line === 'STARTTLS') socket.write('454 TLS unavailable\r\n');
          else if (line === 'QUIT') socket.end('221 closing\r\n');
          else socket.write('250 localhost\r\n');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SMTP_LOOPBACK_BIND_FAILED');
  const transport = nodemailer.createTransport({ host: '127.0.0.1', port: address.port, secure: false,
    connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000 });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM users u')) return { rows: [{ status: 'ACTIVE', token_version: 1, is_admin: true, is_active: true }] };
    if (sql.includes('global_count')) return { rows: [{ actor_count: 0, global_count: 0 }] };
    return { rows: [], rowCount: 1 };
  });
  const resultQuery = vi.fn(async () => { if (failResultAudit) throw new Error('bookkeeping unavailable'); return { rows: [], rowCount: 1 }; });
  const worker = new EmailWorkerService({} as Pool); Object.assign(worker, { transporter: transport });
  const service = new EmailTestService({ connect: async () => ({ query, release: vi.fn() }), query: resultQuery } as unknown as Pool, worker);
  return { service, messages, commands, port: address.port, resultQuery, close: async () => {
    transport.close(); for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('test email real SMTP protocol with mocked database', () => {
  it('refuses a STARTTLS failure before sending credentials or mail', async () => {
    const test = await fixture('accept');
    vi.stubEnv('SMTP_ENABLED', 'true');
    vi.stubEnv('SMTP_SECURE', 'false');
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(test.port));
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>');
    vi.stubEnv('SMTP_USER', 'fixture');
    vi.stubEnv('SMTP_PASSWORD', 'synthetic-smtp-password');
    vi.stubEnv('APP_URL', 'https://crypta.example.invalid');
    const logger = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const worker = new EmailWorkerService({} as Pool);
    try {
      await expect(worker.onModuleInit()).rejects.toThrow('SMTP_VERIFY_FAILED');
      expect(test.commands).toContain('STARTTLS');
      expect(test.commands).not.toContain('AUTH');
      expect(test.messages).toHaveLength(0);
      expect(logger).toHaveBeenCalledWith({ event: 'email.smtp_verify_failed' });
      expect(() => worker.assertTestReady()).toThrow();
    } finally { await test.close(); }
  });
  it('rejects an invalid port and incomplete authentication before connecting', async () => {
    const test = await fixture('accept');
    vi.stubEnv('SMTP_ENABLED', 'true');
    vi.stubEnv('SMTP_SECURE', 'false');
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>');
    vi.stubEnv('SMTP_USER', 'fixture');
    vi.stubEnv('SMTP_PASSWORD', '');
    vi.stubEnv('APP_URL', 'https://crypta.example.invalid');
    const worker = new EmailWorkerService({} as Pool);
    try {
      vi.stubEnv('SMTP_PORT', '70000');
      await expect(worker.onModuleInit()).rejects.toThrow('SMTP_PORT_INVALID');
      vi.stubEnv('SMTP_PORT', String(test.port));
      await expect(worker.onModuleInit()).rejects.toThrow('SMTP_AUTH_INCOMPLETE');
      expect(test.commands).toHaveLength(0);
    } finally { await test.close(); }
  });
  it('returns success only after the requested recipient and DATA are accepted', async () => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>'); const test = await fixture('accept');
    try {
      const result = await test.service.send(admin, 'test-recipient@example.invalid');
      expect(result.sent).toBe(true); expect(test.messages).toHaveLength(1);
      expect(test.messages[0]).toContain(`<email-test-${result.operationId}@example.invalid>`);
      expect(test.resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_ACCEPTED');
    } finally { await test.close(); }
  });
  it('records a real 550 refusal without transmitting DATA or exposing the server response', async () => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>'); const test = await fixture('reject');
    try {
      await expect(test.service.send(admin, 'test-recipient@example.invalid')).rejects.toMatchObject({ response: { code: 'SMTP_TEST_REJECTED' } });
      expect(test.messages).toHaveLength(0); expect(test.resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_REJECTED');
      expect(JSON.parse(test.resultQuery.mock.calls[0][1][4]).smtpStatus).toBe(550);
      expect(JSON.stringify(test.resultQuery.mock.calls)).not.toContain('synthetic-private-smtp-response');
    } finally { await test.close(); }
  });
  it('does not replay DATA after the server records it and disconnects before acknowledgement', async () => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>'); const test = await fixture('disconnect');
    try {
      await expect(test.service.send(admin, 'test-recipient@example.invalid')).rejects.toMatchObject({ response: { code: 'SMTP_TEST_OUTCOME_UNKNOWN' } });
      expect(test.messages).toHaveLength(1); expect(test.resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_OUTCOME_UNKNOWN');
    } finally { await test.close(); }
  });
  it('does not replay accepted DATA when the result audit fails', async () => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>'); vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const test = await fixture('accept', true);
    try {
      await expect(test.service.send(admin, 'test-recipient@example.invalid')).rejects.toMatchObject({ response: { code: 'SMTP_TEST_ACKNOWLEDGEMENT_FAILED' } });
      expect(test.messages).toHaveLength(1); expect(test.resultQuery).toHaveBeenCalledOnce();
    } finally { await test.close(); }
  });
});
