// apps/web-tenant/src/features/integrations/integrations.ts · PURE helpers for the integrations console — PC-56 TENANT-13c (W187,
// W2643–W2649).
//
// THE TRUTH THIS CONSOLE PRINTS: a connection is `verified` / `verify_failed` / `disconnected` / `unverified` — never "active" — and its
// `consumers` list (the platform paths that read it) is EMPTY today: payments run on the platform's Razorpay account and SMS on the
// platform's route. "Direct settlement to your own account" is refused by name (Law 9, its own wave). Health (24 h) is the count of
// real verification checks and the last good instant. THE CREDENTIAL NEVER TRAVELS IN A URL: the connect chain is a client component
// holding the typed credential in memory only; the pages are no-store / no-referrer.
import type { IntegrationConnectionStatus, IntegrationHealth, IntegrationProvider, TenantIntegration } from '@krishalaya/sdk-js';

export const INTEGRATIONS_HREF = '/settings/integrations';
export const CONNECT_HREF = `${INTEGRATIONS_HREF}/connect`;
export function connectHref(provider?: string, kind: 'connect' | 'rotate' = 'connect'): string {
  const p = new URLSearchParams();
  if (provider) p.set('provider', provider);
  if (kind !== 'connect') p.set('kind', kind);
  const s = p.toString();
  return s ? `${CONNECT_HREF}?${s}` : CONNECT_HREF;
}
export function disconnectHref(provider: string): string { return `${INTEGRATIONS_HREF}/disconnect?provider=${encodeURIComponent(provider)}&step=confirm`; }
export function proposalHref(id: string): string { return `${INTEGRATIONS_HREF}/proposals/${encodeURIComponent(id)}`; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }
export function isProviderCode(v: unknown): v is string { return typeof v === 'string' && /^[a-z][a-z0-9_]{1,59}$/.test(v); }

export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'INTEGRATIONS_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}

export function statusKey(s: IntegrationConnectionStatus): string { return `int.status.${s}`; }
/** The Status cell for a provider row: a connection's status, or `platform-managed` / `available`. */
export function providerStatusKey(p: Pick<IntegrationProvider, 'managed'>, c: Pick<TenantIntegration, 'status'> | null): string {
  if (p.managed) return 'int.status.platform_managed';
  return c ? statusKey(c.status) : 'int.status.available';
}
/** Health (24 h) as a sentence: "N checks · last OK <time>" — never a percentage of calls. */
export function healthLine(h: IntegrationHealth | null): { key: string; vars: Record<string, string>; at: string | null } {
  if (!h || h.checks24h === 0) return { key: 'int.health.none', vars: {}, at: null };
  if (h.lastOkAt) return { key: h.failed24h > 0 ? 'int.health.mixed' : 'int.health.ok', vars: { n: String(h.checks24h), failed: String(h.failed24h) }, at: h.lastOkAt };
  return { key: 'int.health.failing', vars: { n: String(h.checks24h) }, at: null };
}
/** The consumers line: empty today for every provider — said in words, never as an "active" badge. */
export function consumersKey(consumers: readonly string[]): string { return consumers.length === 0 ? 'int.consumers.none' : 'int.consumers.some'; }
/** Which acts a connection row offers. */
export function rowActs(c: Pick<TenantIntegration, 'status'> | null, p: Pick<IntegrationProvider, 'ownable' | 'verifiable'>): ('connect' | 'rotate' | 'disconnect')[] {
  if (!p.ownable) return [];
  if (!c || c.status === 'disconnected') return p.verifiable ? ['connect'] : [];
  return [...(p.verifiable ? ['rotate' as const] : []), 'disconnect'];
}

export const REFUSAL_CODES = [
  'INTEGRATION_PROVIDER_NOT_FOUND', 'INTEGRATION_PROVIDER_NOT_OWNABLE', 'INTEGRATION_VERIFY_FAILED', 'INTEGRATION_CHANGE_IN_FLIGHT',
  'INTEGRATION_PROPOSAL_NOT_FOUND', 'INTEGRATION_PROPOSAL_REQUIRED', 'INTEGRATIONS_FORBIDDEN', 'NEEDS_SECOND_ADMIN', 'ALREADY_CONNECTED', 'NOT_CONNECTED',
  'verify_not_configured', 'field_required', 'field_invalid', 'field_unknown', 'provider_has_no_credential_fields', 'credential_not_allowed',
  'kind_invalid', 'reason_length', 'CHECKER_IS_MAKER', 'CHECKER_NOT_ADMIN', 'PROPOSER_NOT_ADMIN', 'PROPOSAL_EXPIRED', 'PROPOSAL_CLOSED',
  'PROPOSAL_NOT_YOURS', 'NOT_FOUND', 'CONFLICT', 'unknown',
] as const;
export const VERIFY_CLASSES = ['auth', 'network', 'unknown'] as const;
export function refusalKey(code: string): string { return (REFUSAL_CODES as readonly string[]).includes(code) ? `int.refusal.${code}` : 'int.refusal.unknown'; }
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Za-z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (code && /^[A-Za-z_]{2,40}$/.test(code) && code !== 'FORBIDDEN') return [code];
  if (status === 403) return ['INTEGRATIONS_FORBIDDEN'];
  if (status === 404) return ['NOT_FOUND'];
  return ['unknown'];
}
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }

export const FORM_KEYS = [
  'int.form.step.edit', 'int.form.step.review', 'int.form.step.formError', 'int.form.step.success', 'int.form.step.failure',
  'int.form.provider', 'int.form.providerPlaceholder', 'int.form.kind.connect', 'int.form.kind.rotate', 'int.form.credential', 'int.form.credentialHint',
  'int.form.reason', 'int.form.reasonHint', 'int.form.reviewButton', 'int.form.checking', 'int.form.submit', 'int.form.submitting',
  'int.form.backToEdit', 'int.form.backToScreen', 'int.form.review.lede', 'int.form.review.shadow', 'int.form.review.checker',
  'int.form.success.title', 'int.form.success.body', 'int.form.success.shadowOk', 'int.form.success.proposal', 'int.form.failure.title',
  'int.form.failure.untouched', 'int.form.failure.retry', 'int.form.failure.verify', 'int.form.failure.onCall', 'int.form.secretField', 'int.form.openField',
] as const;
export function formKeysWithRefusals(): string[] {
  return [...FORM_KEYS, ...REFUSAL_CODES.map((c) => `int.refusal.${c}`), ...VERIFY_CLASSES.map((c) => `int.verify.${c}`)];
}
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`));
}
