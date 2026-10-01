// modules/cms/services/cms-page.service.ts · PC-56 TENANT-8c · THE PAGES — the tenant's CMS pages and FAQ: W175 (the
// list), W176 (the editor), W177 (the FAQ), and the form + mutate chains behind them. Money-free.
//
// What was here (PC-27) and what is now:
//   • create / update wrote NO audit row, publish / archive did — with the REQUEST ID in the `ip` column (F-7). Every
//     write is now keyed (Law 3, the form's Idempotency-Key), audited in its transaction with actor · reason ·
//     before/after, and carries the real client IP (or NULL) and the request id in their own columns.
//   • archive took no reason. It takes a vocabulary code (0177, Law 6) AND a sentence.
//   • `maxVersion` raced: two concurrent creates of one slug took the same number and the loser was a 500 (F-20). A
//     version is allocated under a transaction-scoped advisory lock on (tenant, slug); the writer re-takes the review
//     under the lock and refuses with a typed 409 when it no longer describes the write (`expect`), and a UNIQUE that
//     still fires is a typed 409 too.
//   • one verb did everything (`cms.manage`, F-19). The author (`cms.pages.manage`) writes drafts; the checker
//     (`cms.pages.publish`) publishes; a POLICY page is published by a second person — the verdict here and 0177's
//     trigger (23514).
//   • `getBySlug` served a platform version over the tenant's own (F-14) — the repository's ORDER BY is fixed.
// THERE IS NO READER: nothing outside this console fetches `cms/*` (grep in the 8c report). Every view carries that fact
// so no screen can draw a member surface that does not exist.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { looksLikeId, submittedValues, writerIssuesOf } from '../../../shared/form-review';
import { CmsPage } from '../domain/cms-page.entity';
import { DomainEvent, PAGE_KINDS, PageKind } from '../domain/cms.events';
import { CmsForbiddenError, FaqMoveRefusedError, PageActRefusedError, PageChangedError, PageFormRefusedError, PageNotFoundError, PageVersionTakenError } from '../domain/cms.errors';
import { CmsPageRepository, PageCounts, PageIndexRow, VersionRow } from '../repositories/cms-page.repository';
import { PageFormDto, PageWriterSchema } from '../dto/create-cms-page.dto';
import { OwnVersionFact, PageIntent, PageReview, reviewPage, storedPage } from '../domain/page-review';
import { PageAct, PageActVerdict, actTarget, allPageVerdicts, ignoringInput, isPageAct, pageActVerdict } from '../domain/page-acts';
import { Serving, SlugState, servingAfter, servingFor, slugState } from '../domain/page-serving';
import { slugIssue, normaliseSlug } from '../domain/page-rules';
import { FaqMoveDirection, FaqMoveVerdict, faqMoveVerdict, faqPosition, nextFaqPlace, orderedFaq, planFaqMove } from '../domain/faq-order';

export interface CmsActor { userId: string; canAuthor: boolean; canPublish: boolean }
/** Where the act happened: the client's IP (or NULL — never the request id, F-7) and the request id in its own column. */
export interface ActMeta { ip: string | null; requestId: string | null }

/**
 * THE READER THAT DOES NOT EXIST, as data. `by-slug` serves any authenticated member; no storefront, mobile or partner
 * code calls it. W175's "what members see" and W176's "Preview in app" print this, by name.
 */
export const MEMBER_READER = { surfaces: [] as string[], route: 'GET /v1/cms/pages/by-slug/:slug', gap: ['web-storefront', 'mobile'] } as const;

export interface IndexItem extends PageIndexRow { state: SlugState; serving: Serving }
export interface PageIndex { items: IndexItem[]; nextCursor: string | null; counts: PageCounts; canAuthor: boolean; canPublish: boolean; reader: typeof MEMBER_READER }

export interface VersionView {
  id: string; version: number; status: string; pageKind: string; defaultTitle: string; body: string; languageCode: string | null; topic: string | null; sortOrder: number;
  createdAt: Date | undefined; publishedAt: Date | null; archivedAt: Date | null; archivedReason: string | null;
  authorName: string | null; publisherName: string | null; archiverName: string | null; editorName: string | null;
  authoredByYou: boolean; lastEditedByYou: boolean; acts: PageActVerdict[];
}
export interface SlugView {
  slug: string; pageKind: string | null; needsChecker: boolean;
  versions: VersionView[];
  draft: VersionView | null; live: VersionView | null; latest: VersionView | null;
  platform: { id: string; version: number; pageKind: string; defaultTitle: string; body: string; languageCode: string | null } | null;
  serving: Serving; contiguous: boolean;
  languages: string[];
  canAuthor: boolean; canPublish: boolean; reader: typeof MEMBER_READER;
}

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** The words, as an audit row records them: the facts and a hash of the body (the version row holds the words — once
 *  published they are immutable, 0177 — so the hash proves WHICH words without copying 200 kB into the trail). */
const wordsOf = (p: { pageKind: string; defaultTitle: string; body: string; languageCode: string | null; topic: string | null; version: number }) =>
  ({ version: p.version, pageKind: p.pageKind, defaultTitle: p.defaultTitle, languageCode: p.languageCode, topic: p.topic, bodyLength: p.body.length, bodySha256: sha(p.body) });

const pgCode = (e: unknown) => (e as { code?: string })?.code;
const pgConstraint = (e: unknown) => (e as { constraint?: string })?.constraint ?? null;

@Injectable()
export class CmsPageService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: CmsPageRepository,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
  ) {}

  private guardRead(actor: CmsActor) {
    // W175 "Pages restricted": the console's pages are for the people who write or publish them.
    if (!actor.canAuthor && !actor.canPublish) throw new CmsForbiddenError('requires cms.pages.manage or cms.pages.publish');
  }

  /** The languages a page may be written in: this tenant's, or the platform's active registry when it declared none. */
  async languages(tenantId: string, tx?: TxContext): Promise<Array<{ code: string; nameEnglish: string; nameNative: string; tenantDeclared: boolean }>> {
    const registry = await this.repo.activeLanguages(tenantId, tx);
    const own = await this.repo.tenantLanguageOrder(tenantId, tx);
    if (own.length === 0) return registry.map((l) => ({ ...l, tenantDeclared: false }));
    return own.map((code) => registry.find((l) => l.code === code) ?? { code, nameEnglish: code, nameNative: code }).map((l) => ({ ...l, tenantDeclared: true }));
  }

  /** The form's choices — every one from a table or the module's own list, never a literal in a page. */
  async vocabulary(tenantId: string, actor: CmsActor) {
    this.guardRead(actor);
    const [topics, reasons, languages] = await Promise.all([
      this.repo.vocabulary(tenantId, 'cms_faq_topic'), this.repo.vocabulary(tenantId, 'cms_page_archive_reason'), this.languages(tenantId),
    ]);
    return { kinds: [...PAGE_KINDS], topics, archiveReasons: reasons.filter((r) => r.chosen), languages };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W175                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  async index(tenantId: string, actor: CmsActor, q: { pageKind?: string; state?: string; languageCode?: string; cursor?: string; limit: number }): Promise<PageIndex> {
    this.guardRead(actor);
    const [counts, rows] = await Promise.all([this.repo.counts(tenantId), this.repo.index(tenantId, q)]);
    const items = rows.map((r) => ({
      ...r,
      state: slugState({ ownRows: r.own.rows, ownPublished: r.own.publishedVersion, openDraft: r.own.draftVersion }),
      serving: servingFor(r.own.publishedVersion, r.platform.version),
    }));
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? last.slug : null, counts, canAuthor: actor.canAuthor, canPublish: actor.canPublish, reader: MEMBER_READER };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W176                                                                                                       */
  /* ---------------------------------------------------------------------------------------------------------- */

  private versionView(v: VersionRow, actor: CmsActor, openDraftExists: boolean, archiveReasons: string[]): VersionView {
    const p = v.page.toProps();
    const acts = allPageVerdicts({
      canAuthor: actor.canAuthor, canPublish: actor.canPublish,
      page: { tenantOwned: p.tenantId !== null, status: p.status, pageKind: p.pageKind, createdBy: p.createdBy ?? null, lastEditedBy: p.lastEditedBy ?? null, body: p.body },
      openDraftExists, actorUserId: actor.userId, reason: null, archiveReason: null, archiveReasons,
    }).map(ignoringInput).filter((x) => actTarget(p.status, x.act) !== null);   // only the acts this status has
    return {
      id: p.id, version: p.version, status: p.status, pageKind: p.pageKind, defaultTitle: p.defaultTitle, body: p.body, languageCode: p.languageCode ?? null,
      topic: p.topic ?? null, sortOrder: p.sortOrder ?? 0, createdAt: p.createdAt, publishedAt: p.publishedAt, archivedAt: p.archivedAt ?? null, archivedReason: p.archivedReason ?? null,
      authorName: v.authorName, publisherName: v.publisherName, archiverName: v.archiverName, editorName: v.editorName,
      authoredByYou: p.createdBy === actor.userId, lastEditedByYou: p.lastEditedBy === actor.userId, acts,
    };
  }

  async view(tenantId: string, actor: CmsActor, rawSlug: string): Promise<SlugView> {
    this.guardRead(actor);
    const slug = normaliseSlug(rawSlug);
    if (slug === null || slugIssue(slug) !== null) throw new PageNotFoundError(rawSlug);
    const [rows, platform, reasons, langs] = await Promise.all([
      this.repo.versionsOf(tenantId, slug), this.repo.platformLive(tenantId, slug), this.repo.vocabulary(tenantId, 'cms_page_archive_reason'), this.languages(tenantId),
    ]);
    if (rows.length === 0 && !platform) throw new PageNotFoundError(slug);
    const openDraftExists = rows.some((r) => r.page.status === 'draft');
    const chosen = reasons.filter((r) => r.chosen).map((r) => r.code);
    const versions = rows.map((r) => this.versionView(r, actor, openDraftExists, chosen));
    const live = versions.find((v) => v.status === 'published') ?? null;
    const kind = versions[0]?.pageKind ?? platform?.pageKind ?? null;
    const pp = platform?.toProps();
    return {
      slug, pageKind: kind, needsChecker: kind === 'policy',
      versions, draft: versions.find((v) => v.status === 'draft') ?? null, live, latest: versions[0] ?? null,
      platform: pp ? { id: pp.id, version: pp.version, pageKind: pp.pageKind, defaultTitle: pp.defaultTitle, body: pp.body, languageCode: pp.languageCode ?? null } : null,
      serving: servingFor(live?.version ?? null, pp?.version ?? null),
      contiguous: versions.map((v) => v.version).sort((a, b) => a - b).every((v, i) => v === i + 1),
      languages: langs.map((l) => l.code),
      canAuthor: actor.canAuthor, canPublish: actor.canPublish, reader: MEMBER_READER,
    };
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE FORM CHAIN                                                                                             */
  /* ---------------------------------------------------------------------------------------------------------- */

  private async reviewFacts(tenantId: string, actor: CmsActor, dto: PageFormDto, tx?: TxContext): Promise<PageReview> {
    const s = storedPage(dto);
    const slugOk = s.slug !== null && slugIssue(s.slug) === null;
    // One after another: inside the writer's transaction these share ONE connection (never concurrent queries on it).
    const rows = slugOk ? await this.repo.versionsOf(tenantId, s.slug as string, tx) : [];
    const platform = slugOk ? await this.repo.platformLive(tenantId, s.slug as string, tx) : null;
    const topics = await this.repo.vocabulary(tenantId, 'cms_faq_topic', tx);
    const langs = await this.languages(tenantId, tx);
    const own: OwnVersionFact[] = rows.map((r) => { const p = r.page.toProps(); return { id: p.id, version: p.version, status: p.status, pageKind: p.pageKind, defaultTitle: p.defaultTitle, body: p.body, languageCode: p.languageCode ?? null, topic: p.topic ?? null, sortOrder: p.sortOrder ?? 0 }; });
    const topicEntries = s.pageKind === 'faq' && s.topic ? (await this.repo.faqTopicPlaces(tenantId, s.topic, tx)).length : undefined;
    // The review is asked about the page's fields; `intent` and `expect` are the chain's, not the page's.
    const fields = { slug: dto.slug, pageKind: dto.pageKind, defaultTitle: dto.defaultTitle, body: dto.body, languageCode: dto.languageCode, topic: dto.topic, reason: dto.reason };
    const pp = platform?.toProps();
    return reviewPage({
      canAuthor: actor.canAuthor, intent: (dto.intent as PageIntent) ?? 'version', entered: fields,
      topics: topics.map((t) => t.code), tenantLanguages: langs.map((l) => l.code), own,
      platform: pp ? { version: pp.version, pageKind: pp.pageKind, defaultTitle: pp.defaultTitle } : null,
      topicEntries, writerIssues: writerIssuesOf(PageWriterSchema, submittedValues(fields)),
    });
  }

  async preview(tenantId: string, actor: CmsActor, dto: PageFormDto): Promise<PageReview> {
    return this.reviewFacts(tenantId, actor, dto);
  }

  /**
   * "New page" (W2703) / "Choose kind" (W2696) / "New FAQ entry" (W2605): a DRAFT — a new page, a new version, or an edit
   * of the open draft, whichever the review computed. Keyed; audited in the transaction; under the slug's lock.
   * `draftId` is the SDK's `pages.update(id)`: the write must be an edit of exactly that draft.
   */
  async save(tenantId: string, actor: CmsActor, idemKey: string, dto: PageFormDto, meta: ActMeta, draftId?: string) {
    return this.idem.remember(idemKey, actor.userId, draftId ? 'cms.page.update' : 'cms.page.write', () => this.guarded(normaliseSlug(dto.slug) ?? '', () =>
      this.uow.run(tenantId, async (tx) => {
        const s = storedPage(dto);
        if (s.slug !== null && slugIssue(s.slug) === null) await this.repo.lockSlug(tx, tenantId, s.slug);
        const review = await this.reviewFacts(tenantId, actor, dto, tx);
        const p = review.preview;
        // F-20: what the review promised is re-taken under the lock. A colleague who wrote first makes this a 409.
        if (dto.expect && dto.expect !== p.expect) throw new PageChangedError(s.slug ?? '', dto.expect, p.expect);
        if (draftId && (p.mode !== 'edit_draft' || p.draftId !== draftId)) throw new PageChangedError(s.slug ?? '', `edit_draft:${draftId}`, p.expect);
        if (!review.ready) throw new PageFormRefusedError(review.refusals);
        const slug = s.slug as string; const kind = s.pageKind as PageKind;
        const own = await this.repo.versionsOf(tenantId, slug, tx);
        const latest = own[0]?.page.toProps() ?? null;
        const places = kind === 'faq' && s.topic ? await this.repo.faqTopicPlaces(tenantId, s.topic, tx) : [];
        let id: string; let action: string; let before: Record<string, unknown> | null; let after: Record<string, unknown>;
        if (p.mode === 'edit_draft') {
          const page = await this.repo.getForUpdate(tx, tenantId, p.draftId as string);
          if (!page || page.status !== 'draft') throw new PageChangedError(slug, p.expect ?? '', null);
          const was = page.toProps();
          // A draft moved to another topic takes the last place there; otherwise its place is kept.
          const sortOrder = kind === 'faq' && s.topic !== was.topic ? nextFaqPlace(places) : (was.sortOrder ?? 0);
          page.edit({ defaultTitle: s.defaultTitle as string, body: s.body as string, pageKind: kind, languageCode: s.languageCode, topic: s.topic }, actor.userId);
          const next = CmsPage.rehydrate({ ...page.toProps(), sortOrder });
          if ((await this.repo.updateDraft(tx, next, tenantId, actor.userId)) !== 1) throw new PageChangedError(slug, p.expect ?? '', null);
          id = was.id; action = 'cms.page_edited';
          before = { ...wordsOf({ ...was, languageCode: was.languageCode ?? null, topic: was.topic ?? null }), status: 'draft' };
          after = { ...wordsOf({ pageKind: kind, defaultTitle: s.defaultTitle as string, body: s.body as string, languageCode: s.languageCode, topic: s.topic, version: was.version }), status: 'draft', sortOrder };
        } else {
          id = uuidv7();
          const sortOrder = kind !== 'faq' ? 0 : latest && latest.topic === s.topic ? (latest.sortOrder ?? 0) : nextFaqPlace(places);
          const page = CmsPage.create({ id, tenantId, slug, pageKind: kind, defaultTitle: s.defaultTitle as string, body: s.body as string, version: p.version as number, languageCode: s.languageCode, topic: s.topic, sortOrder, createdBy: actor.userId });
          await this.repo.insert(tx, page, tenantId, actor.userId);
          action = 'cms.page_created';
          before = latest ? { latest: { ...wordsOf({ ...latest, languageCode: latest.languageCode ?? null, topic: latest.topic ?? null }), status: latest.status } } : null;
          after = { ...wordsOf({ pageKind: kind, defaultTitle: s.defaultTitle as string, body: s.body as string, languageCode: s.languageCode, topic: s.topic, version: p.version as number }), status: 'draft', mode: p.mode, sortOrder };
        }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'cms_page', entityId: id, oldValue: before, newValue: { slug, ...after }, reason: s.reason, ip: meta.ip, requestId: meta.requestId });
        this.metrics.inc('cms.page.write', { mode: p.mode ?? 'none', kind });
        return { id, slug, version: p.version as number, mode: p.mode, status: 'draft' as const, needsChecker: p.needsChecker };
      }, { userId: actor.userId })));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE MUTATE CHAIN                                                                                           */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** The confirm step's object and verdict, with what a member would be served after it. */
  async acts(tenantId: string, actor: CmsActor, id: string, q: { act?: string; reason?: string; archiveReason?: string }) {
    this.guardRead(actor);
    const page = looksLikeId(id) ? await this.repo.getById(tenantId, id) : null;
    if (!page) throw new PageNotFoundError(id);
    const view = await this.view(tenantId, actor, page.slug);
    const version = view.versions.find((v) => v.id === id) ?? null;
    const reasons = (await this.repo.vocabulary(tenantId, 'cms_page_archive_reason')).filter((r) => r.chosen);
    const p = page.toProps();
    const base = {
      canAuthor: actor.canAuthor, canPublish: actor.canPublish,
      page: { tenantOwned: p.tenantId !== null, status: p.status, pageKind: p.pageKind, createdBy: p.createdBy ?? null, lastEditedBy: p.lastEditedBy ?? null, body: p.body },
      openDraftExists: view.draft !== null, actorUserId: actor.userId, reason: q.reason ?? null, archiveReason: q.archiveReason ?? null, archiveReasons: reasons.map((r) => r.code),
    };
    const verdicts = allPageVerdicts(base);
    const after = (a: 'publish' | 'archive') => servingAfter(a, { version: p.version, wasLive: p.status === 'published', platformPublished: view.platform?.version ?? null, ownPublished: view.live?.version ?? null });
    return {
      view, version, platformPage: p.tenantId === null,
      verdicts, archiveReasons: reasons,
      servingAfter: { publish: after('publish'), archive: after('archive') },
      restoreAs: (view.latest?.version ?? 0) + 1,
      supersedes: p.status === 'draft' ? view.live?.version ?? null : null,
    };
  }

  async act(tenantId: string, actor: CmsActor, idemKey: string, id: string, actName: string, body: { reason: string; archiveReason?: string }, meta: ActMeta) {
    if (!isPageAct(actName)) throw new PageActRefusedError(actName, ['ILLEGAL_FROM_STATUS']);
    const act: PageAct = actName;
    return this.idem.remember(idemKey, actor.userId, `cms.page.${act}`, () => this.guarded(id, () =>
      this.uow.run(tenantId, async (tx) => {
        let page = looksLikeId(id) ? await this.repo.getForUpdate(tx, tenantId, id) : null;
        if (!page) {
          // The platform's page is visible and read-only here: refused by name, never "not found".
          const seen = looksLikeId(id) ? await this.repo.getById(tenantId, id, tx) : null;
          if (seen && seen.tenantId === null) throw new PageActRefusedError(act, ['PLATFORM_PAGE']);
          throw new PageNotFoundError(id);
        }
        await this.repo.lockSlug(tx, tenantId, page.slug);
        page = (await this.repo.getForUpdate(tx, tenantId, id)) as CmsPage;
        const own = await this.repo.versionsOf(tenantId, page.slug, tx);
        const reasons = (await this.repo.vocabulary(tenantId, 'cms_page_archive_reason', tx)).filter((r) => r.chosen).map((r) => r.code);
        const p = page.toProps();
        const v = pageActVerdict({
          act, canAuthor: actor.canAuthor, canPublish: actor.canPublish,
          page: { tenantOwned: true, status: p.status, pageKind: p.pageKind, createdBy: p.createdBy ?? null, lastEditedBy: p.lastEditedBy ?? null, body: p.body },
          openDraftExists: own.some((r) => r.page.status === 'draft'), actorUserId: actor.userId,
          reason: body.reason, archiveReason: body.archiveReason ?? null, archiveReasons: reasons,
        });
        if (!v.allowed) throw new PageActRefusedError(act, v.refusals);
        const reason = body.reason.trim();
        const platform = await this.repo.platformLive(tenantId, p.slug, tx);
        const liveBefore = own.find((r) => r.page.status === 'published')?.page.version ?? null;
        const servingBefore = servingFor(liveBefore, platform?.version ?? null);
        let resultId = p.id; let resultVersion = p.version; let resultStatus = v.to as string;
        let before: Record<string, unknown>; let after: Record<string, unknown>;
        if (act === 'publish') {
          const superseded: number[] = [];
          for (const prior of await this.repo.publishedForUpdate(tx, tenantId, p.slug, p.id)) {
            prior.archive(actor.userId, 'superseded');
            await this.repo.updateState(tx, prior, tenantId, actor.userId);
            await this.flush(tx, tenantId, prior.id, prior.pullEvents());
            superseded.push(prior.version);
          }
          page.publish(actor.userId);
          await this.repo.updateState(tx, page, tenantId, actor.userId);
          before = { status: p.status, version: p.version, serving: servingBefore };
          after = { status: 'published', version: p.version, serving: servingFor(p.version, platform?.version ?? null), superseded, checker: p.pageKind === 'policy' ? { publishedBy: actor.userId, author: p.createdBy ?? null, lastEditor: p.lastEditedBy ?? null } : null };
        } else if (act === 'archive') {
          const code = (body.archiveReason ?? '').trim();
          page.archive(actor.userId, code);
          await this.repo.updateState(tx, page, tenantId, actor.userId);
          before = { status: p.status, version: p.version, serving: servingBefore };
          after = { status: 'archived', version: p.version, archivedReason: code, serving: p.status === 'published' ? servingFor(null, platform?.version ?? null) : servingBefore };
        } else {
          const nextVersion = Math.max(...own.map((r) => r.page.version)) + 1;
          resultId = uuidv7(); resultVersion = nextVersion; resultStatus = 'draft';
          const fresh = CmsPage.create({ id: resultId, tenantId, slug: p.slug, pageKind: p.pageKind, defaultTitle: p.defaultTitle, body: p.body, version: nextVersion, languageCode: p.languageCode ?? null, topic: p.topic ?? null, sortOrder: own[0]?.page.toProps().sortOrder ?? 0, createdBy: actor.userId });
          await this.repo.insert(tx, fresh, tenantId, actor.userId);
          before = { fromVersion: p.version, fromStatus: p.status, latestVersion: nextVersion - 1 };
          after = { ...wordsOf({ pageKind: p.pageKind, defaultTitle: p.defaultTitle, body: p.body, languageCode: p.languageCode ?? null, topic: p.topic ?? null, version: nextVersion }), status: 'draft', restoredFrom: p.version };
        }
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: act === 'publish' ? 'cms.page_published' : act === 'archive' ? 'cms.page_archived' : 'cms.page_restored',
          entityType: 'cms_page', entityId: resultId, oldValue: before, newValue: { slug: p.slug, pageKind: p.pageKind, ...after }, reason, ip: meta.ip, requestId: meta.requestId,
        });
        await this.flush(tx, tenantId, p.id, page.pullEvents());
        this.metrics.inc('cms.page.act', { act, kind: p.pageKind });
        return { id: resultId, slug: p.slug, act, version: resultVersion, status: resultStatus, before, after };
      }, { userId: actor.userId })));
  }

  /** Public: serve the live page for a slug — the tenant's own published version, else the platform's (F-14). */
  async getBySlug(tenantId: string, slug: string) {
    const p = await this.repo.publishedBySlug(tenantId, slug);
    if (!p) throw new PageNotFoundError(slug);
    return p.toJSON();
  }
  async getById(tenantId: string, actor: CmsActor, id: string) {
    this.guardRead(actor);
    const p = looksLikeId(id) ? await this.repo.getById(tenantId, id) : null;
    if (!p) throw new PageNotFoundError(id);
    return p.toJSON();
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* W177 — THE FAQ                                                                                             */
  /* ---------------------------------------------------------------------------------------------------------- */

  async faqIndex(tenantId: string, actor: CmsActor, q: { topic?: string; state?: string }) {
    this.guardRead(actor);
    const [entries, topics] = await Promise.all([this.repo.faqEntries(tenantId, q.topic), this.repo.vocabulary(tenantId, 'cms_faq_topic')]);
    const all = q.topic ? await this.repo.faqEntries(tenantId) : entries;
    const byTopic = new Map<string, Array<{ slug: string; sortOrder: number }>>();
    for (const e of all) { const k = e.topic ?? 'general'; byTopic.set(k, [...(byTopic.get(k) ?? []), { slug: e.slug, sortOrder: e.sortOrder }]); }
    const items = entries
      .map((e) => {
        const places = byTopic.get(e.topic ?? 'general') ?? [];
        const state = slugState({ ownRows: e.own.rows, ownPublished: e.own.publishedVersion, openDraft: e.own.draftVersion });
        // The buttons are drawn before a reason exists: the move itself is judged, the reason by the confirm step.
        const movable = (d: FaqMoveDirection) => actor.canAuthor && e.topic !== null && planFaqMove(places, e.slug, d).ok;
        return { ...e, state, position: faqPosition(places, e.slug), ofTopic: places.length, canMoveUp: movable('up'), canMoveDown: movable('down') };
      })
      .filter((e) => (q.state === 'draft' ? e.own.draftVersion !== null : q.state ? e.state === q.state : true));
    const languages = new Map<string, number>();
    for (const e of all) if (e.languageCode) languages.set(e.languageCode, (languages.get(e.languageCode) ?? 0) + 1);
    return {
      items, topics,
      tiles: {
        entries: all.length,
        published: all.filter((e) => e.own.publishedVersion !== null).length,
        drafts: all.filter((e) => e.own.draftVersion !== null).length,
        bySourceLanguage: [...languages.entries()].map(([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1)),
        byTopic: [...byTopic.entries()].map(([topic, xs]) => ({ topic, n: xs.length })),
      },
      truncated: all.length >= 300,
      canAuthor: actor.canAuthor, canPublish: actor.canPublish, reader: MEMBER_READER,
    };
  }

  private async faqFacts(tenantId: string, slug: string, tx?: TxContext) {
    const rows = await this.repo.versionsOf(tenantId, slug, tx);
    const latest = rows[0]?.page.toProps() ?? null;
    const topic = latest && latest.pageKind === 'faq' ? latest.topic ?? null : null;
    return { latest, topic };
  }

  /** The reorder confirm step: the entry, its topic's order, and the verdict (with the reason as typed). */
  async faqMovePreview(tenantId: string, actor: CmsActor, rawSlug: string, direction: FaqMoveDirection, reason: string | null): Promise<FaqMoveVerdict & { slug: string; title: string | null; order: Array<{ slug: string; sortOrder: number }>; position: number | null }> {
    this.guardRead(actor);
    const slug = normaliseSlug(rawSlug) ?? '';
    const { latest, topic } = await this.faqFacts(tenantId, slug);
    const entries = topic ? await this.repo.faqTopicPlaces(tenantId, topic) : [];
    const v = faqMoveVerdict({ canAuthor: actor.canAuthor, topic, entries, slug, direction, reason });
    return { ...v, slug, title: latest?.defaultTitle ?? null, order: orderedFaq(entries), position: faqPosition(entries, slug) };
  }

  /** The reorder act (W177 → the faq mutate chain): the topic LOCKED, the move judged against the order as it stands. */
  async faqMove(tenantId: string, actor: CmsActor, idemKey: string, dto: { slug: string; direction: FaqMoveDirection; reason: string }, meta: ActMeta) {
    const slug = normaliseSlug(dto.slug) ?? '';
    return this.idem.remember(idemKey, actor.userId, 'cms.faq.move', () =>
      this.uow.run(tenantId, async (tx) => {
        const { latest, topic } = await this.faqFacts(tenantId, slug, tx);
        if (topic) await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`cms_faq|${tenantId}|${topic}`]);
        const entries = topic ? await this.repo.faqTopicForUpdate(tx, tenantId, topic) : [];
        const v = faqMoveVerdict({ canAuthor: actor.canAuthor, topic, entries, slug, direction: dto.direction, reason: dto.reason });
        if (!v.allowed || !v.plan || !v.plan.ok) throw new FaqMoveRefusedError(v.refusals);
        for (const st of v.plan.steps) await this.repo.setFaqPlace(tx, tenantId, st.slug, st.to, actor.userId);
        const beforeOrder = orderedFaq(entries).map((e) => e.slug);
        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: `cms.faq_moved_${dto.direction}`, entityType: 'cms_page', entityId: latest?.id ?? null,
          oldValue: { topic, order: beforeOrder, position: beforeOrder.indexOf(slug) + 1 },
          newValue: { slug, topic, order: v.plan.order, position: v.plan.order.indexOf(slug) + 1, renumbered: v.plan.steps },
          reason: dto.reason.trim(), ip: meta.ip, requestId: meta.requestId,
        });
        this.metrics.inc('cms.faq.move', { direction: dto.direction });
        return { id: latest?.id ?? null, slug, topic, order: v.plan.order, position: v.plan.order.indexOf(slug) + 1 };
      }, { userId: actor.userId }));
  }

  /* ---------------------------------------------------------------------------------------------------------- */

  /** A UNIQUE the lock did not foresee is a typed 409 (F-20); 0177's guard refusing is a sentence, never a 500. */
  private async guarded<T>(slug: string, fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e) {
      if (pgCode(e) === '23505') throw new PageVersionTakenError(slug, pgConstraint(e));
      if (pgCode(e) === '23514') throw new PageActRefusedError('write', ['REFUSED_BY_DATABASE']);
      throw e;
    }
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'cms_page', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
