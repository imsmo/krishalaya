// modules/identity/domain/totp.ts · PC-56 TENANT-SW-c · B3 — RFC 6238 TOTP for staff, through a vetted library.
//
// Library: `otplib@12.0.1` (added to apps/api — no TOTP library was in the lockfile; speakeasy / otpauth were absent too). Settings
// are the authenticator-app defaults the brief fixes: 30-second step, ±1 step window, HMAC-SHA1, 6 digits, a 160-bit (20-byte)
// base32 secret. `matchedStep` returns the absolute time-step a code matched, so the caller can enforce the REPLAY guard
// (`user_totp.last_used_step` only ever increases — 0199's trigger refuses anything else, `[TOTP_REPLAY]`).
//
// Recovery codes: 10 per enrolment, `xxxxx-xxxxx` from an alphabet without look-alikes; only HMAC-SHA256(pepper, normalised code)
// is stored (the pepper is the platform's AUTH_HASH_PEPPER, the same one the refresh-token and OTP hashes use).
import { authenticator } from 'otplib';
import { createHmac, randomInt } from 'node:crypto';
import { RECOVERY_CODE_COUNT, TOTP_DIGITS, TOTP_STEP_SECONDS, TOTP_WINDOW } from './verification-team';

const base = authenticator.clone({ step: TOTP_STEP_SECONDS, window: TOTP_WINDOW, digits: TOTP_DIGITS });

export const TOTP_ISSUER = 'Krishalaya';

/** A fresh base32 secret (20 bytes → 32 characters). */
export function newTotpSecret(): string { return base.generateSecret(20); }

/** The `otpauth://` URI an authenticator app scans (shown ONCE at enrolment). The account label is a NAME, never a phone. */
export function otpauthUri(secret: string, accountLabel: string, issuer = TOTP_ISSUER): string {
  return base.keyuri(accountLabel.replace(/[:]/g, ' ').trim() || 'staff', issuer, secret);
}

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** The code an app shows at `nowMs` (tests, and nothing else, call this). */
export function totpCodeAt(secret: string, nowMs: number): string { return base.clone({ epoch: nowMs }).generate(secret); }

/** The absolute step `code` matches at `nowMs` within ±1 step, or null. */
export function matchedStep(code: string, secret: string, nowMs: number): number | null {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(c)) return null;
  const delta = base.clone({ epoch: nowMs }).checkDelta(c, secret);
  return delta === null || delta === undefined ? null : stepAt(nowMs) + delta;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no i, l, o, 0, 1
export function newRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join('');
  const out = new Set<string>();
  while (out.size < n) { const c = one(); out.add(`${c.slice(0, 5)}-${c.slice(5)}`); }
  return [...out];
}
export const normaliseRecoveryCode = (c: string) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const looksLikeRecoveryCode = (c: unknown) => typeof c === 'string' && normaliseRecoveryCode(c).length === 10;
export function hashRecoveryCode(pepper: string, code: string): string {
  return createHmac('sha256', pepper).update(`recovery:${normaliseRecoveryCode(code)}`).digest('hex');
}
