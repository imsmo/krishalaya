// modules/tenant-api-keys/domain/api-key.state.ts · PC-56 TENANT-13c · THE KEY'S LIFECYCLE IN ONE PLACE (Law 5).
//
//   issued (no checker scope) ─────────────────────────────► active ──revoke(reason)──► revoked
//   issued (checker scope) ──► waiting_checker ──confirm (a DIFFERENT tenant_admin)──► active
//                                     │  └──refuse(reason) / 7 days unconfirmed──► revoked (the key never worked)
//   any unrevoked key whose expires_at has passed ─────────► expired
//
// The status is DERIVED from the row (activated_at / revoked_at / expires_at) — no status column to drift. The database enforces the
// same machine (0193 `trg_api_keys_rules`, `trg_akp_moves`); these functions are what the service, the guard and the console read.

export type KeyStatus = 'waiting_checker' | 'active' | 'revoked' | 'expired';
export interface KeyFacts { activatedAt: string | null; revokedAt: string | null; expiresAt: string | null }

export function keyStatus(k: KeyFacts, nowMs: number): KeyStatus {
  if (k.revokedAt) return 'revoked';
  if (k.expiresAt && Date.parse(k.expiresAt) <= nowMs) return 'expired';
  if (!k.activatedAt) return 'waiting_checker';
  return 'active';
}

/** The refusal the guard answers for a key whose secret matched, or null when the key may be used. */
export function guardRefusalFor(k: KeyFacts, nowMs: number): 'KEY_REVOKED' | 'KEY_EXPIRED' | 'KEY_PENDING_CHECKER' | null {
  const s = keyStatus(k, nowMs);
  if (s === 'revoked') return 'KEY_REVOKED';
  if (s === 'expired') return 'KEY_EXPIRED';
  if (s === 'waiting_checker') return 'KEY_PENDING_CHECKER';
  return null;
}

/** Revocation is offered on every key that is not already revoked (a waiting key may be withdrawn by revoking it). */
export function canRevoke(k: KeyFacts): boolean { return !k.revokedAt; }

export type KeyProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired';
export type KeyProposalAct = 'confirm' | 'refuse' | 'expire';

/** Which acts a proposal admits, and for whom. The DB trigger is the wall; this is the sentence the console prints first. */
export function keyProposalVerdict(p: { status: KeyProposalStatus; proposedBy: string; expiresAt: string }, act: KeyProposalAct, actorId: string, nowMs: number):
  { ok: true } | { ok: false; code: 'PROPOSAL_CLOSED' | 'PROPOSAL_EXPIRED' | 'CHECKER_IS_MAKER' } {
  if (p.status !== 'proposed') return { ok: false, code: 'PROPOSAL_CLOSED' };
  if (act === 'expire') return Date.parse(p.expiresAt) <= nowMs ? { ok: true } : { ok: false, code: 'PROPOSAL_CLOSED' };
  if (Date.parse(p.expiresAt) <= nowMs) return { ok: false, code: 'PROPOSAL_EXPIRED' };
  if (act === 'confirm' && p.proposedBy === actorId) return { ok: false, code: 'CHECKER_IS_MAKER' };
  return { ok: true };
}

export const PROPOSAL_TTL_DAYS = 7;
