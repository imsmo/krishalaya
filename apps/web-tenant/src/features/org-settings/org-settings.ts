// apps/web-tenant/src/features/org-settings/org-settings.ts · PURE helpers for W186 Organisation settings and its chains (W2754–W2760)
// — PC-56 TENANT-13b.
//
// Founder decision: TENANT MAKER-CHECKER WITH PLATFORM FLOORS, EFFECTIVE NEXT MIDNIGHT IST WITH MEMBER NOTICE. What the screens print
// comes from the API AS BUILT: the Effect column only where a consumer reads the key (`effect` is null otherwise and the row sits in the
// "defined, not yet wired" list), the floor the platform set, the route the API will take (direct / proposal / none). Values travel in
// the URL (the chain pattern of record): a setting VALUE is not a secret, and the review / failure steps must be re-openable.
import type { OrgSettingRow, SettingRoute } from '@krishalaya/sdk-js';

export const ORG_HREF = '/settings/org';
export const EDIT_HREF = `${ORG_HREF}/edit`;
export const HISTORY_HREF = `${ORG_HREF}/history`;
export function proposalHref(id: string, act: 'confirm' | 'refuse', step: 'confirm' | 'success' | 'failure' = 'confirm'): string {
  return `${ORG_HREF}/proposals/${encodeURIComponent(id)}?act=${act}&step=${step}`;
}
export function editHref(key: string): string { return `${EDIT_HREF}?key=${encodeURIComponent(key)}&step=edit`; }
export function historyHref(key?: string): string { return key ? `${HISTORY_HREF}?key=${encodeURIComponent(key)}` : HISTORY_HREF; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }
export function isSettingKey(v: unknown): v is string { return typeof v === 'string' && /^[a-z0-9_.]{1,80}$/.test(v); }

export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
/** A read's failure as one of the canon's states: 404 on the registry is the `tenancy` flag; 403 is tenant.settings. */
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'TENANT_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}

/** Every refusal code the API can name on these screens (each is a sentence `os.refusal.<CODE>` in en / hi / gu). */
export const REFUSAL_CODES = [
  'PROPOSAL_REQUIRED', 'SETTING_OUTSIDE_FLOOR', 'SETTING_NOT_WIRED', 'SETTING_DEPRECATED', 'SETTING_NOT_GATED', 'SETTING_UNCHANGED',
  'SETTING_REASON_INVALID', 'NEEDS_SECOND_ADMIN', 'SETTING_PROPOSAL_LIVE', 'SETTING_PROPOSAL_NOT_FOUND', 'CHECKER_IS_MAKER',
  'SETTING_PROPOSAL_EXPIRED', 'SETTING_PROPOSAL_CLOSED', 'SETTING_NOT_TENANT_SCOPED', 'TENANT_SETTING_INVALID', 'SETTING_FLOOR_LOCKED',
  'LANGUAGES_INVALID', 'LANGUAGE_IN_USE', 'TENANT_FORBIDDEN', 'NOT_FOUND', 'VALUE_UNPARSEABLE', 'IDEMPOTENCY_CONFLICT', 'CONFLICT', 'unknown',
] as const;
export function refusalKey(code: string): string { return (REFUSAL_CODES as readonly string[]).includes(code) ? `os.refusal.${code}` : 'os.refusal.unknown'; }
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return refusals.map((r) => (typeof r.code === 'string' && /^[A-Z_]{2,40}$/.test(r.code) ? r.code : 'unknown')).slice(0, 8);
  if (status === 403) return ['TENANT_FORBIDDEN'];
  if (code && /^[A-Za-z_]{2,40}$/.test(code)) return [code];
  if (status === 404) return ['NOT_FOUND'];
  return ['unknown'];
}
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }

/** The typed value an edit form submitted, from its text. A blank or malformed value is refused before the API is asked. */
export function parseValue(type: OrgSettingRow['type'], raw: string | null | undefined): { ok: true; value: unknown } | { ok: false } {
  const s = (raw ?? '').trim();
  switch (type) {
    case 'bool': return s === 'true' ? { ok: true, value: true } : s === 'false' ? { ok: true, value: false } : { ok: false };
    case 'int': return /^-?\d{1,16}$/.test(s) ? { ok: true, value: Number(s) } : { ok: false };
    case 'decimal': return s !== '' && Number.isFinite(Number(s)) ? { ok: true, value: Number(s) } : { ok: false };
    case 'string': return s.length <= 4000 ? { ok: true, value: s } : { ok: false };
    case 'json': try { const v = JSON.parse(s); return v !== null && typeof v === 'object' ? { ok: true, value: v } : { ok: false }; } catch { return { ok: false }; }
    default: return { ok: false };
  }
}
/** A value as the table prints it (and as the edit field holds it). */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '""' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}
export function editableText(v: unknown): string { return v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v); }

/** The risk badge a row carries. */
export function riskKey(r: Pick<OrgSettingRow, 'riskClass' | 'memberNotice'>): string {
  if (r.riskClass === 'money_path') return 'os.risk.money_path';
  if (r.riskClass === 'security') return 'os.risk.security';
  return r.memberNotice ? 'os.risk.trust' : 'os.risk.ordinary';
}
export function routeKey(route: SettingRoute, locked: boolean): string {
  if (route === 'none') return locked ? 'os.route.locked' : 'os.route.none';
  return `os.route.${route}`;
}
/** The highlighted, editable rows (the table) vs the defined-but-unwired ones (the collapsed list). Deprecated rows sit with the unwired. */
export function splitRows(items: OrgSettingRow[]): { table: OrgSettingRow[]; unwired: OrgSettingRow[] } {
  return { table: items.filter((i) => i.wired), unwired: items.filter((i) => !i.wired) };
}
/** The edit control for a type. */
export function inputKind(type: OrgSettingRow['type']): 'bool' | 'number' | 'text' | 'json' {
  return type === 'bool' ? 'bool' : type === 'int' || type === 'decimal' ? 'number' : type === 'json' ? 'json' : 'text';
}
