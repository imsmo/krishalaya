// apps/web-tenant/src/features/webhooks/webhooks.ts · PURE helpers for the webhook screens — PC-56 TENANT-13a (W188, W189, W2829–W2838).
//
// THE SECRET NEVER TRAVELS IN A URL (F-5). The old console redirected to `/settings/webhooks?secret=…`, which put the signing secret in
// browser history, every proxy / CDN / Next access log and the Referer of the next request, and re-displayed it on reload — and it
// rendered any attacker-supplied `?secret=` as "your signing secret". Now the add-endpoint chain and the rotate confirm are client
// components that call a server action and hold the secret in React state only (the RevealField pattern of record, TENANT-1b): it is
// shown once, in memory, and gone on navigation. Nothing here reads a `secret` query parameter, and the developer pages are served
// `Cache-Control: no-store` and `Referrer-Policy: no-referrer` (next.config.js — the spec pins both).
//
// THE ENDPOINT URL NEVER TRAVELS IN A URL EITHER. Endpoint URLs commonly embed a token (`?token=…`), so the add-endpoint chain keeps its
// values in the client component's memory instead of the query string the other chains use.
import type { WebhookContract, WebhookDelivery, WebhookDiagnosis, WebhookEndpointAct, WebhookEndpointView } from '@krishalaya/sdk-js';

export const WEBHOOKS_HREF = '/settings/developers/webhooks';
export const NEW_ENDPOINT_HREF = `${WEBHOOKS_HREF}/new`;
export const DELIVERIES_HREF = `${WEBHOOKS_HREF}/deliveries`;
export const LEGACY_WEBHOOKS_HREF = '/settings/webhooks';
/** The developer pages that may hold a secret on screen — served no-store / no-referrer (next.config.js). */
export const SECRET_BEARING_ROUTES = [WEBHOOKS_HREF, `${WEBHOOKS_HREF}/:path*`] as const;

export const ACTS: readonly WebhookEndpointAct[] = ['pause', 'resume', 'rotate', 'delete', 'replay-failed'];
export function isAct(a: unknown): a is WebhookEndpointAct { return typeof a === 'string' && (ACTS as readonly string[]).includes(a); }
export function actHref(id: string, act: WebhookEndpointAct): string { return `${WEBHOOKS_HREF}/${encodeURIComponent(id)}/act?act=${act}&step=confirm`; }
export function actBase(id: string): string { return `${WEBHOOKS_HREF}/${encodeURIComponent(id)}/act`; }
export function deliveryHref(id: string): string { return `${DELIVERIES_HREF}/${encodeURIComponent(id)}`; }
export function replayBase(id: string): string { return `${DELIVERIES_HREF}/${encodeURIComponent(id)}/replay`; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }

/** Which acts a row offers, by status (the API judges again; this only avoids offering what it would refuse by name). */
export function rowActs(e: Pick<WebhookEndpointView, 'status' | 'previousSecretSignsUntil' | 'stats'>): WebhookEndpointAct[] {
  const out: WebhookEndpointAct[] = [];
  if (e.status === 'active') out.push('pause'); else out.push('resume');
  if (!e.previousSecretSignsUntil) out.push('rotate');
  if (e.status === 'active' && (e.stats?.failedOpen ?? 0) > 0) out.push('replay-failed');
  out.push('delete');
  return out;
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* states and refusals                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */
export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
/** A read's failure as one of the canon's states: 404 on a list is the flag; 403 is api.manage. */
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'WEBHOOKS_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}
/** Every refusal code a write answered with (WEBHOOK_REFUSED carries the list), sanitised for the URL. */
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (status === 403) return ['WEBHOOKS_FORBIDDEN'];
  if (status === 404) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}
/** A refusal's sentence key — a code the catalogue does not carry reads as "something went wrong", never as its own key string. */
export function refusalKey(code: string): string { return (REFUSAL_CODES as readonly string[]).includes(code) ? `wh.refusal.${code}` : 'wh.refusal.unknown'; }
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* what a row says                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */
/** "whsec_••••8f2" — the hint is the last 3 characters the API stored apart; null for a pre-0191 endpoint until it rotates. */
export function secretMask(hint: string | null): string | null { return hint ? `whsec_••••${hint}` : null; }

/** Success (7d) as a sentence key + vars. A rate is printed only over real attempts (never a fabricated 100%). */
export function successLine(s: WebhookEndpointView['stats']): { key: string; vars: Record<string, string> } {
  if (!s || s.attempts7d === 0 || s.successBp7d === null) return { key: 'wh.list.success.none', vars: { delivered: String(s?.delivered7d ?? 0) } };
  const pct = (s.successBp7d / 100).toFixed(1).replace(/\.0$/, '');
  if (s.failedToday > 0) return { key: 'wh.list.success.withFailures', vars: { pct, delivered: String(s.delivered7d), failedToday: String(s.failedToday) } };
  return { key: 'wh.list.success.rate', vars: { pct, delivered: String(s.delivered7d) } };
}
export function statusKey(e: Pick<WebhookEndpointView, 'status' | 'pausedReason'>): string {
  if (e.status === 'active') return 'wh.status.active';
  return `wh.status.${e.status}.${e.pausedReason ?? 'manual'}`;
}

/** The three promises, printed from the contract the API returned — the numbers are the worker's own. */
export function promiseVars(c: WebhookContract): Record<string, string> {
  return {
    ladder: c.ladder.join(' · '), attempts: String(c.attemptsPerCycle), overlap: String(c.rotationOverlapHours), retention: String(c.retentionDays),
    timeout: String(c.timeoutSeconds), cap: String(c.responseCapKiB), header: c.signatureHeader, version: String(c.payloadVersion),
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* the delivery log                                                                                                               */
/* ------------------------------------------------------------------------------------------------------------------------------ */
export const WINDOWS = ['24h', '7d', '30d', '90d'] as const;
export type Window = (typeof WINDOWS)[number];
export const PAGE_SIZES = [25, 50, 100] as const;
export function windowOf(raw: unknown): Window { return (WINDOWS as readonly string[]).includes(String(raw)) ? (raw as Window) : '24h'; }
export function pageSizeOf(raw: unknown): (typeof PAGE_SIZES)[number] { const n = Number(raw); return (PAGE_SIZES as readonly number[]).includes(n) ? (n as 25) : 25; }
const WINDOW_MS: Record<Window, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, '90d': 90 * 86_400_000 };
export function sinceOf(w: Window, now: Date): string { return new Date(now.getTime() - WINDOW_MS[w]).toISOString(); }

export interface LogQuery { endpointId?: string; failedOnly?: boolean; window: Window; size: number; cursor?: string }
export function logHref(q: LogQuery): string {
  const p = new URLSearchParams();
  if (q.endpointId) p.set('endpoint', q.endpointId);
  if (q.failedOnly) p.set('failed', '1');
  if (q.window !== '24h') p.set('window', q.window);
  if (q.size !== 25) p.set('size', String(q.size));
  if (q.cursor) p.set('cursor', q.cursor);
  const s = p.toString();
  return s ? `${DELIVERIES_HREF}?${s}` : DELIVERIES_HREF;
}

/** The "Next retry" cell: the time plus the ladder step that set it ("15:22 (30m backoff)"); a dash when nothing is due. */
export function nextRetryCell(d: Pick<WebhookDelivery, 'state' | 'nextRetryAt' | 'nextRetryStep'>): { key: string; at: string | null; step: string | null } {
  if (d.state === 'retrying' && d.nextRetryAt) return { key: 'wh.log.next.backoff', at: d.nextRetryAt, step: d.nextRetryStep };
  if (d.state === 'pending' && d.nextRetryAt) return { key: 'wh.log.next.queued', at: d.nextRetryAt, step: null };
  return { key: `wh.log.next.${d.state}`, at: null, step: null };
}

/** The diagnosis as a sentence key + vars: "N failures, all <code>, all on <endpoint>, since <time>" — or the mixed case. */
export function diagnosisLine(d: WebhookDiagnosis | null): { key: string; vars: Record<string, string>; since: string | null } | null {
  if (!d || d.failures === 0) return null;
  const top = d.codes[0]; const ep = d.endpoints[0];
  if (d.singleCause) return { key: 'wh.log.diagnosis.single', vars: { n: String(d.failures), code: top.code, host: ep.host }, since: d.since };
  return {
    key: 'wh.log.diagnosis.mixed',
    vars: { n: String(d.failures), codes: d.codes.slice(0, 3).map((c) => `${c.code} ×${c.count}`).join(', '), endpoints: String(d.endpoints.length), host: ep.host, hostCount: String(ep.count) },
    since: d.since,
  };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* the client components' strings — translated on the server, handed over as a map (the console's translator is server-only)      */
/* ------------------------------------------------------------------------------------------------------------------------------ */
export const REFUSAL_CODES = [
  'URL_REQUIRED', 'URL_TOO_LONG', 'URL_INVALID', 'URL_NOT_HTTPS', 'URL_HAS_CREDENTIALS', 'URL_BAD_PORT', 'URL_BLOCKED_HOST', 'URL_SINGLE_LABEL_HOST',
  'URL_PRIVATE_ADDRESS', 'URL_UNRESOLVABLE', 'EVENTS_REQUIRED', 'EVENTS_TOO_MANY', 'EVENT_UNKNOWN', 'EMAIL_REQUIRED', 'EMAIL_INVALID',
  'REASON_REQUIRED', 'REASON_TOO_LONG', 'NOT_ACTIVE', 'NOT_PAUSED', 'GUARD_STILL_REFUSES', 'ROTATION_OVERLAP_LIVE', 'ENDPOINT_DELETED',
  'ENDPOINT_NOT_ACTIVE', 'NOTHING_TO_REPLAY', 'STATE_NOT_REPLAYABLE', 'WEBHOOKS_FORBIDDEN', 'WEBHOOK_ENDPOINT_NOT_FOUND', 'WEBHOOK_DELIVERY_NOT_FOUND',
  'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'CONFLICT', 'unknown',
] as const;
export const GUARD_REASONS = ['invalid_url', 'not_https', 'has_credentials', 'bad_port', 'no_host', 'blocked_host', 'single_label_host', 'private_address', 'unresolvable', 'no_address'] as const;

export const FORM_KEYS = [
  'wh.form.step.edit', 'wh.form.step.review', 'wh.form.step.formError', 'wh.form.step.success', 'wh.form.step.failure',
  'wh.form.url', 'wh.form.urlHint', 'wh.form.events', 'wh.form.eventsHint', 'wh.form.payloadVersion', 'wh.form.email', 'wh.form.emailHint',
  'wh.form.reviewButton', 'wh.form.checking', 'wh.form.submit', 'wh.form.submitting', 'wh.form.backToEdit', 'wh.form.backToScreen',
  'wh.form.review.lede', 'wh.form.review.diff', 'wh.form.guard.public', 'wh.form.guard.refused', 'wh.form.guard.notChecked',
  'wh.form.success.title', 'wh.form.success.secretOnce', 'wh.form.success.copy', 'wh.form.success.copied', 'wh.form.success.copyFailed',
  'wh.form.success.hint', 'wh.form.success.verify', 'wh.form.success.replayed', 'wh.form.success.audit', 'wh.form.failure.title',
  'wh.form.failure.untouched', 'wh.form.failure.retry', 'wh.form.failure.onCall', 'wh.form.hide',
  'wh.rotate.confirm.reason', 'wh.rotate.confirm.reasonHint', 'wh.rotate.confirm.proceed', 'wh.rotate.confirm.working', 'wh.rotate.success.title',
  'wh.rotate.success.window',
] as const;
export function formKeysWithRefusals(): string[] {
  return [...FORM_KEYS, ...REFUSAL_CODES.map((c) => `wh.refusal.${c}`), ...GUARD_REASONS.map((r) => `wh.guard.${r}`)];
}
/** `{name}` substitution for the client side (the server translator's own rule). */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`));
}
