import { describe, expect, it } from 'vitest';
import { expiryWarningPolicy } from '../src/jobs/expiry-warning-policy';

describe('legacy expiry warning policy normalization', () => {
  it('uses the legacy 30-day default only when an object has no warning_days field', () => {
    expect(expiryWarningPolicy({ algorithm: 'RSA' })).toEqual({ days: [30], invalid: false });
    expect(expiryWarningPolicy({ warning_days: [] })).toEqual({ days: [], invalid: false });
  });
  it.each([null, false, 7, 'secret-policy-text', [], { warning_days: null }, { warning_days: 7 }, { warning_days: '7' }, { warning_days: {} }])('isolates a malformed root or array without inventing a threshold', configuration => {
    expect(expiryWarningPolicy(configuration)).toEqual({ days: [], invalid: true });
  });
  it('keeps only bounded integer numbers and deduplicates the attached thresholds', () => {
    const configuration = { warning_days: [30, '7', null, {}, [], 7, true, 1.5, 0, -1, 3651, 2 ** 40, Number.NaN, Number.POSITIVE_INFINITY, 7, 1] };
    expect(expiryWarningPolicy(configuration)).toEqual({ days: [1, 7, 30], invalid: true });
    expect(configuration.warning_days).toHaveLength(16);
  });
  it('accepts all policy publication bounds without string coercion', () => {
    expect(expiryWarningPolicy({ warning_days: [3650, 1, 30, 30] })).toEqual({ days: [1, 30, 3650], invalid: false });
  });
  it('rejects oversized legacy arrays before processing their entries', () => {
    expect(expiryWarningPolicy({ warning_days: Array(3651).fill(7) })).toEqual({ days: [], invalid: true });
  });
});
