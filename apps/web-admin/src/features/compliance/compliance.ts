// apps/web-admin/src/features/compliance/compliance.ts · PURE, framework-free helpers + types for the god-mode
// DPDP/compliance console. No fetch, no React → unit-tested. MIRRORS admin-api compliance-ops: the DSR status
// state machine (dsr.state), the breach incident state machine (breach.state), the export-approval gate
// (export-approval), and the retention-policy validation. PII-MINIMAL: these model only statuses, categories,
// UUIDs and counts — never raw subject data (the endpoints don't return it, and nothing here fabricates it).

// ---- digit-only integer parse (float-free; for month counts + affected counts; unary + on a validated digit string) ----
function toIntInRange(raw: string | undefined, min: number, max: number): number | null {
  const s = (raw ?? '').trim();
  if (!/^[0-9]{1,4}$/.test(s)) return null;
  const n = +s;                       // exact integer for a ≤4-digit string
  return n >= min && n <= max ? n : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | null | undefined): boolean { return UUID_RE.test((v ?? '').trim()); }
export function validText(v: string | null | undefined, min = 3, max = 2000): boolean {
  const s = (v ?? '').trim();
  return s.length >= min && s.length <= max;
}
// admin-api validates these as z.string().datetime() — ISO 8601 UTC with a trailing Z (optional fractional secs).
const ISO_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export function isIsoDateTime(v: string | null | undefined): boolean { return ISO_DT_RE.test((v ?? '').trim()); }

/* ===================== data-subject requests (DPDP rights) ===================== */
// Mirrors admin-api dsr.state.ts: open → in_progress → completed | rejected; PC-56 DPDP-1: an erasure the executor could not run yet
// is `blocked` (it moves on by itself when the blocker clears — an operator may only reject it).
export const DSR_STATUSES = ['open', 'in_progress', 'blocked', 'completed', 'rejected'] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];
export const DSR_REQUEST_TYPES = ['access', 'erasure', 'correction', 'portability'] as const;
export type DsrRequestType = (typeof DSR_REQUEST_TYPES)[number];

export function dsrStatusKey(s: string | null | undefined): DsrStatus {
  return (DSR_STATUSES as readonly string[]).includes(s ?? '') ? (s as DsrStatus) : 'open';
}
export function isDsrTerminal(s: DsrStatus): boolean { return s === 'completed' || s === 'rejected'; }
export function canStartDsr(s: DsrStatus): boolean { return s === 'open'; }
export function canCompleteDsr(s: DsrStatus): boolean { return s === 'in_progress'; }
export function canRejectDsr(s: DsrStatus): boolean { return s === 'open' || s === 'in_progress' || s === 'blocked'; }

export const DSR_ACTIONS = ['start', 'complete', 'reject'] as const;
export type DsrAction = (typeof DSR_ACTIONS)[number];
export type DsrUpdateResult =
  | { ok: true; value: { action: DsrAction; resolution: string; exportMediaId?: string } }
  | { ok: false; error: 'action' | 'resolution' | 'exportMediaId' };

export function buildDsrUpdate(raw: { action?: string; resolution?: string; exportMediaId?: string }): DsrUpdateResult {
  const action = (raw.action ?? '').trim();
  if (!(DSR_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'action' };
  if (!validText(raw.resolution)) return { ok: false, error: 'resolution' };
  const media = (raw.exportMediaId ?? '').trim();
  if (media && !isUuid(media)) return { ok: false, error: 'exportMediaId' };
  return { ok: true, value: { action: action as DsrAction, resolution: (raw.resolution ?? '').trim(), ...(media ? { exportMediaId: media } : {}) } };
}

/* ===================== export approvals ===================== */
export const EXPORT_APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ExportApprovalStatus = (typeof EXPORT_APPROVAL_STATUSES)[number];
export const EXPORT_DECISIONS = ['approve', 'reject'] as const;
export type ExportDecision = (typeof EXPORT_DECISIONS)[number];

export function exportApprovalKey(s: string | null | undefined): ExportApprovalStatus {
  return (EXPORT_APPROVAL_STATUSES as readonly string[]).includes(s ?? '') ? (s as ExportApprovalStatus) : 'pending';
}
/** A data-export job can be decided only while pending (mirrors decideExport → 409 otherwise). */
export function canDecideExport(approvalStatus: string | null | undefined): boolean { return approvalStatus === 'pending'; }

export type ExportDecisionResult =
  | { ok: true; value: { decision: ExportDecision; reason: string } }
  | { ok: false; error: 'decision' | 'reason' };
export function buildExportDecision(raw: { decision?: string; reason?: string }): ExportDecisionResult {
  const d = (raw.decision ?? '').trim();
  if (!(EXPORT_DECISIONS as readonly string[]).includes(d)) return { ok: false, error: 'decision' };
  if (!validText(raw.reason)) return { ok: false, error: 'reason' };
  return { ok: true, value: { decision: d as ExportDecision, reason: (raw.reason ?? '').trim() } };
}

/* ===================== retention policies (config) ===================== */
export const RETENTION_ACTIONS = ['archive', 'anonymise', 'delete', 'keep_forever'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
const TABLE_RE = /^[a-z0-9_]{2,100}$/;

export type RetentionResult =
  | { ok: true; value: { tableName: string; activeMonths: number; archiveMonths: number | null; legalBasis: string | null; action: RetentionAction; isActive: boolean; reason: string } }
  | { ok: false; error: 'tableName' | 'activeMonths' | 'archiveMonths' | 'action' | 'reason' };

export function buildRetention(raw: { tableName?: string; activeMonths?: string; archiveMonths?: string; legalBasis?: string; action?: string; isActive?: string; reason?: string }): RetentionResult {
  const tableName = (raw.tableName ?? '').trim();
  if (!TABLE_RE.test(tableName)) return { ok: false, error: 'tableName' };
  const active = toIntInRange(raw.activeMonths, 0, 1200);
  if (active === null) return { ok: false, error: 'activeMonths' };
  const archiveRaw = (raw.archiveMonths ?? '').trim();
  let archiveMonths: number | null = null;
  if (archiveRaw) { const a = toIntInRange(archiveRaw, 0, 1200); if (a === null) return { ok: false, error: 'archiveMonths' }; archiveMonths = a; }
  const action = (raw.action ?? '').trim();
  if (!(RETENTION_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'action' };
  if (!validText(raw.reason)) return { ok: false, error: 'reason' };
  const legal = (raw.legalBasis ?? '').trim();
  return { ok: true, value: { tableName, activeMonths: active, archiveMonths, legalBasis: legal || null, action: action as RetentionAction, isActive: raw.isActive !== 'false', reason: (raw.reason ?? '').trim() } };
}

/* ===================== breach console (DPDP §8 incident) ===================== */
// Mirrors admin-api breach.state.ts: open → contained|closed; contained → notified|closed; notified → closed.
export const BREACH_STATUSES = ['open', 'contained', 'notified', 'closed'] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];
export const BREACH_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];

export function breachStatusKey(s: string | null | undefined): BreachStatus {
  return (BREACH_STATUSES as readonly string[]).includes(s ?? '') ? (s as BreachStatus) : 'open';
}
export function breachSeverityKey(s: string | null | undefined): BreachSeverity {
  return (BREACH_SEVERITIES as readonly string[]).includes(s ?? '') ? (s as BreachSeverity) : 'high';
}
export function isBreachTerminal(s: BreachStatus): boolean { return s === 'closed'; }
export function canContainBreach(s: BreachStatus): boolean { return s === 'open'; }
export function canNotifyBreach(s: BreachStatus): boolean { return s === 'contained'; }
export function canCloseBreach(s: BreachStatus): boolean { return s === 'open' || s === 'contained' || s === 'notified'; }

export type OpenBreachResult =
  | { ok: true; value: { affectedTenantId?: string; severity: BreachSeverity; title: string; description: string; affectedData: string; affectedCount: number; detectedAt: string } }
  | { ok: false; error: 'affectedTenantId' | 'severity' | 'title' | 'description' | 'affectedData' | 'affectedCount' | 'detectedAt' };

export function buildOpenBreach(raw: { affectedTenantId?: string; severity?: string; title?: string; description?: string; affectedData?: string; affectedCount?: string; detectedAt?: string }): OpenBreachResult {
  const tenant = (raw.affectedTenantId ?? '').trim();
  if (tenant && !isUuid(tenant)) return { ok: false, error: 'affectedTenantId' };
  const severity = (raw.severity ?? 'high').trim();
  if (!(BREACH_SEVERITIES as readonly string[]).includes(severity)) return { ok: false, error: 'severity' };
  if (!validText(raw.title, 3, 200)) return { ok: false, error: 'title' };
  if (!validText(raw.description)) return { ok: false, error: 'description' };
  if (!validText(raw.affectedData, 1, 500)) return { ok: false, error: 'affectedData' };  // categories only — NO raw PII
  const count = toIntInRange(raw.affectedCount && raw.affectedCount.trim() ? raw.affectedCount : '0', 0, 9999);
  if (count === null) return { ok: false, error: 'affectedCount' };
  const detectedAt = (raw.detectedAt ?? '').trim();
  if (!isIsoDateTime(detectedAt)) return { ok: false, error: 'detectedAt' };
  return { ok: true, value: { ...(tenant ? { affectedTenantId: tenant } : {}), severity: severity as BreachSeverity, title: (raw.title ?? '').trim(), description: (raw.description ?? '').trim(), affectedData: (raw.affectedData ?? '').trim(), affectedCount: count, detectedAt } };
}

export const BREACH_ACTIONS = ['contain', 'notify', 'close'] as const;
export type BreachAction = (typeof BREACH_ACTIONS)[number];
export type BreachUpdateResult =
  | { ok: true; value: { action: BreachAction; note: string; regulatorNotifiedAt?: string; principalsNotifiedAt?: string } }
  | { ok: false; error: 'action' | 'note' | 'notifiedAt' };

export function buildBreachUpdate(raw: { action?: string; note?: string; regulatorNotifiedAt?: string; principalsNotifiedAt?: string }): BreachUpdateResult {
  const action = (raw.action ?? '').trim();
  if (!(BREACH_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'action' };
  if (!validText(raw.note)) return { ok: false, error: 'note' };
  const reg = (raw.regulatorNotifiedAt ?? '').trim();
  const prin = (raw.principalsNotifiedAt ?? '').trim();
  if (reg && !isIsoDateTime(reg)) return { ok: false, error: 'notifiedAt' };
  if (prin && !isIsoDateTime(prin)) return { ok: false, error: 'notifiedAt' };
  if (action === 'notify' && (!isIsoDateTime(reg) || !isIsoDateTime(prin))) return { ok: false, error: 'notifiedAt' };   // DPDP §8: both required
  return { ok: true, value: { action: action as BreachAction, note: (raw.note ?? '').trim(), ...(reg ? { regulatorNotifiedAt: reg } : {}), ...(prin ? { principalsNotifiedAt: prin } : {}) } };
}

// ---- read-model shapes (mirror admin-api compliance-ops read models; type-only, no runtime) ----
export interface DsrRow { id: string; userId: string; requestType: DsrRequestType; status: DsrStatus; coolingEndsAt: string | null; resolution: string | null; exportMediaId: string | null; createdAt: string | null }
export interface ExportRow { id: string; tenantId: string | null; userId: string | null; jobKind: string; status: string; approvalStatus: ExportApprovalStatus; expiresAt: string | null; createdAt: string | null }
export interface AuditRow { id: string; tenantId: string | null; actorUserId: string | null; actorRole: string | null; action: string; entityType: string | null; entityId: string | null; reason: string | null; ip: string | null; requestId: string | null; createdAt: string | null }
export interface RetentionRow { tableName: string; activeMonths: number; archiveMonths: number | null; legalBasis: string | null; action: RetentionAction; isActive: boolean }
export interface BreachRow { id: string; affectedTenantId: string | null; status: BreachStatus; severity: BreachSeverity; title: string; affectedCount: number; detectedAt: string | null; containedAt: string | null; regulatorNotifiedAt: string | null; principalsNotifiedAt: string | null; closedAt: string | null; resolutionNote: string | null; createdAt: string | null }
