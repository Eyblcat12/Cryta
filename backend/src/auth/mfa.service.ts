import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RoleCode } from '../common/auth-user';
import { createMfaRecoveryCodes, createTotpEnrollment, matchTotp, matchesMfaRecoveryHash, mfaRecoveryCodeHash, openMfaSecret, readMfaEncryptionKey } from './mfa-credentials';

export const mfaChallengePattern = /^[A-Za-z0-9_-]{43}$/;

export function requiresMfa(roles: RoleCode[], enrolled: boolean, mustChangePassword: boolean) {
  return enrolled || (!mustChangePassword && process.env.MFA_REQUIRED === 'true' &&
    (roles.includes('ADMIN') || roles.includes('APPROVER')));
}

export function validateMfaEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (env.MFA_REQUIRED !== undefined && !['true', 'false'].includes(env.MFA_REQUIRED)) throw new Error('MFA_REQUIRED_INVALID');
  if (env.MFA_REQUIRED === 'true' || env.MFA_ENCRYPTION_KEY) {
    const key = readMfaEncryptionKey(env.MFA_ENCRYPTION_KEY);
    try {
      for (const value of [env.ACCOUNT_ACTION_KEY, env.JWT_ACCESS_SECRET]) {
        if (value?.toLowerCase() === env.MFA_ENCRYPTION_KEY?.toLowerCase()) throw new Error('MFA_ENCRYPTION_KEY_MUST_DIFFER');
      }
    } finally { key.fill(0); }
  }
}

export type MfaPurpose = 'VERIFY' | 'ENROLL' | 'RECOVER' | 'REPLACE';
export type MfaUser = { id: string; email: string; tokenVersion: number };
export type MfaChallenge = {
  user_id: string;
  token_version: number;
  purpose: MfaPurpose;
  oidc_session_id: string | null;
  pending_id: string | null;
  pending_secret: string | null;
  pending_step: string | null;
  pending_hashes: string[] | null;
};
type MfaFactor = {
  credential_id: string | null;
  sealed_secret: string | null;
  last_step: string | null;
  recovery_hashes: string[];
  locked: boolean;
};

function challengeHash(challenge: string) {
  if (challenge.length !== 43 || !mfaChallengePattern.test(challenge)) throw mfaChallengeExpired();
  return createHash('sha256').update(challenge).digest('hex');
}

export function mfaChallengeExpired() {
  return new UnauthorizedException({ code: 'MFA_CHALLENGE_EXPIRED', message: 'Phiên xác thực đã hết hạn. Hãy đăng nhập lại.' });
}

export function mfaInvalidCode() {
  return new UnauthorizedException({ code: 'MFA_CODE_INVALID', message: 'Mã không đúng hoặc đã được dùng. Hãy nhập mã mới.' });
}

export class MfaService {
  async owner(client: PoolClient, challenge: string) {
    const hash = challengeHash(challenge);
    return (await client.query<{ user_id: string }>(`SELECT user_id FROM auth_mfa_challenges
      WHERE token_hash=$1 AND expires_at>clock_timestamp()`, [hash])).rows[0]?.user_id;
  }

  /** Read again after locking users first so a password or access change invalidates the challenge. */
  async challenge(client: PoolClient, user: MfaUser, challenge: string, purposes: MfaPurpose[]) {
    const row = (await client.query<MfaChallenge>(`SELECT user_id,token_version,purpose,oidc_session_id,pending_id,pending_secret,pending_step,pending_hashes
      FROM auth_mfa_challenges WHERE user_id=$1 AND token_hash=$2 AND token_version=$3
        AND expires_at>clock_timestamp()`, [user.id, challengeHash(challenge), user.tokenVersion])).rows[0];
    if (!row || !purposes.includes(row.purpose)) throw mfaChallengeExpired();
    return row;
  }

  async start(client: PoolClient, user: MfaUser, purpose: MfaPurpose, oidcSessionId?: string) {
    const key = readMfaEncryptionKey(process.env.MFA_ENCRYPTION_KEY);
    try {
      await client.query('INSERT INTO auth_mfa (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING', [user.id]);
      await this.factor(client, user.id);
      const challenge = randomBytes(32).toString('base64url');
      const credentialId = purpose === 'VERIFY' ? null : randomUUID();
      const enrollment = credentialId ? createTotpEnrollment(key, { userId: user.id, credentialId }, user.email) : null;
      await client.query(`INSERT INTO auth_mfa_challenges
        (user_id,token_hash,token_version,purpose,expires_at,pending_id,pending_secret,oidc_session_id)
        VALUES ($1,$2,$3,$4,clock_timestamp()+interval '5 minutes',$5,$6,$7)
        ON CONFLICT (user_id) DO UPDATE SET token_hash=excluded.token_hash,token_version=excluded.token_version,
        purpose=excluded.purpose,expires_at=excluded.expires_at,pending_id=excluded.pending_id,
        pending_secret=excluded.pending_secret,pending_step=NULL,pending_hashes=NULL,oidc_session_id=excluded.oidc_session_id`,
      [user.id, challengeHash(challenge), user.tokenVersion, purpose, credentialId, enrollment?.sealedSecret ?? null, oidcSessionId ?? null]);
      return {
        mfa: purpose, challenge,
        ...(enrollment && { enrollment: { manualKey: enrollment.manualKey, uri: enrollment.uri } }),
      };
    } finally { key.fill(0); }
  }

  async factor(client: PoolClient, userId: string): Promise<MfaFactor> {
    const row = (await client.query<MfaFactor>(`SELECT credential_id,sealed_secret,last_step,recovery_hashes,
      COALESCE(locked_until>clock_timestamp(),FALSE) AS locked FROM auth_mfa WHERE user_id=$1`, [userId])).rows[0];
    if (!row) throw mfaChallengeExpired();
    if (row.locked) throw new HttpException({ code: 'MFA_RATE_LIMITED', message: 'Đã thử quá nhiều lần. Hãy chờ 5 phút rồi thử lại.' }, HttpStatus.TOO_MANY_REQUESTS);
    return row;
  }

  async remainingCodes(client: PoolClient, userId: string) {
    const row = (await client.query<{ remaining: number }>(`SELECT cardinality(recovery_hashes) AS remaining
      FROM auth_mfa WHERE user_id=$1 AND credential_id IS NOT NULL`, [userId])).rows[0];
    if (!row) throw mfaChallengeExpired();
    return { remaining: row.remaining };
  }

  async recordFailure(client: PoolClient, userId: string) {
    await client.query(`UPDATE auth_mfa SET
      failed_attempts=CASE WHEN locked_until<=clock_timestamp() THEN 1 ELSE LEAST(failed_attempts+1,5) END,
      locked_until=CASE WHEN locked_until<=clock_timestamp() THEN NULL
        WHEN failed_attempts+1>=5 THEN clock_timestamp()+interval '5 minutes' ELSE NULL END
      WHERE user_id=$1`, [userId]);
  }

  async verifyCurrent(client: PoolClient, userId: string, code: string, factor: MfaFactor) {
    if (!factor.credential_id || !factor.sealed_secret || factor.last_step === null) throw mfaChallengeExpired();
    const step = this.match(userId, factor.credential_id, factor.sealed_secret, Number(factor.last_step), code);
    if (step === undefined) return false;
    await client.query(`UPDATE auth_mfa SET last_step=$2,failed_attempts=0,locked_until=NULL WHERE user_id=$1`, [userId, step]);
    return true;
  }

  async useRecoveryCode(client: PoolClient, userId: string, code: string, factor: MfaFactor) {
    if (!factor.credential_id) throw mfaChallengeExpired();
    const subject = { userId, credentialId: factor.credential_id };
    const matched = factor.recovery_hashes.find(stored => matchesMfaRecoveryHash(code, stored, subject));
    if (!matched) return false;
    await client.query(`UPDATE auth_mfa SET recovery_hashes=array_remove(recovery_hashes,$2),failed_attempts=0,locked_until=NULL
      WHERE user_id=$1`, [userId, matched]);
    return true;
  }

  async verifyEnrollment(client: PoolClient, row: MfaChallenge, code: string) {
    if (!row.pending_id || !row.pending_secret || row.pending_step !== null) throw mfaChallengeExpired();
    const step = this.match(row.user_id, row.pending_id, row.pending_secret, -1, code);
    if (step === undefined) return undefined;
    const issued = this.recoveryCodes(row.user_id, row.pending_id);
    await client.query(`UPDATE auth_mfa_challenges SET pending_step=$2,pending_hashes=$3,
      expires_at=clock_timestamp()+interval '10 minutes' WHERE user_id=$1`, [row.user_id, step, issued.hashes]);
    await client.query('UPDATE auth_mfa SET failed_attempts=0,locked_until=NULL WHERE user_id=$1', [row.user_id]);
    return issued.codes;
  }

  async activate(client: PoolClient, row: MfaChallenge) {
    if (!row.pending_id || !row.pending_secret || row.pending_step === null || !row.pending_hashes) throw mfaChallengeExpired();
    await client.query(`UPDATE auth_mfa SET credential_id=$2,sealed_secret=$3,last_step=$4,recovery_hashes=$5,
      failed_attempts=0,locked_until=NULL WHERE user_id=$1`,
    [row.user_id, row.pending_id, row.pending_secret, row.pending_step, row.pending_hashes]);
    await this.consume(client, row.user_id);
  }

  async rotateRecoveryCodes(client: PoolClient, userId: string, factor: MfaFactor) {
    if (!factor.credential_id) throw mfaChallengeExpired();
    const issued = this.recoveryCodes(userId, factor.credential_id);
    await client.query('UPDATE auth_mfa SET recovery_hashes=$2 WHERE user_id=$1', [userId, issued.hashes]);
    await client.query("DELETE FROM auth_mfa_challenges WHERE user_id=$1 AND purpose IN ('RECOVER','REPLACE')", [userId]);
    return issued.codes;
  }

  async consume(client: PoolClient, userId: string) {
    await client.query('DELETE FROM auth_mfa_challenges WHERE user_id=$1', [userId]);
  }

  private recoveryCodes(userId: string, credentialId: string) {
    const codes = createMfaRecoveryCodes();
    return { codes, hashes: codes.map(code => mfaRecoveryCodeHash(code, { userId, credentialId })) };
  }

  private match(userId: string, credentialId: string, envelope: string, lastStep: number, code: string) {
    const key = readMfaEncryptionKey(process.env.MFA_ENCRYPTION_KEY);
    try {
      const secret = openMfaSecret(key, envelope, { userId, credentialId });
      try { return matchTotp(secret, code, lastStep); } finally { secret.fill(0); }
    } finally { key.fill(0); }
  }
}
