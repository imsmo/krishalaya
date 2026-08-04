// apps/web-tenant/src/features/listings/form.ts · PURE, framework-free helpers for the new-listing form. No React,
// no SDK runtime (type-only import), no I/O → unit-tested. Money is parsed float-free from a major-unit string to
// a bigint minor-unit STRING (Law 2) — never via Number()/parseFloat/toFixed. The product picker encodes the
// three fields the create payload needs (productId, categoryId, defaultUnit) into one <option> value so a
// server-rendered <select> can carry them without an extra lookup; decode validates the shape.
import type { CreateListingInput } from '@krishalaya/sdk-js';

const MINOR_DIGITS = 2; // INR paise; the API authoritatively re-derives by currency, this is the display contract

/** Major-unit string (e.g. "120.5") → minor-unit integer string ("12050"), float-free. undefined when malformed. */
export function parseMajorToMinor(input: string | undefined | null): string | undefined {
  const s = (input ?? '').trim();
  if (!s) return undefined;
  if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${MINOR_DIGITS}})?$`).test(s)) return undefined;
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0'.repeat(MINOR_DIGITS)).slice(0, MINOR_DIGITS);
  const joined = (intPart + frac).replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}

/** Minor-unit integer string → major-unit display string for pre-filling the price field ("12340" → "123.40"). */
export function minorToMajor(minor: string | undefined | null): string {
  const s = (minor ?? '').trim();
  if (!s || !/^\d+$/.test(s)) return '';
  const padded = s.padStart(MINOR_DIGITS + 1, '0');
  const int = padded.slice(0, -MINOR_DIGITS).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(-MINOR_DIGITS);
  return /^0+$/.test(frac) ? int : `${int}.${frac}`;
}

export interface ProductChoice { id: string; categoryId: string; defaultUnit: string }

/** Encode a chosen product into a single <option> value (so the <select> carries categoryId + unit too). */
export function encodeProductChoice(p: ProductChoice): string {
  return [p.id, p.categoryId, p.defaultUnit].join('|');
}

/** Decode + validate a product <option> value. Returns null for anything malformed (never trust the client). */
export function decodeProductChoice(raw: string | undefined | null): ProductChoice | null {
  const parts = (raw ?? '').split('|');
  if (parts.length !== 3) return null;
  const [id, categoryId, defaultUnit] = parts.map((x) => x.trim());
  if (!id || !categoryId || !defaultUnit) return null;
  return { id, categoryId, defaultUnit };
}

const SALE_TYPES = ['direct', 'auction', 'both', 'preorder', 'service', 'group_lot'] as const;
const ORGANIC = ['none', 'natural', 'certified'] as const;
const VISIBILITY = ['tenant', 'cross_tenant', 'public'] as const;

/** Raw string fields off the submitted FormData (all strings, as the browser sends them). */
export interface RawListingForm {
  product?: string; title?: string; description?: string;
  quantityTotal?: string; minOrderQty?: string; priceMajor?: string;
  saleType?: string; organicClaim?: string; visibility?: string; pincode?: string; regionId?: string;
  mediaIds?: string[];
}

export type BuildResult =
  | { ok: true; value: CreateListingInput }
  | { ok: false; error: 'errorProduct' | 'errorTitle' | 'errorQty' | 'errorPrice' };

/** Validate + assemble the CreateListingInput from raw form fields. Pure: returns either the typed payload or an
 *  i18n error key. The API re-validates (zod .strict) authoritatively — this is the first, friendly gate. */
export function buildCreateListingInput(raw: RawListingForm): BuildResult {
  const product = decodeProductChoice(raw.product);
  if (!product) return { ok: false, error: 'errorProduct' };

  const title = (raw.title ?? '').trim();
  if (title.length < 3 || title.length > 140) return { ok: false, error: 'errorTitle' };

  const quantityTotal = Number.parseInt((raw.quantityTotal ?? '').trim(), 10);
  if (!Number.isInteger(quantityTotal) || quantityTotal <= 0) return { ok: false, error: 'errorQty' };

  const priceMinor = parseMajorToMinor(raw.priceMajor);
  if (priceMinor === undefined || priceMinor === '0') return { ok: false, error: 'errorPrice' };

  const minRaw = (raw.minOrderQty ?? '').trim();
  let minOrderQty: number | undefined;
  if (minRaw) {
    const n = Number.parseInt(minRaw, 10);
    if (!Number.isInteger(n) || n <= 0 || n > quantityTotal) return { ok: false, error: 'errorQty' };
    minOrderQty = n;
  }

  const saleType = (SALE_TYPES as readonly string[]).includes(raw.saleType ?? '') ? (raw.saleType as CreateListingInput['saleType']) : 'direct';
  const organicClaim = (ORGANIC as readonly string[]).includes(raw.organicClaim ?? '') ? (raw.organicClaim as CreateListingInput['organicClaim']) : 'none';
  const visibility = (VISIBILITY as readonly string[]).includes(raw.visibility ?? '') ? (raw.visibility as CreateListingInput['visibility']) : 'tenant';

  const description = (raw.description ?? '').trim() || undefined;
  const pincode = (raw.pincode ?? '').trim() || undefined;
  const regionId = (raw.regionId ?? '').trim() || undefined;
  const mediaIds = (raw.mediaIds ?? []).map((m) => m.trim()).filter(Boolean);

  return {
    ok: true,
    value: {
      productId: product.id, categoryId: product.categoryId, unitCode: product.defaultUnit,
      title, description, quantityTotal, minOrderQty,
      priceMinor, currencyCode: 'INR',
      saleType, organicClaim, visibility,
      pincode, regionId,
      mediaIds: mediaIds.length ? mediaIds : undefined,
    },
  };
}

export const LISTING_SALE_TYPES = SALE_TYPES;
export const LISTING_ORGANIC = ORGANIC;
export const LISTING_VISIBILITY = VISIBILITY;
