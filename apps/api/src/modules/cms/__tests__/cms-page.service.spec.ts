// modules/cms/__tests__/cms-page.service.spec.ts · service unit tests with fakes — PC-56 TENANT-8c.
// Pins: the write mints the version the review computed (new page v1, new version max+1, edit of the open draft), under
// the slug's lock, keyed, audited with the CLIENT IP and the request id in their own columns (F-7); a write the review
// no longer describes is a typed 409 (F-20), a UNIQUE that still fires is a typed 409, never a 500; publish archives the
// prior live version `superseded`; a POLICY page is never published by its maker; archive takes a vocabulary reason;
// restore mints the next draft; the author/publisher verbs gate reads; getBySlug serves the live page.
import { CmsPageService } from '../services/cms-page.service';
import { CmsPage } from '../domain/cms-page.entity';
import { CmsForbiddenError, PageActRefusedError, PageChangedError, PageFormRefusedError, PageNotFoundError, PageVersionTakenError } from '../domain/cms.errors';

const T = 't1';
const U = '00000000-0000-7000-8000-00000000000a';
const C = '00000000-0000-7000-8000-00000000000c';
const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const row = (over: Partial<any> = {}) => CmsPage.rehydrate({
  id: id(1), tenantId: T, slug: 'privacy-policy', pageKind: 'policy', defaultTitle: 'Privacy', body: 'b', version: 1, status: 'draft', publishedAt: null,
  languageCode: 'gu', topic: null, sortOrder: 0, createdBy: U, lastEditedBy: U, ...over,
});
const vr = (p: CmsPage) => ({ page: p, authorName: null, publisherName: null, archiverName: null, editorName: null });

function harness(opts: { own?: CmsPage[]; platform?: CmsPage | null; forUpdate?: CmsPage | null; prior?: CmsPage[]; insertError?: unknown } = {}) {
  const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const repo = {
    lockSlug: jest.fn(), versionsOf: jest.fn(async () => (opts.own ?? []).map(vr)), platformLive: jest.fn(async () => opts.platform ?? null),
    vocabulary: jest.fn(async (_t: string, type: string) => (type === 'cms_faq_topic' ? [{ code: 'payments', name: 'P', chosen: true, sortOrder: 1 }] : [{ code: 'outdated', name: 'O', chosen: true, sortOrder: 1 }, { code: 'superseded', name: 'S', chosen: false, sortOrder: 90 }])),
    tenantLanguageOrder: jest.fn(async () => ['gu', 'en']), activeLanguages: jest.fn(async () => [{ code: 'gu', nameEnglish: 'Gujarati', nameNative: 'ગુજરાતી' }, { code: 'en', nameEnglish: 'English', nameNative: 'English' }]),
    faqTopicPlaces: jest.fn(async () => []),
    insert: jest.fn(async () => { if (opts.insertError) throw opts.insertError; }),
    getForUpdate: jest.fn(async () => opts.forUpdate ?? null), getById: jest.fn(async () => opts.forUpdate ?? null),
    updateDraft: jest.fn(async () => 1), updateState: jest.fn(async () => 1), publishedForUpdate: jest.fn(async () => opts.prior ?? []),
    publishedBySlug: jest.fn(async () => opts.forUpdate ?? null),
  };
  const svc = new CmsPageService(uow as any, outbox as any, metrics as any, audit as any, repo as any, idem as any);
  return { svc, repo, audit, idem, outbox };
}
const author = { userId: U, canAuthor: true, canPublish: true };
const checker = { userId: C, canAuthor: false, canPublish: true };
const nobody = { userId: 'x', canAuthor: false, canPublish: false };
const meta = { ip: '203.0.113.9', requestId: 'req-1' };
const form = (over: Record<string, string> = {}) => ({ slug: 'privacy-policy', pageKind: 'policy', defaultTitle: 'Privacy', body: '# Privacy', languageCode: 'gu', reason: 'first policy', intent: 'new', ...over });

describe('save — the version the review computed, keyed and audited (F-7, F-20)', () => {
  it('a new page is v1, a draft, under the slug lock; the audit row has the client IP and the request id apart', async () => {
    const h = harness();
    const out = await h.svc.save(T, author, 'k1', form() as any, meta);
    expect(out).toMatchObject({ slug: 'privacy-policy', version: 1, mode: 'new_page', status: 'draft', needsChecker: true });
    expect(h.repo.lockSlug).toHaveBeenCalledWith(expect.anything(), T, 'privacy-policy');
    expect(h.idem.remember).toHaveBeenCalledWith('k1', U, 'cms.page.write', expect.any(Function));
    const a = h.audit.write.mock.calls[0][1];
    expect(a).toMatchObject({ action: 'cms.page_created', entityType: 'cms_page', ip: '203.0.113.9', requestId: 'req-1', reason: 'first policy', oldValue: null });
    expect(a.newValue).toMatchObject({ slug: 'privacy-policy', version: 1, status: 'draft', mode: 'new_page', bodyLength: 9 });
    expect(a.newValue.bodySha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a slug whose versions are history gets max + 1; the audit row carries the latest as before', async () => {
    const h = harness({ own: [row({ version: 3, status: 'published', publishedAt: new Date() }), row({ id: id(2), version: 2, status: 'archived' })] });
    const out = await h.svc.save(T, author, 'k2', form({ intent: 'version', body: '# v4' }) as any, meta);
    expect(out).toMatchObject({ version: 4, mode: 'new_version' });
    expect(h.audit.write.mock.calls[0][1].oldValue.latest).toMatchObject({ version: 3, status: 'published' });
  });
  it('the open draft is EDITED, never a second draft; before/after in the audit row', async () => {
    const d = row({ version: 2, status: 'draft', body: '# old' });
    const h = harness({ own: [d, row({ id: id(2), version: 1, status: 'published', publishedAt: new Date() })], forUpdate: d });
    const out = await h.svc.save(T, author, 'k3', form({ intent: 'version', body: '# new' }) as any, meta);
    expect(out).toMatchObject({ version: 2, mode: 'edit_draft', id: id(1) });
    expect(h.repo.updateDraft).toHaveBeenCalledTimes(1); expect(h.repo.insert).not.toHaveBeenCalled();
    const a = h.audit.write.mock.calls[0][1];
    expect(a.action).toBe('cms.page_edited'); expect(a.oldValue.bodyLength).toBe(5); expect(a.newValue.bodyLength).toBe(5); expect(a.oldValue.bodySha256).not.toBe(a.newValue.bodySha256);
  });
  it('the review said new_page:1 and a colleague wrote first → typed 409 CMS_PAGE_CHANGED, nothing written', async () => {
    const h = harness({ own: [row()] });
    await expect(h.svc.save(T, author, 'k4', form({ expect: 'new_page:1' }) as any, meta)).rejects.toBeInstanceOf(PageChangedError);
    expect(h.repo.insert).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });
  it('PATCH aimed at a draft that is not the open one → 409', async () => {
    const h = harness({ own: [row({ status: 'published', publishedAt: new Date() })] });
    await expect(h.svc.save(T, author, 'k5', form({ intent: 'version', body: '# x' }) as any, meta, id(9))).rejects.toBeInstanceOf(PageChangedError);
  });
  it('a refused review is a 422 with every code; a UNIQUE that still fires is a typed 409, never a 500', async () => {
    const h = harness();
    await expect(h.svc.save(T, author, 'k6', form({ body: '<b>x</b>', languageCode: 'hi' }) as any, meta)).rejects.toMatchObject({ code: 'CMS_PAGE_FORM_REFUSED', details: { refusals: [{ field: 'body', code: 'BODY_RAW_HTML' }, { field: 'languageCode', code: 'LANGUAGE_NOT_TENANT' }] } });
    const u = harness({ insertError: Object.assign(new Error('dup'), { code: '23505', constraint: 'cms_pages_tenant_id_slug_version_key' }) });
    await expect(u.svc.save(T, author, 'k7', form() as any, meta)).rejects.toBeInstanceOf(PageVersionTakenError);
    const g = harness({ insertError: Object.assign(new Error('guard'), { code: '23514' }) });
    await expect(g.svc.save(T, author, 'k8', form() as any, meta)).rejects.toMatchObject({ code: 'CMS_PAGE_ACT_REFUSED', details: { refusals: ['REFUSED_BY_DATABASE'] } });
  });
  it('without cms.pages.manage the review refuses (NO_PERMISSION), and reads need one of the two verbs', async () => {
    const h = harness();
    await expect(h.svc.save(T, checker, 'k9', form() as any, meta)).rejects.toBeInstanceOf(PageFormRefusedError);
    await expect(h.svc.index(T, nobody, { limit: 10 })).rejects.toBeInstanceOf(CmsForbiddenError);
    await expect(h.svc.view(T, nobody, 'about')).rejects.toBeInstanceOf(CmsForbiddenError);
    await expect(h.svc.faqIndex(T, nobody, {})).rejects.toBeInstanceOf(CmsForbiddenError);
  });
});

describe('act — publish · archive · restore', () => {
  it('publish archives the prior live version `superseded`, then publishes this one — audited with the serving before/after', async () => {
    const prior = row({ id: id(2), version: 1, status: 'published', publishedAt: new Date(), pageKind: 'static' });
    const d = row({ version: 2, pageKind: 'static' });
    const h = harness({ own: [d, prior], forUpdate: d, prior: [prior] });
    const out = await h.svc.act(T, author, 'a1', id(1), 'publish', { reason: 'goes live' }, meta);
    expect(out).toMatchObject({ act: 'publish', status: 'published', version: 2 });
    expect(prior.status).toBe('archived'); expect(prior.toProps().archivedReason).toBe('superseded');
    expect(h.repo.updateState).toHaveBeenCalledTimes(2);
    const a = h.audit.write.mock.calls[0][1];
    expect(a).toMatchObject({ action: 'cms.page_published', reason: 'goes live', ip: '203.0.113.9', requestId: 'req-1' });
    expect(a.oldValue.serving).toEqual({ source: 'own', version: 1 }); expect(a.newValue.serving).toEqual({ source: 'own', version: 2 }); expect(a.newValue.superseded).toEqual([1]);
  });
  it('a POLICY page is never published by its author or last editor (MAKER_IS_CHECKER); a second person may', async () => {
    const d = row();
    const h = harness({ own: [d], forUpdate: d });
    await expect(h.svc.act(T, author, 'a2', id(1), 'publish', { reason: 'self' }, meta)).rejects.toMatchObject({ details: { refusals: ['MAKER_IS_CHECKER'] } });
    const d2 = row({ lastEditedBy: C });
    const h2 = harness({ own: [d2], forUpdate: d2 });
    await expect(h2.svc.act(T, checker, 'a3', id(1), 'publish', { reason: 'edited it' }, meta)).rejects.toMatchObject({ details: { refusals: ['MAKER_IS_CHECKER'] } });
    const d3 = row();
    const h3 = harness({ own: [d3], forUpdate: d3 });
    expect((await h3.svc.act(T, checker, 'a4', id(1), 'publish', { reason: 'read and agreed' }, meta)).status).toBe('published');
    expect(h3.audit.write.mock.calls[0][1].newValue.checker).toEqual({ publishedBy: C, author: U, lastEditor: U });
  });
  it('archive needs a reason from the vocabulary — a system code is refused, a blank one too', async () => {
    const live = row({ status: 'published', publishedAt: new Date(), pageKind: 'static' });
    const h = harness({ own: [live], forUpdate: live });
    await expect(h.svc.act(T, author, 'a5', id(1), 'archive', { reason: 'old', archiveReason: '' }, meta)).rejects.toMatchObject({ details: { refusals: ['ARCHIVE_REASON_REQUIRED'] } });
    await expect(h.svc.act(T, author, 'a6', id(1), 'archive', { reason: 'old', archiveReason: 'superseded' }, meta)).rejects.toMatchObject({ details: { refusals: ['ARCHIVE_REASON_UNKNOWN'] } });
    const out = await h.svc.act(T, author, 'a7', id(1), 'archive', { reason: 'replaced by v2 next season', archiveReason: 'outdated' }, meta);
    expect(out.status).toBe('archived');
    expect(h.audit.write.mock.calls[0][1].newValue).toMatchObject({ archivedReason: 'outdated', serving: { source: 'none', version: null } });
  });
  it('restore mints the NEXT draft with the archived words; the archived row is untouched', async () => {
    const old = row({ version: 1, status: 'archived', archivedReason: 'outdated', archivedAt: new Date(), pageKind: 'static', body: '# old words' });
    const h = harness({ own: [row({ id: id(3), version: 2, status: 'published', publishedAt: new Date(), pageKind: 'static' }), old], forUpdate: old });
    const out = await h.svc.act(T, author, 'a8', id(1), 'restore', { reason: 'the old text was right' }, meta);
    expect(out).toMatchObject({ act: 'restore', status: 'draft', version: 3 });
    expect(h.repo.insert).toHaveBeenCalledTimes(1); expect(h.repo.updateState).not.toHaveBeenCalled();
    expect((h.repo.insert.mock.calls[0] as any[])[1].toProps()).toMatchObject({ version: 3, body: '# old words', status: 'draft', createdBy: U });
  });
  it('a platform page is refused by name (PLATFORM_PAGE), an unknown id is a 404, an unknown act refused', async () => {
    const plat = CmsPage.rehydrate({ ...row().toProps(), tenantId: null });
    const h = harness({ forUpdate: null });
    h.repo.getById.mockResolvedValueOnce(plat as never);
    await expect(h.svc.act(T, author, 'a9', id(1), 'archive', { reason: 'x', archiveReason: 'outdated' }, meta)).rejects.toMatchObject({ details: { refusals: ['PLATFORM_PAGE'] } });
    await expect(h.svc.act(T, author, 'a10', 'not-an-id', 'archive', { reason: 'x' }, meta)).rejects.toBeInstanceOf(PageNotFoundError);
    await expect(h.svc.act(T, author, 'a11', id(1), 'unpublish', { reason: 'x' }, meta)).rejects.toBeInstanceOf(PageActRefusedError);
  });
});

describe('getBySlug (public)', () => {
  it('serves the live page; none → 404', async () => {
    const h = harness({ forUpdate: row({ status: 'published', publishedAt: new Date() }) });
    expect((await h.svc.getBySlug(T, 'privacy-policy')).slug).toBe('privacy-policy');
    await expect(harness().svc.getBySlug(T, 'nope')).rejects.toBeInstanceOf(PageNotFoundError);
  });
});
