// apps/web-tenant/src/features/audit/viewer.ts · PURE helpers for the read-only auditor console.
// No framework, no I/O → unit-tested. The SERVER is authoritative (RLS-isolated reads of the append-only
// audit_log); these helpers only pre-validate the filter form, drop empty filters, and present an entry's
// before/after change as a readable, bounded diff. Regexes are anchored fixed char-classes (ReDoS-safe).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;   // a date-input value (YYYY-MM-DD)

export interface AuditFilterForm {
  action?: string; entityType?: string; entityId?: string; actorUserId?: string; from?: string; to?: string;
}

/** Validate the filter form. Returns a field code on the first problem, else null. */
export function validateFilters(f: AuditFilterForm): string | null {
  if (f.action != null && f.action.length > 120) return 'action';
  if (f.entityType != null && f.entityType.length > 60) return 'entityType';
  if (f.entityId != null && f.entityId !== '' && !isUuid(f.entityId)) return 'entityId';
  if (f.actorUserId != null && f.actorUserId !== '' && !isUuid(f.actorUserId)) return 'actorUserId';
  if (f.from != null && f.from !== '' && !ISO_DATE.test(f.from)) return 'from';
  if (f.to != null && f.to !== '' && !ISO_DATE.test(f.to)) return 'to';
  if (f.from && f.to && f.from > f.to) return 'range';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean { return UUID.test(s); }

/** Build the SDK query object from the filter form, dropping empties.
 *  [PC-56 TENANT-9c · F-9] The days are passed AS DAYS — the cooperative's own civil days, both inclusive — and the API
 *  turns them into instants in `countries.timezone`. They were `${from}T00:00:00.000Z` / `${to}T23:59:59.999Z`: UTC days,
 *  so an Anand cooperative's "13 Jul" began at 05:30 its own time. */
export function buildAuditQuery(f: AuditFilterForm): Record<string, string> {
  const q: Record<string, string> = {};
  const put = (k: string, v?: string) => { const s = (v ?? '').trim(); if (s) q[k] = s; };
  put('action', f.action);
  put('entityType', f.entityType);
  put('entityId', f.entityId);
  put('actorUserId', f.actorUserId);
  if (f.from && ISO_DATE.test(f.from)) q.from = f.from;
  if (f.to && ISO_DATE.test(f.to)) q.to = f.to;
  return q;
}

/** A compact, bounded one-line summary of an entry's change (old→new), for the list row. */
export function summarizeChange(oldValue: unknown, newValue: unknown, maxLen = 140): string {
  const o = compact(oldValue), n = compact(newValue);
  if (o && n) return clip(`${o} → ${n}`, maxLen);
  if (n) return clip(n, maxLen);
  if (o) return clip(o, maxLen);
  return '—';
}

/** Render a JSON value as stable, sorted-key, readable text (objects → k=v; primitives → string). */
export function compact(v: unknown): string {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return v.map(compact).filter(Boolean).join(', ');
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return keys.map((k) => `${k}=${compact((v as Record<string, unknown>)[k])}`).join(', ');
}

/** The changed keys between two object snapshots (for a focused detail view). */
export function changedKeys(oldValue: unknown, newValue: unknown): string[] {
  const o = (oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue)) ? oldValue as Record<string, unknown> : {};
  const n = (newValue && typeof newValue === 'object' && !Array.isArray(newValue)) ? newValue as Record<string, unknown> : {};
  const keys = new Set([...Object.keys(o), ...Object.keys(n)]);
  return [...keys].filter((k) => compact(o[k]) !== compact(n[k])).sort();
}

function clip(s: string, max: number): string { return s.length > max ? `${s.slice(0, max - 1)}…` : s; }
