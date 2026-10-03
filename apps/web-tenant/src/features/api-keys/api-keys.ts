// apps/web-tenant/src/features/api-keys/api-keys.ts · PURE helpers for the API key console — PC-56 TENANT-13c (W190, W2488–W2494).
//
// THE KEY NEVER TRAVELS IN A URL. Issuing is a client component (CreateKeyChain) that calls a server action and holds the key in React
// state only — shown once, copyable, gone on navigation or "Hide" (the 13a RevealField pattern of record). The developer pages are
// served `Cache-Control: no-store` + `Referrer-Policy: no-referrer` (next.config.js + the middleware). The revoke and proposal chains
// carry only an id and outcome codes in their URLs.
import type { ApiKeyStatus, ApiKeyView, ApiScopeEntry } from '@krishalaya/sdk-js';

export const DEVELOPERS_HREF = '/settings/developers';
export const NEW_KEY_HREF = `${DEVELOPERS_HREF}/keys/new`;
export function revokeBase(id: string): string { return `${DEVELOPERS_HREF}/keys/${encodeURIComponent(id)}/revoke`; }
export function revokeHref(id: string): string { return `${revokeBase(id)}?step=confirm`; }
export function keyProposalHref(id: string): string { return `${DEVELOPERS_HREF}/keys/proposals/${encodeURIComponent(id)}`; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }

export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
/** 404 on the list is the `tenant_api` flag; 403 is api.manage. */
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'API_KEYS_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}

export const STATUS_KEYS: Record<ApiKeyStatus, string> = {
  active: 'ak.status.active', waiting_checker: 'ak.status.waiting_checker', revoked: 'ak.status.revoked', expired: 'ak.status.expired',
};
export function statusKey(s: ApiKeyStatus): string { return STATUS_KEYS[s] ?? 'ak.status.active'; }
/** "kv_live_a1b2c3d4…" — the prefix is all the console ever shows of a key. */
export function prefixMask(prefix: string): string { return `${prefix}…`; }
/** The row's scope chips: code + whether it reads or writes + whether it needed a checker. */
export function scopeChips(k: Pick<ApiKeyView, 'scopes'>, catalogue: ApiScopeEntry[]): { code: string; write: boolean; checker: boolean }[] {
  return k.scopes.map((code) => { const c = catalogue.find((x) => x.code === code); return { code, write: c?.kind === 'write', checker: Boolean(c?.checker) }; });
}

export const REFUSAL_CODES = [
  'name_length', 'scopes_empty', 'scope_unknown', 'scopes_too_many', 'rate_range', 'expiry_invalid', 'expiry_too_soon', 'expiry_too_far',
  'reason_checker', 'reason_long', 'reason_required', 'reason_refuse', 'PLAN_FEATURE_REQUIRED', 'API_KEYS_FORBIDDEN', 'API_KEY_NOT_FOUND',
  'API_KEY_PROPOSAL_NOT_FOUND', 'CHECKER_IS_MAKER', 'CHECKER_NOT_ADMIN', 'PROPOSAL_EXPIRED', 'PROPOSAL_CLOSED', 'PROPOSAL_NOT_YOURS',
  'CREATOR_NOT_ADMIN', 'NEEDS_CHECKER', 'KEY_ALREADY_REVOKED', 'SCOPE_UNKNOWN', 'NOT_FOUND', 'CONFLICT', 'unknown',
] as const;
export function refusalKey(code: string): string { return (REFUSAL_CODES as readonly string[]).includes(code) ? `ak.refusal.${code}` : 'ak.refusal.unknown'; }
/** Every refusal code a write answered with (API_KEY_REFUSED carries the list), sanitised for the URL. */
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Za-z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (code && /^[A-Za-z_]{2,40}$/.test(code) && code !== 'FORBIDDEN') return [code];
  if (status === 403) return ['API_KEYS_FORBIDDEN'];
  if (status === 404) return ['NOT_FOUND'];
  return ['unknown'];
}
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }

/** The client chain's strings — translated on the server and handed over (the translator is server-only). */
export const FORM_KEYS = [
  'ak.form.step.edit', 'ak.form.step.review', 'ak.form.step.formError', 'ak.form.step.success', 'ak.form.step.failure',
  'ak.form.name', 'ak.form.namePlaceholder', 'ak.form.scopes', 'ak.form.scopesHint', 'ak.form.read', 'ak.form.write', 'ak.form.needsChecker',
  'ak.form.rate', 'ak.form.rateHint', 'ak.form.expires', 'ak.form.expiresHint', 'ak.form.reason', 'ak.form.reasonHint',
  'ak.form.reviewButton', 'ak.form.checking', 'ak.form.submit', 'ak.form.submitting', 'ak.form.backToEdit', 'ak.form.backToScreen',
  'ak.form.review.lede', 'ak.form.review.routes', 'ak.form.review.checker', 'ak.form.review.noChecker', 'ak.form.review.storage',
  'ak.form.success.title', 'ak.form.success.keyOnce', 'ak.form.success.copy', 'ak.form.success.copied', 'ak.form.success.copyFailed',
  'ak.form.success.prefix', 'ak.form.success.replayed', 'ak.form.success.audit', 'ak.form.success.proposal', 'ak.form.success.proposalBody',
  'ak.form.failure.title', 'ak.form.failure.untouched', 'ak.form.failure.retry', 'ak.form.failure.onCall', 'ak.form.hide', 'ak.form.never',
] as const;
export function formKeysWithRefusals(): string[] { return [...FORM_KEYS, ...REFUSAL_CODES.map((c) => `ak.refusal.${c}`)]; }
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, n) => (n in vars ? String(vars[n]) : `{${n}}`));
}
