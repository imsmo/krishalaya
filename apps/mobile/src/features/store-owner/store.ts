// apps/mobile/src/features/store-owner/store.ts · PURE store-owner logic (PC-50 W10-4). Batch/expiry maths
// (calendar-date compare — an MRP batch expires on a DATE, not an instant) and the zod-mirror goods-inward
// builder (CreateBatchSchema.strict(): MRP is a bigint minor STRING, empty optionals OMITTED). No IO.
import { rupeesToMinor } from '../vet/vet';

export type ExpiryState = 'expired' | 'expiring_soon' | 'ok' | 'none';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar compare against the store's local today (ISO). ≤30 days out = expiring_soon. */
export function expiryState(expiryDate: string | null | undefined, todayIso: string): ExpiryState {
  if (!expiryDate || !DATE.test(expiryDate)) return 'none';
  if (expiryDate < todayIso) return 'expired';
  const soon = new Date(`${todayIso}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return expiryDate <= soon.toISOString().slice(0, 10) ? 'expiring_soon' : 'ok';
}
export function expiryTone(state: ExpiryState): 'danger' | 'warning' | 'success' | 'neutral' {
  return state === 'expired' ? 'danger' : state === 'expiring_soon' ? 'warning' : state === 'ok' ? 'success' : 'neutral';
}

export type BatchDraftResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: 'product' | 'batchno' | 'qty' | 'unit' | 'mrp' | 'mfg' | 'expiry' | 'order' };

/** Mirrors CreateBatchSchema.strict(). qty is a positive number; MRP typed in rupees → minor string. */
export function buildBatchDraft(raw: { productId: string; batchNo: string; qtyReceived: string; unitCode: string; mrpRupees: string; mfgDate: string; expiryDate: string }): BatchDraftResult {
  if (!raw.productId) return { ok: false, error: 'product' };
  const batchNo = raw.batchNo.trim();
  if (!batchNo || batchNo.length > 80) return { ok: false, error: 'batchno' };
  const qty = Number(raw.qtyReceived.trim());
  if (!raw.qtyReceived.trim() || !Number.isFinite(qty) || qty <= 0 || qty > 100000000) return { ok: false, error: 'qty' };
  const unitCode = raw.unitCode.trim();
  if (!unitCode || unitCode.length > 20) return { ok: false, error: 'unit' };
  const out: Record<string, unknown> = { productId: raw.productId, batchNo, qtyReceived: qty, unitCode };
  const mrp = raw.mrpRupees.trim();
  if (mrp) {
    const minor = rupeesToMinor(mrp);
    if (!minor) return { ok: false, error: 'mrp' };
    out.mrpMinor = minor;
  }
  const mfg = raw.mfgDate.trim();
  if (mfg) { if (!DATE.test(mfg)) return { ok: false, error: 'mfg' }; out.mfgDate = mfg; }
  const exp = raw.expiryDate.trim();
  if (exp) { if (!DATE.test(exp)) return { ok: false, error: 'expiry' }; out.expiryDate = exp; }
  if (mfg && exp && exp < mfg) return { ok: false, error: 'order' };
  return { ok: true, value: out };
}
