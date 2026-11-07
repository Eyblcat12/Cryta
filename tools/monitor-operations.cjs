// Independent operations monitor. Each transition is a JSON line on stdout.
const { readFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');

const queueRules = {
  ASSET_QUEUE_DELAYED: ['warning', 'crypto-operations'],
  PROVIDER_RECONCILIATION_REQUIRED: ['critical', 'crypto-operations'],
  EMAIL_QUEUE_DELAYED: ['warning', 'mail-operations'],
  EMAIL_RECONCILIATION_REQUIRED: ['warning', 'mail-operations'],
  EXPIRY_SCAN_FAILED: ['warning', 'job-operations'],
  EXPIRY_SCAN_STALE: ['warning', 'job-operations'],
};
const rules = {
  API_UNAVAILABLE: ['critical', 'platform'],
  DATABASE_UNAVAILABLE: ['critical', 'database'],
  READINESS_PROBE_FAILED: ['warning', 'platform'],
  MONITOR_SIGNAL_ACCESS_FAILED: ['warning', 'platform'],
  MONITOR_SIGNAL_PROBE_FAILED: ['warning', 'platform'],
  ...queueRules,
};
const queueSignals = Object.keys(queueRules);
const bodyLimit = 16_384;

function monitorOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('MONITOR_INVALID_ORIGIN'); }
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MONITOR_INVALID_ORIGIN');
  }
  return url.origin;
}

async function probe(origin, path, timeoutMs, token) {
  try {
    const response = await fetch(origin + '/api/v1' + path, {
      redirect: 'error',
      cache: 'no-store',
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      return { status: response.status };
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > bodyLimit) return { status: 0 };
      chunks.push(chunk);
    }
    return { status: response.status, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { status: 0 };
  }
}

async function collect({ origin, tokenFile, timeoutMs = 4_000 }) {
  const [live, ready] = await Promise.all([
    probe(origin, '/health/live', timeoutMs),
    probe(origin, '/health/ready', timeoutMs),
  ]);
  const apiUp = live.status === 200 && live.body?.data?.status === 'ok';
  const sample = { API_UNAVAILABLE: !apiUp };
  if (!apiUp) return sample;

  const dbUp = ready.status === 200 && ready.body?.data?.status === 'ok' && ready.body?.data?.database === 'connected';
  const dbDown = ready.status === 503 && ready.body?.error?.code === 'DATABASE_UNAVAILABLE';
  if (dbUp || dbDown) sample.DATABASE_UNAVAILABLE = dbDown;
  sample.READINESS_PROBE_FAILED = !dbUp && !dbDown;
  if (!dbUp) return sample;

  let token;
  try { token = (await readFile(tokenFile, 'utf8')).trim(); } catch { /* Invalid credential input. */ }
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return { ...sample, MONITOR_SIGNAL_ACCESS_FAILED: true };

  const response = await probe(origin, '/operations/signals', timeoutMs, token);
  const accessFailed = [401, 403, 404].includes(response.status);
  const signals = response.body?.data?.signals;
  const signalsValid = response.status === 200 && Array.isArray(signals) && signals.every(code => queueSignals.includes(code));
  sample.MONITOR_SIGNAL_ACCESS_FAILED = accessFailed;
  if (!accessFailed) sample.MONITOR_SIGNAL_PROBE_FAILED = !signalsValid;
  if (signalsValid) {
    for (const code of queueSignals) sample[code] = signals.includes(code);
  }
  return sample;
}

class AlertTracker {
  constructor(requiredSamples = 2) {
    this.requiredSamples = requiredSamples;
    this.states = new Map();
  }

  observe(sample) {
    const events = [];
    for (const [code, [severity, owner]] of Object.entries(rules)) {
      const state = this.states.get(code) ?? { open: false, streak: 0 };
      const active = sample[code];
      state.streak = active === undefined || active === state.open ? 0 : state.streak + 1;
      if (state.streak >= this.requiredSamples) {
        state.open = active;
        state.streak = 0;
        events.push({
          event: active ? 'operations.alert_opened' : 'operations.alert_resolved',
          code, severity, owner, timestamp: new Date().toISOString(),
        });
      }
      this.states.set(code, state);
    }
    return events;
  }
}

async function main() {
  const origin = monitorOrigin(process.env.CRYPTA_MONITOR_ORIGIN);
  const tokenFile = process.env.CRYPTA_MONITOR_TOKEN_FILE;
  if (!tokenFile) throw new Error('MONITOR_TOKEN_FILE_REQUIRED');
  const tracker = new AlertTracker();
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  while (!controller.signal.aborted) {
    const sample = await collect({ origin, tokenFile });
    for (const event of tracker.observe(sample)) process.stdout.write(JSON.stringify(event) + '\n');
    try {
      await delay(15_000, undefined, { signal: controller.signal });
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    const startupErrors = ['MONITOR_INVALID_ORIGIN', 'MONITOR_TOKEN_FILE_REQUIRED'];
    const code = startupErrors.includes(error.message) ? error.message : 'MONITOR_FAILED';
    process.stderr.write(JSON.stringify({ event: 'operations.monitor_failed', code }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { AlertTracker, collect, monitorOrigin };
