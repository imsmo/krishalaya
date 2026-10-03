// modules/tenant-webhooks/domain/webhook-log.ts · PURE helpers for the delivery log (W189) — PC-56 TENANT-13a §B.
//   • maskPayload — "Payload viewer masks member PII fields by default". The v1 projections already carry no phone, name, address or
//     email (webhook-catalog.ts), so on a v1 payload this changes nothing; it is the DEFENSIVE second line for anything older or
//     anything a future version gets wrong: every key ending in phone / mobile / name / address / email (snake or camel case) is
//     replaced with a mask, at any depth.
//   • diagnose — the canon's "Diagnosis hint (automatic)" COMPUTED FROM FACTS: the failed attempt rows in the window (grouped in SQL
//     by endpoint and outcome), how many, which status codes, on which endpoints, since when. The console turns the structure into a sentence; nothing here guesses a cause.
//   • hostOf — the endpoint's host, what the console names an endpoint by ("sheets-bridge.anandfpo.in").

export const PII_MASK = '•••';
const PII_KEY = /(?:^|_)(?:phone|mobile|name|address|email)$|(?:Phone|Mobile|Name|Address|Email)$/;

export function isPiiKey(key: string): boolean {
  return PII_KEY.test(key);
}

export function maskPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return PII_MASK;
  if (Array.isArray(value)) return value.map((v) => maskPayload(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isPiiKey(k) && v !== null && v !== undefined ? PII_MASK : maskPayload(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/\.+$/, ''); } catch { return ''; }
}

/** Failed attempts grouped by (endpoint, outcome) — the SQL aggregates; this composes. `code` is an HTTP status as text, or the
 *  transport class the worker recorded as the error's prefix (timeout, redirect, refused, dns, tls, connect, network). */
export interface FailureGroup { endpointId: string; endpointHost: string; code: string; count: number; since: string }

export interface Diagnosis {
  failures: number;
  codes: Array<{ code: string; count: number }>;
  endpoints: Array<{ id: string; host: string; count: number }>;
  since: string | null;
  /** true when every failure shares one code AND one endpoint — the canon's "looks down, not our delivery" case */
  singleCause: boolean;
}

/** The transport class the worker writes as an error's prefix (`timeout: …`), for grouping — never the raw message. */
export const ERROR_CLASSES = ['timeout', 'redirect', 'refused', 'dns', 'tls', 'connect', 'network', 'body'] as const;
export function errorClass(error: string | null): string {
  const p = String(error ?? '').split(':')[0].trim().toLowerCase();
  return (ERROR_CLASSES as readonly string[]).includes(p) ? p : (p ? 'network' : 'unknown');
}

export function diagnose(groups: readonly FailureGroup[]): Diagnosis | null {
  const live = groups.filter((g) => g.count > 0);
  if (live.length === 0) return null;
  const codes = new Map<string, number>();
  const eps = new Map<string, { host: string; count: number }>();
  let since: string | null = null; let failures = 0;
  for (const g of live) {
    failures += g.count;
    codes.set(g.code, (codes.get(g.code) ?? 0) + g.count);
    const e = eps.get(g.endpointId) ?? { host: g.endpointHost, count: 0 };
    e.count += g.count; eps.set(g.endpointId, e);
    if (since === null || g.since < since) since = g.since;
  }
  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  const codeList = [...codes.entries()].map(([code, count]) => ({ code, count })).sort(byCount);
  const epList = [...eps.entries()].map(([id, v]) => ({ id, host: v.host, count: v.count })).sort(byCount);
  return { failures, codes: codeList, endpoints: epList, since, singleCause: codeList.length === 1 && epList.length === 1 };
}
