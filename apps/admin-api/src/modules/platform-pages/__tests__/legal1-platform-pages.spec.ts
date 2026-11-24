// apps/admin-api/src/modules/platform-pages/__tests__/legal1-platform-pages.spec.ts · PC-56 LEGAL-1 (migration 0242).
//
// Pure / mocked — no database (the live half is the lead's proof against a fresh database). What is pinned:
//   • permissions: read / manage / publish on the right routes; publish ELEVATED; every code held by a role below god mode;
//   • idempotency: a write without a key is refused before anything happens; a replay returns the first answer, acts once, audits once;
//   • audit: every write writes ONE row in its transaction, with the reason, the actor, ip and request id — and no body text;
//   • maker ≠ checker: author / last editor refused (typed 409), unnamed maker refused, a second operator publishes; the database's 23514
//     (0242's markers and its CHECK) maps to the same typed 409;
//   • the body rules are apps/api's, replicated — this spec READS the api file and fails if the patterns drift.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformPagesController } from '../platform-pages.controller';
import { PlatformPagesService } from '../services/platform-pages.service';
import { REQUIRE_OWNER_PERMISSION, ownerRoleCatalogue, resolveOwnerPermissions } from '../../../core/rbac/owner-roles';
import { HardwareKeyGuard } from '../../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../../core/auth/step-up-reauth.guard';
import { AdminIdempotency, IdempotencyKeyRequiredError, scopedIdempotencyKey } from '../../../core/idempotency/admin-idempotency.service';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { MARKDOWN_RULE_SOURCES, PLATFORM_FACT_TOKENS, assessWords, bodyIsMarkdown, unknownTokens } from '../domain/platform-page';
import { archivePermissionFor, canTransition, publishVerdict } from '../domain/platform-page.state';
import { mapPageDbError } from '../domain/platform-pages.errors';
import { CreateDraftSchema, PublishSchema } from '../dto/platform-pages.dto';

const AUTHOR = '0190f0aa-1111-7111-8111-111111111111';
const CHECKER = '0190f0aa-2222-7222-8222-222222222222';
const PAGE = '0190f0aa-3333-7333-8333-333333333333';
const REASON = 'reviewed by counsel on the twentieth of November';
const KEY = '7d1c3f8e-0b5e-4a8f-9d7c-1a2b3c4d5e6f';

const ctx = (userId: string, roles: string[]): AdminRequestContext => ({
  userId, roles, permissions: resolveOwnerPermissions(roles), ip: '10.0.0.1', requestId: 'req-legal-1',
} as unknown as AdminRequestContext);
const author = ctx(AUTHOR, ['platform_legal_author']);
const checker = ctx(CHECKER, ['platform_legal_checker']);
const both = ctx(AUTHOR, ['platform_legal_author', 'platform_legal_checker']);

/* ---------------------------------------------------------------------------------------------- */
/* A fake AdminPool: `idempotency_keys` in a Map (the real AdminIdempotency runs over it); withTx     */
/* hands a client that records statements.                                                          */
/* ---------------------------------------------------------------------------------------------- */
function fakePool() {
  const keys = new Map<string, { status: number | null; body: unknown }>();
  const txStatements: string[] = [];
  const client = { query: jest.fn(async (sql: string) => { txStatements.push(sql); return { rows: [], rowCount: 0 }; }) };
  const pool = {
    keys, txStatements, client,
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const k = String(params[0]);
      if (sql.includes('INSERT INTO idempotency_keys')) {
        if (keys.has(k)) return { rows: [], rowCount: 0 };
        keys.set(k, { status: null, body: null }); return { rows: [{ key: k }], rowCount: 1 };
      }
      if (sql.includes('SELECT response_status')) {
        const v = keys.get(k); return v ? { rows: [{ response_status: v.status, response_body: v.body }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('UPDATE idempotency_keys')) { keys.set(k, { status: 200, body: JSON.parse(String(params[1])) }); return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('DELETE FROM idempotency_keys')) { keys.delete(k); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }),
    withTx: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(client)),
  };
  return pool;
}

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: PAGE, slug: 'privacy', version: 2, status: 'draft', pageKind: 'policy', title: 'Privacy Notice', body: '## Who we are\n\nText.',
  languageCode: 'en', createdByAdminId: AUTHOR, lastEditedByAdminId: AUTHOR, publishedByAdminId: null, publishedAt: null,
  archivedAt: null, archivedReason: null, archivedByAdminId: null, updatedAt: '2026-11-20T10:00:00.000Z', ...over,
});

function harness(row: Record<string, unknown> | null = draftRow()) {
  const pool = fakePool();
  const repo = {
    lockById: jest.fn(async () => row), lockSlug: jest.fn(async () => undefined),
    slugState: jest.fn(async (): Promise<{ maxVersion: number; openDraft: number | null; latestLanguage: string | null }> => ({ maxVersion: 1, openDraft: null, latestLanguage: 'en' })),
    activeLanguages: jest.fn(async () => ['en', 'hi', 'gu']),
    archiveReasons: jest.fn(async () => [{ code: 'legal_review', name: 'Taken down for legal review' }]),
    insertDraft: jest.fn(async () => PAGE), updateDraft: jest.fn(async () => undefined), replaceTranslations: jest.fn(async () => undefined),
    supersedeLive: jest.fn(async () => ({ id: 'old', version: 1 })), markPublished: jest.fn(async () => undefined),
    markArchived: jest.fn(async () => undefined),
    detailById: jest.fn(async () => ({ ...(row ?? draftRow()), translations: [] })),
    versionsOf: jest.fn(async () => [{ ...(row ?? draftRow()), translations: [] }]), summaries: jest.fn(async () => []),
  };
  const audit = { write: jest.fn(async () => undefined) };
  const idem = new AdminIdempotency(pool as never);
  const svc = new PlatformPagesService(pool as never, repo as never, audit as never, idem);
  return { svc, repo, audit, pool };
}
const status = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return e instanceof HttpException ? { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> } : e; }
};

/* ---------------------------------------------------------------------------------------------- */
describe('LEGAL-1 · permissions', () => {
  const proto = PlatformPagesController.prototype as unknown as Record<string, object>;
  it('reads need platform.pages.read, authoring platform.pages.manage, publishing platform.pages.publish', () => {
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.list)).toBe('platform.pages.read');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.detail)).toBe('platform.pages.read');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.createDraft)).toBe('platform.pages.manage');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.editDraft)).toBe('platform.pages.manage');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.archive)).toBe('platform.pages.manage');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.publish)).toBe('platform.pages.publish');
  });
  it('publishing is elevated (hardware key + step-up); authoring is not', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.publish)).toEqual([HardwareKeyGuard, StepUpReauthGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.createDraft)).toBeUndefined();
  });
  it('the three codes are held below god mode, and author / checker are different roles', () => {
    const cat = ownerRoleCatalogue();
    const holders = (p: string) => cat.filter((r) => !r.isGodMode && r.permissions.includes(p)).map((r) => r.role);
    expect(holders('platform.pages.read').length).toBeGreaterThanOrEqual(3);
    expect(holders('platform.pages.manage')).toEqual(['platform_legal_author']);
    expect(holders('platform.pages.publish')).toEqual(['platform_legal_checker']);
  });
  it('taking a LIVE version down needs publish, abandoning a draft needs manage', async () => {
    expect(archivePermissionFor('published')).toBe('platform.pages.publish');
    expect(archivePermissionFor('draft')).toBe('platform.pages.manage');
    const { svc, repo } = harness(draftRow({ status: 'published' }));
    const r = await status(svc.archive(author, PAGE, { reason: REASON, archiveReason: 'legal_review' }, KEY));
    expect(r).toMatchObject({ status: 403, body: { code: 'PLATFORM_PAGE_PERMISSION' } });
    expect(repo.markArchived).not.toHaveBeenCalled();
    const ok = harness(draftRow({ status: 'published' }));
    await ok.svc.archive(checker, PAGE, { reason: REASON, archiveReason: 'legal_review' }, KEY);
    expect(ok.repo.markArchived).toHaveBeenCalledWith(expect.anything(), PAGE, 'legal_review', CHECKER);
  });
  it('an archive reason outside the chosen vocabulary is refused by name', async () => {
    const { svc } = harness();
    expect(await status(svc.archive(author, PAGE, { reason: REASON, archiveReason: 'superseded' }, KEY)))
      .toMatchObject({ status: 422, body: { code: 'PLATFORM_PAGE_ARCHIVE_REASON_UNKNOWN' } });
  });
  it('an unknown slug is a typed 404', async () => {
    const { svc } = harness();
    expect(await status(svc.createDraft(author, 'cookies', { title: 'x', body: 'y', reason: REASON }, KEY)))
      .toMatchObject({ status: 404, body: { code: 'PLATFORM_PAGE_UNKNOWN_SLUG' } });
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe('LEGAL-1 · idempotency (Law 3)', () => {
  it('a write without (or with a malformed) Idempotency-Key is refused before any transaction', async () => {
    for (const bad of [undefined, '', 'short', 'has spaces in it', ['a', 'b']]) {
      const { svc, pool, audit } = harness();
      const r = await status(svc.publish(checker, PAGE, { reason: REASON }, bad));
      expect(r).toMatchObject({ status: 400, body: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
      expect(pool.withTx).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    }
    expect(new IdempotencyKeyRequiredError().getStatus()).toBe(400);
  });
  it('a replay with the same key returns the first answer and acts ONCE (one publish, one audit row)', async () => {
    const { svc, repo, audit } = harness();
    const a = await svc.publish(checker, PAGE, { reason: REASON }, KEY);
    const b = await svc.publish(checker, PAGE, { reason: REASON }, KEY);
    expect(b).toEqual(a);
    expect(repo.markPublished).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
  it('the key is scoped per operator and endpoint (one operator never replays another\'s answer) and fits varchar(120)', () => {
    const k1 = scopedIdempotencyKey(AUTHOR, 'platform-pages.publish:x', KEY);
    expect(k1).not.toBe(scopedIdempotencyKey(CHECKER, 'platform-pages.publish:x', KEY));
    expect(k1).not.toBe(scopedIdempotencyKey(AUTHOR, 'platform-pages.archive:x', KEY));
    expect(k1.length).toBeLessThanOrEqual(120);
  });
  it('a failed act releases the key so a genuine retry can succeed', async () => {
    const { svc, pool } = harness();
    expect(await status(svc.publish(author, PAGE, { reason: REASON }, KEY))).toMatchObject({ status: 409 });
    expect(pool.keys.size).toBe(0);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe('LEGAL-1 · audit', () => {
  it('create, edit, publish and archive each write ONE audit row with actor, reason, ip, request id — never the body text', async () => {
    const h = harness();
    await h.svc.createDraft(author, 'privacy', { title: 'Privacy Notice', body: '## A\n\nSECRET-BODY-TEXT', reason: REASON }, KEY);
    const h2 = harness(); await h2.svc.editDraft(author, PAGE, { body: '## B\n\nSECRET-BODY-TEXT', reason: REASON }, KEY);
    const h3 = harness(); await h3.svc.publish(checker, PAGE, { reason: REASON }, KEY);
    const h4 = harness(); await h4.svc.archive(author, PAGE, { reason: REASON, archiveReason: 'legal_review' }, KEY);
    const actions: string[] = [];
    for (const x of [h, h2, h3, h4]) {
      expect(x.audit.write).toHaveBeenCalledTimes(1);
      const [client, entry] = x.audit.write.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(client).toBe(x.pool.client);                    // inside the business transaction
      expect(entry).toMatchObject({ reason: REASON, ip: '10.0.0.1', requestId: 'req-legal-1', entityType: 'cms_page' });
      expect(JSON.stringify(entry)).not.toContain('SECRET-BODY-TEXT');
      actions.push(String(entry.action));
    }
    expect(actions).toEqual(['platform_pages.draft_created', 'platform_pages.draft_edited', 'platform_pages.published', 'platform_pages.archived']);
  });
  it('a reason under 20 characters is refused by the DTO', () => {
    expect(PublishSchema.safeParse({ reason: 'too short' }).success).toBe(false);
    expect(CreateDraftSchema.safeParse({ title: 't', body: 'b', reason: REASON, extra: 1 }).success).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe('LEGAL-1 · maker ≠ checker', () => {
  it('the domain verdict: author or last editor refused; unnamed maker refused; a second operator allowed; non-policy free', () => {
    const v = { pageKind: 'policy', createdBy: AUTHOR, lastEditedByAdminId: null };
    expect(publishVerdict(v, AUTHOR)).toBe('maker_is_checker');
    expect(publishVerdict({ ...v, createdBy: null, lastEditedByAdminId: CHECKER }, CHECKER)).toBe('maker_is_checker');
    expect(publishVerdict({ ...v, createdBy: null }, CHECKER)).toBe('maker_unnamed');
    expect(publishVerdict(v, CHECKER)).toBe('ok');
    expect(publishVerdict({ ...v, pageKind: 'static' }, AUTHOR)).toBe('ok');
  });
  it('the author holding both grants still cannot publish their own draft (typed 409, nothing written)', async () => {
    const { svc, repo } = harness();
    expect(await status(svc.publish(both, PAGE, { reason: REASON }, KEY)))
      .toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_CHECKER_REQUIRED' } });
    expect(repo.markPublished).not.toHaveBeenCalled();
  });
  it('a seeded draft nobody adopted cannot be published (typed 409 MAKER_UNNAMED)', async () => {
    const { svc } = harness(draftRow({ createdByAdminId: null, lastEditedByAdminId: null }));
    expect(await status(svc.publish(checker, PAGE, { reason: REASON }, KEY)))
      .toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_MAKER_UNNAMED' } });
  });
  it('a second operator publishes: the live version is superseded first, then the draft published, by the checker', async () => {
    const { svc, repo } = harness();
    await svc.publish(checker, PAGE, { reason: REASON }, KEY);
    expect(repo.supersedeLive).toHaveBeenCalledWith(expect.anything(), 'privacy', CHECKER);
    expect(repo.markPublished).toHaveBeenCalledWith(expect.anything(), PAGE, CHECKER);
    expect(repo.supersedeLive.mock.invocationCallOrder[0]).toBeLessThan(repo.markPublished.mock.invocationCallOrder[0]);
  });
  it('the DATABASE\'s 23514 (0242 trigger markers and CHECK) maps to the same typed 409s', async () => {
    const isChecker = mapPageDbError({ code: '23514', message: '[CMS_PLATFORM_MAKER_IS_CHECKER] maker is checker: …' }, 'terms', 3) as HttpException;
    expect(isChecker.getStatus()).toBe(409);
    expect(isChecker.getResponse()).toMatchObject({ code: 'PLATFORM_PAGE_CHECKER_REQUIRED', slug: 'terms', version: 3 });
    expect((mapPageDbError({ code: '23514', constraint: 'ck_cms_pages_platform_maker_ne_checker', message: 'x' }, 'terms', 3) as HttpException).getStatus()).toBe(409);
    expect((mapPageDbError({ code: '23514', message: '[CMS_PLATFORM_MAKER_UNNAMED] …' }, 'terms', 3) as HttpException).getResponse())
      .toMatchObject({ code: 'PLATFORM_PAGE_MAKER_UNNAMED' });
    expect((mapPageDbError({ code: '23505', constraint: 'uq_cms_pages_one_draft_platform' }, 'terms', 0) as HttpException).getResponse())
      .toMatchObject({ code: 'PLATFORM_PAGE_DRAFT_EXISTS' });
    const other = { code: '23514', message: 'some other check' };
    expect(mapPageDbError(other, 'terms', 3)).toBe(other);
    // …and through the service: the race where the service check passed and the trigger refused.
    const h = harness();
    h.repo.markPublished.mockRejectedValueOnce(Object.assign(new Error('[CMS_PLATFORM_MAKER_IS_CHECKER] x'), { code: '23514' }));
    expect(await status(h.svc.publish(checker, PAGE, { reason: REASON }, KEY))).toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_CHECKER_REQUIRED' } });
  });
  it('a version that left draft is neither edited nor published (typed 409)', async () => {
    const { svc } = harness(draftRow({ status: 'published' }));
    expect(await status(svc.editDraft(author, PAGE, { body: 'x', reason: REASON }, KEY))).toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_NOT_DRAFT' } });
    expect(await status(svc.publish(checker, PAGE, { reason: REASON }, KEY))).toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_NOT_DRAFT' } });
    expect(canTransition('archived', 'published')).toBe(false);
    expect(canTransition('published', 'draft')).toBe(false);
  });
  it('saving a draft — even unchanged — names the saver as last editor (adoption); a stale expectUpdatedAt is a typed 409', async () => {
    const { svc, repo } = harness(draftRow({ createdByAdminId: null, lastEditedByAdminId: null }));
    await svc.editDraft(author, PAGE, { reason: REASON }, KEY);
    expect(repo.updateDraft).toHaveBeenCalledWith(expect.anything(), PAGE, expect.objectContaining({ adminId: AUTHOR }));
    const h = harness();
    expect(await status(h.svc.editDraft(author, PAGE, { body: 'x', reason: REASON, expectUpdatedAt: '2026-11-19T00:00:00.000Z' }, KEY)))
      .toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_CHANGED' } });
  });
  it('a second open draft is refused by name', async () => {
    const h = harness();
    h.repo.slugState.mockResolvedValueOnce({ maxVersion: 2, openDraft: 2, latestLanguage: 'en' });
    expect(await status(h.svc.createDraft(author, 'privacy', { title: 'T', body: 'B', reason: REASON }, KEY)))
      .toMatchObject({ status: 409, body: { code: 'PLATFORM_PAGE_DRAFT_EXISTS' } });
  });
  it('the detail tells the console whether to DRAW the publish control', async () => {
    const own = await harness().svc.detail('privacy', both);
    expect(own.viewer).toMatchObject({ canPublishDraft: false, draftHasNamedMaker: true });
    const other = await harness().svc.detail('privacy', checker);
    expect(other.viewer.canPublishDraft).toBe(true);
    const noGrant = await harness().svc.detail('privacy', ctx(CHECKER, ['platform_legal_viewer']));
    expect(noGrant.viewer.canPublishDraft).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------- */
describe('LEGAL-1 · the body rules (apps/api\'s, replicated)', () => {
  it('the three patterns are character-for-character apps/api cms page-rules.ts', () => {
    const api = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'cms', 'domain', 'page-rules.ts'), 'utf8');
    expect(api).toContain(`const TAG_RE = /${MARKDOWN_RULE_SOURCES.tag}/gi;`);
    expect(api).toContain(`const COMMENT_RE = /${MARKDOWN_RULE_SOURCES.comment}/;`);
    expect(api).toContain(`const UNSAFE_LINK_RE = /${MARKDOWN_RULE_SOURCES.unsafeLink}/gi;`);
  });
  it('refuses raw HTML, comments and script/data link targets; accepts markdown and `a < b > c` prose', () => {
    expect(bodyIsMarkdown('<script>alert(1)</script>')).toBe(false);
    expect(bodyIsMarkdown('hi <img src=x onerror=alert(1)>')).toBe(false);
    expect(bodyIsMarkdown('<!-- hidden -->')).toBe(false);
    expect(bodyIsMarkdown('[x](javascript:alert(1))')).toBe(false);
    expect(bodyIsMarkdown('[x]( DATA:text/html,abc)')).toBe(false);
    expect(bodyIsMarkdown('## Heading\n\n- **bold** [site](https://example.test) and a < b > c')).toBe(true);
  });
  it('only the eleven platform facts are tokens; every problem is listed at once', () => {
    expect(PLATFORM_FACT_TOKENS).toHaveLength(11);
    expect(unknownTokens('{{platform.grievance.email}} {{ platform.legal.entity_name }} {{evil.token}}')).toEqual(['evil.token']);
    const v = assessWords({ title: ' ', body: '<b>x</b> [y](vbscript:z) {{nope}}', translations: [{ languageCode: 'xx', body: 'a' }, { languageCode: 'en', body: 'b' }] }, 'en', ['en', 'hi', 'gu']);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems.map((p) => p.code).sort()).toEqual(['raw_html', 'title_required', 'translation_is_source', 'unknown_language', 'unknown_token', 'unsafe_link'].sort());
    const ok = assessWords({ title: '  Terms  of Use ', body: 'Body\r\n', translations: [{ languageCode: 'HI', title: 'शर्तें', body: 'पाठ' }] }, 'en', ['en', 'hi', 'gu']);
    expect(ok).toEqual({ ok: true, words: { title: 'Terms of Use', body: 'Body', translations: [{ languageCode: 'hi', title: 'शर्तें', body: 'पाठ' }] } });
  });
  it('a refused body is a typed 422 listing the problems, and nothing is written', async () => {
    const { svc, repo, pool } = harness();
    const r = await status(svc.createDraft(author, 'terms', { title: 'Terms', body: '<iframe src=x></iframe>', reason: REASON }, KEY));
    expect(r).toMatchObject({ status: 422, body: { code: 'PLATFORM_PAGE_REFUSED', problems: [expect.objectContaining({ code: 'raw_html' })] } });
    expect(repo.insertDraft).not.toHaveBeenCalled();
    expect(pool.keys.size).toBe(0);
  });
});
