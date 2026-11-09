import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext, getCACertificates, setDefaultCACertificates, TLSSocket, type SecureContext } from 'node:tls';
import nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { EmailTestService } from '../src/notifications/email-test.service';
import { EmailWorkerService } from '../src/notifications/email-worker.service';

const admin = { id: '11111111-1111-4111-8111-111111111111', roles: ['ADMIN'], tokenVersion: 1 } as unknown as AuthUser;
const smtpUser = 'fixture';
const smtpPassword = 'synthetic-smtp-password';

async function starttlsCertificate() {
  const directory = await mkdtemp(join(tmpdir(), 'crypta-starttls-'));
  const keyFile = join(directory, 'relay.key');
  const certFile = join(directory, 'relay.pem');
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=Crypta SMTP test CA', '-addext', 'subjectAltName=IP:127.0.0.1',
      '-keyout', keyFile, '-out', certFile], { stdio: 'pipe', timeout: 10_000 });
    const [key, cert] = await Promise.all([readFile(keyFile), readFile(certFile, 'utf8')]);
    return { cert, context: createSecureContext({ key, cert }) };
  } finally {
    await Promise.all([rm(keyFile, { force: true }), rm(certFile, { force: true })]);
    await rmdir(directory);
  }
}

// This suite exercises the real nodemailer transport against an in-process SMTP
// server bound to IPv4 loopback. It does not use Docker, DNS or an external inbox.
async function fixture(mode: 'accept' | 'reject' | 'disconnect', failResultAudit = false, starttls?: SecureContext) {
  const sockets = new Set<Socket>(), messages: string[] = [], commands: string[] = [];
  const encryptedCommands: string[] = [];
  function readCommands(socket: Socket, encrypted: boolean) {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = '', body = '', inData = false, authenticated = false;
    const receive = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            messages.push(body); body = ''; inData = false;
            if (mode === 'disconnect') socket.destroy(); else socket.write('250 accepted locally\r\n');
          } else body += line + '\r\n';
        } else {
          const verb = line.split(/[ :]/, 1)[0].toUpperCase();
          (encrypted ? encryptedCommands : commands).push(verb);
          if (starttls && verb === 'EHLO') {
            socket.write(encrypted ? '250-localhost\r\n250 AUTH PLAIN\r\n' : '250-localhost\r\n250 STARTTLS\r\n');
          } else if (starttls && !encrypted && verb === 'STARTTLS') {
            socket.off('data', receive);
            socket.write('220 Ready to start TLS\r\n');
            readCommands(new TLSSocket(socket, { isServer: true, secureContext: starttls }), true);
            return;
          } else if (starttls && encrypted && verb === 'AUTH') {
            const expected = Buffer.from(`\0${smtpUser}\0${smtpPassword}`).toString('base64');
            authenticated = line === `AUTH PLAIN ${expected}`;
            socket.write(authenticated ? '235 authenticated\r\n' : '535 authentication failed\r\n');
          } else if (starttls && ['AUTH', 'MAIL', 'RCPT', 'DATA'].includes(verb) && !authenticated) {
            socket.write('530 authentication and TLS required\r\n');
          } else if (/^RCPT TO:/i.test(line)) socket.write(mode === 'reject' ? '550 synthetic-private-smtp-response\r\n' : '250 recipient ok\r\n');
          else if (line === 'DATA') { inData = true; socket.write('354 send body\r\n'); }
          else if (line === 'STARTTLS') socket.write('454 TLS unavailable\r\n');
          else if (line === 'QUIT') socket.end('221 closing\r\n');
          else socket.write('250 localhost\r\n');
        }
      }
    };
    socket.on('data', receive);
  }
  const server = createServer(socket => {
    readCommands(socket, false);
    socket.write('220 localhost SMTP fixture\r\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('SMTP_LOOPBACK_BIND_FAILED');
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM users u')) return { rows: [{ status: 'ACTIVE', token_version: 1, is_admin: true, is_active: true }] };
    if (sql.includes('global_count')) return { rows: [{ actor_count: 0, global_count: 0 }] };
    return { rows: [], rowCount: 1 };
  });
  const resultQuery = vi.fn(async () => { if (failResultAudit) throw new Error('bookkeeping unavailable'); return { rows: [], rowCount: 1 }; });
  const connect = async () => ({ query, release: vi.fn() });
  const worker = new EmailWorkerService({ connect, query: async (sql: string) => ({ rows: [], rowCount: sql.includes('email_worker_status') ? 1 : 0 }) } as unknown as Pool);
  if (!starttls) Object.assign(worker, { transporter: nodemailer.createTransport({ host: '127.0.0.1', port: address.port,
    secure: false, connectionTimeout: 1000, greetingTimeout: 1000, socketTimeout: 1000 }) });
  const service = new EmailTestService({ connect, query: resultQuery } as unknown as Pool, worker);
  return { worker, service, messages, commands, encryptedCommands, port: address.port, resultQuery, close: async () => {
    worker.onModuleDestroy();
    await worker.beforeApplicationShutdown();
    worker.onApplicationShutdown();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('test email real SMTP protocol with mocked database', () => {
  it('authenticates and sends DATA only after a trusted STARTTLS handshake', async () => {
    const relay = await starttlsCertificate();
    const test = await fixture('accept', false, relay.context);
    const trusted = getCACertificates();
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '1');
    vi.stubEnv('SMTP_ENABLED', 'true');
    vi.stubEnv('SMTP_SECURE', 'false');
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(test.port));
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.invalid>');
    vi.stubEnv('SMTP_USER', smtpUser);
    vi.stubEnv('SMTP_PASSWORD', smtpPassword);
    vi.stubEnv('APP_URL', 'https://crypta.example.invalid');
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    try {
      await expect(test.worker.onModuleInit()).rejects.toThrow('SMTP_VERIFY_FAILED');
      expect(test.commands).toContain('STARTTLS');
      expect(test.encryptedCommands).toHaveLength(0);
      setDefaultCACertificates([...trusted, relay.cert]);
      await test.worker.onModuleInit();
      const result = await test.service.send(admin, 'test-recipient@example.invalid');
      expect(result.sent).toBe(true);
      expect(test.commands).not.toContain('AUTH');
      expect(test.commands).not.toContain('DATA');
      expect(test.encryptedCommands.filter(command => command === 'AUTH')).toHaveLength(2);
      expect(test.encryptedCommands.filter(command => command === 'DATA')).toHaveLength(1);
      expect(test.messages).toHaveLength(1);
      expect(test.messages[0]).toContain(`<email-test-${result.operationId}@example.invalid>`);
      expect(test.resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_ACCEPTED');
    } finally {
      setDefaultCACertificates(trusted);
      await test.close();
    }
  });

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
