// apps/web-ops/src/features/warehouse/manage.ts · PURE warehouse-wave logic (PC-32 OW-2). Mirrors the
// storage-booking state machine (requested → confirmed → stored → released; cancel from requested|confirmed)
// and the eNWR issue DTO. Money float-free. No IO → unit-tested.
import { parseMajorToMinor } from '../money';

export const BOOKING_STATUSES = ['requested', 'confirmed', 'stored', 'released', 'cancelled'] as const;
export const NWR_REPOSITORIES = ['NERL', 'CCRL'] as const;

export function isBookingStatus(v: string | undefined | null): boolean {
  return !!v && (BOOKING_STATUSES as readonly string[]).includes(v);
}
export function canConfirm(status: string | undefined | null): boolean { return status === 'requested'; }
export function canStore(status: string | undefined | null): boolean { return status === 'confirmed'; }
export function canRelease(status: string | undefined | null): boolean { return status === 'stored'; }
export function canCancel(status: string | undefined | null): boolean { return status === 'requested' || status === 'confirmed'; }
/** eNWR can only be issued against goods that are physically IN the warehouse. */
export function canIssueNwr(status: string | undefined | null): boolean { return status === 'stored'; }

export type NwrResult =
  | { ok: true; value: { storageBookingId: string; repository: string; enwrNo: string; valuationMinor: string; expiresAt?: string } }
  | { ok: false; error: 'booking' | 'repo' | 'enwrno' | 'valuation' | 'expires' };

export function buildNwr(raw: { storageBookingId: string; repository: string; enwrNo: string; valuationMajor: string; expiresAt: string }): NwrResult {
  const storageBookingId = raw.storageBookingId.trim();
  if (!storageBookingId) return { ok: false, error: 'booking' };
  if (!(NWR_REPOSITORIES as readonly string[]).includes(raw.repository)) return { ok: false, error: 'repo' };
  const enwrNo = raw.enwrNo.trim();
  if (enwrNo.length < 3 || enwrNo.length > 60) return { ok: false, error: 'enwrno' };
  const valuationMinor = parseMajorToMinor(raw.valuationMajor);
  if (valuationMinor === undefined || valuationMinor === '0') return { ok: false, error: 'valuation' };
  const expiresAt = raw.expiresAt.trim();
  if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return { ok: false, error: 'expires' };
  const out: { storageBookingId: string; repository: string; enwrNo: string; valuationMinor: string; expiresAt?: string } =
    { storageBookingId, repository: raw.repository, enwrNo, valuationMinor };
  if (expiresAt) out.expiresAt = expiresAt;
  return { ok: true, value: out };
}

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
