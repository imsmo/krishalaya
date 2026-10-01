// apps/web-tenant/src/features/pages/pages.ts · PC-56 TENANT-8c · THE PAGES — the console's pure helpers for W175
// (`/content/pages`), W176 (`/content/pages/[slug]`), W177 (`/content/faq`) and their chains:
//   • the FORM chain, one screen for three canon chains — pages-form W2703–W2706 (*New page*, `/content/pages/new`),
//     page-form W2696–W2699 (*Choose kind*, the editor's chain on a slug: `/content/pages/[slug]/edit`) and faq-form
//     W2605–W2608 (*New FAQ entry · New entry*, `/content/faq/new`); four states, values in the URL, the API computes the
//     review (`cms.pages.preview`), the key is minted on the review page and travels in the form;
//   • the page MUTATE chain W2700–W2702 (`/content/pages/[slug]/act`): publish · archive · restore. *Retry now* is the
//     form chain's own retry (a re-save), not an act — PARITY-DECOR;
//   • the FAQ MUTATE chain W2609–W2611 (`/content/faq/act`): the reorder act (move up / down in its topic). Its canon act
//     *Retry* is a page load — PARITY-DECOR;
//   • the pages-mutate chain W2707–W2709 hosts *Retry · help_article* — a re-read and a FILTER CHIP the flow-map captured
//     as acts: neither is a state change, so it has NO route (PARITY-DECOR, the 6a ruling); the chip is W175's kind filter.
//
// No React, no SDK runtime (type-only imports), so every rule a page draws is reachable by a spec.
import type { CmsFaqDirection, CmsPageAct, CmsPageActVerdict, CmsPageKind, CmsServing, CmsSlugState, CmsSlugView, CmsVersionView } from '@krishalaya/sdk-js';

export const PAGES_HREF = '/content/pages';
export const NEW_PAGE_HREF = '/content/pages/new';
export const FAQ_HREF = '/content/faq';
export const NEW_FAQ_HREF = '/content/faq/new';
export const FAQ_ACT_HREF = '/content/faq/act';
export const PAGE_FORM = 'page';
export const PAGE_MUTATE = 'page';
export const FAQ_MUTATE = 'faq';
export const PAGE_FIELDS = ['slug', 'pageKind', 'defaultTitle', 'body', 'languageCode', 'topic', 'reason'] as const;
export const PAGE_KIND_VALUES = ['static', 'policy', 'faq', 'help_article'] as const;
export const SLUG_STATE_VALUES = ['published', 'draft', 'archived', 'platform'] as const;
export const SERVING_VALUES = ['own', 'platform', 'none'] as const;
export const PAGE_ACT_VALUES = ['publish', 'archive', 'restore'] as const;
export const PAGE_MUTATE_FIELDS = ['act', 'reason', 'archiveReason'] as const;
export const FAQ_MUTATE_FIELDS = ['slug', 'direction', 'reason'] as const;
/** The FAQ topics 0177 seeds (`cms_faq_topic`). A topic added later prints the vocabulary's own name. */
export const FAQ_TOPIC_VALUES = ['payments', 'orders', 'listing', 'dairy', 'delivery', 'membership', 'schemes', 'account', 'general'] as const;
/** The archive reasons 0177 seeds (`cms_page_archive_reason`), the two platform-only codes included (they print on history). */
export const ARCHIVE_REASON_VALUES = ['outdated', 'replaced', 'withdrawn', 'legal_review', 'duplicate', 'draft_abandoned', 'superseded', 'unrecorded'] as const;
/** The canon's clickables this platform has no backend for, each printed by name with its reason. */
export const REFUSED_BY_NAME = [
  'translations', 'aiDraft', 'voiceToDraft', 'previewInApp', 'memberReader', 'archiveWhileOrders', 'views', 'deflection', 'selfServe', 'topGap',
  'voicePlayback', 'financeRead', 'englishGloss', 'unpublish', 'keptLocally', 'retryPageLoad', 'chipIsFilter', 'pager',
] as const;
export type RefusedByName = (typeof REFUSED_BY_NAME)[number];
export function refusedKey(r: RefusedByName): string { return `pages.refused.${r}`; }

/** The body travels in the query string (the house pattern); 7b's ceiling for long text. */
export const MAX_CARRIED_LENGTH_PAGE = 7_000;

/* ---------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export interface PageFilters { pageKind?: string | null; state?: string | null; languageCode?: string | null }

/** W175 with its GET-form filters; a filter change drops the cursor (a cursor belongs to one filter set). */
export function pagesHref(f: PageFilters = {}, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.pageKind) q.set('pageKind', f.pageKind);
  if (f.state) q.set('state', f.state);
  if (f.languageCode) q.set('languageCode', f.languageCode);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${PAGES_HREF}?${s}` : PAGES_HREF;
}
export function pageHref(slug: string): string { return `${PAGES_HREF}/${encodeURIComponent(slug)}`; }
/** The page-form chain (W2696): the editor's write on a slug — its open draft, else its next version. */
export function editPageHref(slug: string): string { return `${pageHref(slug)}/edit`; }
export function pageActHref(slug: string, versionId: string, act: CmsPageAct): string {
  const q = new URLSearchParams({ step: 'confirm', act, id: versionId });
  return `${pageHref(slug)}/act?${q.toString()}`;
}
/** The pages-form chain (W2703), optionally aimed at a platform slug (writing your own version of a platform page). */
export function newPageHref(slug?: string | null, pageKind?: string | null): string {
  const q = new URLSearchParams();
  if (slug) q.set('slug', slug);
  if (pageKind) q.set('pageKind', pageKind);
  const s = q.toString();
  return s ? `${NEW_PAGE_HREF}?${s}` : NEW_PAGE_HREF;
}
export function faqHref(f: { topic?: string | null; state?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (f.topic) q.set('topic', f.topic);
  if (f.state) q.set('state', f.state);
  const s = q.toString();
  return s ? `${FAQ_HREF}?${s}` : FAQ_HREF;
}
export function faqMoveHref(slug: string, direction: CmsFaqDirection): string {
  return `${FAQ_ACT_HREF}?${new URLSearchParams({ step: 'confirm', slug, direction }).toString()}`;
}

/** Which canon form chain a screen is: `pages` (New page), `page` (the editor's), `faq` (New FAQ entry). */
export type PageChain = 'pages' | 'page' | 'faq';
export function chainIntent(chain: PageChain): 'new' | 'version' { return chain === 'page' ? 'version' : 'new'; }
export function chainPath(chain: PageChain, slug?: string | null): string {
  if (chain === 'faq') return NEW_FAQ_HREF;
  if (chain === 'page' && slug) return editPageHref(slug);
  return NEW_PAGE_HREF;
}
export function chainBackHref(chain: PageChain, slug?: string | null): string {
  if (chain === 'faq') return FAQ_HREF;
  if (chain === 'page' && slug) return pageHref(slug);
  return PAGES_HREF;
}
export function chainTitleKey(chain: PageChain): string { return `form.page.title.${chain}`; }
export function chainModuleKey(chain: PageChain): string { return `form.page.module.${chain}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export type PagesPageState = 'notEnabled' | 'restricted' | 'notFound' | 'error';

/**
 * A transport failure → one of the canon's own states. The module guard answers a bare 404 when `cms` is OFF (the
 * canon's *"Flagged off"*); `CMS_PAGE_NOT_FOUND` is a slug this tenant has no version of and the platform none either;
 * `CMS_FORBIDDEN` is *"Pages restricted"* (neither verb) — different sentences (the 6e-1 lesson).
 */
export function pagesTransportState(code: string | null | undefined, status?: number): PagesPageState {
  if (code === 'CMS_FORBIDDEN' || code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'CMS_PAGE_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function pageStateKey(s: PagesPageState): string { return `pages.state.${s}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export function kindKey(k: CmsPageKind | string): string { return `pages.kind.${k}`; }
export function slugStateKey(s: CmsSlugState | string): string { return `pages.slugState.${s}`; }
export function statusKey(s: string): string { return `pages.status.${s}`; }
export function archiveReasonKey(code: string): string { return `pages.archiveReason.${code}`; }
export function isKnownArchiveReason(code: string | null | undefined): boolean { return (ARCHIVE_REASON_VALUES as readonly string[]).includes(code ?? ''); }
export function topicKey(code: string): string { return `pages.topic.${code}`; }
export function isKnownTopic(code: string | null | undefined): boolean { return (FAQ_TOPIC_VALUES as readonly string[]).includes(code ?? ''); }

/** W175's serving column, as a key and its version: yours vN · the platform's vN · nothing (a 404 to a member). */
export function servingKey(s: CmsServing): string { return `pages.serving.${s.source}`; }

/** A kind chip's GET href: the chip IS the filter (W2707's *help_article* "act" is this link). */
export function kindChipHref(f: PageFilters, kind: string | null): string { return pagesHref({ ...f, pageKind: kind }); }

/* ---------------------------------------------------------------------------------------------------------- */
/* THE EDITOR (W176)                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

/**
 * The editor's first values for the page-form chain: the open draft's words if one waits, else the latest version's —
 * you edit a copy that becomes the next version, never the published row. The reason is never pre-filled (6d-5).
 */
export function editValues(v: Pick<CmsSlugView, 'slug' | 'draft' | 'latest' | 'platform'>): Record<string, string> {
  const src: Pick<CmsVersionView, 'pageKind' | 'defaultTitle' | 'body' | 'languageCode' | 'topic'> | null = v.draft ?? v.latest ?? null;
  const out: Record<string, string> = { slug: v.slug };
  if (src) {
    out.pageKind = src.pageKind; out.defaultTitle = src.defaultTitle; out.body = src.body;
    if (src.languageCode) out.languageCode = src.languageCode;
    if (src.topic) out.topic = src.topic;
  } else if (v.platform) {
    out.pageKind = v.platform.pageKind; out.defaultTitle = v.platform.defaultTitle; out.body = v.platform.body;
  }
  return out;
}

/** W176's head line: *"publishing creates v3, v2 stays in history"* — computed, from the versions. */
export function nextPublishFacts(v: Pick<CmsSlugView, 'draft' | 'live' | 'latest'>): { publishes: number | null; staysInHistory: number | null; nextVersion: number } {
  return { publishes: v.draft?.version ?? null, staysInHistory: v.draft && v.live ? v.live.version : null, nextVersion: (v.latest?.version ?? 0) + 1 };
}

/** The acts a version offers as buttons, and the ones refused with their first reason (never a 403 button). */
export function offeredActs(acts: readonly CmsPageActVerdict[]): CmsPageActVerdict[] { return acts.filter((a) => a.allowed); }
export function refusedActs(acts: readonly CmsPageActVerdict[]): CmsPageActVerdict[] { return acts.filter((a) => !a.allowed); }
export function verdictFor(acts: readonly CmsPageActVerdict[], act: CmsPageAct): CmsPageActVerdict | null { return acts.find((a) => a.act === act) ?? null; }
export function isPageAct(s: string | null | undefined): s is CmsPageAct { return (PAGE_ACT_VALUES as readonly string[]).includes(s ?? ''); }
export function actLabelKey(act: CmsPageAct | string): string { return `pages.act.${act}`; }
export function actDoneKey(act: CmsPageAct | string): string { return `pages.actDone.${act}`; }

/** The languages a page is NOT written in that this tenant speaks — the translations panel's rows, each refused. */
export function untranslatedLanguages(tenantLanguages: readonly string[], source: string | null): string[] {
  return tenantLanguages.filter((l) => l !== source);
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FAQ (W177)                                                                                             */
/* ---------------------------------------------------------------------------------------------------------- */

export function isDirection(s: string | null | undefined): s is CmsFaqDirection { return s === 'up' || s === 'down'; }
export function moveLabelKey(d: CmsFaqDirection): string { return `faq.move.${d}`; }

/** W177's entries grouped by topic, in the order the API returned them (topic order, then place). */
export function groupByTopic<T extends { topic: string | null }>(items: readonly T[]): Array<{ topic: string; items: T[] }> {
  const out: Array<{ topic: string; items: T[] }> = [];
  for (const it of items) {
    const k = it.topic ?? 'general';
    const g = out.find((x) => x.topic === k);
    if (g) g.items.push(it); else out.push({ topic: k, items: [it] });
  }
  return out;
}
