// apps/web-tenant/src/features/desks/desks.ts · PURE helpers for W185 Desks and its chains (W2574–W2580) — PC-56 TENANT-13b.
//
// Founder decision: TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE. A desk's PERMISSIONS (and its existence and
// status) change only by a proposal a second tenant_admin confirms; its MEMBERS are a direct, audited act. The cards print each canon
// label as the API mapped it — a real code, or refused by name — never a code the platform does not have.
import type { DeskProposalKind, DeskTemplateLabel } from '@krishalaya/sdk-js';

export const DESKS_HREF = '/settings/team/desks';
export const NEW_DESK_HREF = `${DESKS_HREF}/new`;
export const DESK_ACT_HREF = `${DESKS_HREF}/act`;
export function editDeskHref(deskId: string): string { return `${NEW_DESK_HREF}?deskId=${encodeURIComponent(deskId)}&step=edit`; }
export function deskActHref(kind: 'install_templates' | 'disable' | 'enable', deskId?: string): string {
  return `${DESK_ACT_HREF}?kind=${kind}${deskId ? `&deskId=${encodeURIComponent(deskId)}` : ''}&step=confirm`;
}
export function deskProposalHref(id: string, act: 'confirm' | 'refuse', step: 'confirm' | 'success' | 'failure' = 'confirm'): string {
  return `${DESKS_HREF}/proposals/${encodeURIComponent(id)}?act=${act}&step=${step}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID.test(v); }
export function isIdemKey(v: unknown): v is string { return typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v); }
export function isDeskCode(v: unknown): v is string { return typeof v === 'string' && /^[a-z][a-z0-9_]{1,39}$/.test(v); }
export function isPermCode(v: unknown): v is string { return typeof v === 'string' && /^[a-z][a-z0-9_.]{1,79}$/.test(v); }
export const ACT_KINDS = ['install_templates', 'disable', 'enable'] as const;
export function isActKind(v: unknown): v is (typeof ACT_KINDS)[number] { return typeof v === 'string' && (ACT_KINDS as readonly string[]).includes(v); }

export type PageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
export function pageState(code: string | undefined, status?: number, forId = false): PageState {
  if (code === 'DESK_FORBIDDEN' || code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return forId ? 'notFound' : 'flaggedOff';
  return 'error';
}

/** Every code the desk API can name (`dk.refusal.<CODE>`, en / hi / gu). */
export const DESK_REFUSAL_CODES = [
  'NEEDS_SECOND_ADMIN', 'CHECKER_IS_MAKER', 'DESK_INVALID', 'DESK_FORBIDDEN', 'DESK_NOT_FOUND', 'DESK_PROPOSAL_NOT_FOUND', 'DESK_PROPOSAL_LIVE',
  'DESK_PROPOSAL_EXPIRED', 'DESK_PROPOSAL_CLOSED', 'DESK_PROPOSAL_STALE', 'DESK_REASON_INVALID', 'DESK_CODE_INVALID', 'DESK_CODE_TAKEN',
  'DESK_NAME_INVALID', 'DESK_DESCRIPTION_TOO_LONG', 'DESK_TEMPLATE_UNKNOWN', 'DESK_NO_CODES', 'DESK_TOO_MANY_CODES', 'DESK_CODE_UNGRANTABLE',
  'DESK_CODE_NOT_HELD', 'DESK_CODE_UNKNOWN', 'DESK_TOO_MANY_MEMBERS', 'DESK_MEMBER_NOT_IN_TENANT', 'DESK_UNCHANGED', 'DESK_ALREADY_DISABLED',
  'DESK_ALREADY_ACTIVE', 'DESK_TEMPLATES_INSTALLED', 'DESK_MEMBER_ALREADY', 'DESK_MEMBER_NOT_ON_DESK', 'DESK_DISABLED', 'DESK_MEMBER_REASON',
  'IDEMPOTENCY_CONFLICT', 'CONFLICT', 'NOT_FOUND', 'unknown',
] as const;
export function deskRefusalKey(code: string): string { return (DESK_REFUSAL_CODES as readonly string[]).includes(code) ? `dk.refusal.${code}` : 'dk.refusal.unknown'; }
export function failureCodesFrom(code: string | undefined, status?: number, details?: unknown): string[] {
  const refusals = (details as { refusals?: Array<{ code?: unknown }> } | null)?.refusals;
  if (Array.isArray(refusals) && refusals.length) return [...new Set(refusals.map((r) => (typeof r.code === 'string' && /^[A-Z_]{2,40}$/.test(r.code) ? r.code : 'unknown')))].slice(0, 8);
  if (status === 403) return ['DESK_FORBIDDEN'];
  if (code && /^[A-Za-z_]{2,40}$/.test(code)) return [code];
  return ['unknown'];
}
export function parseCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)).slice(0, 8); }
/** Permission codes from a comma list (the form carries them in the URL). */
export function parsePermList(raw: string | string[] | undefined): string[] {
  const all = (Array.isArray(raw) ? raw : (raw ?? '').split(',')).map((x) => String(x).trim()).filter(isPermCode);
  return [...new Set(all)].slice(0, 40);
}
export function parseIdList(raw: string | string[] | undefined): string[] {
  const all = (Array.isArray(raw) ? raw : (raw ?? '').split(',')).map((x) => String(x).trim()).filter(isUuid);
  return [...new Set(all)].slice(0, 200);
}

/** The sentence a template label prints: the real code it rides, or why it is refused. */
export function labelLine(l: DeskTemplateLabel): { key: string; vars: Record<string, string> } {
  if (l.kind === 'refused') return l.reasonKey === 'rides_other' ? { key: 'dk.label.rides', vars: { label: l.label, on: l.ridesOn ?? '' } } : { key: 'dk.label.noRoute', vars: { label: l.label } };
  if (l.grant === 'not_held') return { key: 'dk.label.notHeld', vars: { label: l.label, code: l.code } };
  if (l.grant === 'ungrantable') return { key: 'dk.label.ungrantable', vars: { label: l.label, code: l.code } };
  return l.label === l.code ? { key: 'dk.label.same', vars: { code: l.code } } : { key: 'dk.label.mapped', vars: { label: l.label, code: l.code } };
}
export function kindKey(kind: DeskProposalKind): string { return `dk.kind.${kind}`; }
