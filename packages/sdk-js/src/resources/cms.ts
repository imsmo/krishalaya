// @krishalaya/sdk-js · cms resource — PC-56 TENANT-8c · THE PAGES. Every route of `cms/pages` and `cms/faq` has its
// method (F-14: before this wave not one did, so nothing could reach the plane). Gated server-side by the `cms` flag (a
// disabled flag answers 404). Writes take the FORM's Idempotency-Key (Law 3) — minted when the review / confirm step
// rendered, carried in the form, so a double-submit is one write. A refusal is an SdkError carrying the review's codes.
//
// THERE IS NO READER: `pages.bySlug` is what a member WOULD be served; no storefront or mobile code calls it yet.
import { HttpClient } from '../http';
import {
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

export class CmsResource {
  readonly pages: CmsPagesApi;
  readonly faq: CmsFaqApi;
  constructor(http: HttpClient) { this.pages = new CmsPagesApi(http); this.faq = new CmsFaqApi(http, this.pages); }
}
