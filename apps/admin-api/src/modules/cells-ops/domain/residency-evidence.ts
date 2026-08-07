// apps/admin-api/src/modules/cells-ops/domain/residency-evidence.ts · W033, PURE (PC-56 ADMIN-8b).
//
// ---------------------------------------------------------------------------
// THE BOUNDARY IS ENFORCED AND NOBODY CAN PROVE IT HELD
// ---------------------------------------------------------------------------
// `TenantCellAssignmentService.move` refuses a cross-border move and fails closed — ADMIN-8 verified that and it is
// correct. It throws `ResidencyViolationError(from, to)` and **nothing records the attempt.** The error reaches the
// caller and the event vanishes.
//
// W033's empty state: "No residency violations logged. No attempt to move or access data outside its declared region has
// been recorded. **This log fills automatically if the fail-closed boundary is ever tested.**" There is no log, and that
// sentence would read identically after a hundred blocked attempts.
//
// **A FAIL-CLOSED BOUNDARY THAT LEAVES NO TRACE WHEN TESTED IS A BOUNDARY NOBODY CAN PROVE HELD** — and W033's other
// control is "Export residency attestation", which under DPDP asserts a NEGATIVE: no personal data left the country. A
// negative is evidenced by a complete record of attempts and their outcomes, never by the absence of a record. Today that
// export would attest from nothing.
//
// New member of the claim-with-nothing-behind-it family, and the first where the missing artefact is EVIDENCE rather than
// a control: the control works, and its work is invisible.
import { InvalidCellsInputError } from './cells-ops.errors';

export const ATTEMPT_KINDS = ['move', 'place', 'read', 'export'] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export const OUTCOMES = ['blocked', 'allowed'] as const;
export type ViolationOutcome = (typeof OUTCOMES)[number];

export interface ViolationRow {
  id: string;
  attemptKind: string;
  subjectType: string;
  subjectId: string;
  fromCountry: string | null;
  toCountry: string | null;
  refusedBy: string;
  outcome: string;
  actorAdminId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Which rule refused it, as a closed vocabulary.
 *
 *  RECORDED RATHER THAN INFERRED, because the attestation's value is in saying WHY each attempt failed. "The residency
 *  lock held" and "the target cell did not exist" are different assurances and only the first evidences the boundary — an
 *  attestation counting the second as protection would be claiming credit for a typo.
 */
export const REFUSAL_REASONS = ['residency_lock', 'country_mismatch', 'cell_missing', 'profile_not_ratified'] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export function isEvidenceOfBoundary(refusedBy: string): boolean {
  // Only these two are the boundary DOING ITS JOB. The others are the request being malformed, which protects nobody and
  // must not be counted as protection.
  return refusedBy === 'residency_lock' || refusedBy === 'country_mismatch';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE ATTESTATION                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export type Attestation =
  /** Every cross-border attempt in the window was blocked, and the boundary is what blocked them. */
  | {
    kind: 'clean'; windowFrom: string; windowTo: string;
    attempts: number; blockedByBoundary: number; otherRefusals: number;
    countries: string[];
  }
  /** At least one cross-border transfer was ALLOWED. Not a failure — a lawful transfer under a processing agreement is a
   *  real thing DELTA-011 will model — but it changes what the attestation says, from "none occurred" to "these occurred
   *  and here is the basis for each". Conflating the two would be the attestation's one unforgivable error. */
  | {
    kind: 'transfers_occurred'; windowFrom: string; windowTo: string;
    attempts: number; allowed: number; withoutBasis: number;
    countries: string[];
  }
  /** **NO EVIDENCE AT ALL, WHICH IS NOT THE SAME AS A CLEAN RECORD.** Before this wave every window was in this state and
   *  the screen said "no violations logged" — a sentence a reader would take as assurance. An attestation from an empty
   *  log is an attestation from nothing, and it must say so. */
  | { kind: 'no_evidence'; windowFrom: string; windowTo: string; since: string | null };

/** How long a window may be attested over without the log having been running for all of it.
 *
 *  The rule this encodes: an attestation covering a period BEFORE the log existed is attesting from silence. `since` is
 *  the earliest recorded attempt (or the log's own start), and a window reaching further back returns `no_evidence` for
 *  the uncovered part rather than a clean verdict for the whole.
 */
export function attest(
  rows: readonly ViolationRow[],
  windowFrom: string,
  windowTo: string,
  loggingSince: string | null,
): Attestation {
  // THE COVERAGE CHECK COMES FIRST, and it is the whole point. Without it, a window predating the log returns "clean"
  // from an empty array — which is precisely the false assurance the missing table produced for the platform's whole life.
  if (!loggingSince) return { kind: 'no_evidence', windowFrom, windowTo, since: null };
  const sinceMs = Date.parse(loggingSince);
  const fromMs = Date.parse(windowFrom);
  // An unreadable timestamp is treated as NO COVERAGE, not as full coverage. On an attestation the safe direction is to
  // decline to assert.
  if (Number.isNaN(sinceMs) || Number.isNaN(fromMs) || fromMs < sinceMs) {
    return { kind: 'no_evidence', windowFrom, windowTo, since: loggingSince };
  }

  const countries = [...new Set(rows.flatMap((r) => [r.fromCountry, r.toCountry]).filter((c): c is string => !!c))].sort();
  const allowed = rows.filter((r) => r.outcome === 'allowed');
  if (allowed.length > 0) {
    return {
      kind: 'transfers_occurred', windowFrom, windowTo,
      attempts: rows.length,
      allowed: allowed.length,
      // A transfer permitted with no legal basis recorded is the worst row this table can hold, and it is counted
      // separately so an attestation cannot quietly average it away. `ck_rv_allowed_needs_basis` forbids it at the
      // database, so a non-zero count here means a row that bypassed the constraint.
      withoutBasis: allowed.filter((r) => !r.detail || !('legalBasis' in r.detail)).length,
      countries,
    };
  }
  const byBoundary = rows.filter((r) => isEvidenceOfBoundary(r.refusedBy)).length;
  return {
    kind: 'clean', windowFrom, windowTo,
    attempts: rows.length,
    blockedByBoundary: byBoundary,
    // Reported beside it rather than folded in: an attestation saying "40 attempts blocked" where 35 were malformed
    // requests would overstate what the boundary did.
    otherRefusals: rows.length - byBoundary,
    countries,
  };
}

/** The sentence the attestation may make, as an i18n-free verdict for the console and the export to render.
 *
 *  Returned as a discriminated kind rather than prose because this text ends up in a compliance document and must be
 *  translatable and identical everywhere it appears.
 */
export function attestationClaim(a: Attestation): 'no_cross_border_transfers' | 'transfers_under_basis' | 'cannot_attest' {
  switch (a.kind) {
    case 'clean': return 'no_cross_border_transfers';
    case 'transfers_occurred': return 'transfers_under_basis';
    default: return 'cannot_attest';
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE COUNTRY PROFILE                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export const REGULATION_STATUSES = ['none', 'draft', 'ratified'] as const;
export type RegulationStatus = (typeof REGULATION_STATUSES)[number];

export interface CountryProfile {
  code: string;
  name: string;
  regulationProfile: string | null;
  regulationStatus: string;
  cells: number;
  activeCells: number;
  placedTenants: number;
  allLocked: boolean;
}

/** May a cell be provisioned for this country?
 *
 *  **A DRAFT PROFILE IS NOT A PROFILE.** W033 shows BD as "DPA 2023 (draft profile)" with no cells, and that is the
 *  correct state: provisioning a cell under a draft would mean the residency lock enforcing a rule nobody has ratified —
 *  the platform asserting a legal position its lawyers have not taken. W038's market-entry gate says the same thing in
 *  its own words: "opening a new country cell requires the legal entity, local payment rails and DPA profile signed off."
 */
export function canProvisionForCountry(p: Pick<CountryProfile, 'regulationStatus' | 'regulationProfile'>): { ok: true } | { ok: false; reason: string } {
  if (p.regulationStatus === 'ratified' && p.regulationProfile) return { ok: true };
  if (p.regulationStatus === 'draft') {
    return {
      ok: false,
      reason: 'this country\'s data-protection profile is drafted but not ratified. Provisioning a cell under it would '
        + 'mean the residency lock enforcing a rule nobody has signed off — the platform taking a legal position its '
        + 'lawyers have not taken.',
    };
  }
  return {
    ok: false,
    reason: 'this country has no data-protection profile recorded, so there is no residency rule for a cell here to '
      + 'anchor to. The profile is a legal artefact and comes before the infrastructure.',
  };
}

/** W033's cross-border column, which reads "blocked" for every row.
 *
 *  It is COMPUTED from the locks rather than stored, because a stored value could disagree with the locks it describes —
 *  and this column is the screen's central assurance. `allLocked` false means at least one cell in the country is
 *  unlocked, which makes the country's boundary as strong as its weakest cell.
 */
export function crossBorderPosture(p: Pick<CountryProfile, 'allLocked' | 'cells'>): 'blocked' | 'partial' | 'no_cells' {
  if (p.cells === 0) return 'no_cells';
  return p.allLocked ? 'blocked' : 'partial';
}

/* ------------------------------------------------------------------------------------------------ */
/* RECORDING AN ATTEMPT                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export interface ViolationDraft {
  attemptKind: AttemptKind;
  subjectType: string;
  subjectId: string;
  fromCountry: string | null;
  toCountry: string | null;
  fromCellId: string | null;
  toCellId: string | null;
  refusedBy: RefusalReason;
  outcome: ViolationOutcome;
  actorAdminId: string | null;
  detail: Record<string, unknown>;
}

/** Build the record of a refused attempt.
 *
 *  **THE RECORD IS WRITTEN IN ITS OWN TRANSACTION, BEFORE THE REFUSAL.** This is the one thing about this module that is
 *  easy to get wrong and total when wrong: recording inside the transaction that is about to abort writes evidence that
 *  rolls back with it. 0117's trigger says the same in its own comment, and the service does the write separately for
 *  exactly this reason.
 */
export function draftViolation(v: ViolationDraft): ViolationDraft {
  if (v.outcome === 'blocked' && (!v.fromCountry || !v.toCountry)) {
    // `ck_rv_countries` refuses it at the database; refusing here gives the caller a sentence rather than a constraint
    // violation, and says the true thing: a cross-border record with one side missing is a record an attestation cannot use.
    throw new InvalidCellsInputError(
      'a blocked cross-border attempt must name both countries; a record with one side missing cannot support an attestation');
  }
  if (v.outcome === 'allowed' && !('legalBasis' in v.detail)) {
    throw new InvalidCellsInputError(
      'a permitted cross-border transfer must record its legal basis. There is no lawful transfer without one, and a row '
      + 'asserting otherwise would be the single most damaging entry this log could hold.');
  }
  return v;
}
