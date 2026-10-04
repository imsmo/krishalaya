// modules/insights/domain/report-builder.ts · PC-56 TENANT-SW-f · W196 — the tenant report builder's ALLOW-LIST and its bounds.
//
// THE DEFINITION IS A SET OF KEYS, NEVER SQL (0120's ruling for the platform builder, kept for the tenant one). A dataset, up to three
// dimension keys and one to six measure keys, each looked up in the frozen map below; the SQL is assembled ONLY from the map's own
// expressions. The tenant predicate is the dataset's own (`tenant_id = $1`, mandi prices also read the platform's rows) and RLS is the
// net under it. Nothing a caller sends reaches the SQL text except as a bind parameter.
//
// THE BOUNDS. From/To ≤ 92 days (inclusive), ≤ 50,000 rows (the run reads cap + 1 to KNOW it was exceeded and refuses `ROW_CAP`
// rather than truncating), and `SET LOCAL statement_timeout = '60s'` inside the run's transaction — that IS the canon's "60s limit",
// printed as "statement timeout 60 s on the primary — an analytics replica is not provisioned" (`NO_ANALYTICS_REPLICA`).
//
// MONEY STAYS WITH ITS CURRENCY, QUANTITY WITH ITS UNIT. A money measure forces the dataset's currency dimension into the grouping,
// a quantity measure its unit dimension — a sum across currencies or units is not a number anybody can use.
import { daysInclusive, isCivilDay } from './civil-days';

export const MAX_RANGE_DAYS = 92;
export const ROW_CAP = 50_000;
export const STATEMENT_TIMEOUT = '60s';
export const MAX_DIMENSIONS = 3;
export const MAX_MEASURES = 6;

export interface DimensionDef { key: string; sql: string }
export interface MeasureDef { key: string; sql: string; kind: 'count' | 'money' | 'qty' | 'number' }
export interface DatasetDef {
  code: string;
  /** FROM clause; the dataset's main relation is aliased `t`. */
  from: string;
  /** The tenant predicate ($1 = tenant id). */
  tenantWhere: string;
  /** Extra fixed predicate (soft-deletes etc.). */
  where?: string;
  /** The column the From/To window applies to, and whether it is a `date` (civil) or a `timestamptz` (IST days). */
  dateCol: string; dateKind: 'date' | 'timestamptz';
  dimensions: readonly DimensionDef[];
  measures: readonly MeasureDef[];
  /** The dimension a money measure must be grouped by / a quantity measure must be grouped by. */
  currencyDim?: string; unitDim?: string;
  /** Read verb a caller needs to run it (`report.run` for every dataset today: the builder's grant is the read; the auditor is narrowed by `auditor`). */
  permission: string;
  /** Within the 9c auditor realm (ledger / compliance basis): the auditor may run it — read-only, via the named export exception. */
  auditor: boolean;
  /** Module flag the dataset's own screens sit behind (refused DATASET_DISABLED when off). */
  flag?: string;
  /** The 6e-2 plane dataset this one corresponds to, when the plane already registers one (the report's file itself is `report_run`). */
  planeDataset?: string;
}

const month = (col: string, kind: 'date' | 'timestamptz') =>
  kind === 'date' ? `to_char(${col}, 'YYYY-MM')` : `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM')`;

/** THE ALLOW-LIST. Eight datasets; every dimension and measure the builder can name. */
export const REPORT_DATASETS: readonly DatasetDef[] = [
  {
    code: 'orders', from: 'orders t', tenantWhere: 't.tenant_id = $1', dateCol: 't.created_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.created_at', 'timestamptz') }, { key: 'status', sql: 't.status::text' }, { key: 'source', sql: 't.source::text' }, { key: 'currency', sql: 't.currency_code::text' }],
    measures: [{ key: 'orders', sql: 'count(*)', kind: 'count' }, { key: 'goods_value_minor', sql: 'sum(t.subtotal_minor)', kind: 'money' }, { key: 'buyer_total_minor', sql: 'sum(t.total_minor)', kind: 'money' }],
    currencyDim: 'currency', permission: 'report.run', auditor: true,
  },
  {
    code: 'settlements', from: 'settlement_lines t JOIN orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id', tenantWhere: 't.tenant_id = $1',
    dateCol: 't.created_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.created_at', 'timestamptz') }, { key: 'currency', sql: 'o.currency_code::text' }],
    measures: [{ key: 'lines', sql: 'count(*)', kind: 'count' }, { key: 'gross_minor', sql: 'sum(t.gross_minor)', kind: 'money' }, { key: 'commission_minor', sql: 'sum(t.commission_minor)', kind: 'money' },
      { key: 'gst_minor', sql: 'sum(t.gst_minor)', kind: 'money' }, { key: 'tds_minor', sql: 'sum(t.tds_minor)', kind: 'money' }, { key: 'net_minor', sql: 'sum(t.net_minor)', kind: 'money' }],
    currencyDim: 'currency', permission: 'report.run', auditor: true,
  },
  {
    code: 'listings', from: 'listings t JOIN products p ON p.id = t.product_id', tenantWhere: 't.tenant_id = $1', where: 't.deleted_at IS NULL',
    dateCol: 't.created_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.created_at', 'timestamptz') }, { key: 'status', sql: 't.status::text' }, { key: 'crop', sql: 'p.default_name' }, { key: 'unit', sql: 't.unit_code::text' }],
    measures: [{ key: 'listings', sql: 'count(*)', kind: 'count' }, { key: 'quantity_available', sql: 'sum(t.quantity_available)', kind: 'qty' }],
    unitDim: 'unit', permission: 'report.run', auditor: false,
  },
  {
    code: 'memberships', from: 'user_tenant_roles t JOIN roles r ON r.id = t.role_id', tenantWhere: 't.tenant_id = $1', where: 't.deleted_at IS NULL',
    dateCol: 't.created_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.created_at', 'timestamptz') }, { key: 'role', sql: 'r.code::text' }, { key: 'active', sql: 'CASE WHEN t.is_active THEN \'active\' ELSE \'inactive\' END' }],
    measures: [{ key: 'role_holders', sql: 'count(DISTINCT t.user_id)', kind: 'count' }, { key: 'role_grants', sql: 'count(*)', kind: 'count' }],
    permission: 'report.run', auditor: false,
  },
  {
    code: 'dairy_cycles', from: 'dairy_bill_cycles t', tenantWhere: 't.tenant_id = $1', where: 't.deleted_at IS NULL', dateCol: 't.period_start', dateKind: 'date',
    dimensions: [{ key: 'month', sql: month('t.period_start', 'date') }, { key: 'status', sql: 't.status::text' }, { key: 'payment_cycle', sql: 't.payment_cycle::text' }],
    measures: [{ key: 'cycles', sql: 'count(*)', kind: 'count' }, { key: 'bills_generated', sql: 'sum(coalesce(t.bills_generated, 0))', kind: 'number' }, { key: 'bills_approved', sql: 'sum(coalesce(t.bills_approved, 0))', kind: 'number' }],
    permission: 'report.run', auditor: false, flag: 'dairy', planeDataset: 'dairy.insights',
  },
  {
    code: 'cold_chain_breaches', from: 'cold_chain_breaches t', tenantWhere: 't.tenant_id = $1', dateCol: 't.opened_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.opened_at', 'timestamptz') }, { key: 'subject_type', sql: 't.subject_type::text' }, { key: 'direction', sql: 't.direction::text' },
      { key: 'outcome', sql: 'coalesce(t.outcome, \'none_recorded\')' }, { key: 'currency', sql: 'coalesce(t.loss_currency::text, \'\')' }],
    measures: [{ key: 'breaches', sql: 'count(*)', kind: 'count' }, { key: 'loss_minor', sql: 'sum(t.loss_minor)', kind: 'money' }],
    currencyDim: 'currency', permission: 'report.run', auditor: false, flag: 'logistics', planeDataset: 'logistics.cold_chain_breaches',
  },
  {
    code: 'wastage_events', from: 'wastage_events t', tenantWhere: 't.tenant_id = $1', dateCol: 't.occurred_at', dateKind: 'timestamptz',
    dimensions: [{ key: 'month', sql: month('t.occurred_at', 'timestamptz') }, { key: 'kind', sql: 't.kind::text' }, { key: 'source_kind', sql: 't.source_kind::text' },
      { key: 'currency', sql: 'coalesce(t.currency_code::text, \'\')' }, { key: 'unit', sql: 'coalesce(t.unit_code::text, \'\')' }],
    measures: [{ key: 'events', sql: 'count(*)', kind: 'count' }, { key: 'value_minor', sql: 'sum(t.value_minor)', kind: 'money' }, { key: 'quantity', sql: 'sum(t.quantity)', kind: 'qty' }],
    currencyDim: 'currency', unitDim: 'unit', permission: 'report.run', auditor: false, flag: 'insights_wastage', planeDataset: 'wastage_events',
  },
  {
    code: 'mandi_pulse',
    from: `mandi_prices t JOIN products p ON p.id = t.product_id LEFT JOIN mandis m ON m.id = t.mandi_id`,
    // the platform's published prices (tenant NULL) and the cooperative's own entries — for the crops its members list or declared
    tenantWhere: `(t.tenant_id IS NULL OR t.tenant_id = $1) AND t.anomaly_state IN ('accepted','released') AND t.product_id IN (
      SELECT l.product_id FROM listings l WHERE l.tenant_id = $1 AND l.status = 'published' AND l.deleted_at IS NULL
      UNION SELECT cs.product_id FROM crop_seasons cs WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL)`,
    dateCol: 't.price_date', dateKind: 'date',
    dimensions: [{ key: 'month', sql: month('t.price_date', 'date') }, { key: 'crop', sql: 'p.default_name' }, { key: 'mandi', sql: 'coalesce(m.default_name, \'\')' },
      { key: 'currency', sql: 't.currency_code::text' }, { key: 'unit', sql: 't.unit_code::text' }],
    measures: [{ key: 'observations', sql: 'count(*)', kind: 'count' }, { key: 'modal_min_minor', sql: 'min(t.modal_minor)', kind: 'money' }, { key: 'modal_max_minor', sql: 'max(t.modal_minor)', kind: 'money' }],
    currencyDim: 'currency', permission: 'report.run', auditor: false, flag: 'market_intel', planeDataset: 'mandi_pulse_member_crops',
  },
];

export const datasetByCode = (code: string): DatasetDef | undefined => REPORT_DATASETS.find((d) => d.code === code);

export type SpecRefusal = 'UNKNOWN_DATASET' | 'UNKNOWN_DIMENSION' | 'UNKNOWN_MEASURE' | 'TOO_MANY_DIMENSIONS' | 'NO_MEASURE' | 'TOO_MANY_MEASURES' | 'DUPLICATE_KEY';
export interface ReportSpec { datasetCode: string; dimensions: readonly string[]; measures: readonly string[] }
export interface ResolvedSpec { dataset: DatasetDef; dimensions: DimensionDef[]; measures: MeasureDef[]; implied: string[] }

/** Validate a spec against the allow-list; money/quantity measures pull in their currency/unit dimension ("implied"). */
export function resolveSpec(s: ReportSpec): { ok: true; spec: ResolvedSpec } | { ok: false; code: SpecRefusal; key?: string } {
  const d = datasetByCode(s.datasetCode);
  if (!d) return { ok: false, code: 'UNKNOWN_DATASET', key: s.datasetCode };
  if (new Set(s.dimensions).size !== s.dimensions.length || new Set(s.measures).size !== s.measures.length) return { ok: false, code: 'DUPLICATE_KEY' };
  if (s.dimensions.length > MAX_DIMENSIONS) return { ok: false, code: 'TOO_MANY_DIMENSIONS' };
  if (s.measures.length === 0) return { ok: false, code: 'NO_MEASURE' };
  if (s.measures.length > MAX_MEASURES) return { ok: false, code: 'TOO_MANY_MEASURES' };
  const dims: DimensionDef[] = [];
  for (const k of s.dimensions) { const x = d.dimensions.find((y) => y.key === k); if (!x) return { ok: false, code: 'UNKNOWN_DIMENSION', key: k }; dims.push(x); }
  const meas: MeasureDef[] = [];
  for (const k of s.measures) { const x = d.measures.find((y) => y.key === k); if (!x) return { ok: false, code: 'UNKNOWN_MEASURE', key: k }; meas.push(x); }
  const implied: string[] = [];
  const need = (key: string | undefined) => {
    if (!key || dims.some((x) => x.key === key)) return;
    const x = d.dimensions.find((y) => y.key === key); if (x) { dims.push(x); implied.push(key); }
  };
  if (meas.some((m) => m.kind === 'money')) need(d.currencyDim);
  if (meas.some((m) => m.kind === 'qty')) need(d.unitDim);
  return { ok: true, spec: { dataset: d, dimensions: dims, measures: meas, implied } };
}

export type RangeRefusal = 'DATE_INVALID' | 'RANGE_ORDER' | 'RANGE_TOO_WIDE';
/** From/To are IST civil days, inclusive; at most 92 days. */
export function checkRange(from: string, to: string): { ok: true; days: number } | { ok: false; code: RangeRefusal } {
  if (!isCivilDay(from) || !isCivilDay(to)) return { ok: false, code: 'DATE_INVALID' };
  if (to < from) return { ok: false, code: 'RANGE_ORDER' };
  const days = daysInclusive(from, to);
  if (days > MAX_RANGE_DAYS) return { ok: false, code: 'RANGE_TOO_WIDE' };
  return { ok: true, days };
}

/** The run's SQL — assembled ONLY from the allow-list's expressions. $1 tenant · $2 from (civil) · $3 to-exclusive (civil). */
export function compileRunSql(s: ResolvedSpec, cap = ROW_CAP): string {
  const d = s.dataset;
  const cols = [...s.dimensions.map((x) => `${x.sql} AS "${x.key}"`), ...s.measures.map((m) => `${m.sql} AS "${m.key}"`)];
  const lo = d.dateKind === 'date' ? '$2::date' : `($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
  const hi = d.dateKind === 'date' ? '$3::date' : `($3::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`;
  const where = [d.tenantWhere, `${d.dateCol} >= ${lo}`, `${d.dateCol} < ${hi}`, ...(d.where ? [d.where] : [])].map((w) => `(${w})`).join(' AND ');
  const n = s.dimensions.length;
  const by = n ? ` GROUP BY ${Array.from({ length: n }, (_, i) => i + 1).join(', ')} ORDER BY ${Array.from({ length: n }, (_, i) => i + 1).join(', ')}` : '';
  return `SELECT ${cols.join(', ')} FROM ${d.from} WHERE ${where}${by} LIMIT ${cap + 1}`;
}

/** The CSV header of a run: dimension keys then measure keys. */
export const runHeader = (s: ResolvedSpec): string[] => [...s.dimensions.map((x) => x.key), ...s.measures.map((m) => m.key)];

/* ──────────────────────────────────────────── the watermark ──────────────────────────────────────────── */
export interface WatermarkFacts {
  tenantId: string; tenantSlug: string; requestedBy: string; requesterName: string | null; generatedAt: Date; runId: string;
  definitionId: string | null; datasetCode: string; from: string; to: string; rowCount: number; dimensions: readonly string[]; measures: readonly string[];
}
/** "2026-10-04 21:07:33 IST" — the IST wall clock of an instant. */
export function istStamp(d: Date): string {
  const t = new Date(d.getTime() + 330 * 60_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 19)} IST`;
}
/** The file's first lines (key, value) — who, when, which run, which definition, how many rows — before the header. */
export function watermarkLines(f: WatermarkFacts): Array<[string, string]> {
  return [
    ['# krishalaya report', 'watermark — this file is audited (report.run)'],
    ['# tenant', `${f.tenantSlug} (${f.tenantId})`],
    ['# requested_by', `${f.requesterName ?? 'user'} (${f.requestedBy})`],
    ['# generated_at', istStamp(f.generatedAt)],
    ['# run_id', f.runId],
    ['# definition_id', f.definitionId ?? 'ad hoc (no saved definition)'],
    ['# dataset', f.datasetCode],
    ['# range', `${f.from} to ${f.to} (IST days, inclusive)`],
    ['# dimensions', f.dimensions.join(' ') || '(none)'],
    ['# measures', f.measures.join(' ')],
    ['# row_count', String(f.rowCount)],
    ['# limits', `statement timeout ${STATEMENT_TIMEOUT} on the primary — an analytics replica is not provisioned; ≤ ${MAX_RANGE_DAYS} days; ≤ ${ROW_CAP} rows`],
    ['# signature', 'unsigned — signing is a founder-physical key; the sha256 is printed on the receipt'],
  ];
}

/* ──────────────────────────────────────────── schedules ──────────────────────────────────────────── */
export const SCHEDULE_CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type ScheduleCadence = (typeof SCHEDULE_CADENCES)[number];
export interface ScheduleShape { cadence: ScheduleCadence; weekdayIso?: number | null; monthDay?: number | null; timeIst: string }
export const RECIPIENT_ROLES = ['tenant_admin', 'fpo_coordinator', 'auditor', 'tenant_staff'] as const;

/**
 * THE NEXT RUN, IN IST. The schedule's wall-clock time on the next IST day that matches its cadence and is strictly after `after`.
 * IST has no daylight saving, so the offset is the constant +05:30 (named, not looked up per call). Monthly days stop at 28 (0202).
 */
export function nextRunAt(s: ScheduleShape, after: Date): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s.timeIst);
  if (!m) throw new Error('timeIst must be HH:MM');
  const hh = Number(m[1]); const mm = Number(m[2]);
  const OFF = 330 * 60_000;
  const wall = new Date(after.getTime() + OFF);
  let y = wall.getUTCFullYear(); let mo = wall.getUTCMonth(); let d = wall.getUTCDate();
  for (let i = 0; i < 400; i++) {
    const cand = new Date(Date.UTC(y, mo, d, hh, mm, 0) - OFF);
    const isoDow = ((new Date(Date.UTC(y, mo, d)).getUTCDay() + 6) % 7) + 1;
    const ok = s.cadence === 'daily' || (s.cadence === 'weekly' && isoDow === s.weekdayIso) || (s.cadence === 'monthly' && d === s.monthDay);
    if (ok && cand.getTime() > after.getTime()) return cand;
    const next = new Date(Date.UTC(y, mo, d + 1)); y = next.getUTCFullYear(); mo = next.getUTCMonth(); d = next.getUTCDate();
  }
  throw new Error('no next run within 400 days');
}

export function checkSchedule(s: ScheduleShape): { ok: true } | { ok: false; code: 'SCHEDULE_SHAPE' } {
  if (!(SCHEDULE_CADENCES as readonly string[]).includes(s.cadence)) return { ok: false, code: 'SCHEDULE_SHAPE' };
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(s.timeIst)) return { ok: false, code: 'SCHEDULE_SHAPE' };
  if (s.cadence === 'weekly' && !(Number.isInteger(s.weekdayIso) && (s.weekdayIso as number) >= 1 && (s.weekdayIso as number) <= 7)) return { ok: false, code: 'SCHEDULE_SHAPE' };
  if (s.cadence === 'monthly' && !(Number.isInteger(s.monthDay) && (s.monthDay as number) >= 1 && (s.monthDay as number) <= 28)) return { ok: false, code: 'SCHEDULE_SHAPE' };
  if (s.cadence === 'daily' && (s.weekdayIso != null || s.monthDay != null)) return { ok: false, code: 'SCHEDULE_SHAPE' };
  return { ok: true };
}

/** The range a saved definition (relative `range_days`) or a schedule runs over: the `days` IST days ending YESTERDAY. */
export function relativeRange(days: number, now: Date): { from: string; to: string } {
  const wall = new Date(now.getTime() + 330 * 60_000);
  const y = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() - 1));
  const f = new Date(Date.UTC(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate() - (days - 1)));
  return { from: f.toISOString().slice(0, 10), to: y.toISOString().slice(0, 10) };
}
