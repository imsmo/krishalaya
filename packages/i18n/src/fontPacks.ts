// @krishalaya/i18n · fontPacks.ts — the Q35 font-pack manifest (developer-handoff.md §7 / BRAND-015/016).
// One entry per DISTINCT font family the platform loads for a script. Several languages REUSE a pack (mr rides
// hi's shipped Hind; as rides bn's Hind Siliguri) — that reuse is exactly why this is a separate manifest keyed
// by `id`, not a 1:1 per-language table: `LanguageDef.fontPack` in languages.ts POINTS at one of these ids.
//
// Q35 ruling (developer-handoff.md §7, Performance-budgets table): "Font pack per language | ≤120KB WOFF2,
// subsetted, weights 400/700 initially | founder §17 approval to loosen" — `budgetBytes` below is that ceiling in
// bytes (120 * 1024 = 122880), enforced for real by `tools/scripts/i18n/check-font-budget.js` (Part 4 of this
// batch), never just asserted in a comment.
//
// `googleFontsFamilyParam` is the exact `family=` query-string value BRAND-015 loaded and fetch-verified (APPLY-4/
// APPLY-5 for the 4 Baloo-2 candidates: 200 OK, real @font-face rules, dated 2026-07-21). This manifest does NOT
// ship a binary — see FONT_PIPELINE.md for the honest network/CI boundary: no font binary exists anywhere in this
// repo today (grep-verified before writing this file), and none is invented here.
export type FontPackStatus =
  | 'shipped'              // already loaded on every screen (hi/en/gu launch set)
  | 'verified-live-fetch'  // BRAND-015/APPLY-4/5: fetched 200 OK with real @font-face rules, PROPOSED §17
  | 'demo-face';           // loaded for bidi/script DEMONSTRATION only, explicitly not ratified as the launch body face (ar's Noto Naskh Arabic, per BRAND-017 line 150)

export interface FontPackDef {
  id: string;
  family: string;                 // the CSS font-family name
  googleFontsFamilyParam: string; // the exact fonts.googleapis.com/css2?family=... value
  weights: readonly number[];     // Q35: weights 400/700 initially
  scriptCoverage: readonly string[]; // Unicode script name(s) this pack must subset for
  budgetBytes: number;            // Q35 ceiling per language pack (≤120KB WOFF2)
  status: FontPackStatus;
  sourceCitation: string;         // exact doc/section this pack's facts trace to
}

const KB_120 = 120 * 1024; // 122880 — Q35's ceiling, byte-exact

export const FONT_PACKS: readonly FontPackDef[] = Object.freeze([
  {
    id: 'hind', family: 'Hind', googleFontsFamilyParam: 'Hind:wght@400;500;600;700', weights: [400, 500, 600, 700],
    scriptCoverage: ['Devanagari'], budgetBytes: KB_120, status: 'shipped',
    sourceCitation: 'tokens.css line 113 (--font-body-hi); BRAND-015 (mr rides this pack, zero new load)',
  },
  {
    id: 'plusJakartaSans', family: 'Plus Jakarta Sans', googleFontsFamilyParam: 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
    weights: [400, 500, 600, 700, 800], scriptCoverage: ['Latin'], budgetBytes: KB_120, status: 'shipped',
    sourceCitation: 'developer-handoff.md §7 (EN body face)',
  },
  {
    id: 'hindVadodara', family: 'Hind Vadodara', googleFontsFamilyParam: 'Hind+Vadodara:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Gujarati'], budgetBytes: KB_120, status: 'shipped',
    sourceCitation: 'developer-handoff.md §7 (GU body face)',
  },
  {
    id: 'hindSiliguri', family: 'Hind Siliguri', googleFontsFamilyParam: 'Hind+Siliguri:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Bengali'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (bn/as pack, real Hind-family sibling, HIGH confidence)',
  },
  {
    id: 'hindGuntur', family: 'Hind Guntur', googleFontsFamilyParam: 'Hind+Guntur:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Telugu'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (te pack, real Hind-family sibling, HIGH confidence)',
  },
  {
    id: 'hindMadurai', family: 'Hind Madurai', googleFontsFamilyParam: 'Hind+Madurai:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Tamil'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (ta pack, real Hind-family sibling, HIGH confidence)',
  },
  {
    id: 'balooPaaji2', family: 'Baloo Paaji 2', googleFontsFamilyParam: 'Baloo+Paaji+2:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Gurmukhi'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (pa pack); fetch-verified 200 OK at APPLY-4, 2026-07-21 (apply4_report.md §2)',
  },
  {
    id: 'balooTamma2', family: 'Baloo Tamma 2', googleFontsFamilyParam: 'Baloo+Tamma+2:wght@400;500;600;700',
    weights: [400, 500, 600, 700], scriptCoverage: ['Kannada'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (kn pack); fetch-verified 200 OK at APPLY-4, 2026-07-21 (apply4_report.md §2)',
  },
  {
    id: 'balooChettan2', family: 'Baloo Chettan 2', googleFontsFamilyParam: 'Baloo+Chettan+2:wght@400;500;600;700;800',
    weights: [400, 500, 600, 700, 800], scriptCoverage: ['Malayalam'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (ml pack); fetch-verified 200 OK at APPLY-5, 2026-07-21 (apply5_report.md §2)',
  },
  {
    id: 'balooBhaina2', family: 'Baloo Bhaina 2', googleFontsFamilyParam: 'Baloo+Bhaina+2:wght@400;500;600;700;800',
    weights: [400, 500, 600, 700, 800], scriptCoverage: ['Odia'], budgetBytes: KB_120, status: 'verified-live-fetch',
    sourceCitation: 'BRAND-015 (or pack); fetch-verified 200 OK at APPLY-5, 2026-07-21 (apply5_report.md §2)',
  },
  {
    id: 'notoNaskhArabic', family: 'Noto Naskh Arabic', googleFontsFamilyParam: 'Noto+Naskh+Arabic:wght@400;500;600;700',
    weights: [400, 700], scriptCoverage: ['Arabic'], budgetBytes: KB_120, status: 'demo-face',
    sourceCitation: 'BRAND-017 line 150: "Naskh here is a DEMO face for bidi mechanics only" — ar-AE candidate locale (SITE-023), NOT founder-ratified as the launch body face',
  },
  {
    id: 'notoNastaliqUrdu', family: 'Noto Nastaliq Urdu', googleFontsFamilyParam: 'Noto+Nastaliq+Urdu:wght@400;600;700',
    weights: [400, 700], scriptCoverage: ['Arabic'], budgetBytes: KB_120, status: 'demo-face',
    sourceCitation: 'BRAND-018: forward canon, first real Urdu specimen string, still fully machine-draft-watermarked, not a launch',
  },
]);

const FONT_PACK_BY_ID = new Map(FONT_PACKS.map((f) => [f.id, f]));

/** Look up a font pack by id (as referenced from a `LanguageDef.fontPack`). Undefined if the id is unknown —
 * callers should treat that as a data-integrity bug (a language pointing at a pack that doesn't exist), never
 * silently substitute a default. */
export function getFontPack(id: string): FontPackDef | undefined {
  return FONT_PACK_BY_ID.get(id);
}
