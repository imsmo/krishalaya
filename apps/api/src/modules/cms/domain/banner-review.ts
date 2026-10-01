// modules/cms/domain/banner-review.ts · PC-56 TENANT-8d · THE BANNERS — the review of a banner write, the FORM chain's
// API-computed review for the two canon chains that write one: banners-form W2510–W2513 (*"New banner"*, from W173) and
// banner-form W2503–W2506 (*"Add gu variant · Save changes"*, W174's chain on one banner).
//
// A REVIEW BUILT FROM WHAT THE OPERATOR TYPED IS AN ECHO (shared/form-review.ts). This one shows what the platform WILL
// WRITE, from the facts the writer uses:
//   • the placement — a code of `cms_banner_placement` (0178, Law 6), never a free word; a pre-0178 value carried into
//     the cooperative's own vocabulary is kept on the banner that has it and never chosen for a new one;
//   • the image — F-8: the cooperative's OWN image (`MEDIA_NOT_YOURS` for another tenant's, the platform's or a missing
//     id — indistinguishable from the tenant realm, by design), an image, and CLEAN by the scanner;
//   • the words, per language (`headline_<l>`, `body_<l>`, `cta_<l>`) — plain text, bounded, a headline wherever there are
//     words, a CTA label in every language when there is a link (and no label without one); the required languages
//     the banner does not yet speak, so the review says *"cannot be activated until gu has words"* BEFORE the save;
//   • the audience — role codes and regions from the registries, the reach computed by the service (banner-audience.ts);
//   • the window — typed as the cooperative's wall-clock, resolved in SQL in the tenant's zone, the instant AND its
//     read-back printed (a wall-clock that does not exist there is refused by name);
//   • the variant group (a grouping fact — no allocation), the link (https), the place the banner takes in its slot;
//   • on an edit: the diff against the banner as it stands, `NOTHING_CHANGED`, and — for an ACTIVE banner — that the
//     change reaches members at once and may not drop a required language.
import { ReviewField, ReviewRefusal, ReviewResult, WriterIssue, WRITER_REFUSALS, field, reviewResult, trimOrNull, writerRefusals, looksLikeId } from '../../../shared/form-review';
import { BannerState, isEditable } from './banner.state';
import { AudienceRule, EVERYONE, RegionFact, audienceIssues, audienceRule, isEveryone } from './banner-audience';
import {
  AUDIENCE_LIST_MAX, BODY_MAX, BannerText, CTA_MAX, HEADLINE_MAX, REQUIRED_LANGUAGES, groupKeyIssue, hasMarkup, missingLanguages, normaliseGroupKey, normaliseText, orderedLanguages,
  parseList, parseTargetUrl, reasonIssue,
} from './banner-rules';
import { BannerPhase, ResolvedInstant, bannerPhase, wallClock, windowRefusals } from './banner-window';
import { SlotEntry, nextSlotPlace } from './banner-slot';

/** The form's own fields (the text fields `headline_<l>` · `body_<l>` · `cta_<l>` are per language, below). */
export const BANNER_FORM_FIELDS = ['placement', 'mediaId', 'groupKey', 'targetUrl', 'roles', 'regions', 'startsDate', 'startsTime', 'endsDate', 'endsTime', 'reason'] as const;
export type BannerFormField = (typeof BANNER_FORM_FIELDS)[number];
export const BANNER_TEXT_PARTS = ['headline', 'body', 'cta'] as const;
export type BannerTextPart = (typeof BANNER_TEXT_PARTS)[number];
/** Rows the review prints that are not form fields one-to-one. */
export const BANNER_REVIEW_ROWS = ['placement', 'mediaId', 'groupKey', 'targetUrl', 'roles', 'regions', 'startsAt', 'endsAt', 'reason'] as const;
export const BANNER_DERIVED_ROWS = ['state', 'slot', 'timezone'] as const;
export const textField = (part: BannerTextPart, lang: string) => `${part}_${lang}`;
export const TEXT_FIELD_RE = /^(headline|body|cta)_([a-z]{2,3})$/;

export const BANNER_INTENTS = ['new', 'edit'] as const;
export type BannerIntent = (typeof BANNER_INTENTS)[number];

export const BANNER_REVIEW_REFUSALS = [
  'NO_PERMISSION', 'NOTHING_CHANGED', 'STATE_ARCHIVED', 'LANGUAGE_NOT_OFFERED', 'TEXT_REQUIRED',
  'PLACEMENT_REQUIRED', 'PLACEMENT_UNKNOWN', 'PLACEMENT_RETIRED',
  'MEDIA_REQUIRED', 'MEDIA_INVALID', 'MEDIA_NOT_YOURS', 'MEDIA_NOT_IMAGE', 'MEDIA_NOT_CLEAN',
  'GROUP_KEY_INVALID', 'GROUP_KEY_TOO_LONG',
  'TARGET_NOT_HTTPS', 'TARGET_INVALID', 'TARGET_TOO_LONG',
  'ROLE_UNKNOWN', 'REGION_UNKNOWN', 'AUDIENCE_TOO_MANY',
  'STARTS_INVALID', 'ENDS_INVALID', 'STARTS_NOT_ON_CLOCK', 'ENDS_NOT_ON_CLOCK', 'WINDOW_ORDER', 'WINDOW_ENDED',
  'HEADLINE_MISSING', 'TEXT_HAS_MARKUP', 'TEXT_TOO_LONG', 'CTA_REQUIRED', 'CTA_WITHOUT_TARGET', 'TEXT_REQUIRED_WHILE_ACTIVE',
  'REASON_REQUIRED', 'REASON_TOO_LONG', ...WRITER_REFUSALS,
] as const;
export type BannerReviewRefusal = (typeof BANNER_REVIEW_REFUSALS)[number];

/** The banner as it stands, for an edit. */
export interface CurrentBanner {
  id: string; state: BannerState; placement: string; mediaId: string; groupKey: string | null; targetUrl: string | null; audience: AudienceRule;
  startsAt: Date; endsAt: Date; texts: BannerText[]; slotOrder: number; version: string;
}

export interface BannerReviewInput {
  canManage: boolean;
  intent: BannerIntent;
  entered: Readonly<Record<string, string | undefined>>;
  /** The languages the form offers: the required three and the cooperative's own. */
  languages: readonly string[];
  /** Language keys the form carried that it does not offer. */
  strayLanguages: readonly string[];
  placements: ReadonlyArray<{ code: string; chosen: boolean }>;
  /** 0178's `banner_media_issue()` for the entered id (null = clean, the tenant's, an image); undefined = not asked. */
  mediaIssue: string | null | undefined;
  knownRoles: readonly string[];
  regions: readonly RegionFact[];
  startsAt: ResolvedInstant | null; endsAt: ResolvedInstant | null; timezone: string | null; now: Date;
  current: CurrentBanner | null;
  /** The non-archived banners of the placement it will stand in (itself excluded). */
  slot: readonly SlotEntry[];
  writerIssues: readonly WriterIssue[];
}

export interface BannerPreview {
  mode: 'create' | 'update' | null;
  bannerId: string | null;
  state: BannerState;
  phaseAfter: BannerPhase | null;
  placement: string | null;
  slotPlace: number | null;
  placementChanged: boolean;
  timezone: string | null;
  startsAt: Date | null; endsAt: Date | null;
  texts: BannerText[];
  missingLanguages: string[];
  /** After this write, could the banner be activated (or stay active)? The words and the image are the review's to know. */
  activatable: boolean;
  /** An ACTIVE banner's change reaches members as soon as it is saved. */
  liveNow: boolean;
  audience: AudienceRule; everyone: boolean;
  groupKey: string | null;
  targetUrl: string | null;
  /** The edit's concurrency token, carried back by the form (a colleague who saved first → 409). */
  expect: string | null;
}
export interface BannerReview extends ReviewResult { preview: BannerPreview }

const isoWall = (r: ResolvedInstant | null) => (r ? `${r.localDate} ${r.localTime}` : null);

/** The texts as the writer stores them, from the entered fields, for the offered languages. */
export function storedTexts(entered: Readonly<Record<string, string | undefined>>, languages: readonly string[]): BannerText[] {
  const out: BannerText[] = [];
  for (const l of orderedLanguages(languages)) {
    const headline = normaliseText(entered[textField('headline', l)]);
    const body = normaliseText(entered[textField('body', l)]);
    const ctaLabel = normaliseText(entered[textField('cta', l)]);
    if (headline !== null) out.push({ languageCode: l, headline, body, ctaLabel });
  }
  return out;
}

/** The languages carried in the form (any part non-empty). */
export function enteredLanguages(entered: Readonly<Record<string, string | undefined>>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(entered)) {
    const m = TEXT_FIELD_RE.exec(k);
    if (m && trimOrNull(v ?? null) !== null && !out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

export function reviewBanner(i: BannerReviewInput): BannerReview {
  const e = i.entered;
  const refusals: ReviewRefusal[] = [];
  const fields: ReviewField[] = [];
  const cur = i.current;
  const editing = i.intent === 'edit';

  if (!i.canManage) refusals.push({ field: null, code: 'NO_PERMISSION' });
  if (editing && cur && !isEditable(cur.state)) refusals.push({ field: null, code: 'STATE_ARCHIVED' });
  if (i.strayLanguages.length > 0) refusals.push({ field: null, code: 'LANGUAGE_NOT_OFFERED' });

  // ---- placement (Law 6) ----
  const placement = trimOrNull(e.placement ?? null);
  fields.push(field('placement', e.placement ?? null, placement));
  const known = placement === null ? undefined : i.placements.find((p) => p.code === placement);
  if (placement === null) refusals.push({ field: 'placement', code: 'PLACEMENT_REQUIRED' });
  else if (!known) refusals.push({ field: 'placement', code: 'PLACEMENT_UNKNOWN' });
  else if (!known.chosen && !(cur && cur.placement === placement)) refusals.push({ field: 'placement', code: 'PLACEMENT_RETIRED' });

  // ---- the image (F-8) ----
  const mediaId = trimOrNull(e.mediaId ?? null);
  const mediaStored = mediaId !== null && looksLikeId(mediaId) ? mediaId.toLowerCase() : null;
  fields.push(field('mediaId', e.mediaId ?? null, mediaStored));
  if (mediaId === null) refusals.push({ field: 'mediaId', code: 'MEDIA_REQUIRED' });
  else if (mediaStored === null) refusals.push({ field: 'mediaId', code: 'MEDIA_INVALID' });
  else if (i.mediaIssue === 'MEDIA_NOT_YOURS' || i.mediaIssue === 'MEDIA_NOT_IMAGE' || i.mediaIssue === 'MEDIA_NOT_CLEAN') refusals.push({ field: 'mediaId', code: i.mediaIssue });
  else if (i.mediaIssue !== null) refusals.push({ field: 'mediaId', code: 'MEDIA_NOT_YOURS' });

  // ---- the variant group (a grouping fact) ----
  const groupKey = normaliseGroupKey(e.groupKey);
  fields.push(field('groupKey', e.groupKey ?? null, groupKey));
  const gi = groupKeyIssue(groupKey);
  if (gi !== null) refusals.push({ field: 'groupKey', code: gi });

  // ---- the link ----
  const target = parseTargetUrl(e.targetUrl);
  fields.push(field('targetUrl', e.targetUrl ?? null, target.url));
  if (target.issue !== null) refusals.push({ field: 'targetUrl', code: target.issue });

  // ---- the audience (the registries) ----
  const audience = audienceRule(parseList(e.roles), parseList(e.regions));
  fields.push(field('roles', e.roles ?? null, audience.roles.length ? audience.roles.join(', ') : null));
  fields.push(field('regions', e.regions ?? null, audience.regions.length ? audience.regions.join(', ') : null));
  for (const a of audienceIssues(audience, i.knownRoles, i.regions)) {
    refusals.push({ field: a.code === 'REGION_UNKNOWN' ? 'regions' : a.code === 'ROLE_UNKNOWN' ? 'roles' : audience.roles.length > AUDIENCE_LIST_MAX ? 'roles' : 'regions', code: a.code });
  }

  // ---- the window, in the tenant's zone ----
  const starts = wallClock(e.startsDate, e.startsTime);
  const ends = wallClock(e.endsDate, e.endsTime);
  const enteredStart = [trimOrNull(e.startsDate ?? null), trimOrNull(e.startsTime ?? null)].filter(Boolean).join(' ') || null;
  const enteredEnd = [trimOrNull(e.endsDate ?? null), trimOrNull(e.endsTime ?? null)].filter(Boolean).join(' ') || null;
  fields.push(field('startsAt', enteredStart, isoWall(starts ? i.startsAt : null)));
  fields.push(field('endsAt', enteredEnd, isoWall(ends ? i.endsAt : null)));
  const windowMoved = !cur || !i.startsAt || !i.endsAt || i.startsAt.at.getTime() !== cur.startsAt.getTime() || i.endsAt.at.getTime() !== cur.endsAt.getTime();
  for (const w of windowRefusals({ starts, ends, startsAt: starts ? i.startsAt : null, endsAt: ends ? i.endsAt : null, now: i.now, requireOpen: windowMoved })) {
    refusals.push({ field: w.field, code: w.code });
  }

  // ---- the words, per language ----
  const offered = orderedLanguages([...REQUIRED_LANGUAGES, ...i.languages]);
  const texts = storedTexts(e, offered);
  const shownLanguages = offered.filter((l) => (REQUIRED_LANGUAGES as readonly string[]).includes(l) || BANNER_TEXT_PARTS.some((p) => trimOrNull(e[textField(p, l)] ?? null) !== null) || (cur?.texts.some((t) => t.languageCode === l) ?? false));
  for (const l of shownLanguages) {
    const h = normaliseText(e[textField('headline', l)]);
    const b = normaliseText(e[textField('body', l)]);
    const c = normaliseText(e[textField('cta', l)]);
    fields.push(field(textField('headline', l), e[textField('headline', l)] ?? null, h));
    fields.push(field(textField('body', l), e[textField('body', l)] ?? null, h === null ? null : b));
    fields.push(field(textField('cta', l), e[textField('cta', l)] ?? null, h === null ? null : c));
    const parts: Array<[BannerTextPart, string | null, number]> = [['headline', h, HEADLINE_MAX], ['body', b, BODY_MAX], ['cta', c, CTA_MAX]];
    for (const [p, v, max] of parts) {
      if (hasMarkup(v)) refusals.push({ field: textField(p, l), code: 'TEXT_HAS_MARKUP' });
      else if (v !== null && v.length > max) refusals.push({ field: textField(p, l), code: 'TEXT_TOO_LONG' });
    }
    if (h === null && (b !== null || c !== null)) refusals.push({ field: textField('headline', l), code: 'HEADLINE_MISSING' });
    if (h !== null && target.url !== null && c === null) refusals.push({ field: textField('cta', l), code: 'CTA_REQUIRED' });
    if (c !== null && target.url === null && target.issue === null) refusals.push({ field: textField('cta', l), code: 'CTA_WITHOUT_TARGET' });
    if (h === null && cur?.state === 'active' && (REQUIRED_LANGUAGES as readonly string[]).includes(l)) refusals.push({ field: textField('headline', l), code: 'TEXT_REQUIRED_WHILE_ACTIVE' });
  }
  if (texts.length === 0) refusals.push({ field: null, code: 'TEXT_REQUIRED' });
  const missing = missingLanguages(texts.map((t) => t.languageCode));

  // ---- the reason (the audit row's sentence) ----
  fields.push(field('reason', e.reason ?? null, trimOrNull(e.reason ?? null)));
  const ri = reasonIssue(e.reason);
  if (ri !== null) refusals.push({ field: 'reason', code: ri });

  // ---- the writer's belt ----
  const rows = fields.map((f) => f.name);
  refusals.push(...writerRefusals(i.writerIssues, rows, refusals));

  // ---- derived rows: the state it will have, its place in the slot, the zone the window was read in ----
  const state: BannerState = cur?.state ?? 'draft';
  const placementChanged = !!cur && placement !== null && placement !== cur.placement;
  const slotPlace = placement === null ? null : cur && !placementChanged ? cur.slotOrder : nextSlotPlace(i.slot);
  fields.push(field('state', null, state));
  fields.push(field('slot', null, slotPlace === null ? null : String(slotPlace)));
  fields.push(field('timezone', null, i.timezone));

  // ---- the diff, where applicable (an edit) ----
  let diff: ReviewResult['diff'] = null;
  if (cur) {
    diff = [];
    const row = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    row('placement', cur.placement, placement);
    row('mediaId', cur.mediaId, mediaStored);
    row('groupKey', cur.groupKey, groupKey);
    row('targetUrl', cur.targetUrl, target.url);
    row('roles', cur.audience.roles.join(', ') || null, audience.roles.join(', ') || null);
    row('regions', cur.audience.regions.join(', ') || null, audience.regions.join(', ') || null);
    row('startsAt', cur.startsAt.toISOString(), i.startsAt && starts ? i.startsAt.at.toISOString() : null);
    row('endsAt', cur.endsAt.toISOString(), i.endsAt && ends ? i.endsAt.at.toISOString() : null);
    const langs = orderedLanguages([...new Set([...cur.texts.map((t) => t.languageCode), ...texts.map((t) => t.languageCode)])]);
    for (const l of langs) {
      const was = cur.texts.find((t) => t.languageCode === l) ?? null;
      const now = texts.find((t) => t.languageCode === l) ?? null;
      row(textField('headline', l), was?.headline ?? null, now?.headline ?? null);
      row(textField('body', l), was?.body ?? null, now?.body ?? null);
      row(textField('cta', l), was?.ctaLabel ?? null, now?.ctaLabel ?? null);
    }
    if (diff.length === 0) refusals.push({ field: null, code: 'NOTHING_CHANGED' });
  }

  const result = reviewResult('banner', fields, refusals, diff);
  const mediaOk = i.mediaIssue === null && mediaStored !== null;
  return {
    ...result,
    preview: {
      mode: editing ? (cur ? 'update' : null) : 'create',
      bannerId: cur?.id ?? null,
      state,
      phaseAfter: i.startsAt && i.endsAt ? bannerPhase(state, i.startsAt.at, i.endsAt.at, i.now) : null,
      placement, slotPlace, placementChanged,
      timezone: i.timezone,
      startsAt: i.startsAt && starts ? i.startsAt.at : null, endsAt: i.endsAt && ends ? i.endsAt.at : null,
      texts, missingLanguages: missing,
      activatable: missing.length === 0 && mediaOk,
      liveNow: cur?.state === 'active',
      audience: isEveryone(audience) ? EVERYONE : audience, everyone: isEveryone(audience),
      groupKey, targetUrl: target.url,
      expect: cur ? cur.version : null,
    },
  };
}
