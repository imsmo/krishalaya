// apps/admin-api/src/modules/operator-auth/domain/operator-auth.rules.ts · PC-56 ADMIN-AUTH-1 — the decisions, as pure functions.
//
// Every rule that decides whether somebody gets into the god-mode realm lives here, without I/O, so each one is tested
// directly rather than through a mocked database. The repository enforces the same rules a second time where it can
// (conditional UPDATEs, CHECKs in 0244) — two locks on one door, deliberately.

export const TICKET_TTL_SEC = 300;              // ≤ 5 min between the IdP and the key
export const SSO_FLOW_TTL_SEC = 600;            // ≤ 10 min at the IdP
export const CHALLENGE_TTL_SEC = 300;
export const ENROLLMENT_CODE_TTL_SEC = 86_400;  // 24 h
export const TICKET_MAX_FAILED_ATTEMPTS = 5;    // then the ticket is burnt and the operator starts again at the IdP

/* ------------------------------------------------------------------------------------------------------------------ */
/* Tickets                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface TicketRow { adminUserId: string; email: string; expiresAt: Date; consumedAt: Date | null; failedAttempts: number }

export type TicketVerdict = { ok: true } | { ok: false; reason: 'unknown' | 'consumed' | 'expired' | 'too_many_failures' };

/** A ticket is usable exactly once, within its 5 minutes, and only until it has absorbed too many failed ceremonies. */
export function ticketVerdict(t: TicketRow | null, now: Date): TicketVerdict {
  if (!t) return { ok: false, reason: 'unknown' };
  if (t.consumedAt) return { ok: false, reason: 'consumed' };
  if (t.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  if (t.failedAttempts >= TICKET_MAX_FAILED_ATTEMPTS) return { ok: false, reason: 'too_many_failures' };
  return { ok: true };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Enrollment codes                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------------ */

export interface EnrollmentCodeRow {
  id: string; email: string; issuedByEmail: string; expiresAt: Date; consumedAt: Date | null; revokedAt: Date | null;
}

export interface EnrollmentInputs {
  /** sha256 hex of the code the operator typed. */
  codeSha256: string;
  operatorEmail: string;
  /** Active (unrevoked) operator credentials platform-wide — the bootstrap window is "zero". */
  activeCredentialsPlatformWide: number;
  /** ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256 ('' when unset). */
  bootstrapSha256: string;
  /** Has THIS bootstrap hash been used before (platform_operator_bootstrap_uses)? */
  bootstrapAlreadyUsed: boolean;
  /** The issued code whose hash matches, if any. */
  codeRow: EnrollmentCodeRow | null;
  now: Date;
}

export type EnrollmentDecision =
  | { ok: true; via: 'bootstrap' }
  | { ok: true; via: 'enrollment_code'; codeId: string }
  | { ok: false; reason: 'no_such_code' | 'bootstrap_closed' | 'bootstrap_used' | 'code_for_other_email' | 'code_consumed' | 'code_revoked' | 'code_expired' | 'code_self_issued' };

/** Constant-time-ish hex compare (both sides are fixed-length sha256 hex). */
function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Which enrollment path, if any, admits a new FIRST key for this operator.
 *
 *  BOOTSTRAP: the code's hash equals ADMIN_BOOTSTRAP_ENROLLMENT_CODE_SHA256, AND zero active operator credentials exist
 *  platform-wide, AND this hash has never been used. Once anybody holds a key, the bootstrap code is inert — a leaked
 *  bootstrap code is worthless the moment the founder has enrolled.
 *
 *  ISSUED CODE: a code issued by a DIFFERENT operator for exactly this email, unconsumed, unrevoked, unexpired.
 */
export function decideEnrollment(i: EnrollmentInputs): EnrollmentDecision {
  if (i.bootstrapSha256 && hexEqual(i.codeSha256, i.bootstrapSha256)) {
    if (i.activeCredentialsPlatformWide > 0) return { ok: false, reason: 'bootstrap_closed' };
    if (i.bootstrapAlreadyUsed) return { ok: false, reason: 'bootstrap_used' };
    return { ok: true, via: 'bootstrap' };
  }
  const c = i.codeRow;
  if (!c) return { ok: false, reason: 'no_such_code' };
  const email = i.operatorEmail.toLowerCase();
  if (c.email !== email) return { ok: false, reason: 'code_for_other_email' };
  if (c.issuedByEmail === email) return { ok: false, reason: 'code_self_issued' };
  if (c.consumedAt) return { ok: false, reason: 'code_consumed' };
  if (c.revokedAt) return { ok: false, reason: 'code_revoked' };
  if (c.expiresAt.getTime() <= i.now.getTime()) return { ok: false, reason: 'code_expired' };
  return { ok: true, via: 'enrollment_code', codeId: c.id };
}

export type IssueCodeVerdict = { ok: true } | { ok: false; reason: 'self' | 'not_bound' };

/** An operator cannot issue a code for themselves (the whole point is a SECOND person), and a code for an email with no
 *  binding would be useless — it could only ever be used by somebody the realm refuses at the IdP step anyway. */
export function canIssueCode(issuerEmail: string, targetEmail: string, targetIsBound: boolean): IssueCodeVerdict {
  if (issuerEmail.toLowerCase() === targetEmail.toLowerCase()) return { ok: false, reason: 'self' };
  if (!targetIsBound) return { ok: false, reason: 'not_bound' };
  return { ok: true };
}

/** A human-typable one-time code: 4 groups of 5 from an unambiguous alphabet (no 0/O/1/I/L) ≈ 96 bits. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function formatEnrollmentCode(random: Buffer): string {
  if (random.length < 20) throw new Error('need ≥ 20 random bytes');
  let out = '';
  for (let i = 0; i < 20; i++) {
    out += CODE_ALPHABET[random[i] % CODE_ALPHABET.length];
    if (i % 5 === 4 && i < 19) out += '-';
  }
  return out;
}
/** What gets hashed: upper-cased, separators and whitespace removed — so "abcde-fghjk" typed by hand still matches. */
export function canonicalCode(typed: string): string { return typed.toUpperCase().replace(/[\s-]/g, ''); }

/* ------------------------------------------------------------------------------------------------------------------ */
/* Signature counter                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------------ */

/**
 * WebAuthn §6.1.1: the counter must strictly increase — EXCEPT a key that never increments (always 0). A response whose
 * counter is not greater than the stored one, when either is non-zero, is a cloned-authenticator signal and is refused.
 * (@simplewebauthn/server applies the same rule; this copy runs before it and is what the conditional UPDATE encodes.)
 */
export function signCountAcceptable(stored: number, presented: number): boolean {
  if (stored === 0 && presented === 0) return true;
  return presented > stored;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Keys                                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------------ */

export type RevokeKeyVerdict = { ok: true } | { ok: false; reason: 'not_found' | 'already_revoked' | 'last_own_key' | 'needs_staff_manage' };

/** Revoking ANOTHER operator's key needs staff.manage (any of their keys, including the last: that is how a lost or
 *  compromised operator is locked out until re-enrolled). Revoking one's OWN key is allowed only while another remains —
 *  an operator must not be able to lock themselves out by accident. */
export function revokeKeyVerdict(v: {
  key: { adminUserId: string; revokedAt: Date | null } | null; actorId: string; actorHasStaffManage: boolean; ownActiveKeys: number;
}): RevokeKeyVerdict {
  if (!v.key) return { ok: false, reason: 'not_found' };
  if (v.key.revokedAt) return { ok: false, reason: 'already_revoked' };
  if (v.key.adminUserId === v.actorId) return v.ownActiveKeys > 1 ? { ok: true } : { ok: false, reason: 'last_own_key' };
  return v.actorHasStaffManage ? { ok: true } : { ok: false, reason: 'needs_staff_manage' };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* Rate limiting (per process, fixed window)                                                                            */
/* ------------------------------------------------------------------------------------------------------------------ */

/**
 * A fixed-window counter per (bucket, ip). PER PROCESS, and that is stated rather than hidden: with N admin-api pods the
 * effective ceiling is N × the limit. It exists to blunt a scripted flood at the front door — the real gates are the IP
 * allowlist (before this), the IdP, the single-use ticket and the hardware key. Memory is bounded: the map is swept when
 * it grows past `maxKeys`.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { count: number; windowStartMs: number }>();
  constructor(private readonly maxKeys = 10_000) {}

  /** true = allowed (and counted); false = over the limit for this window. */
  take(key: string, limit: number, windowMs: number, nowMs = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || nowMs - h.windowStartMs >= windowMs) {
      if (this.hits.size >= this.maxKeys) this.sweep(windowMs, nowMs);
      this.hits.set(key, { count: 1, windowStartMs: nowMs });
      return true;
    }
    if (h.count >= limit) return false;
    h.count += 1;
    return true;
  }

  private sweep(windowMs: number, nowMs: number): void {
    for (const [k, v] of this.hits) if (nowMs - v.windowStartMs >= windowMs) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();   // pathological flood: forget everything rather than grow
  }
}

/** Where a post-login (or step-up) redirect may go: a same-console relative path only — never `//host` or a scheme. */
export function safeRelativePath(p: unknown, fallback = '/dashboard'): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /[\r\n]/.test(p)) return fallback;
  return p.slice(0, 500);
}
