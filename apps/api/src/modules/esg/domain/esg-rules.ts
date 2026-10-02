// modules/esg/domain/esg-rules.ts · PC-56 TENANT-9d · ESG's pure rules (no I/O): the metric registry's vocabulary, THE GATE
// (a figure prints only where a PUBLISHED method meets a RECORDED fact), freshness in the cooperative's own days, the
// disclosure review (words in the platform's languages, never a number) and the act verdicts.
//
// THE LAW THIS FILE EXISTS FOR — the canon's own: *"An ESG number without a method is marketing."* W423 drew fourteen rows of
// figures; the platform records a fact for three of them. So the gate is two-sided and both sides are required:
//   • method side — 0183's `esg_metric_methods.method_status = 'published'` (a CHECK makes a published row cite its method:
//     ref, version, date, declared source tables, a fact kind, a freshness rule);
//   • fact side   — a reader for that fact kind returned a fact AND the fact is present (a closed resolution with a snapshot;
//     a pour in the window; the catalogue answered).
// Anything else is a verdict WITHOUT a figure: `published_no_fact` ("method published — nothing recorded yet", never 0),
// `no_method` ("no method published"), `no_programme` (carbon — "no programme recorded", never "0 parcels"). Unknown ≠ zero.

/** The canon's pillars, in its order (W423: Environment · Social · Governance). */
import { canTransition } from './esg-disclosure.state';

export const PILLARS = ['E', 'S', 'G'] as const;
export type Pillar = (typeof PILLARS)[number];

/** Every metric W423 draws, in its order — 0183's rows; the unit spec reads the migration and asserts the two agree. The
 *  canon's W424 says "13 metrics"; W423 draws FOURTEEN rows (4 E · 6 S · 4 G). The registry carries what is drawn. */
export const METRIC_CODES = [
  'water_per_kg', 'diesel_per_qtl', 'solar_share_bmc', 'carbon_participation',
  'women_participation', 'wage_on_time', 'delay_compensation', 'adulteration', 'worksite_facilities', 'worksite_injury_rate',
  'one_member_one_vote', 'to_farmer_hands', 'audit_trail', 'grievance_channels',
] as const;
export type MetricCode = (typeof METRIC_CODES)[number];

export const METHOD_STATUSES = ['published', 'not_published'] as const;
export const REFUSAL_KINDS = ['no_method', 'no_programme'] as const;
export const FRESHNESS_RULES = ['latest_source_fact', 'catalogue_now', 'none'] as const;
/** The fact kinds the API has a READER for. A published method naming any other kind prints no figure (fail closed). */
export const FACT_KINDS = ['omov', 'adulteration', 'audit_trail'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** The row chip on W423: four verdicts, never a fifth that reads as a number. */
export const VERDICTS = ['published_with_fact', 'published_no_fact', 'no_method', 'no_programme'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface MethodRow {
  metricCode: string; pillar: Pillar; sortOrder: number;
  methodStatus: 'published' | 'not_published'; refusalKind: 'no_method' | 'no_programme' | null;
  methodRef: string | null; methodVersion: number | null; publishedAt: string | null;
  factKind: string; sourceTables: string[]; freshnessRule: string; staleAfterDays: number | null; windowDays: number | null;
}

/** A civil instant in the cooperative's zone (`YYYY-MM-DDTHH:MM`), as the DATABASE formatted it — never a JS offset guess. */
export type CivilInstant = string;

export interface OmovFact {
  kind: 'omov';
  /** Closed resolutions with 0182's snapshot (outcome passed | failed) — the only ones that contribute. */
  closedWithSnapshot: number;
  /** Ballots in their frozen ballot boxes. */
  ballots: number;
  /** Σ `eligible_at_close` — the roll recorded at each close, NEVER today's roll. */
  eligibleAtClose: number;
  /** The most ballots any one member has in any one resolution (the PK makes it 1; read, not assumed). */
  maxBallotsPerMember: number | null;
  /** Closed resolutions whose ballots exceed their recorded roll (a member eligible when voting, not at close). */
  overRoll: number;
  /** Closed before the snapshot existed (`outcome = 'not_recorded'`) — counted apart, never a figure. */
  notRecordedCloses: number;
  asOf: CivilInstant | null;
}
export interface AdulterationFact {
  kind: 'adulteration';
  windowDays: number; from: string; to: string;
  pours: number; flaggedPours: number; waterFlagged: number;
  reviewsOpened: number; retested: number;
  /** The latest civil day in the window with a flagged pour; null = none in the window (the streak beyond it is refused). */
  lastFlaggedDay: string | null;
  asOf: CivilInstant | null;
}
export interface AuditTrailFact {
  kind: 'audit_trail';
  /** kv_app holds INSERT and SELECT on the trail and its partitions, and never UPDATE, DELETE or TRUNCATE. */
  appendOnly: boolean;
  canInsert: boolean; canUpdate: boolean; canDelete: boolean; canTruncate: boolean;
  /** Columns of `audit_log` whose name says hash — none on this platform: the trail is NOT hash-chained. */
  hashColumns: string[];
  /** `ledger_entries` carries `prev_hash` and `entry_hash` — the chain is the MONEY LEDGER's. */
  ledgerChained: boolean;
  asOf: CivilInstant | null;
}
export type Fact = OmovFact | AdulterationFact | AuditTrailFact;

/** Is there anything recorded to print? (A fact object with nothing in it is not a fact.) */
export function factPresent(f: Fact): boolean {
  switch (f.kind) {
    case 'omov': return f.closedWithSnapshot > 0;
    case 'adulteration': return f.pours > 0;
    case 'audit_trail': return true;
    default: return false;
  }
}

/** THE GATE. Method AND fact, or a verdict without a figure. */
export function verdictOf(m: Pick<MethodRow, 'methodStatus' | 'refusalKind' | 'factKind'>, fact: Fact | null, cited = true): Verdict {
  if (m.methodStatus !== 'published') return m.refusalKind === 'no_programme' ? 'no_programme' : 'no_method';
  // A published row whose method TEXT the platform cannot produce has nothing to cite: no method, no metric.
  if (!cited) return 'no_method';
  if (!fact || fact.kind !== m.factKind || !factPresent(fact)) return 'published_no_fact';
  return 'published_with_fact';
}

/** The fact the wire may carry: only behind a published method, only when present. Everything else is null. */
export function printable(m: Pick<MethodRow, 'methodStatus' | 'refusalKind' | 'factKind'>, fact: Fact | null, cited = true): Fact | null {
  return verdictOf(m, fact, cited) === 'published_with_fact' ? fact : null;
}

/** Is the fact kind one the API can read? (A method row is data; a reader is code — the two must meet.) */
export const isFactKind = (k: unknown): k is FactKind => typeof k === 'string' && (FACT_KINDS as readonly string[]).includes(k);

/* ------------------------------------------------------------------------------------------------------------ */
/* CIVIL DAYS AND FRESHNESS (F-17)                                                                               */
/* ------------------------------------------------------------------------------------------------------------ */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isCivilDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
/** Calendar arithmetic (UTC used only as a calendar, never as the cooperative's clock). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** Whole days from `a` to `b` (`a == b` → 0). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}
/** The last `days` civil days ending `today`, inclusive. */
export function windowEnding(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, -(Math.max(1, days) - 1)), to: today };
}

export interface Freshness {
  rule: string; zone: string; today: string;
  /** When the newest source fact was recorded, in the cooperative's zone (or the moment of reading, for the catalogue). */
  asOf: CivilInstant | null; asOfDay: string | null;
  ageDays: number | null; staleAfterDays: number | null;
  /** Older than the method's declared bound — printed DATED, never hidden and never refreshed by guessing. */
  stale: boolean;
}

/** Freshness exists only where a figure exists. A stale figure is shown with its date (W423 "Stale" state). */
export function freshnessOf(m: MethodRow, fact: Fact | null, clock: { zone: string; today: string }, cited = true): Freshness | null {
  const f = printable(m, fact, cited);
  if (!f) return null;
  const asOfDay = f.asOf && isCivilDay(f.asOf.slice(0, 10)) ? f.asOf.slice(0, 10) : null;
  const ageDays = asOfDay ? Math.max(0, daysBetween(asOfDay, clock.today)) : null;
  const stale = m.staleAfterDays !== null && ageDays !== null && ageDays > m.staleAfterDays;
  return { rule: m.freshnessRule, zone: clock.zone, today: clock.today, asOf: f.asOf, asOfDay, ageDays, staleAfterDays: m.staleAfterDays, stale };
}

/**
 * What the canon draws that this platform cannot stand behind — each printed on its page with its reason, never faked.
 * (`retry` is the canon's own act on the esg-mutate chain W2602–W2604: a page load, not a mutation.)
 */
export const ESG_REFUSED_BY_NAME = [
  'methodEditing',     // W423 "editing method definitions needs the tenant compliance role" — methods are PLATFORM records
  'complianceRole',    // W423/W424 "tenant compliance role", "tenant finance or compliance role" — no such role exists
  'carbonCredits',     // W423 "214 parcels enrolled … MRV evidence" — no carbon programme is recorded; 0015's sale schema awaits the founder
  'hashChainedTrail',  // W423 "Audit trail · hash-chained" — the trail is append-only; the hash chain is the money ledger's
  'trend',             // W423 "up from 11%" — no metric keeps a history to compare against
  'streakBeyondWindow',// W423 "34-day streak" — counted inside the method's window only (Law 8: no unbounded scan of pours)
  'audience',          // W424 Buyer / Lender / AGM annexure — no audience-specific report shape exists
  'platformSignature', // W424 "Signed" / "Pending sign" — no signing key (founder-physical, F-11)
  'docIdQr',           // W424 "Doc ID ESG-26-ANA-07", "QR · verify at krishalaya.in/esg/…" — no document registry, no public verify URL
  'watermark',         // W424 "Watermarked per requester" — the plane writes CSV only; no watermark exists
  'byteIdentical',     // W424 "run twice, byte-identical twice" — computed over live tables; not claimed
  'pdf',               // W424 "Sample page preview" — the plane writes CSV only
  'retry',             // W424 Couldn't compile → Retry (W2602–W2604) — a page load, not a mutation
] as const;
export type EsgRefusal = (typeof ESG_REFUSED_BY_NAME)[number];
export const retryIsMutation = (): false => false;

/* ------------------------------------------------------------------------------------------------------------ */
/* THE DISCLOSURE (W2598–W2601): words, never a number                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export const DISCLOSURE_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];
export const MIN_TEXT = 20;
export const MAX_TEXT = 2000;
export const MIN_NOTE = 3;
export const MAX_NOTE = 300;

export type DisclosureRefusalCode =
  'NO_PERMISSION' | 'NOT_A_DRAFT' | 'METRIC_REQUIRED' | 'METRIC_UNKNOWN' | 'METRIC_FIXED' | 'TEXT_REQUIRED' | 'LANGUAGE_UNKNOWN' |
  'TEXT_TOO_SHORT' | 'TEXT_TOO_LONG' | 'NUMBER_IN_DISCLOSURE' | 'TEXT_HAS_MARKUP' | 'NOTHING_CHANGED';

/**
 * A DECIMAL DIGIT IN ANY SCRIPT (`\p{Nd}` — ASCII, Devanagari ०–९, Gujarati ૦–૯, and every other). A number a tenant types
 * is a self-reported figure; the platform's figures come from records, so a disclosure is words. 0183's
 * `esg_text_has_number()` is the net under this (`ck_esgd_no_number`).
 */
export function hasNumber(s: string): boolean { return /\p{Nd}/u.test(s); }
const MARKUP = /<\s*[a-z!/?]/i;
/** NFC, trimmed, inner runs of whitespace kept as typed (a paragraph break is the author's). */
export function normaliseText(s: string): string { return s.normalize('NFC').trim(); }

export interface DisclosureInput { metricCode?: string | null; texts: Record<string, string | null | undefined> }
export interface DisclosureReviewCtx {
  canDisclose: boolean;
  metricCodes: readonly string[];
  /** The platform's ACTIVE languages (`languages.is_active`) — data, never a compiled list. */
  languages: readonly string[];
  /** The draft as it stands, for an edit. */
  current: { status: string; metricCode: string; texts: Record<string, string> } | null;
}
export interface ReviewRefusal { field: string | null; code: DisclosureRefusalCode }
export interface ReviewField { name: string; entered: string | null; stored: string | null; normalised: boolean }
export interface DisclosureReview {
  ready: boolean; refusals: ReviewRefusal[]; fields: ReviewField[];
  metricCode: string | null; texts: Record<string, string>;
  diff: Array<{ field: string; before: string | null; after: string | null }> | null;
}

/** The review the API computes (W2599). The form-error screen (W2598) is this review with refusals. */
export function buildDisclosureReview(input: DisclosureInput, ctx: DisclosureReviewCtx): DisclosureReview {
  const refusals: ReviewRefusal[] = [];
  const fields: ReviewField[] = [];
  if (!ctx.canDisclose) refusals.push({ field: null, code: 'NO_PERMISSION' });
  if (ctx.current && ctx.current.status !== 'draft') refusals.push({ field: null, code: 'NOT_A_DRAFT' });

  const mRaw = (input.metricCode ?? '').trim();
  const metric = ctx.current ? ctx.current.metricCode : mRaw;
  if (ctx.current && mRaw && mRaw !== ctx.current.metricCode) refusals.push({ field: 'metricCode', code: 'METRIC_FIXED' });
  else if (!metric) refusals.push({ field: 'metricCode', code: 'METRIC_REQUIRED' });
  else if (!ctx.metricCodes.includes(metric)) refusals.push({ field: 'metricCode', code: 'METRIC_UNKNOWN' });
  fields.push({ name: 'metricCode', entered: mRaw || null, stored: metric && ctx.metricCodes.includes(metric) ? metric : null, normalised: false });

  const texts: Record<string, string> = {};
  for (const [lang, raw] of Object.entries(input.texts ?? {})) {
    const entered = raw ?? '';
    if (entered.trim().length === 0) continue;                       // an empty language is "not written", not a refusal
    const name = `text.${lang}`;
    if (!ctx.languages.includes(lang)) { refusals.push({ field: name, code: 'LANGUAGE_UNKNOWN' }); fields.push({ name, entered, stored: null, normalised: false }); continue; }
    const v = normaliseText(entered);
    const before = refusals.length;
    if (hasNumber(v)) refusals.push({ field: name, code: 'NUMBER_IN_DISCLOSURE' });
    if (MARKUP.test(v)) refusals.push({ field: name, code: 'TEXT_HAS_MARKUP' });
    if ([...v].length < MIN_TEXT) refusals.push({ field: name, code: 'TEXT_TOO_SHORT' });
    if ([...v].length > MAX_TEXT) refusals.push({ field: name, code: 'TEXT_TOO_LONG' });
    const ok = refusals.length === before;
    if (ok) texts[lang] = v;
    fields.push({ name, entered, stored: ok ? v : null, normalised: ok && v !== entered });
  }
  if (Object.keys(input.texts ?? {}).every((l) => (input.texts[l] ?? '').trim().length === 0)) refusals.push({ field: null, code: 'TEXT_REQUIRED' });

  let diff: DisclosureReview['diff'] = null;
  if (ctx.current) {
    const langs = [...new Set([...Object.keys(ctx.current.texts), ...Object.keys(texts)])].sort();
    diff = langs.filter((l) => (ctx.current!.texts[l] ?? null) !== (texts[l] ?? null))
      .map((l) => ({ field: `text.${l}`, before: ctx.current!.texts[l] ?? null, after: texts[l] ?? null }));
    if (diff.length === 0 && refusals.length === 0) refusals.push({ field: null, code: 'NOTHING_CHANGED' });
  }
  return { ready: refusals.length === 0, refusals, fields, metricCode: metric && ctx.metricCodes.includes(metric) ? metric : null, texts, diff };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE ACTS (W2602–W2604): publish · withdraw                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export type DisclosureActRefusal =
  'NO_PERMISSION' | 'NOT_A_DRAFT' | 'ALREADY_FINAL' | 'ANOTHER_PUBLISHED' | 'REASON_REQUIRED' | 'REASON_UNKNOWN' | 'NOTE_REQUIRED' | 'NOTE_TOO_LONG';

export interface ActVerdict { allowed: boolean; refusals: DisclosureActRefusal[]; to: DisclosureStatus | null }

export function disclosureActVerdict(
  act: 'publish' | 'withdraw',
  d: { status: string },
  ctx: { canDisclose: boolean; otherPublished: boolean; reasons: readonly string[] },
  input: { reasonCode?: string | null; note?: string | null },
): ActVerdict {
  const refusals: DisclosureActRefusal[] = [];
  if (!ctx.canDisclose) refusals.push('NO_PERMISSION');
  let to: DisclosureStatus | null = null;
  if (act === 'publish') {
    if (!canTransition('publish', d.status)) refusals.push(d.status === 'withdrawn' ? 'ALREADY_FINAL' : 'NOT_A_DRAFT');
    else if (ctx.otherPublished) refusals.push('ANOTHER_PUBLISHED');
    to = 'published';
  } else {
    if (!canTransition('withdraw', d.status)) refusals.push('ALREADY_FINAL');
    const r = (input.reasonCode ?? '').trim();
    if (!r) refusals.push('REASON_REQUIRED');
    else if (!ctx.reasons.includes(r)) refusals.push('REASON_UNKNOWN');
    to = 'withdrawn';
  }
  const note = (input.note ?? '').trim();
  if ([...note].length < MIN_NOTE) refusals.push('NOTE_REQUIRED');
  else if ([...note].length > MAX_NOTE) refusals.push('NOTE_TOO_LONG');
  return { allowed: refusals.length === 0, refusals, to };
}
