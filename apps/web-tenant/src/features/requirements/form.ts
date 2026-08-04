// apps/web-tenant/src/features/requirements/form.ts · PURE validation for the requirements board (PC-28c).
// Mirrors CreateRequirementSchema/CreateResponseSchema (quantity ≤3 decimals; budgets/quote float-free minor;
// needBy YYYY-MM-DD; pincode 6 digits; quote price POSITIVE). No IO → unit-tested.
import { parseMajorToMinor } from '../listings/form';

const QTY_RE = /^\d{1,11}(\.\d{1,3})?$/;

export type ReqResult =
  | { ok: true; value: { title: string; quantity: string; unitCode: string; budgetMinMinor?: string; budgetMaxMinor?: string; needBy?: string; deliveryPincode?: string; isUrgent?: boolean } }
  | { ok: false; error: 'title' | 'quantity' | 'unit' | 'budget' | 'needby' | 'pincode' };

export function buildRequirement(raw: { title: string; quantity: string; unitCode: string; budgetMinMajor: string; budgetMaxMajor: string; needBy: string; pincode: string; isUrgent: boolean }): ReqResult {
  const title = raw.title.trim();
  if (title.length < 3 || title.length > 250) return { ok: false, error: 'title' };
  const quantity = raw.quantity.trim();
  if (!QTY_RE.test(quantity) || Number(quantity) <= 0) return { ok: false, error: 'quantity' };
  const unitCode = raw.unitCode.trim();
  if (!unitCode || unitCode.length > 20) return { ok: false, error: 'unit' };

  const out: { title: string; quantity: string; unitCode: string; budgetMinMinor?: string; budgetMaxMinor?: string; needBy?: string; deliveryPincode?: string; isUrgent?: boolean } = { title, quantity, unitCode };

  const bmin = raw.budgetMinMajor.trim(); const bmax = raw.budgetMaxMajor.trim();
  if (bmin) { const v = parseMajorToMinor(bmin); if (v === undefined) return { ok: false, error: 'budget' }; out.budgetMinMinor = v; }
  if (bmax) { const v = parseMajorToMinor(bmax); if (v === undefined) return { ok: false, error: 'budget' }; out.budgetMaxMinor = v; }
  if (out.budgetMinMinor && out.budgetMaxMinor && BigInt(out.budgetMaxMinor) < BigInt(out.budgetMinMinor)) return { ok: false, error: 'budget' };

  const needBy = raw.needBy.trim();
  if (needBy) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(needBy)) return { ok: false, error: 'needby' };
    out.needBy = needBy;
  }
  const pincode = raw.pincode.trim();
  if (pincode) {
    if (!/^\d{6}$/.test(pincode)) return { ok: false, error: 'pincode' };
    out.deliveryPincode = pincode;
  }
  if (raw.isUrgent) out.isUrgent = true;
  return { ok: true, value: out };
}

export type QuoteResult =
  | { ok: true; value: { quotedPriceMinor: string; quantity: string; message?: string } }
  | { ok: false; error: 'price' | 'quantity' | 'message' };

export function buildQuote(raw: { priceMajor: string; quantity: string; message: string }): QuoteResult {
  const quotedPriceMinor = parseMajorToMinor(raw.priceMajor);
  if (quotedPriceMinor === undefined || quotedPriceMinor === '0') return { ok: false, error: 'price' };
  const quantity = raw.quantity.trim();
  if (!QTY_RE.test(quantity) || Number(quantity) <= 0) return { ok: false, error: 'quantity' };
  const message = raw.message.trim();
  if (message.length > 1000) return { ok: false, error: 'message' };
  const value: { quotedPriceMinor: string; quantity: string; message?: string } = { quotedPriceMinor, quantity };
  if (message) value.message = message;
  return { ok: true, value };
}
