// modules/listings/domain/listing-import-row.ts · reading one row of W128's bulk file (PC-56 TENANT-2c).
//
// Pure functions over a CSV `Record<string, string>` — no database, no framework. Every shape below is one an FPO
// secretary actually types into kharif_listings_jul.xlsx: a phone with spaces, a price entered per KILO on a
// per-quintal sheet, a quantity with the unit written into the cell, a blank line between two villages.
import { normalizePhoneE164 } from '../../../shared/utils/phone';

/** W128's template columns. `phone` (whose produce) and `product` (what) are the two a row cannot do without —
 *  everything else has a sensible absence. */
export const LISTING_IMPORT_COLUMNS = ['phone', 'product', 'quantity', 'unit', 'price', 'min_order_qty', 'harvest_date', 'title'] as const;

export type ListingRowRead =
  | { ok: true; phone: string; product: string; quantity: number; unit: string | null; priceMajor: string; minOrderQty: number | null; harvestDate: string | null; title: string | null }
  | { ok: false; code: 'ROW_EMPTY' | 'PHONE_MISSING' | 'PRODUCT_MISSING'; message: string }
  | { ok: false; code: 'PHONE_INVALID' | 'QTY_INVALID' | 'PRICE_INVALID' | 'HARVEST_INVALID' | 'MOQ_INVALID'; message: string; fixable: true; suggestion?: string };

const trim = (v: string | undefined) => (v ?? '').trim();

/** A quantity cell is a NUMBER; "18 qtl" is a number plus a unit somebody typed in the wrong column. The unit is
 *  read out rather than discarded — losing it silently would list 18 kg as 18 quintals, a 100× error in a farmer's
 *  favour on paper and against them at delivery. */
export function readQuantityCell(raw: string): { n: number; unit: string | null } | null {
  const m = /^([\d.]+)\s*([a-zA-Z%]*)$/.exec(trim(raw));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { n, unit: m[2] ? m[2].toLowerCase() : null };
}

/** Money stays a STRING all the way to the API (Law 2). A cell may carry ₹, commas or a decimal; none of that is a
 *  reason to lose the value, and none of it is parsed through a float. */
export function readPriceCell(raw: string): string | null {
  const s = trim(raw).replace(/[₹,\s]/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  if (Number(s.replace(/\..*$/, '')) === 0 && !/[1-9]/.test(s)) return null;
  return s;
}

export function readListingRow(row: Record<string, string>): ListingRowRead {
  const phoneRaw = trim(row.phone);
  const productRaw = trim(row.product);
  const priceRaw = trim(row.price);
  const qtyRaw = trim(row.quantity);
  if (!phoneRaw && !productRaw && !priceRaw && !qtyRaw) {
    return { ok: false, code: 'ROW_EMPTY', message: 'the row is empty' };
  }
  if (!phoneRaw) return { ok: false, code: 'PHONE_MISSING', message: 'no phone — a listing needs a member whose produce it is' };
  if (!productRaw) return { ok: false, code: 'PRODUCT_MISSING', message: 'no product — a lot with no product cannot be listed' };

  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) return { ok: false, code: 'PHONE_INVALID', message: `"${phoneRaw}" is not a usable phone number`, fixable: true };

  const qty = readQuantityCell(qtyRaw);
  if (!qty) return { ok: false, code: 'QTY_INVALID', message: `quantity "${qtyRaw}" is not a positive number`, fixable: true };

  const priceMajor = readPriceCell(priceRaw);
  if (priceMajor === null) return { ok: false, code: 'PRICE_INVALID', message: `price "${priceRaw}" is not a usable amount`, fixable: true };

  const moqRaw = trim(row.min_order_qty);
  let minOrderQty: number | null = null;
  if (moqRaw) {
    const m = readQuantityCell(moqRaw);
    if (!m || m.n > qty.n) return { ok: false, code: 'MOQ_INVALID', message: `minimum order "${moqRaw}" must be a positive number not larger than the quantity`, fixable: true };
    minOrderQty = m.n;
  }

  const harvestRaw = trim(row.harvest_date);
  if (harvestRaw && !/^\d{4}-\d{2}-\d{2}$/.test(harvestRaw)) {
    return { ok: false, code: 'HARVEST_INVALID', message: `harvest date "${harvestRaw}" must be YYYY-MM-DD`, fixable: true };
  }

  // The unit comes from the `unit` column, or from whatever the quantity cell carried — the row's own word either way.
  const unit = trim(row.unit).toLowerCase() || qty.unit;
  return {
    ok: true, phone, product: productRaw, quantity: qty.n, unit: unit || null,
    priceMajor, minOrderQty, harvestDate: harvestRaw || null, title: trim(row.title) || null,
  };
}

/** W128: "re-uploading the same file cannot double-create". The key is the row's OWN identity — member + product +
 *  quantity + price — so the same lot twice in one file is one lot, and a corrected re-upload of a DIFFERENT price
 *  is honestly a different lot. */
export function listingImportIdemKey(tenantId: string, r: { phone: string; product: string; quantity: number; priceMajor: string }): string {
  return `listing_import:${tenantId}:${r.phone}:${r.product.toLowerCase()}:${r.quantity}:${r.priceMajor}`;
}

/** THE PER-KILO CATCH (W128's own row: "₹128.00/qtl is 100× below band; did you mean ₹12,800/qtl?").
 *
 *  ONLY WHEN A REAL PEER BAND EXISTS. The suggestion is arithmetic on the operator's own number against this
 *  tenant's own published listings — never a guess from nothing: with no comparable listings there is no band, and
 *  a "looks too cheap" warning invented from air would teach operators to click past warnings.
 *
 *  TWO CONDITIONS, AND THE SECOND IS THE ONE THAT MAKES THE SUGGESTION HONEST:
 *    • the row is at least an ORDER OF MAGNITUDE below the band floor — no genuine lot is that cheap, so something
 *      is wrong with the number rather than with the harvest; and
 *    • multiplying by 100 (the kg→quintal ratio the mistake actually is) lands AT OR ABOVE that floor — i.e. the
 *      per-kilo hypothesis EXPLAINS the number. A price a thousand times too low is flagged by nothing here,
 *      because ×100 would not explain it and a suggestion that does not fit is worse than none.
 *  Deliberately NOT keyed to the floor being exactly 100× away: W128's own row (₹128 against a ₹12,480 floor) is
 *  97.5× under, because a band FLOOR sits below the modal price — a rule that demanded a clean 100× would miss the
 *  canon's own example, which is how a threshold picked from arithmetic instead of from data fails in the field. */
export function perKiloSuspicion(priceMinor: string, band: { lowMinor: string } | null): { suggestMinor: string } | null {
  if (!band) return null;
  const p = BigInt(priceMinor), low = BigInt(band.lowMinor);
  if (p <= 0n || low <= 0n) return null;
  if (p * 10n >= low) return null;                 // within one order of magnitude of the floor (inclusive) — a cheap
                                                   // lot, not a typo. The boundary is stated rather than incidental.
  const corrected = p * 100n;
  if (corrected < low) return null;                // ×100 does not explain it; offer no suggestion at all
  return { suggestMinor: corrected.toString() };
}
