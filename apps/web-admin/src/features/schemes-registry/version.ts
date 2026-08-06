// apps/web-admin/src/features/schemes-registry/version.ts · PURE, framework-free helpers for the scheme VERSION
// plane (PC-56 ADMIN-4, migration 0105). No fetch, no React → unit-tested.
//
// The console's job here is to LABEL, never to decide. The server owns every rule: maker ≠ checker is a CHECK
// constraint plus `assertPublishable`, a published version's immutability is a trigger, and the version number comes
// from `maxVersionEverUsed`. Nothing below re-implements any of that. What it does is make sure the screen never
// SAYS something the data does not support — which, on a screen about what a farmer is entitled to, is the part that
// goes wrong quietly.

import { parseJsonObject, parseUuidList, buildWindow } from './scheme';

/* ===================== read-model shapes ===================== */
export type VersionStatus = 'draft' | 'published' | 'superseded';

export interface VersionRow {
  id: string; schemeId: string; version: number; status: VersionStatus | string;
  benefitSummary: Record<string, unknown>; eligibilityRules: Record<string, unknown>;
  requiredDocTypeIds: string[]; applicationWindow: Record<string, unknown> | null;
  applicableRegionIds: string[]; processingFeeMinor: string;
  changeReason: string; draftedBy: string | null; draftedAt: string | null;
  publishedBy: string | null; publishedAt: string | null; checkerNote: string | null;
  isBackfilled: boolean; isSigned: boolean; applicationCount: number | null;
}
export interface DiffEntry { field: string; from: string | null; to: string | null }
export interface Coverage { earliestRecorded: number | null; unrecordedBelow: number | null }

/* ===================== labelling the history ===================== */

/** What a version row is, for the badge. Kept separate from `status` because 'published' and 'published but nobody
 *  signed it' are the same status and very different facts. */
export type VersionKind = 'draft' | 'current' | 'superseded' | 'backfilled' | 'unknown';
export function versionKind(v: Pick<VersionRow, 'status' | 'isBackfilled'>): VersionKind {
  if (v.isBackfilled) return 'backfilled';       // checked FIRST: a backfilled row is 'published' and unsigned
  if (v.status === 'draft') return 'draft';
  if (v.status === 'published') return 'current';
  if (v.status === 'superseded') return 'superseded';
  return 'unknown';                               // a status this console does not know is NOT quietly a current one
}

export function versionClass(kind: VersionKind): string {
  switch (kind) {
    case 'current': return 'kv-status kv-status--ok';
    case 'draft': return 'kv-status kv-status--warn';
    // Deliberately NOT a failure colour. A backfilled version is not somebody's mistake; it is the platform being
    // honest that versioning arrived after these rules did.
    case 'backfilled': return 'kv-status kv-status--muted';
    case 'superseded': return 'kv-status kv-status--muted';
    default: return 'kv-status kv-status--muted';
  }
}

/** Whether to draw a signature line ("published by … · checker note") for this row.
 *
 *  FALSE for a backfilled row even though its status is 'published' and it has a `published_at`. The DB constraint
 *  `ck_scheme_version_backfill` guarantees `published_by IS NULL` for those, so there is no name to print — and a
 *  signature line with a blank name reads as a rendering bug rather than as "nobody signed this".
 */
export function showsSignature(v: Pick<VersionRow, 'isSigned'>): boolean { return v.isSigned === true; }

/** The honest history note. Returns a KEY, so the catalogue holds the wording.
 *
 *  `unrecorded` is the whole point of this function. A scheme sitting at v6 whose earliest recorded version is v6
 *  changed five times before 0105 and those rule sets were overwritten in place. An empty-list check would render
 *  "no earlier versions" — a false statement about a scheme that has been rewritten five times.
 */
export type CoverageNote = 'none' | 'complete' | 'unrecorded';
export function coverageNote(c: Coverage): CoverageNote {
  if (c.earliestRecorded === null) return 'none';
  return c.unrecordedBelow === null ? 'complete' : 'unrecorded';
}

/** The live `schemes` row is a projection of the published version. If they ever disagree, the screen must say so
 *  rather than pick one — a divergence here means a publish half-committed, and the number a farmer is being served
 *  by is the live one. */
export function projectionDiverged(liveVersion: number, rows: Array<Pick<VersionRow, 'status' | 'version'>>): boolean {
  const current = rows.find((r) => r.status === 'published');
  if (!current) return false;             // no published version is a different, separately-reported state
  return current.version !== liveVersion;
}

/** Is there an open draft, and which one. */
export function openDraft(rows: VersionRow[]): VersionRow | null {
  return rows.find((r) => r.status === 'draft') ?? null;
}

/* ===================== the checker gate, as a LABEL ===================== */

/** Why the Publish control is not offered. `null` means it is.
 *
 *  MAKER-CHECKER BY ABSENCE, the standing doctrine: when the reason is `sameActor` the control is NOT RENDERED
 *  rather than rendered-and-disabled. A disabled Publish button teaches an operator that they nearly have the right
 *  to publish their own rule change and should go and ask for it; an absent one, beside a line naming the rule,
 *  teaches them to find a second person. The server refuses either way (`assertPublishable` + a CHECK constraint) —
 *  this is about what the screen implies is possible.
 */
export type PublishBlock = 'noDraft' | 'sameActor' | null;
export function publishBlockedReason(draft: VersionRow | null, viewerUserId: string | null): PublishBlock {
  if (!draft) return 'noDraft';
  if (draft.draftedBy && viewerUserId && draft.draftedBy === viewerUserId) return 'sameActor';
  return null;
}

/* ===================== money and diffs: never parsed ===================== */

/** A minor-unit fee as text, with the unit named. NEVER divided, NEVER parsed to a number.
 *
 *  `processingFeeMinor` is a bigint in minor units. `Number('900000000000000')` is already at the edge of exact
 *  integer representation and a fee is one refactor away from being formatted as a float. The label says "minor
 *  units" for the same reason the CSV header does: 5000 read as ₹5,000 rather than ₹50 is a hundredfold error, and
 *  it is the reader who makes it.
 */
export function feeText(minor: string | null | undefined): string {
  const s = (minor ?? '').trim();
  if (!s || !/^[0-9]{1,20}$/.test(s)) return '—';
  return `${s} minor units`;
}

/** True when this version's fee differs from the one below it — the diff line an operator most needs to notice. */
export function feeChanged(diff: DiffEntry[]): boolean {
  return diff.some((d) => d.field === 'processingFeeMinor');
}

/** Order the review-step diff so the fields that change what a farmer gets or pays come FIRST.
 *
 *  A diff rendered in whatever order the server emitted puts a region-list reshuffle above a fee change as often as
 *  not. The checker reads top-down and the top is where attention is.
 */
const FIELD_WEIGHT: Record<string, number> = {
  processingFeeMinor: 0, eligibilityRules: 1, benefitSummary: 2, applicationWindow: 3, requiredDocTypeIds: 4, applicableRegionIds: 5,
};
export function orderedDiff(diff: DiffEntry[]): DiffEntry[] {
  return [...diff].sort((a, b) => (FIELD_WEIGHT[a.field] ?? 99) - (FIELD_WEIGHT[b.field] ?? 99));
}

/** Is this diff entry an ADDITION (nothing there before)? Used to label rather than to show an empty "from" cell,
 *  which reads as missing data. */
export function isAddition(d: DiffEntry): boolean { return d.from === null || d.from === 'null'; }

/* ===================== DELTA-018: the portal word ===================== */

export type PortalState = 'mapped' | 'manual';

/** What an authority's filing route is. TWO values, and neither is the canon's "connected".
 *
 *  W072's mock prints "connected" against three authorities. A mapping row records WHICH portal an authority files
 *  through; nothing in this monorepo has ever called one of these portals. An operator who reads "connected" stops
 *  chasing a filing that is not happening — so the console says "portal mapped", and the screen says in words that a
 *  mapping is a record of intent rather than evidence of a working sync.
 */
export function portalState(row: { portalState?: string | null; portal?: { providerCode?: string | null } | null }): PortalState {
  if (row.portalState === 'mapped' || row.portalState === 'manual') return row.portalState;
  return row.portal && row.portal.providerCode ? 'mapped' : 'manual';
}
/** `manual` is NOT styled as a failure. An authority with no API is the normal case for a district collectorate, and
 *  a red cell against it would be a criticism of a fact. */
export function portalClass(state: PortalState): string {
  return state === 'mapped' ? 'kv-status kv-status--ok' : 'kv-status kv-status--muted';
}

export const PORTAL_PROVIDERS = ['pfms', 'ikhedut', 'pmkisan'] as const;
export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];
export function isPortalProvider(v: string | null | undefined): v is PortalProvider {
  return (PORTAL_PROVIDERS as readonly string[]).includes((v ?? '').trim());
}

/** Refuse anything credential-shaped in the endpoint label. The server refuses too; this stops the round trip and,
 *  more to the point, stops a token being sent over the wire and into a log line before it is rejected. */
const SECRET_SHAPED = /(?:api[_-]?key|secret|token|password|passwd|bearer\s|authorization|-----BEGIN)/i;
export type MapPortalResult =
  | { ok: true; value: { providerCode: PortalProvider; externalId: string; endpointLabel: string | null; reason: string } }
  | { ok: false; error: 'providerCode' | 'externalId' | 'endpointLabel' | 'secretShaped' | 'reason' };
export function buildMapPortal(raw: { providerCode?: string; externalId?: string; endpointLabel?: string; reason?: string }): MapPortalResult {
  const provider = (raw.providerCode ?? '').trim();
  if (!isPortalProvider(provider)) return { ok: false, error: 'providerCode' };
  const externalId = (raw.externalId ?? '').trim();
  if (!externalId || externalId.length > 200 || /[<>]/.test(externalId)) return { ok: false, error: 'externalId' };
  const label = (raw.endpointLabel ?? '').trim();
  if (label.length > 200 || /[<>]/.test(label)) return { ok: false, error: 'endpointLabel' };
  // its own error key, not 'endpointLabel' — the operator needs to be told WHY, or they will retype the same token
  if (label && SECRET_SHAPED.test(label)) return { ok: false, error: 'secretShaped' };
  const reason = (raw.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: 'reason' };
  return { ok: true, value: { providerCode: provider, externalId, endpointLabel: label || null, reason } };
}

/* ===================== the calendar's close state ===================== */

export type CloseState =
  | { kind: 'closes_in'; days: number; onYear: number }
  | { kind: 'closes_today'; onYear: number }
  | { kind: 'no_window' }
  | { kind: 'unparseable' }
  | { kind: 'impossible_date'; month: number; day: number; onYear: number };

/** How to style a deadline. `no_window` is an always-open scheme (pm_kisan, kcc) and gets NO urgency styling at all —
 *  it is not a deadline, and colouring it like one would put pm_kisan permanently at the top of an operator's
 *  worry list. `unparseable` and `impossible_date` ARE failures: both mean a stored window nobody can act on. */
export function closeClass(s: CloseState): string {
  switch (s.kind) {
    case 'closes_today': return 'kv-status kv-status--danger';
    case 'closes_in': return s.days <= 2 ? 'kv-status kv-status--danger' : s.days <= 14 ? 'kv-status kv-status--warn' : 'kv-status kv-status--ok';
    case 'unparseable':
    case 'impossible_date': return 'kv-status kv-status--danger';
    default: return 'kv-status kv-status--muted';
  }
}
/** The i18n key for a close state. A state this console does not recognise resolves to `unparseable`, never to a
 *  reassuring default — an unknown deadline is a problem, not an absence of one. */
export function closeKey(s: CloseState): 'closesToday' | 'closesIn' | 'noWindow' | 'unparseable' | 'impossibleDate' {
  switch (s.kind) {
    case 'closes_today': return 'closesToday';
    case 'closes_in': return 'closesIn';
    case 'no_window': return 'noWindow';
    case 'impossible_date': return 'impossibleDate';
    default: return 'unparseable';
  }
}

/* ===================== W069: the apps-30d column ===================== */

/** Applications filed in the last 30 days. 0 is a REAL answer here (a scheme nobody applies to), so this returns a
 *  number and not a "no data" state — unlike the crop-lens rollups, where 0 and "no products" were different facts.
 *  The distinction is that every scheme can be applied to; not every crop has products. */
export function apps30dText(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? String(n) : '—';
}

/* ===================== exports (W2251 / W2252) ===================== */

export const SCHEME_EXPORT_REPORTS = ['schemes', 'authorities', 'versions', 'calendar'] as const;
export type SchemeExportReport = (typeof SCHEME_EXPORT_REPORTS)[number];
export function isSchemeExportReport(v: string | null | undefined): v is SchemeExportReport {
  return (SCHEME_EXPORT_REPORTS as readonly string[]).includes((v ?? '').trim());
}
export type BuildExportResult =
  | { ok: true; value: { report: SchemeExportReport; limit?: number } }
  | { ok: false; error: 'report' | 'limit' };
export function buildSchemeExport(raw: { report?: string; limit?: string }): BuildExportResult {
  const report = (raw.report ?? '').trim();
  if (!isSchemeExportReport(report)) return { ok: false, error: 'report' };
  const rawLimit = (raw.limit ?? '').trim();
  if (!rawLimit) return { ok: true, value: { report } };
  if (!/^[0-9]{1,5}$/.test(rawLimit)) return { ok: false, error: 'limit' };
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 20000) return { ok: false, error: 'limit' };
  return { ok: true, value: { report, limit } };
}

/* ===================== the draft form ===================== */

/** A draft edit. Every field optional — a draft is edited a field at a time — but at least one must change, because
 *  an empty patch would open a version whose only content is a reason. */
export type SaveDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'benefitSummary' | 'eligibilityRules' | 'requiredDocTypeIds' | 'applicableRegionIds' | 'window' | 'processingFeeMinor' | 'reason' | 'empty' };

/** Build a draft patch from the form. A BLANK field means "leave it alone" and is skipped — which is why every check
 *  below is guarded on the field being non-empty, and why `window_clear` exists as its own checkbox: clearing the
 *  window (making a scheme always-open) and not touching the window are different requests, and two blank date boxes
 *  cannot express the difference. Getting that wrong would silently make a seasonal scheme year-round. */
export function buildSaveDraft(raw: {
  benefitSummary?: string; eligibilityRules?: string; requiredDocTypeIds?: string; applicableRegionIds?: string;
  window_opens?: string; window_closes?: string; window_season?: string; window_clear?: string;
  processingFeeMinor?: string; reason?: string;
}): SaveDraftResult {
  const patch: Record<string, unknown> = {};

  const benefit = (raw.benefitSummary ?? '').trim();
  if (benefit) { const r = parseJsonObject(benefit); if (!r.ok) return { ok: false, error: 'benefitSummary' }; patch.benefitSummary = r.value; }

  const elig = (raw.eligibilityRules ?? '').trim();
  if (elig) { const r = parseJsonObject(elig); if (!r.ok) return { ok: false, error: 'eligibilityRules' }; patch.eligibilityRules = r.value; }

  const docs = (raw.requiredDocTypeIds ?? '').trim();
  if (docs) { const r = parseUuidList(docs); if (!r.ok) return { ok: false, error: 'requiredDocTypeIds' }; patch.requiredDocTypeIds = r.value; }

  const regions = (raw.applicableRegionIds ?? '').trim();
  if (regions) { const r = parseUuidList(regions); if (!r.ok) return { ok: false, error: 'applicableRegionIds' }; patch.applicableRegionIds = r.value; }

  if ((raw.window_clear ?? '').trim() === 'true') {
    // An explicit clear. If dates were ALSO typed the request contradicts itself, and guessing which half the
    // operator meant is how a closing date disappears.
    if ((raw.window_opens ?? '').trim() || (raw.window_closes ?? '').trim()) return { ok: false, error: 'window' };
    patch.applicationWindow = null;
  } else {
    const w = buildWindow({ opens: raw.window_opens, closes: raw.window_closes, season: raw.window_season });
    if (!w.ok) return { ok: false, error: 'window' };
    if (w.value !== null) patch.applicationWindow = w.value;
  }

  const fee = (raw.processingFeeMinor ?? '').trim();
  if (fee) { if (!/^[0-9]{1,15}$/.test(fee)) return { ok: false, error: 'processingFeeMinor' }; patch.processingFeeMinor = fee; }

  // Checked LAST on purpose, unlike the crop-calendar's source rule: here the reason is required but it is not the
  // interesting rule, and reporting it first would hide a malformed eligibility blob behind a missing sentence.
  const reason = (raw.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 1000) return { ok: false, error: 'reason' };
  if (Object.keys(patch).length === 0) return { ok: false, error: 'empty' };

  return { ok: true, value: { ...patch, reason } };
}
