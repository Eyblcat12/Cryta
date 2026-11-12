export const EMAIL_QUEUE_WAIT_LIMIT_SECONDS = 300;

export const EMAIL_WORKER_SAMPLE = `json_build_object(
  'lastPollAt', worker.last_poll_at,
  'lastPollSucceeded', worker.last_poll_succeeded,
  'stale', COALESCE(worker.last_poll_at,worker.initialized_at) <= statement_timestamp()-INTERVAL '5 minutes'
)`;

export type EmailWorkerSample = { lastPollAt: string | null; lastPollSucceeded: boolean | null; stale: boolean };

export function emailWorkerStatus(enabled: boolean, sample: EmailWorkerSample) {
  let state: 'DISABLED' | 'STALE' | 'FAILED' | 'RECENT' | 'AWAITING';
  if (!enabled) state = 'DISABLED';
  else if (sample.stale) state = 'STALE';
  else if (sample.lastPollSucceeded === null) state = 'AWAITING';
  else state = sample.lastPollSucceeded ? 'RECENT' : 'FAILED';
  return { state, lastPollAt: sample.lastPollAt, lastPollSucceeded: sample.lastPollSucceeded };
}
