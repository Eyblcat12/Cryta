export function expiryWarningPolicy(configuration: unknown): { days: number[]; invalid: boolean } {
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return { days: [], invalid: true };
  if (!Object.prototype.hasOwnProperty.call(configuration, 'warning_days')) return { days: [30], invalid: false };
  const input = (configuration as Record<string, unknown>).warning_days;
  if (!Array.isArray(input) || input.length > 3650) return { days: [], invalid: true };
  const days = new Set<number>();
  let invalid = false;
  for (const value of input) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 3650) days.add(value);
    else invalid = true;
  }
  return { days: [...days].sort((a, b) => a - b), invalid };
}
