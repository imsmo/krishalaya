// apps/web-tenant/src/features/banners/banners.ts · PC-56 TENANT-8d · THE BANNERS — the console's pure helpers for W173
// (`/content/banners`), W174 (`/content/banners/[id]`) and their chains:
//   • the FORM chain, one screen for two canon chains — banners-form W2510–W2513 (*New banner*, `/content/banners/new`)
//     and banner-form W2503–W2506 (*Add gu variant · Save changes*, W174's chain on one banner:
//     `/content/banners/[id]/edit`); four states, values in the URL, the API computes the review
//     (`cms.banners.preview`, with the reach), the key is minted on the review page and travels in the form;
//   • the banner MUTATE chain W2507–W2509 (`/content/banners/[id]/act`): activate · pause · resume · archive, each with a
//     reason. The canon's *Retry* (W174 "Couldn't save → Retry") is the form chain's own retry — PARITY-DECOR;
//   • the banners MUTATE chain W2514–W2516 (`/content/banners/slot`): the canon's only act there is *Retry* (W173's
//     "Couldn't load banners") — a page load, PARITY-DECOR; the list-level act a placement needs — the ORDER of its
//     banners — rides this chain (8c's FAQ reorder took the same shape).
//
// No React, no SDK runtime (type-only imports), so every rule a page draws is reachable by a spec.
import type { CmsBannerAct, CmsBannerActVerdict, CmsBannerPhase, CmsBannerState, CmsBannerView, CmsFaqDirection } from '@krishalaya/sdk-js';

export const BANNERS_HREF = '/content/banners';
export const NEW_BANNER_HREF = '/content/banners/new';
export const BANNER_SLOT_HREF = '/content/banners/slot';
export const BANNER_FORM = 'banner';
export const BANNER_MUTATE = 'banner';
export const BANNERS_MUTATE = 'banners';
/** The form's own fields — the API's `BANNER_FORM_FIELDS` (a spec reads both). */
export const BANNER_FIELDS = ['placement', 'mediaId', 'groupKey', 'targetUrl', 'roles', 'regions', 'startsDate', 'startsTime', 'endsDate', 'endsTime', 'reason'] as const;
export const BANNER_TEXT_PARTS = ['headline', 'body', 'cta'] as const;
/** The rows the review prints that are not form fields one-to-one (the API's BANNER_REVIEW_ROWS + derived rows). */
export const BANNER_REVIEW_ROWS = ['placement', 'mediaId', 'groupKey', 'targetUrl', 'roles', 'regions', 'startsAt', 'endsAt', 'reason', 'state', 'slot', 'timezone'] as const;
export const BANNER_PHASE_VALUES = ['live', 'scheduled', 'ended', 'draft', 'paused', 'archived'] as const;
export const BANNER_STATE_VALUES = ['draft', 'active', 'paused', 'archived'] as const;
export const BANNER_ACT_VALUES = ['activate', 'pause', 'resume', 'archive'] as const;
/** The placements 0178 seeds (`cms_banner_placement`). A placement added later prints the vocabulary's own name. */
export const PLACEMENT_VALUES = ['home_hero', 'category_top', 'wallet'] as const;
/** 0178's `banner_required_languages()`. */
export const REQUIRED_LANGUAGES = ['en', 'hi', 'gu'] as const;
/** The canon's clickables and claims this platform has no backend for — each printed by name with its reason. */
export const REFUSED_BY_NAME = [
  'impressions', 'memberReader', 'previewInApp', 'deepLink', 'minOrders', 'kyc', 'clusters', 'abAllocation', 'promotionLink', 'voiceFirst',
  'pager', 'retryPageLoad', 'retryIsResave',
] as const;
export type RefusedByName = (typeof REFUSED_BY_NAME)[number];
export function refusedKey(r: RefusedByName): string { return `banners.refused.${r}`; }

/** The words travel in the query string (the house pattern); Gujarati percent-encodes ~9 bytes a letter — 7b's ceiling. */
export const MAX_CARRIED_LENGTH_BANNER = 7_000;

/* ---------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export interface BannerFilters { phase?: string | null; placement?: string | null; languageCode?: string | null }

/** W173 with its GET-form filters; a filter change drops the cursor (a cursor belongs to one filter set). */
export function bannersHref(f: BannerFilters = {}, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.phase) q.set('phase', f.phase);
  if (f.placement) q.set('placement', f.placement);
  if (f.languageCode) q.set('languageCode', f.languageCode);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${BANNERS_HREF}?${s}` : BANNERS_HREF;
}
export function bannerHref(id: string): string { return `${BANNERS_HREF}/${encodeURIComponent(id)}`; }
export function editBannerHref(id: string): string { return `${bannerHref(id)}/edit`; }
export function bannerActHref(id: string, act: CmsBannerAct): string { return `${bannerHref(id)}/act?${new URLSearchParams({ step: 'confirm', act }).toString()}`; }
export function slotMoveHref(id: string, direction: CmsFaqDirection): string { return `${BANNER_SLOT_HREF}?${new URLSearchParams({ step: 'confirm', id, direction }).toString()}`; }
/** A chip IS a filter: the other filters kept, this one set (or cleared with null). */
export function chipHref(f: BannerFilters, key: keyof BannerFilters, value: string | null): string { return bannersHref({ ...f, [key]: value }); }

/** Which canon form chain a screen is: `banners` (New banner, W2510) or `banner` (W174's, W2503). */
export type BannerChain = 'banners' | 'banner';
export function chainPath(chain: BannerChain, id?: string | null): string { return chain === 'banner' && id ? editBannerHref(id) : NEW_BANNER_HREF; }
export function chainBackHref(chain: BannerChain, id?: string | null): string { return chain === 'banner' && id ? bannerHref(id) : BANNERS_HREF; }
export function chainTitleKey(chain: BannerChain): string { return `form.banner.title.${chain}`; }
export function chainModuleKey(chain: BannerChain): string { return `form.banner.module.${chain}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORM'S VALUES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export const textFieldName = (part: (typeof BANNER_TEXT_PARTS)[number], lang: string) => `${part}_${lang}`;
/** Every field name the form carries for these languages: its own, then three per language. */
export function bannerFieldNames(languages: readonly string[]): string[] {
  return [...BANNER_FIELDS, ...languages.flatMap((l) => BANNER_TEXT_PARTS.map((p) => textFieldName(p, l)))];
}
/** The languages the form offers: the required three always (a banner reaches no one without them), then the cooperative's own. */
export function formLanguages(offered: readonly string[]): string[] {
  const rest = [...new Set(offered.filter((l) => !(REQUIRED_LANGUAGES as readonly string[]).includes(l)))].sort();
  return [...REQUIRED_LANGUAGES, ...rest];
}
/**
 * The values out of the URL. Roles and regions are CHECKBOXES (one URL key, many values) — joined with commas, the shape
 * the API reads; every other field is its first non-blank value.
 */
export function readBannerValues(sp: Record<string, string | string[] | undefined>, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = sp[n];
    const xs = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((x) => x.trim()).filter((x) => x.length > 0);
    if (xs.length === 0) continue;
    out[n] = n === 'roles' || n === 'regions' ? [...new Set(xs.flatMap((x) => x.split(',').map((y) => y.trim()).filter(Boolean)))].join(',') : xs[0];
  }
  return out;
}
/** Is `code` in the comma list (a checkbox's checked state)? */
export function listHas(list: string | undefined, code: string): boolean { return (list ?? '').split(',').map((x) => x.trim()).includes(code); }

/** W174 → the edit chain's first values: what the banner IS now, never a reason. */
export function editValues(v: Pick<CmsBannerView, 'placement' | 'mediaId' | 'groupKey' | 'targetUrl' | 'audience' | 'startsLocal' | 'endsLocal' | 'texts'>): Record<string, string> {
  const out: Record<string, string> = {
    placement: v.placement, mediaId: v.mediaId, startsDate: v.startsLocal.date, startsTime: v.startsLocal.time, endsDate: v.endsLocal.date, endsTime: v.endsLocal.time,
  };
  if (v.groupKey) out.groupKey = v.groupKey;
  if (v.targetUrl) out.targetUrl = v.targetUrl;
  if (v.audience.roles.length) out.roles = v.audience.roles.join(',');
  if (v.audience.regions.length) out.regions = v.audience.regions.join(',');
  for (const t of v.texts) {
    out[textFieldName('headline', t.languageCode)] = t.headline;
    if (t.body) out[textFieldName('body', t.languageCode)] = t.body;
    if (t.ctaLabel) out[textFieldName('cta', t.languageCode)] = t.ctaLabel;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export type BannersPageState = 'notEnabled' | 'restricted' | 'notFound' | 'error';
/**
 * A transport failure → one of the canon's own states. The module guard answers a bare 404 when `cms` is OFF (the
 * canon's *"Flagged off — Banners disabled"*); `CMS_BANNER_NOT_FOUND` is a banner this cooperative does not have;
 * `CMS_FORBIDDEN` is *"CMS restricted"* — different sentences (the 6e-1 lesson).
 */
export function bannersTransportState(code: string | null | undefined, status?: number): BannersPageState {
  if (code === 'CMS_FORBIDDEN' || code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'CMS_BANNER_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function pageStateKey(s: BannersPageState): string { return `banners.state.${s}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export function phaseKey(p: CmsBannerPhase | string): string { return `banners.phase.${p}`; }
export function stateKey(s: CmsBannerState | string): string { return `banners.stateName.${s}`; }
export function placementKey(code: string): string { return `banners.placement.${code}`; }
export function isKnownPlacement(code: string | null | undefined): boolean { return (PLACEMENT_VALUES as readonly string[]).includes(code ?? ''); }
export function isBannerAct(s: string | null | undefined): s is CmsBannerAct { return (BANNER_ACT_VALUES as readonly string[]).includes(s ?? ''); }
export function isDirection(s: string | null | undefined): s is CmsFaqDirection { return s === 'up' || s === 'down'; }
export function actLabelKey(act: CmsBannerAct | string): string { return `banners.act.${act}`; }
export function actDoneKey(act: CmsBannerAct | string): string { return `banners.actDone.${act}`; }
export function moveLabelKey(d: CmsFaqDirection): string { return `banners.move.${d}`; }

/** W173's Languages cell: the languages it speaks (required first) and the required ones it does not — "(en missing)". */
export function languagesCell(languages: readonly string[], missing: readonly string[]): { speaks: string; missing: string | null } {
  return { speaks: languages.join(' · '), missing: missing.length ? missing.join(' · ') : null };
}
/** The headline to print for a row: the console's language if the banner speaks it, else the first required, else any. */
export function headlineFor(texts: ReadonlyArray<{ languageCode: string; headline: string }>, lang: string): { text: string; lang: string } | null {
  const pick = texts.find((t) => t.languageCode === lang) ?? REQUIRED_LANGUAGES.map((l) => texts.find((t) => t.languageCode === l)).find((t) => t !== undefined) ?? texts[0];
  return pick ? { text: pick.headline, lang: pick.languageCode } : null;
}
/** The acts a banner offers as buttons, and the ones refused with their reasons (never a 403 button). */
export function offeredActs(acts: readonly CmsBannerActVerdict[]): CmsBannerActVerdict[] { return acts.filter((a) => a.allowed); }
export function refusedActs(acts: readonly CmsBannerActVerdict[]): CmsBannerActVerdict[] { return acts.filter((a) => !a.allowed); }
export function verdictFor(acts: readonly CmsBannerActVerdict[], act: CmsBannerAct): CmsBannerActVerdict | null { return acts.find((a) => a.act === act) ?? null; }
/** W174's reach as a share: the per-cent of matched members who read a language (whole numbers; 0 when nobody matched). */
export function shareOf(n: number, of: number): number { return of > 0 ? Math.round((n * 100) / of) : 0; }
/** A window as the cooperative reads it: `2026-07-01 06:00 – 2026-07-20 22:00 (Asia/Kolkata)` parts. */
export function windowText(s: { date: string; time: string }, e: { date: string; time: string }): string { return `${s.date} ${s.time} – ${e.date} ${e.time}`; }
