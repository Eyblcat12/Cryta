export const automaticRetryDelays = [15, 60] as const;
export const maximumRecoveryRetries = 3;

export type FailureClass = 'UNSENT_TRANSIENT' | 'UNSENT_PERMANENT' | 'OUTCOME_UNKNOWN' | 'RESULT_RECORDED';

export function failureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '40001' || code === '40P01' || code === '55P03') return 'PREFLIGHT_DB_BUSY';
  if (error instanceof Error && /^CRYPTO_PROVIDER_(?:HTTP_[45]\d\d|RESPONSE_INVALID|URL_REQUIRED|HTTPS_REQUIRED|SCOPE_MISMATCH|TIMEOUT|TRANSPORT_FAILED)$/.test(error.message)) {
    return error.message;
  }
  return 'PROCESSING_ERROR';
}

export function publicFailureCode(code: string | null) {
  if (!code) return null;
  if (['PROCESSING_ERROR', 'PREFLIGHT_DB_BUSY', 'STALE_PROCESSING'].includes(code)) return code;
  return failureCode(new Error(code));
}
