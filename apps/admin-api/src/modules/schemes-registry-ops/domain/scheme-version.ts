// apps/admin-api/src/modules/schemes-registry-ops/domain/scheme-version.ts · the rules of the VERSION plane (0105).
// Pure, no I/O. This is the module that makes `scheme_applications.scheme_version` mean something: a version is a
// published-never-edited rule set, drafted by one operator and published by a DIFFERENT one, and the live `schemes`
// row is a projection of whichever version is `published`.
//
// WHAT IS VERSIONED AND WHAT IS NOT — the line matters and it is not arbitrary:
//   VERSIONED    eligibility_rules, benefit_summary, required_doc_type_ids, applicable_region_ids,
//                processing_fee_minor, application_window.  These decide WHO may apply, WHAT they get, WHAT it
//                costs them, and WHEN the door is open. Every one of them can be the reason an application was
//                accepted or refused, so every one of them must be recoverable years later.
//   NOT VERSIONED  default_name, authority_id, category_id, source_url (classification and identity — correcting a
//                misspelled ministry name is not a rule change and forcing it through a checker would teach
//                operators to route around the checker), and is_active (lifecycle, not entitlement).
//
// THE WINDOW IS IN THE FIRST LIST DELIBERATELY. The canon's own W073 locked state says "Window dates come from
// scheme versions — edit via the scheme (checker-gated)", and the closing date is the single field that decides
// whether a filing is accepted at all. Before 0105 it was the LEAST controlled field in the module: a direct
// UPDATE on the live row, no version, no history of what the date used to be.
import { assertJsonObject, assertUuidArray, assertWindow, assertFeeMinor, assertPlainText } from './scheme-rules';
import { InvalidSchemeInputError, SelfPublishError, VersionNotDraftError } from './schemes-registry.errors';

export type VersionStatus = 'draft' | 'published' | 'superseded';

/** The rule set a version carries — the SAME six fields on both sides of a publish, so a diff is total. */
export interface VersionRules {
  benefitSummary: Record<string, unknown>;
  eligibilityRules: Record<string, unknown>;
  requiredDocTypeIds: string[];
  applicationWindow: Record<string, unknown> | null;
  applicableRegionIds: string[];
  processingFeeMinor: string;          // minor units as a STRING, always (Law 2 — never parsed here, never a float)
}

export interface VersionRow extends VersionRules {
  id: string;
  schemeId: string;
  version: number;
  status: VersionStatus;
  changeReason: string;
  draftedBy: string | null;
  draftedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  checkerNote: string | null;
  isBackfilled: boolean;
}

export const VERSIONED_FIELDS = [
  'benefitSummary', 'eligibilityRules', 'requiredDocTypeIds', 'applicationWindow', 'applicableRegionIds', 'processingFeeMinor',
] as const;
export type VersionedField = (typeof VERSIONED_FIELDS)[number];

/* ------------------------------------------------------------------------------------------------------------ */
/* STABLE COMPARISON — and why a plain JSON.stringify is a real bug here, not a nicety.                         */
/* ------------------------------------------------------------------------------------------------------------ */
/** Canonical JSON: object keys sorted recursively, so `{a:1,b:2}` and `{b:2,a:1}` compare EQUAL.
 *
 *  Postgres `jsonb` does not preserve key order — it normalises on storage. So a rules editor that round-trips a
 *  jsonb object through a form and compares with `JSON.stringify` will see a "change" whenever the key order coming
 *  back differs from the order it went out with. The consequence is specific and bad: a version bump that changes
 *  no rule. Every application filed after it stamps a new version number, splitting the applicant population across
 *  two rule sets that are byte-identical, and the version history tells a grievance officer the rules changed on a
 *  date when they did not. The existing `Scheme.updateRules` compares with bare JSON.stringify and has exactly this
 *  hole; the draft path below does not.
 */
export function stableJson(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (x === null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(walk);                       // arrays are ORDERED — never sorted
    const o = x as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = walk(o[k]);
    return out;
  };
  return JSON.stringify(walk(v) ?? null);
}

/** True when two rule sets are the same rules, key order and all. */
export function rulesEqual(a: VersionRules, b: VersionRules): boolean {
  return VERSIONED_FIELDS.every((f) => stableJson(a[f]) === stableJson(b[f]));
}

/* ------------------------------------------------------------------------------------------------------------ */
/* BUILDING A DRAFT                                                                                             */
/* ------------------------------------------------------------------------------------------------------------ */
export type RulesPatch = Partial<Record<VersionedField, unknown>>;

/** `assertPlainText`/`assertFeeMinor` in scheme-rules.ts are typed for `string` because their callers came through a
 *  zod DTO. This plane also validates rehydrated jsonb and repository rows, so the type check happens here rather
 *  than being cast away — a cast would let a number reach `.trim()` and surface as a 500 instead of a 422. */
function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new InvalidSchemeInputError(`${field} must be a string`);
  return v;
}

/** Validate a patch over a base rule set and return the COMPLETE next rule set.
 *
 *  A draft always holds all six fields, never a patch: a partial version row could not answer "what did v6
 *  require?", which is the entire reason the table exists. `scheme_registry_changes.old_value` is partial and that
 *  is precisely why it could never serve as the rule source.
 */
export function applyRulesPatch(base: VersionRules, patch: RulesPatch): VersionRules {
  const next: VersionRules = { ...base };
  if (patch.benefitSummary !== undefined) next.benefitSummary = assertJsonObject(patch.benefitSummary, 'benefit_summary');
  if (patch.eligibilityRules !== undefined) next.eligibilityRules = assertJsonObject(patch.eligibilityRules, 'eligibility_rules');
  if (patch.requiredDocTypeIds !== undefined) next.requiredDocTypeIds = assertUuidArray(patch.requiredDocTypeIds, 'required_doc_type_ids', 100);
  if (patch.applicableRegionIds !== undefined) next.applicableRegionIds = assertUuidArray(patch.applicableRegionIds, 'applicable_region_ids', 2000);
  if (patch.applicationWindow !== undefined) next.applicationWindow = assertWindow(patch.applicationWindow);
  if (patch.processingFeeMinor !== undefined) next.processingFeeMinor = assertFeeMinor(str(patch.processingFeeMinor, 'processingFeeMinor')).toString();
  return next;
}

/** The maker's reason. Mandatory, and checked before anything else is looked at — the reason is the only part of a
 *  rule change that a human will read in five years' time. */
export function assertChangeReason(v: unknown): string {
  return assertPlainText(str(v, 'reason'), 'reason', 1000);
}

/** The checker's note. OPTIONAL on approval and MANDATORY nowhere — a checker who agrees has nothing to add, and
 *  demanding a sentence teaches people to type 'ok'. Validated only for shape when present. */
export function assertCheckerNote(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  return assertPlainText(str(v, 'checkerNote'), 'checkerNote', 1000);
}

/** A patch that changes nothing must not open a draft. Rejecting it here rather than letting it through is the
 *  difference between a version history that means something and one padded with no-ops. */
export function assertRulesChanged(base: VersionRules, next: VersionRules): void {
  if (rulesEqual(base, next)) {
    throw new InvalidSchemeInputError('the submitted rules are identical to the current published rules — nothing to version');
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE REVIEW DIFF (W2254)                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */
export interface DiffEntry { field: VersionedField; from: string | null; to: string | null }

/** Field-by-field diff of two rule sets, for the read-only review step.
 *
 *  Values are rendered as canonical JSON STRINGS and never re-parsed downstream: `processingFeeMinor` is a bigint in
 *  minor units and a console that parsed it to compare "50000" with "5000" numerically would be one refactor away
 *  from formatting a fee as a float. A string diff cannot lose a digit.
 */
export function versionDiff(prev: VersionRules | null, next: VersionRules): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const f of VERSIONED_FIELDS) {
    const to = stableJson(next[f]);
    const from = prev ? stableJson(prev[f]) : null;
    if (from !== to) out.push({ field: f, from, to });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* PUBLISHING                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */
/** The checker gate. THROWS rather than returning a boolean, for the reason `assertReviewerScope` throws in the
 *  translations module: a boolean a caller may ignore is a control that will eventually be ignored.
 *
 *  `ck_scheme_version_maker_ne_checker` in 0105 refuses the same row at the database. Both exist on purpose — the
 *  DB constraint makes self-publish unrepresentable against ANY future caller, and this function makes the refusal
 *  a 409 that names the rule instead of a constraint-violation 500.
 */
export function assertPublishable(row: Pick<VersionRow, 'id' | 'status' | 'draftedBy' | 'version'>, actorUserId: string): void {
  if (row.status !== 'draft') throw new VersionNotDraftError(row.id, row.status);
  if (row.draftedBy && row.draftedBy === actorUserId) throw new SelfPublishError(row.version);
}

/** A draft may be discarded by anyone holding the permission — including its maker, who is the most likely person to
 *  realise it was a bad idea. Discarding is NOT the checker gate and must not borrow it. */
export function assertDiscardable(row: Pick<VersionRow, 'id' | 'status'>): void {
  if (row.status !== 'draft') throw new VersionNotDraftError(row.id, row.status);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* READING THE HISTORY HONESTLY                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */
export interface Coverage {
  /** Lowest version number whose RULES we hold. null when we hold none at all. */
  earliestRecorded: number | null;
  /** Versions 1..(this-1) existed and their rules are gone. null when nothing is missing. */
  unrecordedBelow: number | null;
}

/** What the version history can and cannot tell you.
 *
 *  `unrecordedBelow` is the whole point. A scheme sitting at v6 whose only recorded version is v6 has FIVE earlier
 *  rule sets that were overwritten in place before 0105 and are not recoverable. Rendering that as "no earlier
 *  versions" — which is what an empty-list check would produce — tells an operator the scheme has never changed.
 *  It has changed five times. Saying "versions before v6 were not recorded" is the difference between a gap and a
 *  false statement.
 */
export function versionCoverage(rows: Array<Pick<VersionRow, 'version'>>): Coverage {
  if (rows.length === 0) return { earliestRecorded: null, unrecordedBelow: null };
  const earliest = rows.reduce((m, r) => Math.min(m, r.version), Number.POSITIVE_INFINITY);
  return { earliestRecorded: earliest, unrecordedBelow: earliest > 1 ? earliest : null };
}

/** Whether a human actually signed this version. FALSE for backfilled rows, which is why the constraint
 *  `ck_scheme_version_backfill` forbids them from naming a publisher: the console must be unable to print a name
 *  that was never there. */
export function isSignedVersion(row: Pick<VersionRow, 'isBackfilled' | 'publishedBy'>): boolean {
  return !row.isBackfilled && row.publishedBy !== null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* DELTA-018 — THE PORTAL WORD WE WILL NOT PRINT                                                                */
/* ------------------------------------------------------------------------------------------------------------ */
export const PORTAL_PROVIDER_CODES = ['pfms', 'ikhedut', 'pmkisan'] as const;
export type PortalProviderCode = (typeof PORTAL_PROVIDER_CODES)[number];
export function isPortalProvider(v: string): v is PortalProviderCode {
  return (PORTAL_PROVIDER_CODES as readonly string[]).includes(v);
}

/** An authority's filing route. Two values only, and neither of them is "connected".
 *
 *  W072's mock shows "connected" against three authorities. A mapping row records WHICH portal an authority files
 *  through; nothing in this monorepo has ever called any of these portals (the PFMS provider is a Noop that returns
 *  providerAvailable:false, and there is no iKhedut client at all). An operator who reads "connected" stops chasing
 *  a filing that is not happening, so the honest values are `mapped` and `manual`, and the screen says in words that
 *  a mapping is a record of intent and not evidence of a successful sync.
 */
export function portalStateOf(ref: { providerCode: string } | null | undefined): 'mapped' | 'manual' {
  return ref && ref.providerCode ? 'mapped' : 'manual';
}

/** Endpoint LABEL only. Credentials live in Secrets Manager (W072 states this as a rule) and this is the guard that
 *  keeps a well-meaning operator from pasting a token into the one field on the screen that accepts free text. */
const SECRET_SHAPED = /(?:api[_-]?key|secret|token|password|passwd|bearer\s|authorization|-----BEGIN)/i;
export function assertEndpointLabel(v: unknown): string {
  const s = assertPlainText(str(v, 'endpointLabel'), 'endpointLabel', 200);
  if (SECRET_SHAPED.test(s)) {
    throw new InvalidSchemeInputError('endpointLabel looks like a credential — portal credentials belong in Secrets Manager, never in the registry');
  }
  return s;
}
