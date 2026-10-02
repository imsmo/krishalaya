// apps/web-tenant/src/features/esg/esg.ts · PC-56 TENANT-9d · ESG, in the console. PURE.
//
// W423 (`/esg`; canon slug `esg/dashboard` redirects), the method pages (`/esg/methods/[code]` — the canon's `#method-…` and
// `#source-…` anchors pointed at ids its file did not contain), W424 (`/esg/report` — the guard + the UNSIGNED export on the
// 6e-2 plane), the form chain W2598–W2601 (`/esg/disclosures/new` — the cooperative's own words about one metric, never a
// number) and the mutate chain W2602–W2604 (`/esg/disclosures/[id]/act` — publish · withdraw). Every list here is the API's
// own (the console spec reads the API source and 0183 and asserts they agree); every word is a key (Law 7).
//
// THE RULE THIS FILE EXISTS FOR: the console never prints a figure the API did not pass through its gate. `valueShown` is
// true only for `published_with_fact` WITH a fact; every other verdict is a sentence — "no method published", "no programme
// recorded", "method published — nothing recorded yet" — never 0 and never a dash that reads as zero.
import type { EsgFact, EsgLangMap, EsgRow, EsgVerdict } from '@krishalaya/sdk-js';

export const ESG_HREF = '/esg';
export const REPORT_HREF = '/esg/report';
export const NEW_DISCLOSURE_HREF = '/esg/disclosures/new';
export const methodHref = (code: string) => `${ESG_HREF}/methods/${encodeURIComponent(code)}`;
export const actHref = (id: string, act: string) => `${ESG_HREF}/disclosures/${encodeURIComponent(id)}/act?step=confirm&act=${encodeURIComponent(act)}`;
export const newDisclosureHref = (metricCode: string) => `${NEW_DISCLOSURE_HREF}?step=edit&metricCode=${encodeURIComponent(metricCode)}`;
export const editDisclosureHref = (id: string) => `${NEW_DISCLOSURE_HREF}?step=edit&id=${encodeURIComponent(id)}`;
export const exportHref = (id: string) => `${REPORT_HREF}/exports/${encodeURIComponent(id)}`;
export const exportDownloadHref = (id: string, token: string) => `${exportHref(id)}/download?token=${encodeURIComponent(token)}`;

export const PILLARS = ['E', 'S', 'G'] as const;
export const METRIC_CODES = [
  'water_per_kg', 'diesel_per_qtl', 'solar_share_bmc', 'carbon_participation',
  'women_participation', 'wage_on_time', 'delay_compensation', 'adulteration', 'worksite_facilities', 'worksite_injury_rate',
  'one_member_one_vote', 'to_farmer_hands', 'audit_trail', 'grievance_channels',
] as const;
export const VERDICTS = ['published_with_fact', 'published_no_fact', 'no_method', 'no_programme'] as const;
export const DISCLOSURE_STATUSES = ['draft', 'published', 'withdrawn'] as const;
export const DISCLOSURE_ACTS = ['publish', 'withdraw'] as const;
export type DisclosureActCode = (typeof DISCLOSURE_ACTS)[number];
export const WITHDRAW_REASONS = ['superseded', 'inaccurate', 'drafting_error', 'board_decision'] as const;
/** The API's review refusals (DisclosureRefusalCode) and act refusals (DisclosureActRefusal), plus the transport words. */
export const DISCLOSURE_REFUSALS = ['NO_PERMISSION', 'NOT_A_DRAFT', 'METRIC_REQUIRED', 'METRIC_UNKNOWN', 'METRIC_FIXED', 'TEXT_REQUIRED', 'LANGUAGE_UNKNOWN',
  'TEXT_TOO_SHORT', 'TEXT_TOO_LONG', 'NUMBER_IN_DISCLOSURE', 'TEXT_HAS_MARKUP', 'NOTHING_CHANGED'] as const;
export const ACT_REFUSALS = ['NO_PERMISSION', 'NOT_A_DRAFT', 'ALREADY_FINAL', 'ANOTHER_PUBLISHED', 'REASON_REQUIRED', 'REASON_UNKNOWN', 'NOTE_REQUIRED', 'NOTE_TOO_LONG'] as const;
export const TRANSPORT_CODES = ['DATABASE_REFUSED', 'ESG_REFUSED', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY',
  'EXPORT_PLANE_DISABLED', 'EXPORT_TOO_MANY_OPEN', 'EXPORT_PARAMS_INVALID', 'unknown'] as const;
/** Mirrors the API's bounds so the form says them before the route does. */
export const MIN_TEXT = 20;
export const MAX_TEXT = 2000;
export const MIN_NOTE = 3;
export const MAX_NOTE = 300;

/** What the canon draws that the platform cannot stand behind — each a sentence on its page (the API's own list). */
export const ESG_REFUSED_BY_NAME = ['methodEditing', 'complianceRole', 'carbonCredits', 'hashChainedTrail', 'trend', 'streakBeyondWindow',
  'audience', 'platformSignature', 'docIdQr', 'watermark', 'byteIdentical', 'pdf', 'retry'] as const;
export const DASHBOARD_REFUSALS = ['methodEditing', 'complianceRole', 'carbonCredits', 'hashChainedTrail', 'trend', 'streakBeyondWindow'] as const;
export const REPORT_REFUSED_BY_NAME = ['audience', 'platformSignature', 'docIdQr', 'watermark', 'byteIdentical', 'pdf', 'retry'] as const;
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isVerdict = (v: unknown): v is EsgVerdict => has(VERDICTS, v);
export const isDisclosureAct = (v: unknown): v is DisclosureActCode => has(DISCLOSURE_ACTS, v);
export const isMetricCode = (v: unknown) => has(METRIC_CODES, v);

/* ---------------------------------------------------------------------------------------------------------- */
/* KEYS                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------- */

export const pillarKey = (p: string) => `esg.pillar.${has(PILLARS, p) ? p : 'other'}`;
export const verdictKey = (v: string) => `esg.verdict.${isVerdict(v) ? v : 'unknown'}`;
/** The VALUE cell when no figure is printed — a sentence per verdict (never 0, never a lone dash). */
export const noValueKey = (v: string) => `esg.value.${isVerdict(v) && v !== 'published_with_fact' ? v : 'published_no_fact'}`;
export const byNameKey = (r: string) => `esg.byName.${has(ESG_REFUSED_BY_NAME, r) ? r : 'other'}`;
export const statusKey = (s: string) => `esg.disclosure.status.${has(DISCLOSURE_STATUSES, s) ? s : 'other'}`;
export const actKey = (a: string) => `esg.act.${isDisclosureAct(a) ? a : 'other'}`;
export const reasonKey = (r: string) => `esg.reason.${has(WITHDRAW_REASONS, r) ? r : 'other'}`;
export function refusalKey(code: string): string {
  if (has(DISCLOSURE_REFUSALS, code) || has(ACT_REFUSALS, code) || has(TRANSPORT_CODES, code)) return `esg.refusal.${code}`;
  return 'esg.refusal.unknown';
}
export const fieldKey = (name: string) => (name === 'metricCode' ? 'esg.form.field.metricCode' : 'esg.form.field.text');

/** The page state from a transport failure (the 9b shape: 403 → restricted, 404 → flagged off on the area's own read). */
export function esgState(code: string | undefined, status?: number, areaRead = false): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return areaRead ? 'flaggedOff' : 'notFound';
  return 'error';
}

/** A platform word in the reader's language, falling back to English (never a blank). */
export function pick(m: EsgLangMap | null | undefined, lang: string): string | null {
  if (!m) return null;
  return m[lang] ?? m.en;
}

/** THE CONSOLE'S HALF OF THE GATE: a figure is drawn only for `published_with_fact` WITH a fact. */
export function valueShown(row: Pick<EsgRow, 'verdict' | 'fact'>): boolean {
  return row.verdict === 'published_with_fact' && row.fact !== null;
}

/** The figure, as sentences (key + vars). Numbers are handed to the page's formatter — never decided here. */
export type Line = { key: string; vars: Record<string, string> };
export function factLines(fact: EsgFact, fmt: (n: number) => string): Line[] {
  switch (fact.kind) {
    case 'omov': {
      const out: Line[] = [{ key: 'esg.fact.omov.main', vars: { closed: fmt(fact.closedWithSnapshot), ballots: fmt(fact.ballots), eligible: fmt(fact.eligibleAtClose) } }];
      if (fact.maxBallotsPerMember !== null) out.push({ key: 'esg.fact.omov.max', vars: { max: fmt(fact.maxBallotsPerMember) } });
      if (fact.overRoll > 0) out.push({ key: 'esg.fact.omov.overRoll', vars: { n: fmt(fact.overRoll) } });
      if (fact.notRecordedCloses > 0) out.push({ key: 'esg.fact.omov.notRecorded', vars: { n: fmt(fact.notRecordedCloses) } });
      return out;
    }
    case 'adulteration': {
      const out: Line[] = [
        { key: 'esg.fact.adulteration.main', vars: { flagged: fmt(fact.flaggedPours), pours: fmt(fact.pours), water: fmt(fact.waterFlagged), from: fact.from, to: fact.to } },
        { key: 'esg.fact.adulteration.retests', vars: { opened: fmt(fact.reviewsOpened), retested: fmt(fact.retested) } },
      ];
      out.push(fact.lastFlaggedDay
        ? { key: 'esg.fact.adulteration.last', vars: { day: fact.lastFlaggedDay } }
        : { key: 'esg.fact.adulteration.none', vars: { days: fmt(fact.windowDays) } });
      return out;
    }
    case 'audit_trail': return [
      fact.appendOnly ? { key: 'esg.fact.audit.appendOnly', vars: {} } : { key: 'esg.fact.audit.notAppendOnly', vars: {} },
      fact.hashColumns.length === 0 ? { key: 'esg.fact.audit.noHash', vars: {} } : { key: 'esg.fact.audit.hashColumns', vars: { cols: fact.hashColumns.join(', ') } },
      fact.ledgerChained ? { key: 'esg.fact.audit.ledgerChained', vars: {} } : { key: 'esg.fact.audit.ledgerNotChained', vars: {} },
    ];
    default: return [];
  }
}

/** `YYYY-MM-DDTHH:MM` (the database's civil instant) → `YYYY-MM-DD HH:MM`, digits only (readable in every script). */
export function civilLabel(civil: string | null | undefined): string | null {
  if (!civil) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(civil);
  return m ? `${m[1]} ${m[2]}` : /^\d{4}-\d{2}-\d{2}$/.test(civil) ? civil : null;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORM'S VALUES IN THE URL (6d-4's mechanism)                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

/** `metricCode` and `text_<lang>` for each active language; anything else is dropped. */
export function disclosureValues(sp: Record<string, string | string[] | undefined>, languages: readonly string[]): { metricCode: string; texts: Record<string, string> } {
  const one = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');
  const metricCode = one('metricCode').trim();
  const texts: Record<string, string> = {};
  for (const l of languages) { const v = one(`text_${l}`); if (v.trim()) texts[l] = v; }
  return { metricCode: /^[a-z_]{2,40}$/.test(metricCode) ? metricCode : '', texts };
}
export function carriedFrom(v: { metricCode: string; texts: Record<string, string> }): Record<string, string> {
  return { ...(v.metricCode ? { metricCode: v.metricCode } : {}), ...Object.fromEntries(Object.entries(v.texts).map(([l, t]) => [`text_${l}`, t])) };
}
/** A disclosure in three languages is longer than 1,500 characters; the form declares its own ceiling (7b's rule). */
export const MAX_CARRIED_DISCLOSURE = 7000;
/** The field name a review refusal points at, as the form's input name (`text.gu` → `text_gu`). */
export const inputNameOf = (field: string) => field.replace('.', '_');
