// Test-only bootstrap. Credentials are held in memory and the mailbox is container-local.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');

assert.match(process.env.T07_TEST_PROJECT ?? '', /^crypta-t30-test-[a-f0-9]{12}$/);
assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
assert.equal(process.env.SMTP_HOST, '127.0.0.1');
assert.equal(process.env.SMTP_PORT, '2527');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, 'postgres');
assert.equal(database.username, 'crypta_t30_test');
assert.equal(database.pathname, '/crypta_t30_test');
assert.equal(new URL(process.env.APP_URL).hostname, '127.0.0.1');

const messages = new Map();
const smtp = net.createServer(socket => {
  socket.on('error', () => {});
  socket.setEncoding('utf8');
  socket.write('220 localhost Crypta fixture\r\n');
  let buffer = '', data = '', to = '', inData = false;
  socket.on('data', chunk => {
    buffer += chunk;
    if (buffer.length + data.length > 65536) { socket.destroy(); return; }
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (inData) {
        if (line === '.') {
          const text = data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
          const match = /\/account\/(activate|reset-password)#token=([A-Za-z0-9_-]{43})/.exec(text);
          if (match) messages.set(to + ':' + match[1], match[2]);
          socket.write('250 captured locally\r\n');
          inData = false;
          data = '';
        } else data += `${line}\r\n`;
      } else if (/^(EHLO|HELO|MAIL FROM|RSET|NOOP)\b/i.test(line)) socket.write('250 localhost\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        to = /<([^>]+)>/.exec(line)?.[1];
        socket.write('250 captured recipient\r\n');
      } else if (line === 'DATA') {
        inData = true;
        socket.write('354 send data\r\n');
      } else if (line === 'QUIT') socket.end('221 closing\r\n');
      else socket.write('500 unknown\r\n');
    }
  });
});

const mailbox = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:2528');
  const token = messages.get(url.searchParams.get('email') + ':' + url.searchParams.get('route'));
  response.writeHead(token ? 200 : 404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
  response.end(token ?? '');
});

smtp.listen(2527, '127.0.0.1', () => {
  mailbox.listen(2528, '127.0.0.1', () => {
    const child = spawn(process.execPath, ['/app/dist/main.js'], { stdio: 'inherit' });
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
    child.once('exit', code => process.exit(code ?? 1));
  });
});
