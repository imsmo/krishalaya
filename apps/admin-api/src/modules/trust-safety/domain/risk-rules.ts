// apps/admin-api/src/modules/trust-safety/domain/risk-rules.ts · W095's weight editor, PURE (PC-56 ADMIN-5d).
//
// W095's whole argument is one sentence: "Every change is dry-run against yesterday's population before it can ship."
// A weight is not a setting. Moving `dispute_lost` from −12 to −15 drops 312 users a band and puts 41 into payout
// delay, 28 of whom are farmers holding perishable stock — the canon's own dry-run panel says so. That is a decision
// about several hundred people's income, taken by one person at a keyboard, and the dry run is the only thing between
// the two.
//
// ---------------------------------------------------------------------------------------------------------------
// AND THE HARDER TRUTH THIS SCREEN HAS TO TELL: THE CONFIGURATION IS NOT THE BEHAVIOUR
// ---------------------------------------------------------------------------------------------------------------
// 0067 seeded five rules from the canon. Reading the code that actually scores people found four disagreements:
//   • `dispute_lost` is configured at −12 and the handler that fires it hardcodes −15.
//   • `same_ip_bidding`, `fake_listing` and `duplicate_kyc` are configured and NOTHING EMITS THEM — there is no
//     producer anywhere in the platform, so three of the five rules have never fired and cannot.
//   • `order_completed` fires on every completed order at +2 and is not in the table at all.
//   • the band ladder in code is 80/60/40/20 where the canon's is 70/50/30/10 — harsher at every boundary.
// None of those was corrected by this wave, deliberately: each one moves people between bands, and W095's own rule is
// that such a change needs a dry run against yesterday's population, which cannot be run from a migration. Fixing
// them quietly by editing two constants would be this wave doing the exact thing the screen exists to prevent.
//
// So the screen SHOWS them. `weightDrift` and `ruleCoverage` are not diagnostics bolted on the side — on a table
// whose rows the platform does not obey, they are the most important thing on the page.
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidRiskRuleChangeError, DryRunRequiredError } from './trust-safety.errors';

export interface RiskRuleRow {
  eventCode: string;
  weight: number;
  notes: string | null;
  isActive: boolean;
  proposedWeight: number | null;
  proposedBy: string | null;
  proposedAt: string | null;
  checkedBy: string | null;
  checkedAt: string | null;
  dryRunAt: string | null;
  dryRunBandDrops: number | null;
  dryRunNewRestricted: number | null;
  dryRunPopulation: number | null;
}

/** A weight outside this range is not a policy change, it is a typo with consequences: the score is clamped 0–100, so
 *  a single −500 event puts anybody at `blocked` for ever regardless of fourteen years of clean history. */
export const WEIGHT_MIN = -60;
export const WEIGHT_MAX = 60;

/** W095 says "yesterday's population". A dry run is a photograph of who would move, and the population moves every
 *  day — 36 hours is one overnight recompute plus the working day in which somebody reviews it. Beyond that the
 *  figures the checker is approving are about a platform that no longer exists. */
export const DRY_RUN_MAX_AGE_HOURS = 36;

/* ------------------------------------------------------------------------------------------------ */
/* PROPOSING                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

export function assertProposedWeight(current: number, proposed: unknown): number {
  if (typeof proposed !== 'number' || !Number.isFinite(proposed) || !Number.isInteger(proposed)) {
    throw new InvalidRiskRuleChangeError('a weight must be a whole number');
  }
  if (proposed < WEIGHT_MIN || proposed > WEIGHT_MAX) {
    throw new InvalidRiskRuleChangeError(`a weight must be between ${WEIGHT_MIN} and ${WEIGHT_MAX}`);
  }
  // A no-op proposal still consumes a checker's attention and still lands in the audit ledger looking like a policy
  // change. Refusing it keeps the ledger's signal intact.
  if (proposed === current) throw new InvalidRiskRuleChangeError('that is the weight already in force');
  return proposed;
}

/** The dry-run figures a proposal is judged on, stored with it (0110) rather than recomputed at approval time.
 *  Recomputing would mean the checker approved one number and shipped another. */
export interface DryRun { bandDrops: number; newRestricted: number; population: number; computedAt: Date }

export function assertDryRun(d: Partial<DryRun> | null | undefined): DryRun {
  if (!d || typeof d.bandDrops !== 'number' || typeof d.newRestricted !== 'number' || typeof d.population !== 'number'
      || !(d.computedAt instanceof Date)) {
    throw new DryRunRequiredError('a weight change cannot be submitted without a dry run against the current population');
  }
  for (const [k, v] of [['bandDrops', d.bandDrops], ['newRestricted', d.newRestricted], ['population', d.population]] as const) {
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) throw new InvalidRiskRuleChangeError(`${k} must be a whole number of users`);
  }
  // A dry run that says more people move than exist is a broken computation, and shipping a weight on the strength of
  // it would be worse than shipping one with no dry run at all — the second is visibly unchecked, the first looks
  // checked.
  if (d.bandDrops > d.population) throw new InvalidRiskRuleChangeError('the dry run reports more band drops than users in the population');
  if (d.newRestricted > d.population) throw new InvalidRiskRuleChangeError('the dry run reports more newly restricted users than users in the population');
  // A dry run over nobody proves nothing. W095's failure state names exactly this: "yesterday's population snapshot
  // unavailable — changes cannot ship without a dry run".
  if (d.population === 0) throw new DryRunRequiredError('the population snapshot is empty — a dry run over nobody demonstrates nothing');
  return d as DryRun;
}

export function dryRunAgeHours(computedAt: Date, now: Date): number {
  return (now.getTime() - computedAt.getTime()) / 3_600_000;
}
export function isDryRunFresh(computedAt: Date, now: Date): boolean {
  const age = dryRunAgeHours(computedAt, now);
  // A dry run from the future is not fresh, it is a clock problem, and treating it as fresh accepts any figure at all.
  return age >= 0 && age <= DRY_RUN_MAX_AGE_HOURS;
}

/* ------------------------------------------------------------------------------------------------ */
/* APPROVING — the seventh maker-checker site                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type ApprovalBlock =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'no_proposal' }
  | { ok: false; reason: 'no_dry_run' }
  | { ok: false; reason: 'stale_dry_run'; ageHours: number }
  | { ok: false; reason: 'already_checked' };

/** Whether a proposal is in a state that COULD be approved — the read-side decision the console uses to draw (or not
 *  draw) the Approve control. Separate from the assertion below, which is the write-side gate: this one answers "is
 *  the row ready", that one additionally answers "are you a different person". */
export function approvalState(r: RiskRuleRow, now: Date): ApprovalBlock {
  if (r.checkedBy) return { ok: false, reason: 'already_checked' };
  if (r.proposedWeight === null || r.proposedWeight === undefined) return { ok: false, reason: 'no_proposal' };
  if (!r.dryRunAt) return { ok: false, reason: 'no_dry_run' };
  const t = Date.parse(r.dryRunAt);
  if (!Number.isFinite(t)) return { ok: false, reason: 'no_dry_run' };
  const d = new Date(t);
  if (!isDryRunFresh(d, now)) return { ok: false, reason: 'stale_dry_run', ageHours: Math.round(dryRunAgeHours(d, now)) };
  return { ok: true, from: r.weight, to: r.proposedWeight };
}

/** The write-side gate. Throws — never returns a boolean a caller can forget to read (rule 1 of the two-person rule). */
export function assertApprovable(r: RiskRuleRow, approver: string, now: Date): { from: number; to: number } {
  const s = approvalState(r, now);
  if (!s.ok) {
    if (s.reason === 'already_checked') throw new InvalidRiskRuleChangeError('this proposal has already been approved');
    if (s.reason === 'no_proposal') throw new InvalidRiskRuleChangeError('there is no proposed weight to approve');
    if (s.reason === 'stale_dry_run') {
      throw new DryRunRequiredError(
        `the dry run is ${s.ageHours}h old and the population has moved since — re-run it before approving. `
        + 'Approving on stale figures means signing off numbers that describe a platform that no longer exists.');
    }
    throw new DryRunRequiredError('a weight change cannot be approved without a dry run against the current population');
  }
  assertSecondPerson(
    'approving a risk-weight change', r.proposedBy, approver,
    'A weight change re-bands the whole population at once; the person who proposed it cannot also be the one who '
    + 'signs it off.');
  return { from: s.from, to: s.to };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DRIFT — configuration vs behaviour                                                            */
/* ------------------------------------------------------------------------------------------------ */

/** What the platform's code ACTUALLY does, read out of apps/api and written down here so the drift is computed
 *  against a recorded fact rather than a memory.
 *
 *  Kept as data, not as an import from apps/api: admin-api is a separate deployable and must not depend on the other
 *  app's internals. The cost is that this list can go stale — which is why `PRODUCER_SOURCE` names the file, and why
 *  the drift is rendered rather than asserted in a test that would silently start comparing two copies of itself.
 */
export const OBSERVED_PRODUCERS: Readonly<Record<string, { weight: number; source: string }>> = Object.freeze({
  order_completed: { weight: 2, source: 'identity/events/handlers/order-completed.handler.ts' },
  dispute_lost: { weight: -15, source: 'identity/events/handlers/dispute-resolved.handler.ts' },
});
export const PRODUCER_SOURCE = 'apps/api/src/modules/identity/events/handlers' as const;

export type DriftKind =
  /** Configured here, and the code that fires it uses a different number. The rule is not what happens. */
  | 'weight_mismatch'
  /** Configured here, and nothing anywhere emits the event. The rule has never fired and cannot. */
  | 'no_producer'
  /** Emitted by the platform and absent from this table. Its weight is a constant nobody can see or change. */
  | 'unconfigured';

export interface DriftItem { eventCode: string; kind: DriftKind; configured: number | null; observed: number | null; source: string | null }

/** Every disagreement between this table and the running platform.
 *
 *  Ordered by how much it misleads somebody reading the screen: a rule that fires the WRONG number is worse than one
 *  that never fires, because the first makes the table look obeyed. An event firing with no row at all is last —
 *  it is a gap in the configuration rather than a lie about it.
 */
export function weightDrift(rules: readonly Pick<RiskRuleRow, 'eventCode' | 'weight' | 'isActive'>[]): DriftItem[] {
  const out: DriftItem[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    if (!r.isActive) continue;
    seen.add(r.eventCode);
    const obs = OBSERVED_PRODUCERS[r.eventCode];
    if (!obs) { out.push({ eventCode: r.eventCode, kind: 'no_producer', configured: r.weight, observed: null, source: null }); continue; }
    if (obs.weight !== r.weight) out.push({ eventCode: r.eventCode, kind: 'weight_mismatch', configured: r.weight, observed: obs.weight, source: obs.source });
  }
  for (const [code, obs] of Object.entries(OBSERVED_PRODUCERS)) {
    if (!seen.has(code)) out.push({ eventCode: code, kind: 'unconfigured', configured: null, observed: obs.weight, source: obs.source });
  }
  const rank: Record<DriftKind, number> = { weight_mismatch: 0, no_producer: 1, unconfigured: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.eventCode.localeCompare(b.eventCode));
}

/** THE CANON'S BAND LADDER, and the code's.
 *
 *  W095's band panel: trusted ≥70, standard 50–69, caution 30–49, restricted 10–29, blocked <10.
 *  apps/api `bandFor()`:  trusted ≥80, standard 60–79, caution 40–59, restricted 20–39, blocked <20.
 *
 *  The code is ten points harsher at every boundary, so a score of 35 is `caution` to the specification and
 *  `restricted` to the platform — and `restricted` is the band W094 says carries a 48-hour payout delay and a ₹50,000
 *  bid cap. Not corrected here for the reason at the top of this file; rendered, so that whoever runs the dry run
 *  knows both numbers.
 */
export const CANON_BAND_FLOORS = Object.freeze([
  { band: 'trusted', floor: 70 }, { band: 'standard', floor: 50 }, { band: 'caution', floor: 30 },
  { band: 'restricted', floor: 10 }, { band: 'blocked', floor: 0 },
] as const);
export const CODE_BAND_FLOORS = Object.freeze([
  { band: 'trusted', floor: 80 }, { band: 'standard', floor: 60 }, { band: 'caution', floor: 40 },
  { band: 'restricted', floor: 20 }, { band: 'blocked', floor: 0 },
] as const);

export function bandLadderDrift(): { band: string; canonFloor: number; codeFloor: number }[] {
  return CANON_BAND_FLOORS
    .map((c) => ({ band: c.band, canonFloor: c.floor, codeFloor: CODE_BAND_FLOORS.find((x) => x.band === c.band)?.floor ?? c.floor }))
    .filter((x) => x.canonFloor !== x.codeFloor);
}

/** How many of the configured rules have ever actually fired, from the event counts.
 *
 *  A code with NO count is reported as `neverFired`, and a code the count query could not reach is NOT folded in with
 *  it — the same rule as ADMIN-4b's rejection breakdown. "This rule has never fired" and "we could not count" are
 *  different facts, and only one of them is about the platform.
 */
export function ruleCoverage(
  rules: readonly Pick<RiskRuleRow, 'eventCode' | 'isActive'>[],
  counts: ReadonlyMap<string, number> | null,
): { total: number; fired: number; neverFired: string[]; countsUnavailable: boolean } {
  const active = rules.filter((r) => r.isActive);
  if (!counts) return { total: active.length, fired: 0, neverFired: [], countsUnavailable: true };
  const neverFired = active.filter((r) => (counts.get(r.eventCode) ?? 0) === 0).map((r) => r.eventCode).sort();
  return { total: active.length, fired: active.length - neverFired.length, neverFired, countsUnavailable: false };
}
