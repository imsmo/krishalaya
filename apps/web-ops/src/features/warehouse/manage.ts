// apps/web-ops/src/features/warehouse/manage.ts · PURE warehouse-wave logic (PC-32 OW-2). Mirrors the
// storage-booking state machine (requested → confirmed → stored → released; cancel from requested|confirmed)
// and the assay record DTO. No IO → unit-tested. PC-56 OPS-2b (founder Q3-A): `canIssueNwr`, `buildNwr` and `NWR_REPOSITORIES` are REMOVED —
// this platform does not issue an eNWR and the console offers no issue form.

export const BOOKING_STATUSES = ['requested', 'confirmed', 'stored', 'released', 'cancelled'] as const;

export function isBookingStatus(v: string | undefined | null): boolean {
  return !!v && (BOOKING_STATUSES as readonly string[]).includes(v);
}
export function canConfirm(status: string | undefined | null): boolean { return status === 'requested'; }
export function canStore(status: string | undefined | null): boolean { return status === 'confirmed'; }
export function canRelease(status: string | undefined | null): boolean { return status === 'stored'; }
export function canCancel(status: string | undefined | null): boolean { return status === 'requested' || status === 'confirmed'; }
/** Assay parameters arrive as a plain-text "name = value" list (one per line — works in any textarea).
 *  Values parse to number/boolean when they look like one; anything else stays a string. ≤30 params. */
export type AssayResult =
  | { ok: true; value: { assayerName: string; parameters: Record<string, string | number | boolean>; validUntil?: string } }
  | { ok: false; error: 'assayer' | 'params' | 'validuntil' };

export function buildAssay(raw: { assayerName: string; paramsText: string; validUntil: string }): AssayResult {
  const assayerName = raw.assayerName.trim();
  if (!assayerName || assayerName.length > 200) return { ok: false, error: 'assayer' };
  const parameters: Record<string, string | number | boolean> = {};
  const lines = raw.paramsText.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 30) return { ok: false, error: 'params' };
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq < 1) return { ok: false, error: 'params' };
    const key = line.slice(0, eq).trim();
    const rawVal = line.slice(eq + 1).trim();
    if (!key || !rawVal) return { ok: false, error: 'params' };
    if (rawVal === 'true' || rawVal === 'false') parameters[key] = rawVal === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(rawVal)) parameters[key] = Number(rawVal);
    else parameters[key] = rawVal;
  }
  const validUntil = raw.validUntil.trim();
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { ok: false, error: 'validuntil' };
  const out: { assayerName: string; parameters: Record<string, string | number | boolean>; validUntil?: string } = { assayerName, parameters };
  if (validUntil) out.validUntil = validUntil;
  return { ok: true, value: out };
}
