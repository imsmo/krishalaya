// modules/communication/domain/organisation-thread.ts · PC-56 STORE-4b · B1 (founder D1 / D2 / D3, survey STORE-4 F-13 · B3 · B16) — A BUYER'S
// THREAD REACHES THE ORGANISATION, NEVER A PERSON; A REPORTED BODY IS HIDDEN; A LOCK IS MONOTONIC. PURE (no framework, no I/O).
//
//   • respondersOf      — the organisation's side of a buyer's thread: every ACTIVE member whose role grants `order.manage`, OLDEST
//                         membership first, one entry per person, capped (the open DTO's bound, 50). The repository reads the rows; this
//                         decides the order and the cap (and the caller is never their own responder).
//   • contextOwnerRule  — whose context it is: an ORDER belongs to its buyer only; a LISTING (live on sale) to anyone signed in. Anything
//                         else — absent, another buyer's — is "not found" (anti-enumeration, never 403).
//   • canUseGenericOpen — the arbitrary-participant `POST /v1/conversations` is a STAFF tool (an organisation role or a moderator); a buyer
//                         opens the organisation thread instead.
//   • lockLift / lockWins — the monotonic lock rule (founder D2c): the owner lifts only an `owner` lock; a moderator lifts any; a stronger
//                         kind replaces a weaker one (owner < moderator < dispute), a weaker one never replaces a stronger.
//   • hideFlagged       — a reported message is HIDDEN PENDING REVIEW on every non-moderator read (the reporter included): no body, no media,
//                         `hidden: true`; a moderator keeps the body plus the reason and the reporter. The reporter is never named to anyone else.
//   • buyerMaskedCall   — a buyer's call log names no person: direction (outgoing / incoming), never `callerUserId` / `calleeUserId` (D3).
import type { ConversationViewer } from './conversation-roles';

export const RESPONDER_CAP = 50;
export interface ResponderCandidate { userId: string; grantedAt: Date | string }

/** One entry per person (their OLDEST membership), oldest first (ties by id), never the caller, at most `cap`. */
export function respondersOf(members: readonly ResponderCandidate[], cap: number = RESPONDER_CAP, callerUserId?: string): string[] {
  const first = new Map<string, number>();
  for (const m of members) {
    if (!m.userId || m.userId === callerUserId) continue;
    const at = new Date(m.grantedAt).getTime();
    const t = Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
    const prev = first.get(m.userId);
    if (prev === undefined || t < prev) first.set(m.userId, t);
  }
  return [...first.entries()]
    .sort((a, b) => (a[1] - b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, Math.max(0, Math.trunc(cap)))
    .map(([u]) => u);
}

/** The two contexts a buyer may open with the organisation (`POST /v1/conversations/organisation`). */
export const ORG_CONTEXT_TYPES = ['order', 'listing'] as const;
export type OrgContextType = (typeof ORG_CONTEXT_TYPES)[number];
/** The listing statuses a buyer may message the organisation about — the lot is (or just was) on public sale: `published`, under auction
 *  (`reserved_auction`), or emptied by sales (`sold_out` — a buyer whose offer took the last quintal still needs to talk about it). A draft,
 *  pending, paused, held, hidden, rejected, expired or archived listing is "not found". */
export const LISTING_THREAD_STATUSES = ['published', 'reserved_auction', 'sold_out'] as const;

/** Is this context the caller's to open a thread about? An order → its buyer only; a listing → anyone signed in (when it exists, live). */
export function contextOwnerRule(contextType: OrgContextType, found: { exists: boolean; buyerUserId?: string | null }, callerUserId: string): boolean {
  if (!found.exists) return false;
  if (contextType === 'order') return !!found.buyerUserId && found.buyerUserId === callerUserId;
  return contextType === 'listing';
}

/** The arbitrary-participant open is the organisation's (and a moderator's) tool — never a buyer's. */
export function canUseGenericOpen(viewer: ConversationViewer): boolean { return viewer === 'staff'; }

export const LOCK_KINDS = ['owner', 'moderator', 'dispute'] as const;
export type LockKind = (typeof LOCK_KINDS)[number];
export type LockLifter = 'owner' | 'moderator';
const RANK: Record<LockKind, number> = { owner: 1, moderator: 2, dispute: 3 };
export function isLockKind(v: unknown): v is LockKind { return typeof v === 'string' && (LOCK_KINDS as readonly string[]).includes(v); }

/** May `by` lift a lock of `kind`? The owner lifts only an owner lock; a moderator lifts any. An open thread has nothing to lift. */
export function lockLift(kind: LockKind | null, by: LockLifter): { ok: true } | { ok: false; refusal: 'CONVERSATION_LOCK_HELD' } {
  if (kind === null || by === 'moderator' || kind === 'owner') return { ok: true };
  return { ok: false, refusal: 'CONVERSATION_LOCK_HELD' };
}
/** Does a NEW lock of `next` change a thread currently locked `current` (null = open)? Only when it is open or `next` is stronger. */
export function lockWins(current: LockKind | null, next: LockKind): boolean {
  return current === null || RANK[next] > RANK[current];
}

/** The fields a message read may carry about a report (moderator-only ones included). */
export interface FlaggableMessage {
  isFlagged: boolean; body: string | null; voiceMediaId: string | null; attachmentMediaId: string | null;
  flagReason?: string | null; flaggedBy?: string | null; flaggedAt?: Date | string | null;
}
/** A reported message, as THIS viewer reads it. Non-moderators (buyer or staff, the reporter included): no body, no media, `hidden: true`, no
 *  reason, no reporter. A moderator: the message as stored plus `flagReason` and `flaggedBy`. An unreported message never carries report fields. */
export function hideFlagged<T extends FlaggableMessage>(m: T, viewerIsModerator: boolean) {
  const { flagReason, flaggedBy, flaggedAt, ...rest } = m;
  if (!m.isFlagged) return { ...rest, hidden: false as const };
  if (viewerIsModerator) return { ...rest, hidden: false as const, flagReason: flagReason ?? null, flaggedBy: flaggedBy ?? null, flaggedAt: flaggedAt ?? null };
  return { ...rest, body: null, voiceMediaId: null, attachmentMediaId: null, hidden: true as const };
}

/** The raw call-log row (staff keep it). */
export interface RawMaskedCall {
  id: string; callerUserId: string; calleeUserId: string; contextType: string | null; contextId: string | null; durationSecs: number | null; createdAt?: Date | string;
}
export type CallDirection = 'outgoing' | 'incoming';
/** A buyer's call-log row: which way it went, never who was on the other end (founder D3 — the HOTFIX-6 two-shape rule). */
export function buyerMaskedCall(r: RawMaskedCall, viewerUserId: string) {
  const direction: CallDirection = r.callerUserId === viewerUserId ? 'outgoing' : 'incoming';
  return { id: r.id, contextType: r.contextType, contextId: r.contextId, direction, durationSecs: r.durationSecs, createdAt: r.createdAt };
}
