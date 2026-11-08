// Independent operations monitor. Each transition is a JSON line on stdout.
const { randomUUID } = require('node:crypto');
const { open, readFile, rename, unlink } = require('node:fs/promises');
const { relative } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const queueRules = {
  ASSET_QUEUE_DELAYED: ['warning', 'crypto-operations'],
  PROVIDER_RECONCILIATION_REQUIRED: ['critical', 'crypto-operations'],
  EMAIL_QUEUE_DELAYED: ['warning', 'mail-operations'],
  EMAIL_WORKER_FAILED: ['warning', 'mail-operations'],
  EMAIL_WORKER_STALE: ['warning', 'mail-operations'],
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
  constructor(requiredSamples = 2, openCodes = []) {
    this.requiredSamples = requiredSamples;
    this.states = new Map(openCodes.map(code => [code, { open: true, streak: 0 }]));
  }

  openCodes() {
    return [...this.states].filter(([, state]) => state.open).map(([code]) => code);
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
          eventId: randomUUID(), code, severity, owner, timestamp: new Date().toISOString(),
        });
      }
      this.states.set(code, state);
    }
    return events;
  }
}

const version = 1;
const codes = Object.keys(rules);
const opened = 'operations.alert_opened';
const resolved = 'operations.alert_resolved';

function parseState(raw, origin) {
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error('MONITOR_INVALID_STATE'); }
  if (state?.version !== version || state.origin !== origin || !Array.isArray(state.openCodes) ||
      new Set(state.openCodes).size !== state.openCodes.length || !state.openCodes.every(code => codes.includes(code)) ||
      !Array.isArray(state.pending) || state.pending.length > codes.length) throw new Error('MONITOR_INVALID_STATE');
  const pendingCodes = new Set();
  const pendingIds = new Set();
  const pending = state.pending.map(item => {
    const { code, event, eventId, timestamp } = item ?? {};
    if (!codes.includes(code) || pendingCodes.has(code) || pendingIds.has(eventId) ||
        event !== (state.openCodes.includes(code) ? opened : resolved) ||
        typeof eventId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(eventId) ||
        typeof timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp) ||
        !Number.isFinite(Date.parse(timestamp))) throw new Error('MONITOR_INVALID_STATE');
    pendingCodes.add(code);
    pendingIds.add(eventId);
    const [severity, owner] = rules[code];
    return { event, eventId, code, severity, owner, timestamp };
  });
  return { openCodes: state.openCodes, pending };
}

class MonitorJournal {
  constructor(file, origin) {
    this.file = file;
    this.origin = origin;
  }

  async load() {
    let raw;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { openCodes: [], pending: [] };
      throw error;
    }
    return parseState(raw, this.origin);
  }

  async save(openCodes, pending) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify({ version, origin: this.origin, openCodes, pending }) + '\n');
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
}

async function publishAlerts(events, tracker, journal, write, alreadyPending = false) {
  if (!events.length) return;
  const openCodes = tracker.openCodes();
  if (!alreadyPending) await journal?.save(openCodes, events);
  for (const event of events) await write(event);
  await journal?.save(openCodes, []);
}

async function main() {
  const origin = monitorOrigin(process.env.CRYPTA_MONITOR_ORIGIN);
  const tokenFile = process.env.CRYPTA_MONITOR_TOKEN_FILE;
  if (!tokenFile) throw new Error('MONITOR_TOKEN_FILE_REQUIRED');
  const stateFile = process.env.CRYPTA_MONITOR_STATE_FILE;
  if (stateFile && relative(stateFile, tokenFile) === '') throw new Error('MONITOR_INVALID_STATE');
  const journal = stateFile ? new MonitorJournal(stateFile, origin) : undefined;
  const saved = await journal?.load();
  const tracker = new AlertTracker(2, saved?.openCodes);
  const write = event => new Promise((done, reject) => {
    process.stdout.write(JSON.stringify(event) + '\n', error => error ? reject(error) : done());
  });
  process.stdout.on('error', () => { /* The write callback reports delivery failure. */ });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  await publishAlerts(saved?.pending ?? [], tracker, journal, write, true);
  while (!controller.signal.aborted) {
    const sample = await collect({ origin, tokenFile });
    await publishAlerts(tracker.observe(sample), tracker, journal, write);
    try {
      await delay(15_000, undefined, { signal: controller.signal });
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    const startupErrors = ['MONITOR_INVALID_ORIGIN', 'MONITOR_TOKEN_FILE_REQUIRED', 'MONITOR_INVALID_STATE'];
    const code = startupErrors.includes(error.message) ? error.message : 'MONITOR_FAILED';
    process.stderr.write(JSON.stringify({ event: 'operations.monitor_failed', code }) + '\n');
    process.exitCode = 1;
  });
}

module.exports = { AlertTracker, MonitorJournal, collect, monitorOrigin, publishAlerts };
