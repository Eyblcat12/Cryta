// Read-only checks through the HTTPS ingress before opening traffic.
const shell = '<div id="root"></div>';

async function probe(origin, route, status, verify) {
  const response = await fetch(`${origin}${route}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new Error(`${route}: HTTPS request failed.`); });
  try {
    if (response.status !== status || response.headers.has('location')) {
      throw new Error(`${route}: expected HTTP ${status} without Location, got ${response.status}.`);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    const result = await verify(response, contentType);
    console.log(`PASS ${route}`);
    return result;
  } finally {
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

function expect(condition, route, message) {
  if (!condition) throw new Error(`${route}: ${message}`);
}

async function smoke(rawOrigin) {
  const origin = URL.canParse(rawOrigin) ? new URL(rawOrigin) : null;
  if (!origin || origin.protocol !== 'https:' || rawOrigin !== origin.origin) {
    throw new Error('Pass one canonical HTTPS origin without credentials, path, query or fragment.');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('TLS certificate verification must be enabled.');
  }

  async function readShell(route, referrerPolicy) {
    return probe(origin.origin, route, 200, async (response, type) => {
      expect(type === 'text/html', route, 'expected HTML.');
      if (referrerPolicy) {
        expect(response.headers.get('referrer-policy') === referrerPolicy, route, 'expected Referrer-Policy: no-referrer.');
      }
      const html = await response.text();
      expect(html.includes(shell), route, 'expected the application shell.');
      return html;
    });
  }

  async function readJson(route, status, matches) {
    await probe(origin.origin, route, status, async (response, type) => {
      expect(type === 'application/json', route, 'expected JSON.');
      const payload = await response.json().catch(() => null);
      expect(payload && matches(payload), route, 'unexpected API response.');
    });
  }

  await readJson('/api/v1/health/live', 200, body => body.data?.status === 'ok');
  await readJson('/api/v1/health/ready', 200, body => body.data?.status === 'ok' && body.data.database === 'connected');
  const index = await readShell('/');
  await readShell('/assets/smoke-deep-link');
  await readShell('/account/activate', 'no-referrer');
  await readShell('/account/reset-password', 'no-referrer');

  const script = index.match(/\bsrc="(\/assets\/[\w.-]+\.js)"/)?.[1];
  const stylesheet = index.match(/\bhref="(\/assets\/[\w.-]+\.css)"/)?.[1];
  expect(script && stylesheet, '/', 'expected built JavaScript and CSS paths.');
  await probe(origin.origin, script, 200, (_, type) => {
    expect(type === 'text/javascript' || type === 'application/javascript', script, 'expected JavaScript MIME type.');
  });
  await probe(origin.origin, stylesheet, 200, (_, type) => {
    expect(type === 'text/css', stylesheet, 'expected CSS MIME type.');
  });

  const missingChunk = '/assets/__crypta_smoke_missing__.js';
  await probe(origin.origin, missingChunk, 404, async response => {
    expect(!(await response.text()).includes(shell), missingChunk, 'unexpected application shell.');
  });
  await readJson('/api/v1/__crypta_smoke_missing__', 404, body => body.error?.code === 'HTTP_404');
}

if (process.argv.length !== 3) {
  console.error('Usage: node tools/smoke-deployment.cjs <https-origin>');
  process.exitCode = 1;
} else {
  smoke(process.argv[2]).catch(error => {
    console.error(`Deployment smoke failed. ${error.message}`);
    process.exitCode = 1;
  });
}
