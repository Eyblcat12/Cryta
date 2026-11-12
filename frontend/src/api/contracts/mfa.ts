export type MfaEnrollment = { manualKey: string; uri: string };
export type MfaChallenge = { challenge: string } & (
  { mfa: 'VERIFY' } | { mfa: 'ENROLL' | 'RECOVER' | 'REPLACE'; enrollment: MfaEnrollment }
);
export type MfaStepUp = 'CODES' | 'REPLACE';
export type MfaCodes = { recoveryCodes: string[] };
