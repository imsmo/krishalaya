// modules/tenancy/domain/brand-rules.ts · PC-56 TENANT-13d · W191 WHITE-LABEL THEMING — THE PURE RULES (no I/O).
//
// Founder decision 2026-10-03: BRAND FOR ALL (Rule Zero — branding is never plan-gated); PUBLISH NEEDS A CHECKER; CONTRAST LAW.
//
//   • A DRAFT is four colours, a display name, a short app name, a logo (an upload in the media store — never a URL) and the
//     Powered-by choice. Colours are `#rrggbb`, lower-cased, validated here AND by the table's CHECK (the CSS-injection vector F-13
//     named is closed at both ends).
//   • THE CONTRAST LAW is @krishalaya/tokens `brandContrast` — the one implementation the console's live panel also uses. Publishing
//     is refused while any pair the app renders is below 4.5:1, naming the pair and its ratio. AAA (7:1) is reported, never claimed.
//   • A PUBLISH needs: every pair ≥ 4.5:1, a logo that is this tenant's own clean upload, a reason (20–500), and a second
//     administrator. Hiding "Powered by Krishalaya" needs the plan feature `white_label_unbranded` (read for real by the service).
import { brandContrast, normaliseHex, PLATFORM_BRAND_COLOURS, type ContrastReport } from '@krishalaya/tokens';

export const BRAND_NAME_MIN = 2;
export const BRAND_NAME_MAX = 80;
export const BRAND_SHORT_MAX = 12;
export const BRAND_REASON_MIN = 20;
export const BRAND_REASON_MAX = 500;
export const BRAND_REFUSE_MIN = 5;
export const BRAND_PROPOSAL_TTL_DAYS = 7;

export interface BrandColourSet { primary: string; accent: string; ink: string; surface: string }
export interface BrandDraftValues {
  displayName: string;
  appShortName: string;
  logoMediaId: string | null;
  colours: BrandColourSet;
  poweredByHidden: boolean;
}
export interface BrandDraftInput {
  displayName?: unknown; appShortName?: unknown; logoMediaId?: unknown;
  primaryColor?: unknown; accentColor?: unknown; inkColor?: unknown; surfaceColor?: unknown; poweredByHidden?: unknown;
}
export interface BrandRefusal { field: string | null; code: string; detail?: Record<string, unknown> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// a display name is shown in an <h1>, a manifest, a PDF header: printable text only — no markup, no control characters
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f<>]/;

/** The platform default draft a tenant starts from: its own name, the platform's colours, no logo, the mark shown. */
export function defaultDraft(tenantDisplayName: string): BrandDraftValues {
  const name = (tenantDisplayName ?? '').trim().slice(0, BRAND_NAME_MAX);
  return {
    displayName: name.length >= BRAND_NAME_MIN ? name : 'My organisation',
    appShortName: name.slice(0, BRAND_SHORT_MAX).trim() || 'App',
    logoMediaId: null,
    colours: { ...PLATFORM_BRAND_COLOURS },
    poweredByHidden: false,
  };
}

/**
 * Validate a draft edit against the current draft. Returns EVERY refusal against its field (W2793: "every invalid field is listed with
 * its reason") and the normalised values that would be stored. Absent fields keep the current value.
 */
export function judgeDraft(current: BrandDraftValues, input: BrandDraftInput): { values: BrandDraftValues; refusals: BrandRefusal[] } {
  const refusals: BrandRefusal[] = [];
  const v: BrandDraftValues = { ...current, colours: { ...current.colours } };
  if (input.displayName !== undefined) {
    const s = String(input.displayName ?? '').trim().replace(/\s+/g, ' ');
    if (s.length < BRAND_NAME_MIN) refusals.push({ field: 'displayName', code: 'BRAND_NAME_TOO_SHORT', detail: { min: BRAND_NAME_MIN } });
    else if (s.length > BRAND_NAME_MAX) refusals.push({ field: 'displayName', code: 'BRAND_NAME_TOO_LONG', detail: { max: BRAND_NAME_MAX } });
    else if (CONTROL.test(s)) refusals.push({ field: 'displayName', code: 'BRAND_NAME_CHARACTERS' });
    else v.displayName = s;
  }
  if (input.appShortName !== undefined) {
    const s = String(input.appShortName ?? '').trim().replace(/\s+/g, ' ');
    if (s.length < 1) refusals.push({ field: 'appShortName', code: 'BRAND_SHORT_NAME_REQUIRED' });
    else if (s.length > BRAND_SHORT_MAX) refusals.push({ field: 'appShortName', code: 'BRAND_SHORT_NAME_TOO_LONG', detail: { max: BRAND_SHORT_MAX } });
    else if (CONTROL.test(s)) refusals.push({ field: 'appShortName', code: 'BRAND_NAME_CHARACTERS' });
    else v.appShortName = s;
  }
  if (input.logoMediaId !== undefined) {
    if (input.logoMediaId === null || input.logoMediaId === '') v.logoMediaId = null;
    else if (typeof input.logoMediaId === 'string' && UUID.test(input.logoMediaId)) v.logoMediaId = input.logoMediaId.toLowerCase();
    else refusals.push({ field: 'logoMediaId', code: 'BRAND_LOGO_INVALID' });
  }
  const colourFields: Array<[keyof BrandDraftInput, keyof BrandColourSet]> = [
    ['primaryColor', 'primary'], ['accentColor', 'accent'], ['inkColor', 'ink'], ['surfaceColor', 'surface'],
  ];
  for (const [field, key] of colourFields) {
    if (input[field] === undefined) continue;
    const hex = normaliseHex(String(input[field] ?? ''));
    if (!hex) refusals.push({ field: String(field), code: 'BRAND_COLOUR_INVALID', detail: { format: '#rrggbb' } });
    else v.colours[key] = hex;
  }
  if (input.poweredByHidden !== undefined) {
    if (typeof input.poweredByHidden !== 'boolean') refusals.push({ field: 'poweredByHidden', code: 'BRAND_POWERED_BY_INVALID' });
    else v.poweredByHidden = input.poweredByHidden;
  }
  return { values: v, refusals };
}

/** The contrast law over a draft's colours (packages/tokens — the one implementation). */
export function contrastOf(colours: BrandColourSet): ContrastReport {
  return brandContrast(colours);
}

/** What the contrast law says, as refusals naming each failing pair and its ratio (brief A2). */
export function contrastRefusals(report: ContrastReport): BrandRefusal[] {
  return report.failing.map((p) => ({
    field: null, code: 'BRAND_CONTRAST_FAILED',
    detail: { pair: p.code, ratio: Number(p.ratio.toFixed(3)), display: p.display, fg: p.fg, bg: p.bg, min: 4.5 },
  }));
}

/** The before → after of a draft edit (the review's diff, and the audit's before/after). */
export function draftDiff(before: BrandDraftValues, after: BrandDraftValues): Array<{ field: string; before: unknown; after: unknown }> {
  const flat = (d: BrandDraftValues) => ({
    displayName: d.displayName, appShortName: d.appShortName, logoMediaId: d.logoMediaId,
    primaryColor: d.colours.primary, accentColor: d.colours.accent, inkColor: d.colours.ink, surfaceColor: d.colours.surface,
    poweredByHidden: d.poweredByHidden,
  });
  const a = flat(before), b = flat(after);
  return (Object.keys(a) as Array<keyof typeof a>).filter((k) => a[k] !== b[k]).map((k) => ({ field: k, before: a[k], after: b[k] }));
}

export function sameDraft(a: BrandDraftValues, b: BrandDraftValues): boolean { return draftDiff(a, b).length === 0; }

export type BrandReasonProblem = 'required' | 'too_short' | 'too_long';
export function brandReasonProblem(reason: string | null | undefined, min = BRAND_REASON_MIN): BrandReasonProblem | null {
  const s = (reason ?? '').trim();
  if (s.length === 0) return 'required';
  if (s.length < min) return 'too_short';
  if (s.length > BRAND_REASON_MAX) return 'too_long';
  return null;
}

/** The publish checks the canon draws as step 1 ("Contrast + logo checks (automatic, blocking)") plus the plan rule for the mark. */
export function publishRefusals(draft: BrandDraftValues, logo: { ready: boolean; state: string } | null, planAllowsUnbranded: boolean): BrandRefusal[] {
  const out: BrandRefusal[] = [...contrastRefusals(contrastOf(draft.colours))];
  if (!draft.logoMediaId || !logo) out.push({ field: 'logoMediaId', code: 'BRAND_LOGO_REQUIRED' });
  else if (!logo.ready) out.push({ field: 'logoMediaId', code: 'BRAND_LOGO_NOT_READY', detail: { state: logo.state } });
  if (draft.poweredByHidden && !planAllowsUnbranded) out.push({ field: 'poweredByHidden', code: 'POWERED_BY_PLAN_REQUIRED', detail: { feature: 'white_label_unbranded' } });
  return out;
}

/** The public logo URL synced into tenants.logo_url (0075's CHECK: https only). Null when the origin is not an https origin. */
export function publicLogoUrl(origin: string | null | undefined, tenantId: string, version: number): string | null {
  const o = String(origin ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)) return null;
  return `${o}/v1/storefront/branding/logo/${tenantId}/${version}`;
}
