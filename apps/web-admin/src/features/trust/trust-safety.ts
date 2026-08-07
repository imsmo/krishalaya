// apps/web-admin/src/features/trust/trust-safety.ts · PURE helpers for W089/W093/W094/W095/W096/W098 (ADMIN-5d).
// No fetch, no React → unit-tested.
//
// W089 states the three principles these screens are built to, and they are the opposite of what a moderation console
// usually optimises for:
//   • "Hold fast, remove slow — a held listing is reversible, a wrong removal costs a farmer income."
//   • "Every action explains itself in the farmer's language + appeal path in one tap."
//   • "Risk bands change access gradually (caution → restricted), never cliff-edge to blocked without human sign-off."
//
// The governing rule for the console is narrower and follows from the third: THIS PLANE MUST NEVER SHOW A
// RESTRICTION IT DOES NOT APPLY. Nothing on the platform reads a risk band — no guard, no gateway, no payout or
// bidding path — so every band effect renders as advisory. An unenforced restriction displayed as enforced tells a
// safety operator the problem is handled and takes away the attention that was actually protecting somebody.

/* ===================== blocklists (W096) ===================== */

export const IDENTIFIER_TYPES = ['device', 'ip_range', 'phone_hash'] as const;
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number];
export type BlockState = 'active' | 'expired' | 'lifted' | 'unbounded';

export interface BlockRow {
  id: string; identifierType: IdentifierType; identifier: string;
  originRef: string | null; reason: string;
  expiresAt: string | null; reviewAt: string | null;
  state: BlockState;
  attempts: { known: true; value: number } | { known: false; reason: string };
  createdAt: string; createdBy: string | null;
  checkedBy: string | null; checkedAt: string | null;
  liftedAt: string | null; liftReason: string | null;
  reviewDue: boolean;
}

/** An UNBOUNDED block — neither expiry nor review — is a failure colour. W096's rule is that indefinite blocks
 *  without review are prohibited, so a row in that state is a standing violation, not a style of block.
 *  EXPIRED is muted rather than warned: it lapsed, which is the system working. */
export function blockStateClass(s: BlockState | null | undefined): string {
  switch (s) {
    case 'active': return 'kv-status kv-status--ok';
    case 'expired': return 'kv-status kv-status--muted';
    case 'lifted': return 'kv-status kv-status--muted';
    case 'unbounded': return 'kv-status kv-status--danger';
    default: return 'kv-status kv-status--muted';
  }
}

/** The attempts cell. NEVER "0" — the count is not zero, it is uncounted, because nothing on the platform reads the
 *  blocklist. "0 attempts blocked" would say the block is installed and nobody has tried. */
export function attemptsText(a: BlockRow['attempts'] | null | undefined): { known: boolean; text: string } {
  if (a && a.known === true && typeof a.value === 'number' && Number.isFinite(a.value)) return { known: true, text: String(a.value) };
  return { known: false, text: '—' };
}

/** Countersign is offered only to somebody else, and only once. Absent, never disabled. */
export function countersignOfferable(createdBy: string | null | undefined, viewer: string | null | undefined, alreadyChecked: boolean): boolean {
  if (alreadyChecked) return false;
  if (!viewer || !createdBy) return true;    // unknown → let the server refuse (safe direction for a DISPLAY decision)
  return createdBy !== viewer;
}

export type AddBlockResult =
  | { ok: true; value: { identifierType: IdentifierType; identifier: string; originRef?: string; reason: string; expiresAt?: string; reviewAt?: string; auditNote: string } }
  | { ok: false; error: 'identifierType' | 'identifier' | 'looksHashed' | 'reason' | 'auditNote' | 'expiry' };

const HEX64 = /^[0-9a-f]{64}$/i;
export const REASON_MIN = 12;

/** Build the Add-block submission.
 *
 *  The HASHED-VALUE check runs BEFORE the required-field checks, for the same reason the breach form checks PII shape
 *  first: somebody who pasted `dev_a41f…88`'s underlying hash back in should be told THAT, not that a field is short.
 *  It is the one mistake on this form that produces a row which looks correct for ever and matches nothing.
 */
export function buildAddBlock(raw: {
  identifierType?: string; identifier?: string; originRef?: string; reason?: string;
  expiresAt?: string; reviewAt?: string; auditNote?: string;
}): AddBlockResult {
  const type = (raw.identifierType ?? '').trim();
  if (!(IDENTIFIER_TYPES as readonly string[]).includes(type)) return { ok: false, error: 'identifierType' };
  const identifier = (raw.identifier ?? '').trim();
  if (!identifier) return { ok: false, error: 'identifier' };
  if (HEX64.test(identifier.replace(/\s+/g, ''))) return { ok: false, error: 'looksHashed' };

  const reason = (raw.reason ?? '').trim();
  if (reason.length < REASON_MIN) return { ok: false, error: 'reason' };
  const auditNote = (raw.auditNote ?? '').trim();
  if (auditNote.length < REASON_MIN) return { ok: false, error: 'auditNote' };

  const expiresAt = (raw.expiresAt ?? '').trim();
  const reviewAt = (raw.reviewAt ?? '').trim();
  if (!expiresAt && !reviewAt) return { ok: false, error: 'expiry' };

  const originRef = (raw.originRef ?? '').trim();
  return {
    ok: true,
    value: {
      identifierType: type as IdentifierType, identifier, reason, auditNote,
      ...(originRef ? { originRef } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(reviewAt ? { reviewAt } : {}),
    },
  };
}

/* ===================== risk rules (W095) ===================== */

export type ApprovalState =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'no_proposal' | 'no_dry_run' | 'already_checked' }
  | { ok: false; reason: 'stale_dry_run'; ageHours: number };

export interface DryRunView { at: string; bandDrops: number | null; newRestricted: number | null; population: number | null; fresh: boolean }
export interface ProposalView {
  weight: number; proposedBy: string | null; proposedAt: string | null;
  checkedBy: string | null; checkedAt: string | null;
  dryRun: DryRunView | null; approvalState: ApprovalState; approveOfferable: boolean;
}
export interface RuleRow { eventCode: string; weight: number; notes: string | null; isActive: boolean; firedCount: number | null; proposal: ProposalView | null }

/** Why the Approve control is not drawn. A different message per reason, because the operator's NEXT MOVE differs:
 *  no dry run means run one, a stale one means re-run it, already-checked means nothing, and a proposal by you means
 *  find a colleague. One generic "cannot approve" would send all four to the same wrong place. */
export function approveBlockedKey(p: ProposalView | null | undefined, viewer: string | null | undefined): 'noProposal' | 'noDryRun' | 'staleDryRun' | 'alreadyChecked' | 'yourOwn' | null {
  if (!p) return 'noProposal';
  const s = p.approvalState;
  if (!s.ok) {
    if (s.reason === 'no_proposal') return 'noProposal';
    if (s.reason === 'no_dry_run') return 'noDryRun';
    if (s.reason === 'stale_dry_run') return 'staleDryRun';
    return 'alreadyChecked';
  }
  // The state is approvable; the only thing that can still block it is who is looking.
  if (viewer && p.proposedBy && viewer === p.proposedBy) return 'yourOwn';
  return null;
}

/** THE FIRED COLUMN IS NULL-SAFE AND NULL MEANS UNKNOWN.
 *
 *  W095's "Fired 30d" column is where the reader learns whether a rule does anything. A failed count rendered as 0
 *  says "this rule has never fired", which for three of the five seeded rules happens to be TRUE — and that is
 *  exactly why the two must not be confused: if the count is unreadable, the screen cannot tell the reader which of
 *  the five are dead.
 */
export function firedText(n: number | null | undefined): { known: boolean; text: string } {
  return typeof n === 'number' && Number.isFinite(n) ? { known: true, text: String(n) } : { known: false, text: '—' };
}

export type DriftKind = 'weight_mismatch' | 'no_producer' | 'unconfigured';
export interface DriftItem { eventCode: string; kind: DriftKind; configured: number | null; observed: number | null; source: string | null }

/** A weight the platform does not use is a FAILURE, not a note: the table is being read as policy and it is not
 *  policy. A rule nothing emits is a warning. An unconfigured live event is informational — a gap rather than a lie. */
export function driftClass(k: DriftKind): string {
  if (k === 'weight_mismatch') return 'kv-status kv-status--danger';
  if (k === 'no_producer') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--muted';
}

/** The dry-run panel's own state. A proposal whose dry run has gone stale must not keep displaying figures as though
 *  they were current — they are the strongest thing on the screen and the most quotable. */
export function dryRunState(d: DryRunView | null | undefined): 'fresh' | 'stale' | 'absent' {
  if (!d || !d.at) return 'absent';
  if (typeof d.bandDrops !== 'number' || !Number.isFinite(d.bandDrops)) return 'absent';
  return d.fresh === true ? 'fresh' : 'stale';
}

export type ProposeResult =
  | { ok: true; value: { proposedWeight: number; changeReason: string; dryRun: { bandDrops: number; newRestricted: number; population: number; computedAt: string } } }
  | { ok: false; error: 'weight' | 'sameWeight' | 'reason' | 'dryRun' | 'dryRunArithmetic' };

/** The proposal form. THE DRY RUN IS PART OF IT, not a separate step somebody can skip.
 *
 *  The arithmetic check here duplicates the server's on purpose: it is the difference between an operator learning at
 *  the keyboard that their snapshot is wrong and a colleague discovering it tomorrow while trying to approve.
 */
export function buildPropose(raw: {
  currentWeight?: number; proposedWeight?: string; changeReason?: string;
  bandDrops?: string; newRestricted?: string; population?: string; computedAt?: string;
}): ProposeResult {
  const int = (v: string | undefined) => {
    const s = (v ?? '').trim();
    if (!s || !/^-?[0-9]{1,9}$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const w = int(raw.proposedWeight);
  if (w === null) return { ok: false, error: 'weight' };
  if (typeof raw.currentWeight === 'number' && w === raw.currentWeight) return { ok: false, error: 'sameWeight' };
  const changeReason = (raw.changeReason ?? '').trim();
  if (changeReason.length < 10) return { ok: false, error: 'reason' };

  const bandDrops = int(raw.bandDrops);
  const newRestricted = int(raw.newRestricted);
  const population = int(raw.population);
  const computedAt = (raw.computedAt ?? '').trim();
  if (bandDrops === null || newRestricted === null || population === null || !computedAt) return { ok: false, error: 'dryRun' };
  if (bandDrops < 0 || newRestricted < 0 || population <= 0) return { ok: false, error: 'dryRunArithmetic' };
  if (bandDrops > population || newRestricted > population) return { ok: false, error: 'dryRunArithmetic' };

  return { ok: true, value: { proposedWeight: w, changeReason, dryRun: { bandDrops, newRestricted, population, computedAt } } };
}

/* ===================== risk board + profile (W093 / W094) ===================== */

export const RISK_BANDS = ['trusted', 'standard', 'caution', 'restricted', 'blocked'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export type BandReading =
  | { kind: 'unknown'; reason: string }
  | { kind: 'agreed'; band: RiskBand; score: number }
  | { kind: 'ladder_drift'; band: RiskBand; canon: RiskBand; score: number }
  | { kind: 'inconsistent'; band: string; expected: RiskBand; score: number };

/** The band's colour. `blocked` and `restricted` are failure colours because of what they mean for the person, not
 *  because of what they mean for the platform — this screen is read by somebody deciding whether to take away
 *  another person's livelihood, and the strongest colour belongs on the strongest act. */
export function bandClass(b: string | null | undefined): string {
  switch (b) {
    case 'trusted': return 'kv-status kv-status--ok';
    case 'standard': return 'kv-status kv-status--ok';
    case 'caution': return 'kv-status kv-status--warn';
    case 'restricted': return 'kv-status kv-status--danger';
    case 'blocked': return 'kv-status kv-status--danger';
    default: return 'kv-status kv-status--muted';
  }
}

/** An INCONSISTENT row — the stored band is not what the platform's own ladder gives for the stored score — is a
 *  failure, because it means somebody's access is governed by a value nothing computed. LADDER DRIFT is a warning:
 *  the row is internally consistent, the specification simply disagrees with the code. */
export function readingClass(r: BandReading | null | undefined): string {
  if (!r) return 'kv-status kv-status--muted';
  if (r.kind === 'inconsistent') return 'kv-status kv-status--danger';
  if (r.kind === 'ladder_drift') return 'kv-status kv-status--warn';
  if (r.kind === 'unknown') return 'kv-status kv-status--muted';
  return 'kv-status kv-status--ok';
}

export type FactorPanel =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'closed'; base: number; factors: { event: string; weight: number; detail?: string }[]; score: number }
  | { kind: 'does_not_close'; base: number; factors: { event: string; weight: number; detail?: string }[]; score: number; sum: number };

/** Whether to render W094's equation at all.
 *
 *  ONLY when it closes. An equation whose terms do not sum to the total on the right is worse than no equation on a
 *  panel captioned "every point is traceable" — and the total on the right is the number that decides what happens
 *  to the person. `does_not_close` gets a failure notice instead, naming both figures.
 */
export function equationRenderable(p: FactorPanel | null | undefined): boolean {
  return !!p && p.kind === 'closed';
}
export function factorNoticeKey(p: FactorPanel | null | undefined): 'unavailable' | 'doesNotClose' | null {
  if (!p) return 'unavailable';
  if (p.kind === 'unavailable') return 'unavailable';
  if (p.kind === 'does_not_close') return 'doesNotClose';
  return null;
}

/** The rendered equation, e.g. "78 − 30 − 12 + 8 = 44". Built only from a closed panel. */
export function equationText(p: FactorPanel | null | undefined): string | null {
  if (!p || p.kind !== 'closed') return null;
  const terms = p.factors.map((f) => `${f.weight < 0 ? '−' : '+'} ${Math.abs(f.weight)}`).join(' ');
  return `${p.base}${terms ? ` ${terms}` : ''} = ${p.score}`;
}

export interface BandEffect { key: string; enforced: boolean; enforcedBy: string | null }

/** An UNENFORCED effect is muted and captioned. Drawing it as though it applies is the single most dangerous thing
 *  this console could do — see the header. */
export function effectClass(e: BandEffect | null | undefined): string {
  return e && e.enforced === true ? 'kv-status kv-status--ok' : 'kv-status kv-status--muted';
}
/** Whether to show the "this ladder is advisory" banner. Computed from the effects rather than hardcoded, so the
 *  banner disappears by itself the day an enforcer ships — a hand-maintained note is one somebody forgets. */
export function advisoryBannerVisible(effects: readonly BandEffect[] | null | undefined): boolean {
  if (!effects || effects.length === 0) return true;
  return !effects.some((e) => e.enforced === true && e.key !== 'walletStillWithdrawable');
}

export type BandChangeResult =
  | { ok: true; value: { band: RiskBand; reason: string } }
  | { ok: false; error: 'band' | 'sameBand' | 'reason' };

export const BAND_REASON_MIN = 20;

export function buildBandChange(raw: { band?: string; reason?: string; currentBand?: string | null }): BandChangeResult {
  const band = (raw.band ?? '').trim();
  if (!(RISK_BANDS as readonly string[]).includes(band)) return { ok: false, error: 'band' };
  if (raw.currentBand && band === raw.currentBand) return { ok: false, error: 'sameBand' };
  const reason = (raw.reason ?? '').trim();
  if (reason.length < BAND_REASON_MIN) return { ok: false, error: 'reason' };
  return { ok: true, value: { band: band as RiskBand, reason } };
}

/** Blocking is offered only when a SECOND operator is looking. Display gating on top of the server's refusal. */
export function blockOfferable(previousActor: string | null | undefined, viewer: string | null | undefined): boolean {
  if (!viewer || !previousActor) return true;
  return previousActor !== viewer;
}

/** A share the server could not compute renders as unknown, never as 0%. W093 labels these "of active users" and a
 *  0% under "trusted" would be the most alarming false statement on the board. */
export function shareText(s: { pct: number; of: string } | null | undefined): { known: boolean; text: string } {
  return s && typeof s.pct === 'number' && Number.isFinite(s.pct) ? { known: true, text: `${s.pct}%` } : { known: false, text: '—' };
}

/** The census must add up. An unrecognised band is DISPLAYED, not dropped — a stored band nothing has a rule for is
 *  the state `ck_risk_scores_band` was added to prevent, and hiding it makes the board look complete. */
export function censusShortfall(c: Record<string, number> | null | undefined): number {
  if (!c || typeof c.total !== 'number' || !Number.isFinite(c.total)) return 0;
  const counted = RISK_BANDS.reduce((a, b) => a + (Number.isFinite(c[b]) ? c[b] : 0), 0) + (Number.isFinite(c.unrecognised) ? c.unrecognised : 0);
  return Math.max(0, c.total - counted);
}

/* ===================== overview + insights (W089 / W098) ===================== */

export type Tile = { kind: 'value'; value: number; unit?: string; hint?: string } | { kind: 'unavailable'; reason: string };

export function tileValue(t: Tile | null | undefined): { known: boolean; value: number } {
  return t && t.kind === 'value' && typeof t.value === 'number' && Number.isFinite(t.value)
    ? { known: true, value: t.value } : { known: false, value: 0 };
}
export function tileText(t: Tile | null | undefined): string {
  const v = tileValue(t);
  if (!v.known) return '—';
  const unit = t && t.kind === 'value' ? t.unit : undefined;
  if (unit === 'pct') return `${v.value}%`;
  if (unit === 'hours') return `${v.value}h`;
  return String(v.value);
}

export type SlaState =
  | { kind: 'unmeasured' } | { kind: 'ok'; ageHours: number }
  | { kind: 'due_soon'; ageHours: number } | { kind: 'breached'; overHours: number };

/** UNMEASURED is a warning, never a pass: a queue whose oldest item has no age cannot be shown to be inside its SLA. */
export function slaClass(s: SlaState | null | undefined): string {
  if (!s) return 'kv-status kv-status--muted';
  if (s.kind === 'breached') return 'kv-status kv-status--danger';
  if (s.kind === 'due_soon') return 'kv-status kv-status--warn';
  if (s.kind === 'unmeasured') return 'kv-status kv-status--warn';
  return 'kv-status kv-status--ok';
}

export type AttentionSeverity = 'overdue' | 'blocking' | 'due_soon' | 'info';
export interface AttentionItem { id: string; severity: AttentionSeverity; messageKey: string; params?: Record<string, string> }

export function attentionClass(s: AttentionSeverity): string {
  switch (s) {
    case 'overdue': return 'kv-status kv-status--danger';
    case 'blocking': return 'kv-status kv-status--danger';
    case 'due_soon': return 'kv-status kv-status--warn';
    default: return 'kv-status kv-status--muted';
  }
}

export interface SourcesRead { reports: boolean; appeals: boolean; blocklist: boolean; risk: boolean }

export function allQuiet(items: AttentionItem[] | null | undefined, read: SourcesRead | null | undefined): boolean {
  if (!items || !read) return false;
  return items.length === 0 && read.reports && read.appeals && read.blocklist && read.risk;
}
export function unreadSources(read: SourcesRead | null | undefined): string[] {
  if (!read) return ['reports', 'appeals', 'blocklist', 'risk'];
  return (['reports', 'appeals', 'blocklist', 'risk'] as const).filter((k) => !read[k]);
}

/** A LOW-SAMPLE percentage is shown WITH its denominator, because "18% overturn rate" from two appeals is a sentence
 *  that outlives its caveat once somebody puts it in a board pack. */
export function sampleNote(lowSample: boolean | null | undefined, denominator: number | null | undefined): string | null {
  if (!lowSample) return null;
  return typeof denominator === 'number' && Number.isFinite(denominator) ? `n=${denominator}` : 'n=?';
}
