// @krishalaya/tokens · contrast.ts — PC-56 TENANT-13d · THE CONTRAST LAW (W191 "accessibility is enforced by the configurator — a brand
// that farmers cannot read is not a brand").
//
// ONE implementation, pure, no I/O, imported by everything that judges a tenant brand: the API's publish gate
// (apps/api modules/tenancy brand rules), the console's live contrast panel (apps/web-tenant) and the storefront's token seam. A second
// copy would be two answers to "can a farmer read this", and the one that drifts is always the one nobody is looking at.
//
// WCAG 2.x, exactly as written:
//   • relative luminance  L = 0.2126 R + 0.7152 G + 0.0722 B, each channel linearised from sRGB
//     (c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4);
//   • contrast ratio      (L_lighter + 0.05) / (L_darker + 0.05), 1 … 21.
// Thresholds: AA normal text 4.5, AA large text 3, AAA normal text 7, AAA large text 4.5. The PUBLISH GATE is AA normal text (4.5) on
// EVERY pair the app renders; AAA is REPORTED, pass or fail, never claimed (canon: "AAA normal-text needs 7:1 — shown honestly").
//
// Senior Farmer Mode MULTIPLIES TYPE (seniorModeTypeScaleMultiplier, 1.30×) — it never changes a colour, so it never fixes contrast.
// `seniorModeNote` states that as data so every surface prints the same sentence.
import { seniorModeTypeScaleMultiplier } from './typography';

/** Lower-case six-digit hex, the only colour form a brand may store (server-validated `^#[0-9a-f]{6}$`). */
export const BRAND_HEX_RE = /^#[0-9a-f]{6}$/;

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;
export const AAA_NORMAL = 7;
export const AAA_LARGE = 4.5;
/** The publish gate: every rendered pair at or above this ratio. */
export const PUBLISH_MIN_RATIO = AA_NORMAL;

/** Accepts `#RRGGBB` in either case; anything else is not a colour. */
export function normaliseHex(raw: string): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  return BRAND_HEX_RE.test(v) ? v : null;
}

function channel(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) … 1 (white). Throws on a non-colour (a caller bug, never user input). */
export function relativeLuminance(hex: string): number {
  const h = normaliseHex(hex);
  if (!h) throw new Error(`contrast: '${hex}' is not a #rrggbb colour`);
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two colours, 1 … 21 (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The ratio as people print it: one decimal, rounded — EXCEPT that a ratio below a threshold (3, 4.5, 7) is never rounded up onto it,
 * so a failing 4.49 prints "4.4:1", never a passing-looking "4.5:1". (6.175 prints "6.2:1", the canon's own figure.)
 */
export function formatRatio(ratio: number): string {
  let shown = Math.round(ratio * 10) / 10;
  for (const t of [AA_LARGE, AA_NORMAL, AAA_NORMAL]) if (ratio < t && shown >= t) shown = Math.floor(ratio * 10) / 10;
  return `${shown.toFixed(1)}:1`;
}

export interface BrandColours { primary: string; accent: string; ink: string; surface: string }

/**
 * EVERY pair the member app renders with a brand (brief A2), in a fixed order. `fg` is the text, `bg` what it sits on.
 *   primary_on_surface — headings, links and primary buttons' outline on the page surface;
 *   accent_on_ink      — the accent call-to-action text on the ink bar (canon "accent on ink");
 *   ink_on_surface     — body text on the page surface;
 *   surface_on_primary — button / header text in the surface colour on a primary fill.
 */
export const BRAND_PAIRS = [
  { code: 'primary_on_surface', fg: 'primary', bg: 'surface' },
  { code: 'accent_on_ink', fg: 'accent', bg: 'ink' },
  { code: 'ink_on_surface', fg: 'ink', bg: 'surface' },
  { code: 'surface_on_primary', fg: 'surface', bg: 'primary' },
] as const;
export type BrandPairCode = (typeof BRAND_PAIRS)[number]['code'];

export interface PairVerdict {
  code: BrandPairCode;
  fg: string; bg: string;
  /** exact ratio (unrounded) */
  ratio: number;
  /** "6.2:1" — one decimal, never rounded up onto a threshold (formatRatio) */
  display: string;
  aa: boolean;        // ≥ 4.5 — THE GATE
  aaLarge: boolean;   // ≥ 3
  aaa: boolean;       // ≥ 7 — reported, never claimed
  aaaLarge: boolean;  // ≥ 4.5
}
export interface ContrastReport {
  pairs: PairVerdict[];
  /** true only when EVERY pair is ≥ 4.5:1 */
  passes: boolean;
  failing: PairVerdict[];
  minRatio: number;
  /** a sentence-free fact: Senior Farmer Mode scales type by this factor and leaves every colour (and so every ratio) unchanged */
  seniorMode: { typeScale: number; changesContrast: false };
}

/** Judge a brand's four colours. Pure; the caller validated each colour first (a bad hex throws). */
export function brandContrast(c: BrandColours): ContrastReport {
  const pairs = BRAND_PAIRS.map((p) => {
    const fg = c[p.fg], bg = c[p.bg];
    const ratio = contrastRatio(fg, bg);
    return {
      code: p.code, fg: normaliseHex(fg)!, bg: normaliseHex(bg)!, ratio, display: formatRatio(ratio),
      aa: ratio >= AA_NORMAL, aaLarge: ratio >= AA_LARGE, aaa: ratio >= AAA_NORMAL, aaaLarge: ratio >= AAA_LARGE,
    };
  });
  const failing = pairs.filter((p) => !p.aa);
  return {
    pairs, passes: failing.length === 0, failing, minRatio: Math.min(...pairs.map((p) => p.ratio)),
    seniorMode: { typeScale: seniorModeTypeScaleMultiplier, changesContrast: false },
  };
}

/** The platform's own brand — what a tenant sees before it designs anything, and the default draft. All four pairs pass AA. */
export const PLATFORM_BRAND_COLOURS: Readonly<BrandColours> = Object.freeze({
  primary: '#1e6f3f', // colors.primary[600] — 6.2:1 on white (canon "6.2:1")
  accent: '#f39c12',  // colors.accent[500] — 6.6:1 on ink
  ink: '#232a33',     // colors.ink[700]
  surface: '#ffffff',
});
