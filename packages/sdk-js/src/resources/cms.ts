// @krishalaya/sdk-js · cms resource — PC-56 TENANT-8c · THE PAGES, PC-56 TENANT-8d · THE BANNERS. Every route of `cms/pages` and `cms/faq` has its
// method (F-14: before this wave not one did, so nothing could reach the plane). Gated server-side by the `cms` flag (a
// disabled flag answers 404). Writes take the FORM's Idempotency-Key (Law 3) — minted when the review / confirm step
// rendered, carried in the form, so a double-submit is one write. A refusal is an SdkError carrying the review's codes.
//
// THERE IS NO READER: `pages.bySlug` is what a member WOULD be served; no storefront or mobile code calls it yet.
import { HttpClient } from '../http';
import {
  CmsBannerAct, CmsBannerActResult, CmsBannerActs, CmsBannerFormInput, CmsBannerIndex, CmsBannerIndexItem, CmsBannerQuery, CmsBannerReview, CmsBannerSlotPreview,
  CmsBannerSlotResult, CmsBannerView, CmsBannerVocabulary, CmsBannerWriteResult, CmsLiveBanners,
  CmsFaqDirection, CmsFaqIndex, CmsFaqMovePreview, CmsFaqMoveResult, CmsPage, CmsPageAct, CmsPageActResult, CmsPageActs, CmsPageFormInput,
  CmsPageIndex, CmsPageIndexItem, CmsPageQuery, CmsPageReview, CmsPageWriteResult, CmsSlugView, CmsVocabulary,
} from '../types';

const seg = (s: string) => encodeURIComponent(s);

export class CmsPagesApi {
  constructor(private readonly http: HttpClient) {}
  /** W175 · one row per slug, keyset on the slug; the chips' live counts, your verbs and the reader fact ride in meta. */
  async list(q: CmsPageQuery = {}, signal?: AbortSignal): Promise<CmsPageIndex> {
    const r = await this.http.request<CmsPageIndexItem[]>('GET', 'cms/pages', { query: { pageKind: q.pageKind, state: q.state, languageCode: q.languageCode, cursor: q.cursor, limit: q.limit ?? 50 }, signal });
    const m = (r.meta ?? {}) as Partial<CmsPageIndex>;
    return { items: r.data, nextCursor: m.nextCursor ?? null, counts: m.counts ?? { byKind: {}, byState: {}, slugs: 0, platformOnly: 0 }, canAuthor: m.canAuthor ?? false, canPublish: m.canPublish ?? false, reader: m.reader ?? { surfaces: [], route: '', gap: [] } };
  }
  /** The form's choices: kinds · FAQ topics · archive reasons · the languages you write in. */
  async vocabulary(signal?: AbortSignal): Promise<CmsVocabulary> { return (await this.http.request<CmsVocabulary>('GET', 'cms/pages/vocabulary', { signal })).data; }
  /** W176 · a slug: every version (with names), what serves, the acts each version has. */
  async view(slug: string, signal?: AbortSignal): Promise<CmsSlugView> { return (await this.http.request<CmsSlugView>('GET', `cms/pages/slug/${seg(slug)}`, { signal })).data; }
  /** One version by id. */
  async get(id: string, signal?: AbortSignal): Promise<CmsPage> { return (await this.http.request<CmsPage>('GET', `cms/pages/${seg(id)}`, { signal })).data; }
  /** The live page a member would be served — your own published version, else the platform's (F-14). */
  async bySlug(slug: string, signal?: AbortSignal): Promise<CmsPage> { return (await this.http.request<CmsPage>('GET', `cms/pages/by-slug/${seg(slug)}`, { signal })).data; }
  /** The form's review, computed by the API (writes nothing — no key). */
  async preview(input: CmsPageFormInput): Promise<CmsPageReview> { return (await this.http.request<CmsPageReview>('POST', 'cms/pages/preview', { body: input })).data; }
  /** The form's write: a new page, a new version, or the open draft — whichever the review computed. Keyed. */
  async create(input: CmsPageFormInput, idempotencyKey: string): Promise<CmsPageWriteResult> {
    return (await this.http.request<CmsPageWriteResult>('POST', 'cms/pages', { body: input, idempotencyKey })).data;
  }
  /** The form's write aimed at ONE draft — 409 CMS_PAGE_CHANGED when it is no longer the slug's open draft. Keyed. */
  async update(id: string, input: CmsPageFormInput, idempotencyKey: string): Promise<CmsPageWriteResult> {
    return (await this.http.request<CmsPageWriteResult>('PATCH', `cms/pages/${seg(id)}`, { body: input, idempotencyKey })).data;
  }
  /** The confirm step: the version, the verdicts (judging the reason / archive reason as typed), what serves after. */
  async acts(id: string, typed: { reason?: string; archiveReason?: string } = {}, signal?: AbortSignal): Promise<CmsPageActs> {
    return (await this.http.request<CmsPageActs>('GET', `cms/pages/${seg(id)}/acts`, { query: { reason: typed.reason, archiveReason: typed.archiveReason }, signal })).data;
  }
  /** Publish a draft (a POLICY page: never by its author or last editor). Keyed, a reason. */
  async publish(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsPageActResult> { return this.act(id, 'publish', body, idempotencyKey); }
  /** Archive a version — a reason AND an archive reason from the vocabulary. Keyed. */
  async archive(id: string, body: { reason: string; archiveReason: string }, idempotencyKey: string): Promise<CmsPageActResult> { return this.act(id, 'archive', body, idempotencyKey); }
  /** Restore an archived version as the NEXT draft (history untouched). Keyed, a reason. */
  async restore(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsPageActResult> { return this.act(id, 'restore', body, idempotencyKey); }
  /** Any of the three acts by name (the mutate chain posts this). */
  async act(id: string, act: CmsPageAct, body: { reason: string; archiveReason?: string }, idempotencyKey: string): Promise<CmsPageActResult> {
    return (await this.http.request<CmsPageActResult>('POST', `cms/pages/${seg(id)}/${act}`, { body, idempotencyKey })).data;
  }
}

/** W177 · an FAQ entry IS a page (`page_kind = faq`): get / create / update / publish go through `cms/pages` with the kind
 *  fixed; the list and the order inside a topic are the FAQ's own routes. */
export class CmsFaqApi {
  constructor(private readonly http: HttpClient, private readonly pages: CmsPagesApi) {}
  async list(q: { topic?: string; state?: string } = {}, signal?: AbortSignal): Promise<CmsFaqIndex> {
    const r = await this.http.request<CmsFaqIndex['items']>('GET', 'cms/faq', { query: { topic: q.topic, state: q.state }, signal });
    const m = (r.meta ?? {}) as Omit<CmsFaqIndex, 'items'>;
    return { ...m, items: r.data };
  }
  async get(slug: string, signal?: AbortSignal): Promise<CmsSlugView> { return this.pages.view(slug, signal); }
  async create(input: Omit<CmsPageFormInput, 'pageKind'>, idempotencyKey: string): Promise<CmsPageWriteResult> {
    return this.pages.create({ ...input, pageKind: 'faq', intent: input.intent ?? 'new' }, idempotencyKey);
  }
  async update(id: string, input: Omit<CmsPageFormInput, 'pageKind'>, idempotencyKey: string): Promise<CmsPageWriteResult> {
    return this.pages.update(id, { ...input, pageKind: 'faq', intent: 'version' }, idempotencyKey);
  }
  async publish(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsPageActResult> { return this.pages.publish(id, body, idempotencyKey); }
  /** The reorder confirm step: the verdict (judging the reason as typed) and the topic's order. */
  async reorderPreview(slug: string, direction: CmsFaqDirection, reason?: string, signal?: AbortSignal): Promise<CmsFaqMovePreview> {
    return (await this.http.request<CmsFaqMovePreview>('GET', 'cms/faq/reorder', { query: { slug, direction, reason }, signal })).data;
  }
  /** Move one entry one place inside its topic. Keyed, a reason, audited. */
  async reorder(body: { slug: string; direction: CmsFaqDirection; reason: string }, idempotencyKey: string): Promise<CmsFaqMoveResult> {
    return (await this.http.request<CmsFaqMoveResult>('POST', 'cms/faq/reorder', { body, idempotencyKey })).data;
  }
}

/**
 * PC-56 TENANT-8d · W173 / W174 · `cms/banners`. Every route has its method. The words are per language
 * (`headline_<l>` · `body_<l>` · `cta_<l>`); en · hi · gu are required before a banner is activated. Writes take the FORM's
 * Idempotency-Key. THERE IS NO READER: `live` is what a member's app WOULD be offered; no app calls it yet.
 */
export class CmsBannersApi {
  constructor(private readonly http: HttpClient) {}
  /** W173 · keyset; the phase / placement / language filters; counts, placements, the verb and the reader fact in meta. */
  async list(q: CmsBannerQuery = {}, signal?: AbortSignal): Promise<CmsBannerIndex> {
    const r = await this.http.request<CmsBannerIndexItem[]>('GET', 'cms/banners', { query: { phase: q.phase, placement: q.placement, languageCode: q.languageCode, cursor: q.cursor, limit: q.limit ?? 50 }, signal });
    const m = (r.meta ?? {}) as Partial<CmsBannerIndex>;
    return { items: r.data, nextCursor: m.nextCursor ?? null, counts: m.counts ?? { byPhase: {}, byPlacement: {}, total: 0 }, placements: m.placements ?? [], canManage: m.canManage ?? false, reader: m.reader ?? { surfaces: [], route: '', gap: [] }, requiredLanguages: m.requiredLanguages ?? [] };
  }
  /** The form's choices: placements · roles · regions · languages (required marked) · the cooperative's clean images · its zone. */
  async vocabulary(signal?: AbortSignal): Promise<CmsBannerVocabulary> { return (await this.http.request<CmsBannerVocabulary>('GET', 'cms/banners/vocabulary', { signal })).data; }
  /** W174 · one banner: its words per language, the activation law's refusals, the acts, reach, slot, group, who. */
  async get(id: string, signal?: AbortSignal): Promise<CmsBannerView> { return (await this.http.request<CmsBannerView>('GET', `cms/banners/${seg(id)}`, { signal })).data; }
  /** Any member: the banners live now for a placement, by THEIR audience and language (no English fallback). */
  async live(q: { placement?: string; languageCode?: string; limit?: number } = {}, signal?: AbortSignal): Promise<CmsLiveBanners> {
    const r = await this.http.request<CmsLiveBanners['items']>('GET', 'cms/banners/live', { query: { placement: q.placement, languageCode: q.languageCode, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as Omit<CmsLiveBanners, 'items'>;
    return { items: r.data, languageCode: m.languageCode ?? null, reader: m.reader ?? { surfaces: [], route: '', gap: [] } };
  }
  /** The form's review (and reach), computed by the API — writes nothing, no key. `id` reviews an edit of that banner. */
  async preview(input: CmsBannerFormInput, id?: string): Promise<CmsBannerReview> {
    return (await this.http.request<CmsBannerReview>('POST', 'cms/banners/preview', { body: input, query: { id } })).data;
  }
  /** New banner — born a draft. Keyed. */
  async create(input: CmsBannerFormInput, idempotencyKey: string): Promise<CmsBannerWriteResult> {
    return (await this.http.request<CmsBannerWriteResult>('POST', 'cms/banners', { body: input, idempotencyKey })).data;
  }
  /** Save changes / add a language — `expect` is the review's token (a colleague who saved first → 409 CMS_BANNER_CHANGED). Keyed. */
  async update(id: string, input: CmsBannerFormInput, idempotencyKey: string): Promise<CmsBannerWriteResult> {
    return (await this.http.request<CmsBannerWriteResult>('PATCH', `cms/banners/${seg(id)}`, { body: input, idempotencyKey })).data;
  }
  /** The confirm step: every act's verdict (the reason as typed) and the activation law's refusals. */
  async acts(id: string, reason?: string, signal?: AbortSignal): Promise<CmsBannerActs> {
    return (await this.http.request<CmsBannerActs>('GET', `cms/banners/${seg(id)}/acts`, { query: { reason }, signal })).data;
  }
  async activate(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsBannerActResult> { return this.act(id, 'activate', body, idempotencyKey); }
  async pause(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsBannerActResult> { return this.act(id, 'pause', body, idempotencyKey); }
  async resume(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsBannerActResult> { return this.act(id, 'resume', body, idempotencyKey); }
  async archive(id: string, body: { reason: string }, idempotencyKey: string): Promise<CmsBannerActResult> { return this.act(id, 'archive', body, idempotencyKey); }
  /** Any of the four acts by name (the mutate chain posts this). Keyed, a reason. */
  async act(id: string, act: CmsBannerAct, body: { reason: string }, idempotencyKey: string): Promise<CmsBannerActResult> {
    return (await this.http.request<CmsBannerActResult>('POST', `cms/banners/${seg(id)}/${act}`, { body, idempotencyKey })).data;
  }
  /** The reorder's confirm step: the slot before and after (the reason as typed). */
  async slotPreview(id: string, direction: CmsFaqDirection, reason?: string, signal?: AbortSignal): Promise<CmsBannerSlotPreview> {
    return (await this.http.request<CmsBannerSlotPreview>('GET', 'cms/banners/slot', { query: { id, direction, reason }, signal })).data;
  }
  /** Move a banner one place in its placement. Keyed, a reason, audited. */
  async slotMove(body: { id: string; direction: CmsFaqDirection; reason: string }, idempotencyKey: string): Promise<CmsBannerSlotResult> {
    return (await this.http.request<CmsBannerSlotResult>('POST', 'cms/banners/slot', { body, idempotencyKey })).data;
  }
  /** A click on a LIVE banner (a member's app would call this; none does yet). */
  async click(id: string): Promise<{ ok: true }> { return (await this.http.request<{ ok: true }>('POST', `cms/banners/${seg(id)}/click`, {})).data; }
}

export class CmsResource {
  readonly pages: CmsPagesApi;
  readonly faq: CmsFaqApi;
  readonly banners: CmsBannersApi;
  constructor(http: HttpClient) { this.pages = new CmsPagesApi(http); this.faq = new CmsFaqApi(http, this.pages); this.banners = new CmsBannersApi(http); }
}
