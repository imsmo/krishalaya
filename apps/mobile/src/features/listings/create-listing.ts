// apps/mobile/src/features/listings/create-listing.ts · PURE logic for screen 10 (Create Listing). Owns the
// capture-mode vocabulary (Photo / Voice / Manual), the STT language set, and client-side validation + money
// conversion (₹ → paise as a bigint-minor STRING, Law 2 — never a float). No I/O — unit-tested. The screen
// gathers a product (real catalogue id), quantity, ₹/unit price and optional photos/quality, calls
// buildCreateDraft() to validate + assemble, then hands the result to listings.api.createListing().
//
// FLAGGED GAP (never faked): the design's "✨ AI Detected" card is meant to auto-fill crop/qty/price/quality from
// the spoken transcript. The structured extractor exists in ai-services (POST /v1/voice-extraction) but is NOT
// yet exposed through apps/api or the SDK, so the mobile client cannot call it. Until that endpoint lands, the
// AI-Detected fields are farmer-confirmed (the live transcript is real on-device STT); we never invent values.

export type CreateMode = 'photo' | 'voice' | 'manual';
export const CREATE_MODES: readonly CreateMode[] = Object.freeze(['photo', 'voice', 'manual']);

/** Resolve the initial capture mode from a route `mode` param (e.g. Home hero deep-links, repost). Anything
 * that isn't one of the three real modes falls back to 'voice' (design 10's default tab). Pure — no I/O. */
export function resolveModeParam(mode: string | string[] | undefined | null): CreateMode {
  const m = Array.isArray(mode) ? mode[0] : mode;
  return m === 'photo' || m === 'voice' || m === 'manual' ? m : 'voice';
}

// KV-MF-05 / KV-MF-13 (voice STT gap): the Voice tab stays visible (it's never removed — the mic is the
// product's signature), but its mic/transcript/STT-language UI is gated by the `voice_listing` client flag
// until ai-services voice-extraction is exposed via apps/api (GA AI wave). While OFF we render an honest
// "coming soon" card instead of a dead mic + a Live Transcript box that never fills in.
export function shouldShowVoiceComingSoon(mode: CreateMode, voiceListingEnabled: boolean): boolean {
  return mode === 'voice' && !voiceListingEnabled;
}

/** Home hero "Speak to Sell" target mode: Voice once the feature is live, else Manual — the hero itself never
 * disappears (it's the product's signature) but it must not dead-end into a dead mic (KV-MF-05). */
export function speakToSellTargetMode(voiceListingEnabled: boolean): CreateMode {
  return voiceListingEnabled ? 'voice' : 'manual';
}

// KV-MF-09 (founder video review): the "Price/qtl: —" summary row below the Quantity/Price inputs used to be
// keyed on `priceMinor` alone, so it could show a stray dash pre-submit, and (worse) could show a real-looking
// price before a crop was even picked — no context for what unit that ₹ figure is per. It must only render once
// there is BOTH a real parsed price AND a confirmed product (never a "—" placeholder, never a contextless
// number) — a type guard so callers get `priceMinor` narrowed to `string` for free. Pure — no I/O.
export function shouldShowPriceSummary(priceMinor: string | null, hasProduct: boolean): priceMinor is string {
  return priceMinor != null && hasProduct;
}

// STT languages offered on the voice panel (subset of the launch locales). Codes match @krishalaya/i18n.
export const STT_LANGS: readonly string[] = Object.freeze(['hi', 'en', 'gu']);

// Quality grades shown on the AI-Detected card. Appended to the listing description (there is no dedicated
// grade field on the create contract yet — flagged); never silently dropped.
export type QualityGrade = 'A' | 'B' | 'C';
export const QUALITY_GRADES: readonly QualityGrade[] = Object.freeze(['A', 'B', 'C']);

/** ₹ (whole rupees, as typed) → paise bigint-minor string, or null if not a clean positive integer ≤ 13 digits. */
// S6 device-test fix (founder report: "Preview button not enable even I fillup all fields"):
// both parsers were STRICTER than the API and failed SILENTLY. The server accepts decimal
// quantities (CreateListingSchema: z.number().positive() — 2.5 quintal is a real farm quantity)
// and integer PAISE (so ₹2500.50 is perfectly representable). The old integer-only regexes
// disabled the Preview button with no feedback. Parsers now match the server contract exactly;
// the screen additionally surfaces WHY the button is disabled (see new.tsx disabledReason).
export function rupeesToPaise(rupees: string): string | null {
  const s = (rupees ?? '').trim().replace(/,/g, '');   // tolerate Indian-style "2,500"
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const paise = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return paise > 0n ? paise.toString() : null;
}

/** Quantity → positive number ≤ 1,000,000 (server: z.number().positive().max(1_000_000)); decimals allowed (2.5 qtl). */
export function parseQty(qty: string): number | null {
  const s = (qty ?? '').trim();
  if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 1_000_000 ? n : null;
}

export interface ListingDraftForm {
  productId: string | null;
  categoryId: string | null;
  title: string | null;
  defaultUnit: string | null;
  qty: string;
  rupees: string;
  description?: string;
  quality?: QualityGrade | null;
  mediaIds?: string[];
}

export interface DraftResult {
  ok: boolean;
  reason?: 'product' | 'qty' | 'price';
  payload?: {
    productId: string; categoryId: string; title: string; description?: string;
    quantityTotal: number; unitCode: string; priceMinor: string; mediaIds?: string[];
  };
}

/** Validate + assemble the create payload. The product (real catalogue id/unit) is required; qty + price must be
 * clean; quality (if chosen) is folded into the description so it is never lost. Server re-validates (§4). */
export function buildCreateDraft(form: ListingDraftForm): DraftResult {
  if (!form.productId || !form.categoryId || !form.title || !form.defaultUnit) return { ok: false, reason: 'product' };
  const quantityTotal = parseQty(form.qty);
  if (quantityTotal == null) return { ok: false, reason: 'qty' };
  const priceMinor = rupeesToPaise(form.rupees);
  if (priceMinor == null) return { ok: false, reason: 'price' };

  const descParts = [form.description?.trim(), form.quality ? `Quality: ${form.quality}` : ''].filter(Boolean);
  const description = descParts.length ? descParts.join(' · ') : undefined;

  return {
    ok: true,
    payload: {
      productId: form.productId, categoryId: form.categoryId, title: form.title, description,
      quantityTotal, unitCode: form.defaultUnit, priceMinor,
      mediaIds: form.mediaIds && form.mediaIds.length ? form.mediaIds : undefined,
    },
  };
}
