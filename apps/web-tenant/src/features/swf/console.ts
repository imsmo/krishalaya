// apps/web-tenant/src/features/swf/console.ts · PC-56 TENANT-SW-f — the PURE helpers behind W193 (mandi pulse), W194 (demand map), W195
// (wastage), W196 (reports), W417 (learner insights), W318 (offline canon) and their chains (W2678–W2682, W2569–W2573, W2824–W2828,
// W2738–W2740). Every figure is the API's: the console formats, never computes. A figure the API refuses arrives as `{ kind: 'refused',
// code }` and prints its sentence — the API's own (ui_messages, en / hi / gu) when it sent one, else the catalogue's `swf.refused.<CODE>`.
// No literal reaches a page (Law 7).
import type { Translator } from '@krishalaya/i18n';
import type { AsOfLabels } from '../../components/AsOf';
import type { SignalLabels } from '../../components/OnlineGuard';
import type { StaleLabels } from '../../components/StaleDiffChip';

export const INSIGHTS_HREF = '/insights';
export const MANDI_HREF = '/insights/mandi-pulse';
export const DEMAND_HREF = '/insights/demand-map';
export const WASTAGE_HREF = '/insights/wastage';
export const REPORTS_HREF = '/insights/reports';
export const STUDIO_INSIGHTS_HREF = '/studio/insights';
export const OFFLINE_CANON_HREF = '/canon/offline';
export const INSIGHT_EXPORTS_HREF = '/insights/exports';
export const RETRY_HREF = '/insights/retry';
export const insightExportHref = (id: string, from: InsightFrom) => `${INSIGHT_EXPORTS_HREF}/${encodeURIComponent(id)}?from=${from}`;
export const insightExportDownloadHref = (id: string, token: string, from: InsightFrom) => `${INSIGHT_EXPORTS_HREF}/${encodeURIComponent(id)}/download?token=${encodeURIComponent(token)}&from=${from}`;

/** The four screens of the Insights sub-nav, in the canon's order (W193–W196). */
export const INSIGHT_TABS = [
  { key: 'mandi', href: MANDI_HREF }, { key: 'demand', href: DEMAND_HREF }, { key: 'wastage', href: WASTAGE_HREF }, { key: 'reports', href: REPORTS_HREF },
] as const;
export const INSIGHT_FROMS = ['mandi', 'demand', 'wastage', 'reports'] as const;
export type InsightFrom = (typeof INSIGHT_FROMS)[number];
export const isInsightFrom = (v: unknown): v is InsightFrom => typeof v === 'string' && (INSIGHT_FROMS as readonly string[]).includes(v);
export const backHrefFor = (from: InsightFrom) => ({ mandi: MANDI_HREF, demand: DEMAND_HREF, wastage: WASTAGE_HREF, reports: REPORTS_HREF })[from];

/** Every code the API refuses a FIGURE with (domain/insights.ts REFUSED + learner-insights + the computed share refusals). */
export const REFUSED_CODES = [
  'NO_STOCK_DECLARATION', 'NO_CAUSAL_METHOD', 'NO_REGISTERED_MODEL', 'NO_PRICE_ON_REQUIREMENT', 'NO_GEO_REACH', 'NO_UNMET_DEMAND_METHOD',
  'EXTERNAL_STATISTIC_UNSOURCED', 'NO_COUNTERFACTUAL_METHOD', 'NO_WEIGHBRIDGE_OBJECT', 'MANUAL_WASTAGE_REFUSED', 'NO_ANALYTICS_REPLICA',
  'MEMBER_DIMENSION_NOT_OFFERED', 'UNSIGNED_FOUNDER_PHYSICAL_KEY', 'BELOW_LEARNER_FLOOR', 'NO_ADVISORY_GENERATOR', 'NO_CAPTURE_YET',
  'NO_GMV', 'NO_MEASURED_LOSS', 'MIXED_CURRENCY', 'NO_OFFLINE_WRITE_QUEUE',
] as const;
/** The API's refusal codes these screens can meet (the services' codes, the database's `[CODE]`s of 0202, transport codes). */
export const SWF_CODES = [
  'RANGE_TOO_WIDE', 'RANGE_ORDER', 'DATE_INVALID', 'ROW_CAP', 'STATEMENT_TIMEOUT', 'QUERY_FAILED', 'DATASET_DISABLED', 'EXPORT_PLANE_OFF',
  'UNKNOWN_DATASET', 'UNKNOWN_DIMENSION', 'UNKNOWN_MEASURE', 'TOO_MANY_DIMENSIONS', 'NO_MEASURE', 'TOO_MANY_MEASURES', 'DUPLICATE_KEY',
  'AUDITOR_DATASET_NOT_PERMITTED', 'AUDITOR_READ_ONLY', 'PLATFORM_DEFINITION_READ_ONLY', 'PLATFORM_DEFINITION_NOT_RUNNABLE', 'REPORT_DEFINITION_NOT_FOUND',
  'REPORT_DEFINITION_ARCHIVED', 'REPORT_DEFINITION_IDENTITY_FINAL', 'REPORT_RUN_NOT_FOUND', 'REPORT_SCHEDULE_NOT_FOUND', 'REPORT_SCHEDULE_FINAL',
  'REPORT_SCHEDULE_SHAPE_FINAL', 'SCHEDULE_SHAPE', 'SCHEDULE_RECIPIENTS', 'REASON_REQUIRED', 'MANUAL_WASTAGE_REFUSED', 'WASTAGE_EVENT_ONCE',
  'WASTAGE_SOURCE_NOT_A_FACT', 'WASTAGE_APPEND_ONLY', 'STALE_ROW', 'SEEN_MISSING',
  'FEATURE_DISABLED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'IDEMPOTENCY_CONFLICT',
] as const;
/** The report run's own status vocabulary (domain/report-run.state.ts). */
export const RUN_STATUSES = ['queued', 'running', 'ready', 'failed', 'refused'] as const;
export const REPORT_ACTS = ['run', 'save', 'schedule', 'archive', 'unschedule'] as const;
export type ReportAct = (typeof REPORT_ACTS)[number];
export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export const RECIPIENT_ROLES = ['tenant_admin', 'fpo_coordinator', 'auditor', 'tenant_staff'] as const;
export const WASTAGE_KINDS = ['transit', 'storage', 'milk', 'other'] as const;
export const WASTAGE_SOURCES = ['return_accepted', 'dairy_pour_rejected', 'transit_dispute_variance', 'cold_chain_loss', 'pod_rejection'] as const;
export const MAX_RANGE_DAYS = 92;
export const REASON_MIN = 10;

const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isReportAct = (v: unknown): v is ReportAct => isIn(REPORT_ACTS, v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function swfCodeKey(code: string): string { return isIn(SWF_CODES, code) ? `swf.code.${code}` : 'swf.code.unknown'; }
export function refusedKey(code: string): string { return isIn(REFUSED_CODES, code) ? `swf.refused.${code}` : 'swf.refused.unknown'; }

/** A sentence the API sent (ui_messages: en / hi / gu), in the reader's language, falling back to English; null when none was sent. */
export type Words = Record<string, { en: string; [lang: string]: string | undefined }>;
export function wordsFor(words: Words | null | undefined, code: string, lang: string): string | null {
  const w = words?.[code];
  if (!w) return null;
  return (w[lang] && w[lang]!.trim()) || w.en || null;
}

export function swfPageState(status: number | undefined): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (status === 403) return 'restricted';
  if (status === 404) return 'flaggedOff';
  return 'error';
}
export function failedCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x)).slice(0, 8); }

/** Basis points the API computed → "1.89%" (two decimals, from integers — the console never divides money). */
export function bpsPercent(bps: number): string {
  if (!Number.isInteger(bps)) return '';
  const neg = bps < 0; const a = Math.abs(bps);
  return `${neg ? '−' : bps > 0 ? '+' : '±'}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}%`;
}
export function sharePercent(bps: number): string { return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`; }

/** The report form, as typed — checked here for the operator's sake; the API (and the database) decide. */
export interface RunDraft { dataset: string; dimensions: string[]; measures: string[]; from: string; to: string }
export function daysInclusive(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
export function runDraftProblems(d: RunDraft): string[] {
  const out: string[] = [];
  if (!d.dataset) out.push('NO_DATASET');
  if (d.measures.length === 0) out.push('NO_MEASURE');
  if (d.dimensions.length > 3) out.push('TOO_MANY_DIMENSIONS');
  if (!isYmd(d.from) || !isYmd(d.to)) out.push('DATE_INVALID');
  else if (d.to < d.from) out.push('RANGE_ORDER');
  else if (daysInclusive(d.from, d.to) > MAX_RANGE_DAYS) out.push('RANGE_TOO_WIDE');
  return out;
}
/** Multi-value query params (dims=month&dims=crop or dims=month,crop) → a clean, de-duplicated key list. */
export function keyList(raw: string | string[] | undefined): string[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? '']).flatMap((x) => x.split(',')).map((x) => x.trim()).filter((x) => /^[a-z][a-z0-9_]{1,40}$/.test(x));
  return [...new Set(parts)];
}
export function istToday(now = new Date()): string { return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10); }
export function istDaysAgo(n: number, now = new Date()): string { return new Date(now.getTime() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10); }

/** The watermark the API stored (tab-separated `# key\tvalue` lines) → pairs for the run page. */
export function watermarkPairs(w: string | null | undefined): Array<[string, string]> {
  return (w ?? '').split('\n').filter((l) => l.includes('\t')).map((l) => { const i = l.indexOf('\t'); return [l.slice(0, i).replace(/^#\s*/, ''), l.slice(i + 1)] as [string, string]; });
}

/* ───── labels for the shared client components (strings travel as props; the catalogue stays on the server) ───── */
export function asOfLabels(t: Translator): AsOfLabels {
  return { asOf: t.t('swf.asOf.lead'), now: t.t('swf.asOf.rel.now'), minutes: t.t('swf.asOf.rel.minutes'), hours: t.t('swf.asOf.rel.hours'), days: t.t('swf.asOf.rel.days'),
    ago: t.t('swf.asOf.rel.ago'), stale: t.t('swf.asOf.stale'), staleCell: t.t('swf.asOf.staleCell'), refresh: t.t('swf.asOf.refresh') };
}
export function signalLabels(t: Translator): SignalLabels {
  return { banner: t.t('swf.signal.banner'), detail: t.t('swf.signal.detail'), needsSignal: t.t('swf.signal.needs'), policy: t.t('swf.signal.policy'), policyHref: OFFLINE_CANON_HREF };
}
export function staleLabels(t: Translator): StaleLabels {
  return { title: t.t('swf.stale.title'), seenMissing: t.t('swf.stale.seenMissing'), field: t.t('swf.stale.field'), was: t.t('swf.stale.was'), now: t.t('swf.stale.now'),
    recheck: t.t('swf.stale.recheck'), nothingWritten: t.t('swf.stale.nothingWritten') };
}
