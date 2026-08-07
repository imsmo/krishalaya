// apps/admin-api/src/modules/trust-safety/domain/blocklist.ts · W096's platform blocklist, PURE (PC-56 ADMIN-5d).
//
// W096 states two rules the screen is built around, and both are enforced here rather than asked for politely:
//   1. "Every block has an expiry or a review date — indefinite blocks without review are prohibited."
//   2. "Identifiers stored hashed; raw device IDs/IPs never displayed after entry."
//
// The second one has a consequence the canon does not spell out and this module does: ONCE HASHED, A BLOCK CANNOT BE
// EXPLAINED TO THE PERSON IT AFFECTS. Nobody can look at `dev_a41f…88` and tell you whose phone that is. That is the
// correct privacy trade — a blocklist of raw device ids and IPs is a surveillance database — but it means the
// `reason` and `origin_ref` fields carry the entire explanatory weight of a decision that can shut somebody out of
// their livelihood, which is why the reason floor below is not cosmetic.
import { createHash } from 'node:crypto';
import { InvalidBlocklistEntryError } from './trust-safety.errors';

export const IDENTIFIER_TYPES = ['device', 'ip_range', 'phone_hash'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export function isIdentifierType(v: unknown): v is IdentifierType {
  return typeof v === 'string' && (IDENTIFIER_TYPES as readonly string[]).includes(v);
}

export const BLOCK_STATUSES = ['active', 'expired', 'lifted'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];

/** A reason short enough to be a shrug is not a reason. "fraud" explains nothing to an appeal reviewer six weeks
 *  later, and on a hashed identifier there is no other evidence to fall back on. */
export const REASON_MIN = 12;
export const LIFT_REASON_MIN = 12;

export interface BlocklistRow {
  id: string;
  identifierType: IdentifierType;
  identifierHash: string;
  originRef: string | null;
  reason: string;
  expiresAt: string | null;
  reviewAt: string | null;
  attemptsBlocked: number | null;
  status: BlockStatus;
  auditNote: string;
  createdBy: string | null;
  createdAt: string;
  checkedBy: string | null;
  checkedAt: string | null;
  liftedAt: string | null;
  liftedBy: string | null;
  liftReason: string | null;
}

/* ------------------------------------------------------------------------------------------------ */
/* HASHING — where a duplicate block is silently created                                            */
/* ------------------------------------------------------------------------------------------------ */

/** Normalise BEFORE hashing, or the uniqueness guarantee is a fiction.
 *
 *  `uq_platform_blocklists_active` promises at most one live block per identifier. It compares HASHES, so
 *  `103.24.0.0/29` and ` 103.24.0.0/29 ` and `103.24.0.0/29\n` are three different blocks on the same range — three
 *  rows the index cannot see as duplicates, three separate expiry dates, and lifting one leaves the other two
 *  enforcing. A phone typed as `+91 98123 45210` and `+919812345210` is the same person twice.
 *
 *  Case-folding is safe for all three types: hex device ids, IPv4/IPv6 CIDR (RFC 5952 prefers lowercase) and digits.
 *  Internal whitespace and the visual separators people paste from a spreadsheet are stripped; nothing else is
 *  touched, because guessing further at what an identifier "means" is how a normaliser starts silently merging
 *  distinct things.
 */
export function normaliseIdentifier(type: IdentifierType, raw: string): string {
  const base = raw.trim().toLowerCase().replace(/\s+/g, '');
  // A phone is digits and a leading '+'. Nothing else survives, so the same number in four notations is one hash.
  if (type === 'phone_hash') return base.replace(/[^0-9+]/g, '');
  return base;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Refuse a raw identifier that cannot be one, BEFORE it is hashed into something unreadable.
 *
 *  THE GUARD THAT MATTERS IS THE LAST ONE. The screen displays `dev_a41f…88`, and the natural mistake is to copy a
 *  displayed identifier back into the Add-block form. Hashing a hash produces a perfectly valid-looking row that
 *  blocks NOTHING and can never be matched against a real device — an entry that looks like enforcement and is inert.
 *  There is no way to detect it later, because by then it is just another 64-character string.
 */
export function assertRawIdentifier(type: IdentifierType, raw: unknown): string {
  if (typeof raw !== 'string') throw new InvalidBlocklistEntryError('an identifier is required');
  const v = normaliseIdentifier(type, raw);
  if (!v) throw new InvalidBlocklistEntryError('an identifier is required');
  if (v.length > 200) throw new InvalidBlocklistEntryError('an identifier must be at most 200 characters');
  if (HEX64.test(v)) {
    throw new InvalidBlocklistEntryError(
      'that looks like an already-hashed identifier. Enter the raw device id, IP range or phone number — hashing a '
      + 'hash produces a block that matches nothing and cannot be detected later.');
  }
  if (type === 'phone_hash' && !/^\+?[0-9]{6,15}$/.test(v)) {
    throw new InvalidBlocklistEntryError('a phone identifier must be 6–15 digits, optionally with a leading +');
  }
  if (type === 'ip_range' && !/^[0-9a-f.:]+(\/[0-9]{1,3})?$/.test(v)) {
    throw new InvalidBlocklistEntryError('an IP identifier must be an address or CIDR range');
  }
  return v;
}

/** SHA-256 of the normalised identifier. The raw value never reaches the database — 0067's column comment says so
 *  and this is the only function that could make it false. */
export function hashIdentifier(type: IdentifierType, raw: string): string {
  return createHash('sha256').update(`${type}:${normaliseIdentifier(type, raw)}`, 'utf8').digest('hex');
}

/** The canon's display shape: `dev_a41f…88`, `ip_103.24.…/29`, `ph_c88d…41`.
 *
 *  Built from the HASH, never from the raw value, and the prefix is the type rather than a fragment of the input — the
 *  canon's `ip_103.24.…/29` shows real address octets, which would mean storing or reconstructing the raw range. A
 *  displayed prefix of the true address is a partial disclosure of exactly the thing the hashing exists to protect,
 *  and on an IP range it narrows the search space enough to matter. The type prefix carries the same information the
 *  operator actually needs (which tab am I looking at) and discloses nothing.
 */
export function displayIdentifier(type: IdentifierType, hash: string): string {
  const p = type === 'device' ? 'dev' : type === 'ip_range' ? 'ip' : 'ph';
  if (typeof hash !== 'string' || hash.length < 8) return `${p}_…`;
  return `${p}_${hash.slice(0, 4)}…${hash.slice(-2)}`;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE EXPIRY RULE                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

/** W096: "indefinite blocks without review are prohibited". `ck_platform_blocklists_expiry_or_review` enforces it in
 *  the database; this gives the operator the sentence instead of a constraint-violation code.
 *
 *  A review date in the PAST is refused too, which the CHECK cannot express. A block created today "for review last
 *  March" satisfies the constraint and defeats the rule completely — it is an indefinite block wearing a date.
 */
export function assertExpiryOrReview(expiresAt: Date | null, reviewAt: Date | null, now: Date): void {
  if (!expiresAt && !reviewAt) {
    throw new InvalidBlocklistEntryError(
      'a block needs an expiry date, or a review date if it is indefinite — an indefinite block nobody revisits is a '
      + 'permanent ban issued without one being decided');
  }
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new InvalidBlocklistEntryError('an expiry date must be in the future');
  }
  if (reviewAt && reviewAt.getTime() <= now.getTime()) {
    throw new InvalidBlocklistEntryError('a review date must be in the future');
  }
}

export function assertReason(reason: unknown, field = 'reason', min = REASON_MIN): string {
  if (typeof reason !== 'string') throw new InvalidBlocklistEntryError(`a ${field} is required`);
  const v = reason.trim();
  if (v.length < min) {
    throw new InvalidBlocklistEntryError(
      `a ${field} must be at least ${min} characters — the identifier is hashed, so this sentence is the only account `
      + 'of why anybody was shut out');
  }
  if (v.length > 300) throw new InvalidBlocklistEntryError(`a ${field} must be at most 300 characters`);
  return v;
}

/* ------------------------------------------------------------------------------------------------ */
/* STATE — a lapsed block is not an enforcing block                                                  */
/* ------------------------------------------------------------------------------------------------ */

/** The state to RENDER, which is not always the state in the column.
 *
 *  `status` only becomes 'expired' when something writes it, and nothing does — there is no sweeper job, and the
 *  partial unique index treats every non-lifted row as live. So a block whose `expires_at` passed last month still
 *  reads `active` in the table. Showing that as active would tell a safety desk that a fraud ring is still shut out
 *  when the row lapsed weeks ago.
 *
 *  Derived from the clock, and a row with neither an expiry nor a review date is reported as `unbounded` rather than
 *  active — those cannot exist under the CHECK added in 0110, but rows predating it can, and they are exactly the
 *  rows W096's rule was written about.
 */
export function blockState(
  r: Pick<BlocklistRow, 'status' | 'expiresAt' | 'reviewAt'>,
  now: Date,
): BlockStatus | 'unbounded' {
  if (r.status === 'lifted') return 'lifted';
  if (r.status === 'expired') return 'expired';
  if (r.expiresAt) {
    const t = Date.parse(r.expiresAt);
    // An unparseable date is NOT treated as "no expiry" — that would silently promote a corrupt row to a permanent
    // block. It is unbounded, which is the state that draws attention.
    if (!Number.isFinite(t)) return 'unbounded';
    return t <= now.getTime() ? 'expired' : 'active';
  }
  if (r.reviewAt) return 'active';
  return 'unbounded';
}

/** Blocks whose review date has arrived. W096's rule only means something if somebody is told when the day comes. */
export function reviewDue(rows: readonly Pick<BlocklistRow, 'id' | 'reviewAt' | 'status'>[], now: Date): string[] {
  return rows
    .filter((r) => r.status === 'active' && r.reviewAt && Number.isFinite(Date.parse(r.reviewAt))
      && Date.parse(r.reviewAt) <= now.getTime())
    .map((r) => r.id);
}

/** THE ATTEMPTS COLUMN IS NOT ZERO. IT IS UNKNOWN, AND THE DIFFERENCE IS THE WHOLE POINT OF THE COLUMN.
 *
 *  W096 shows "Attempts blocked: 1,204" beside an IP range, and that number is the screen's evidence that the block
 *  is doing something. `attempts_blocked` defaults to 0 and NOTHING ON THE PLATFORM EVER INCREMENTS IT, because
 *  nothing reads the blocklist at all — W096's own note says blocks "enforce at the gateway from cached rules" and
 *  there is no gateway check and no cache.
 *
 *  Rendering that as "0" would say: this block is installed and working, and nobody has tried. The truth is: nothing
 *  is checking. Those are opposite statements about whether the platform is defended, on the screen whose job is to
 *  answer that question. So the count is reported as unavailable with the reason, until an enforcer exists to make it
 *  a real number.
 */
export const ATTEMPTS_UNCOUNTED = 'no enforcement point reads this list yet, so attempts are not counted' as const;
/** The row is taken and DELIBERATELY NOT READ. The parameter stays in the signature because the day an enforcer
 *  exists this becomes `row.attemptsBlocked` and every call site is already correct — a function that had to GAIN a
 *  parameter then is one somebody would forget to update at one of them. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function attemptsBlocked(_row: Pick<BlocklistRow, 'attemptsBlocked'>):
  { known: true; value: number } | { known: false; reason: typeof ATTEMPTS_UNCOUNTED } {
  return { known: false, reason: ATTEMPTS_UNCOUNTED };
}

/** Lifting is a decision and carries its own reason — `ck_platform_blocklists_lift_evidence` in 0110. An unexplained
 *  lift is indistinguishable from a mistake, and it is the fact an appeal turns on. */
export function assertLiftable(r: Pick<BlocklistRow, 'status'>, reason: unknown): string {
  if (r.status === 'lifted') throw new InvalidBlocklistEntryError('this block has already been lifted');
  return assertReason(reason, 'lift reason', LIFT_REASON_MIN);
}

/** Tab counts by type. Types with no rows report 0 — a genuine zero, unlike the attempts column: we counted the
 *  register and it is empty, which is a fact we actually know. */
export function typeCounts(rows: readonly Pick<BlocklistRow, 'identifierType' | 'status'>[]): Record<IdentifierType, number> {
  const out = { device: 0, ip_range: 0, phone_hash: 0 } as Record<IdentifierType, number>;
  for (const r of rows) if (r.status === 'active' && isIdentifierType(r.identifierType)) out[r.identifierType] += 1;
  return out;
}
