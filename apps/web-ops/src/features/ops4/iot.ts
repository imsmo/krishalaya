// apps/web-ops/src/features/ops4/iot.ts · PC-56 OPS-4c · THE SENSORS — PURE helpers for `/iot/*` (W400, W401, W404). Founder door Q6-A (applied by
// the lead from OPS-3 Q13-A and the OPS-3b lesson): signed loggers only, every reading labelled by its source, soil pods and weather masts shown
// as registered with no readings, battery and calibration refused, the old fleet list removed (`/devices` → 307 here).
//
// NOTHING here adds readings up, averages them, draws between them or invents a value. The ONLY arithmetic is a reading's AGE — the whole
// minutes between the time the server sent and the moment this page was read (the OPS-3b `/bmc` shape) — printed with the reading's own time
// and its source beside it. Every temperature is the server's figure as sent; every count is a number the SERVER returned (the breaches in 7
// days, the registered soil pods and weather masts) — never a tally of rows, never a sum.
export const IOT = { dashboard: '/iot/dashboard', device: '/iot/device', health: '/iot/device-health' } as const;
/** next.config.js `redirects()` mirrors this as a REAL 307 (permanent: false); pinned equal by test/ops4c-pages.spec.ts. `/devices/rules` and
 *  `/devices/alerts` stay where they are (OPS-5 owns them). */
export const OPS4C_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [{ source: '/devices', destination: IOT.dashboard }];

/** The monitored subject types, in the server's vocabulary (`COLD_CHAIN_SUBJECTS`, apps/api …/cold-chain-log.entity.ts). */
export const SUBJECT_TYPES = ['bmc_unit', 'shipment', 'warehouse_chamber', 'vaccine_box'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export function isSubjectType(v: unknown): v is SubjectType { return typeof v === 'string' && (SUBJECT_TYPES as readonly string[]).includes(v); }

/** W401's hours window — a GET filter (E7). The server accepts 1…744 and defaults to 48; the page offers four. */
export const HOURS_WINDOWS = [6, 24, 48, 168] as const;
export const DEFAULT_HOURS = 48;
export function hoursParam(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  return (HOURS_WINDOWS as readonly number[]).find((h) => String(h) === s) ?? DEFAULT_HOURS;
}
export function subjectTypeParam(v: string | string[] | undefined): SubjectType | null {
  const s = Array.isArray(v) ? v[0] : v;
  return isSubjectType(s) ? s : null;
}
export function uuidParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
/** W401's address for one subject (the edge the canon never drew beyond W400). */
export function deviceHref(type: SubjectType, id: string, hours?: number): string {
  const qs = new URLSearchParams({ type, id });
  if (hours && hours !== DEFAULT_HOURS) qs.set('hours', String(hours));
  return `${IOT.device}?${qs.toString()}`;
}

export type IotState = 'ok' | 'off' | 'forbidden' | 'error';
/** A read's outcome gives the page state. 404 is the `logistics` flag being OFF (the API hides switched-off routes as 404); 403 is a person
 *  without `logistics.manage`. */
export function iotState(status: 'ok' | number | 'failed'): IotState {
  if (status === 'ok') return 'ok';
  if (status === 404) return 'off';
  if (status === 403) return 'forbidden';
  return 'error';
}

/** The words for a reading's SOURCE (Q6-A): "from the logger" only when the server says `device`; "typed by a person" when it says `manual`. */
export function sourceKey(source: unknown): string {
  return source === 'device' ? 'ops4.iot.source.device' : source === 'manual' ? 'ops4.iot.source.manual' : 'ops4.iot.source.unknown';
}
/** The name of a reading's own time: a logger's reading carries THE DEVICE's clock (bounded by the server); a typed one the time the person
 *  recorded it (the server's clock). */
export function timeKey(source: unknown): string {
  return source === 'device' ? 'ops4.iot.time.device' : 'ops4.iot.time.manual';
}

/** A temperature exactly as the server sent it (a numeric string such as "4.20", or a number) — printed, never computed. */
export function tempText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && /^-?\d{1,3}(\.\d{1,2})?$/.test(v) ? v : null;
}

/** An instant the server sent, as its own date and minute, labelled UTC (string placement, no clock arithmetic — the OPS-3b `atText`). */
export function atText(iso: unknown): string | null {
  const m = typeof iso === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m && typeof iso === 'string' && /Z$|\+00:00$/.test(iso) ? `${m[1]} ${m[2]} UTC` : null;
}

/** A reading's AGE: whole minutes between the time the server sent and the moment this page was read; null when either is missing or the
 *  time is after the read (a clock the page will not argue with). */
export function minutesBefore(iso: unknown, readAtMs: number): number | null {
  const at = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(readAtMs) || at > readAtMs) return null;
  return Math.floor((readAtMs - at) / 60_000);
}

/** The server's per-subject status, in words (`statusOf`, cold-chain.service.ts). */
export const SUBJECT_STATUSES = ['breach_open', 'silent', 'no_threshold', 'no_reading', 'excursion', 'in_range'] as const;
export function statusKey(s: unknown): string {
  return (SUBJECT_STATUSES as readonly string[]).includes(String(s)) ? `ops4.iot.status.${String(s)}` : 'ops4.iot.status.unknown';
}

/** The subjects the server returned, grouped by type in the server's order — a grouping of rows, never a count. */
export function byType<T extends { subjectType: string }>(rows: readonly T[]): Array<{ type: SubjectType; rows: T[] }> {
  return SUBJECT_TYPES.map((type) => ({ type, rows: rows.filter((r) => r.subjectType === type) })).filter((g) => g.rows.length > 0);
}
