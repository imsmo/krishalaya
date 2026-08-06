// apps/web-admin/src/features/tenants/tenant.ts · PURE, framework-free helpers + types for the god-mode tenants
// console. No fetch, no React → unit-tested. The state machine MIRRORS admin-api's tenant.state.ts (Law 5 — the
// server is authoritative; this only decides which lifecycle actions to SHOW, and a raced/illegal move degrades
// to a 409 message). The limit-override validator mirrors the admin-api zod DTO (integer-string, -1 = unlimited)
// and is FLOAT-FREE (digit-string only). Money/usage are rendered by the caller via formatMoneyMinor.

export const TENANT_STATUSES = ['pending', 'trial', 'active', 'grace', 'suspended', 'archived', 'terminated'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

// Mirrors admin-api tenant.state TRANSITIONS exactly.
const TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  pending: ['trial', 'active', 'archived', 'terminated'],
  trial: ['active', 'grace', 'suspended', 'archived', 'terminated'],
  active: ['grace', 'suspended', 'archived', 'terminated'],
  grace: ['active', 'suspended', 'archived', 'terminated'],
  suspended: ['active', 'archived', 'terminated'],
  archived: ['terminated'],
  terminated: [],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function isLive(s: TenantStatus): boolean { return s === 'trial' || s === 'active' || s === 'grace'; }
export function isTerminal(s: TenantStatus): boolean { return s === 'terminated'; }

/** Approve is valid only for a pending/trial tenant (mirrors Tenant.approve in admin-api). */
export function canApprove(s: TenantStatus): boolean { return s === 'pending' || s === 'trial'; }
/** Suspend is valid from the live states. */
export function canSuspend(s: TenantStatus): boolean { return canTransition(s, 'suspended'); }
/** Archive is valid from any non-terminal, non-archived state. */
export function canArchive(s: TenantStatus): boolean { return canTransition(s, 'archived'); }

/** i18n sub-key for a status badge, guarding an unexpected server value. */
export function statusKey(s: string | null | undefined): TenantStatus {
  return (TENANT_STATUSES as readonly string[]).includes(s ?? '') ? (s as TenantStatus) : 'pending';
}

// ---- read-model shapes (mirror admin-api tenant-ops read models; type-only, no runtime) ----
export interface TenantListItem { id: string; slug: string; status: TenantStatus; riskScore: number; approvedAt: string | null; createdAt: string | null; }
export interface TenantScorecard {
  tenant: TenantListItem;
  subscription: { planId: string; status: string; priceMinor: string; currency: string; periodEnd: string } | null;
  liveListings: number;
  openDisputes: number;
  limitOverrides: { limitCode: string; limitValue: string; expiresAt: string | null }[];
}

// ---- limit-override form (mirrors admin-api OverrideLimitSchema; float-free) ----
const LIMIT_CODE_RE = /^[a-z0-9_]{2,60}$/;
const LIMIT_VALUE_RE = /^-1$|^\d{1,18}$/; // integer string; -1 = unlimited; no floats
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export type LimitOverrideResult =
  | { ok: true; value: { limitCode: string; limitValue: string; reason: string; expiresAt?: string } }
  | { ok: false; error: 'limitCode' | 'limitValue' | 'reason' | 'expiresAt' };

/** Validate + assemble the PATCH /tenants/:id/limits body. limitValue stays a STRING (never floated); a blank
 *  expiry is omitted (null/unlimited handled server-side). Reason is mandatory (audit, §4). */
export function buildLimitOverride(raw: { limitCode?: string; limitValue?: string; reason?: string; expiresAt?: string }): LimitOverrideResult {
  const limitCode = (raw.limitCode ?? '').trim();
  if (!LIMIT_CODE_RE.test(limitCode)) return { ok: false, error: 'limitCode' };

  const limitValue = (raw.limitValue ?? '').trim();
  if (!LIMIT_VALUE_RE.test(limitValue)) return { ok: false, error: 'limitValue' };

  const reason = (raw.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 500) return { ok: false, error: 'reason' };

  const expiresRaw = (raw.expiresAt ?? '').trim();
  let expiresAt: string | undefined;
  if (expiresRaw) {
    if (!ISO_DATETIME_RE.test(expiresRaw) || Number.isNaN(Date.parse(expiresRaw))) return { ok: false, error: 'expiresAt' };
    expiresAt = new Date(expiresRaw).toISOString();
  }
  return { ok: true, value: { limitCode, limitValue, reason, ...(expiresAt ? { expiresAt } : {}) } };
}

/** Validate the mandatory audit reason for a lifecycle mutation (approve/suspend/archive). */
export function validReason(reason: string | null | undefined): boolean {
  const r = (reason ?? '').trim();
  return r.length >= 3 && r.length <= 500;
}

// ---------------------------------------------------------------------------
// Directory filters (PC-56 ADMIN-1, canon W002)
// ---------------------------------------------------------------------------
// The list endpoint has always accepted `q` and `riskMin`; the page plumbed `q` through to the API but never
// rendered an input for it, so the capability existed and was unreachable. These helpers make both filters real and
// — more importantly — make them SURVIVE PAGINATION: the previous pager rebuilt the URL with only `status`, so
// page 2 of a search silently became page 2 of everything. On a 1,680-tenant directory that is not a cosmetic bug;
// it is an operator concluding a tenant does not exist.

/** admin-api caps risk at 0..100 (QueryTenantsSchema). A non-integer or out-of-range value is DROPPED rather than
 *  clamped: clamping 900 to 100 would silently answer a different question than the one that was asked. */
export function parseRiskMin(raw: string | null | undefined): number | undefined {
  const s = String(raw ?? '').trim();
  if (!/^\d{1,3}$/.test(s)) return undefined;
  const n = Number.parseInt(s, 10);
  return n >= 0 && n <= 100 ? n : undefined;
}

/** The risk threshold the "high-risk" saved view uses. A tenant at or above this is worth a human look — it is a
 *  triage line, not a verdict, and the number lives here so the view and its label cannot disagree. */
export const HIGH_RISK_MIN = 70;

/** Trim and bound a free-text query. Empty becomes undefined so the URL stays clean and the API is not sent `q=`. */
export function parseQuery(raw: string | null | undefined): string | undefined {
  const s = String(raw ?? '').trim();
  return s ? s.slice(0, 120) : undefined;
}

export interface DirectoryFilters { status?: string; q?: string; riskMin?: number; cursor?: string }

/** Build a directory URL carrying EVERY active filter. One function, used by the chips, the saved views and the
 *  pager, so a link can no longer forget a filter that another link remembers. */
export function directoryHref(f: DirectoryFilters): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  if (f.riskMin !== undefined) p.set('riskMin', String(f.riskMin));
  if (f.cursor) p.set('cursor', f.cursor);
  const s = p.toString();
  return s ? `/tenants?${s}` : '/tenants';
}

/** True when any filter is active — the page then offers "clear filters", which is only honest if there is
 *  something to clear. */
export function hasActiveFilters(f: DirectoryFilters): boolean {
  return !!f.status || !!f.q || f.riskMin !== undefined;
}
