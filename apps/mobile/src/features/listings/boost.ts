// apps/mobile/src/features/listings/boost.ts · PURE helpers for screen 114 (Boost Listing). No I/O — unit-tested.
//
// What's REAL vs STATIC (per the §13/design-parity rule):
//   • A boost tier's id / name / priceMinor / days are SERVER TRUTH (from listings.boostTiers()). The amount the
//     wallet is actually debited is whatever the server resolves for the chosen tier id (payBoostFromWallet) — so
//     the payment Total shown MUST be the tier's own priceMinor, never a client-computed number.
//   • The per-tier feature bullets, coverage radius/area, and the "5× / 3.4×" marketing lines are PRESENTATION
//     COPY (identical for every user) → static i18n, keyed by the tier's coarse KIND below.
//
// FLAGGED GAP (§13 — never fabricated): the design's payment card breaks the price into "GST (18%)" + base. Neither
// BoostTier nor BoostWalletPayResult exposes a tax breakdown, so the screen shows the single server price as the
// Total with a "price inclusive of taxes" note rather than inventing an 18% split that may not match the charge.

import type { BoostTier } from '@krishalaya/sdk-js';

/** Coarse tier kind → drives which static marketing copy (features + coverage area) a tier card shows. Mapped from
 * the server tier `code`; anything unrecognised falls back to 'generic' so a new server tier still renders safely. */
export type TierKind = 'local' | 'regional' | 'statewide' | 'generic';

/** Map a server boost-tier code to a presentation kind. Tolerant of casing / separators / common synonyms; unknown
 * codes degrade to 'generic' (never throws, never guesses a wrong radius). */
export function tierKind(code: string | null | undefined): TierKind {
  const c = (code ?? '').toLowerCase();
  if (/\b(local|nearby|district|30km)\b/.test(c) || c.includes('local')) return 'local';
  if (/\b(region|regional|state|100km)\b/.test(c) && !c.includes('statewide') && !c.includes('national')) return 'regional';
  if (c.includes('statewide') || c.includes('national') || c.includes('multi')) return 'statewide';
  return 'generic';
}

/** The recommended/default-selected tier: the design highlights the MIDDLE option ("Regional"). With the tiers
 * sorted by price ascending, that's the median by index. Returns null for an empty catalogue (screen shows empty). */
export function pickRecommendedTier(tiers: BoostTier[]): BoostTier | null {
  if (!tiers.length) return null;
  const sorted = sortByPrice(tiers);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Tiers in display order: cheapest → dearest, by bigint minor price (Law 2 — never parseFloat). Stable, pure. */
export function sortByPrice(tiers: BoostTier[]): BoostTier[] {
  return [...tiers].sort((a, b) => {
    const av = safeMinor(a.priceMinor), bv = safeMinor(b.priceMinor);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}

function safeMinor(s: string): bigint {
  try { return BigInt(s); } catch { return 0n; }
}
