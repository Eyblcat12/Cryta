const secretKey = /(?:password|passphrase|passwd|secret|token|credential|authorization|bearer|private[_-]?key|api[_-]?key|signing[_-]?key|smtp[_-]?(?:user|password))/i;
const mfaKey = /^(?:challenge|mfa[_-]?(?:code|challenge)|(?:mfa[_-]?)?(?:t?otp(?:[_-]?code)?|recovery[_-]?codes?|manual[_-]?key|otpauth(?:[_-]?uri)?))$/i;

function redactText(value: string): string {
  // Free-text recovery reasons may also contain recognizable credentials. Redact
  // before truncating so a partial PEM block or long token cannot leak its prefix.
  return value
    .replace(/-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED TOKEN]')
    .replace(/otpauth:\/\/[^\s"'<>]+/gi, '[REDACTED MFA ENROLLMENT]')
    .replace(/\b(t?otp(?:[_-]?code)?|mfa[_-]?code|recovery[_-]?code|manual[_-]?key)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b(password|passphrase|passwd|secret|access[_-]?token|refresh[_-]?token|api[_-]?key|smtp[_-]?password)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b(https?|postgres(?:ql)?|smtps?):\/\/[^/\s@:]+:[^/\s@]*@/gi, '$1://[REDACTED]@');
}

/** Defense in depth for structured audit metadata. Do not log request bodies. */
export function redactAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactAuditMetadata(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, secretKey.test(key) || mfaKey.test(key) ? '[REDACTED]' : redactAuditMetadata(item, depth + 1)]));
  }
  if (typeof value === 'string') {
    const safe = redactText(value);
    return safe.length > 1000 ? `${safe.slice(0, 1000)}…` : safe;
  }
  return value;
}
