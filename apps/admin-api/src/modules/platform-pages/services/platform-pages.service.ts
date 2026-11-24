// apps/admin-api/src/modules/platform-pages/services/platform-pages.service.ts · PC-56 LEGAL-1 (migration 0242).
//
// The four platform POLICY pages — terms · privacy · refunds · shipping — authored, published and taken down in the admin realm (Law 11).
// Every write: an Idempotency-Key (AdminIdempotency, Law 3), one ACID transaction under an advisory lock on the slug, the audit row inside
// it (actor · reason ≥ 20 · before/after · ip · request id), and — on publish — MAKER ≠ CHECKER, refused here by name and again by 0242's
// trigger (23514, mapped back to the same typed 409 — mapPageDbError).
//
// WHAT AN AUDIT ROW CARRIES: the title, the body's sha256 and length and the translation languages — not the body itself. The words are
// already immutable history in `cms_pages` (0242), and a 30 KB privacy notice copied into every audit row would make the trail the largest
// copy of the platform's legal text with none of its guarantees.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AdminIdempotency } from '../../../core/idempotency/admin-idempotency.service';
import { hasOwnerPermission } from '../../../core/rbac/owner-roles';
import { PlatformPagesRepository, VersionDetail, VersionSummary } from '../repositories/platform-pages.repository';
import { PLATFORM_POLICY_SLUGS, assessWords, isPlatformPolicySlug } from '../domain/platform-page';
import { archivePermissionFor, canTransition, publishVerdict } from '../domain/platform-page.state';
import {
  ArchiveReasonUnknownError, PlatformPageChangedError, PlatformPageCheckerRequiredError, PlatformPageDraftExistsError,
  PlatformPageMakerUnnamedError, PlatformPageNotDraftError, PlatformPageNotFoundError, PlatformPagePermissionError,
  PlatformPageRefusedError, PlatformPageTransitionError, UnknownPlatformPageSlugError, mapPageDbError,
} from '../domain/platform-pages.errors';
import { ArchiveDto, CreateDraftDto, EditDraftDto, PublishDto } from '../dto/platform-pages.dto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const wordsFact = (v: { title: string; body: string; translations?: { languageCode: string }[] }) => ({
  title: v.title, bodySha256: sha(v.body), bodyLength: v.body.length, translations: (v.translations ?? []).map((t) => t.languageCode),
});

@Injectable()
export class PlatformPagesService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: PlatformPagesRepository,
    private readonly audit: AdminAuditWriter,
    private readonly idem: AdminIdempotency,
  ) {}

  private slugOrThrow(slug: string): string {
    if (!isPlatformPolicySlug(slug)) throw new UnknownPlatformPageSlugError(slug);
    return slug;
  }

  /** W: the four pages, always in order, each with its live version and its open draft. */
  async list() {
    const rows = await this.repo.summaries(PLATFORM_POLICY_SLUGS);
    return PLATFORM_POLICY_SLUGS.map((slug) => {
      const mine = rows.filter((r) => r.slug === slug);
      return {
        slug,
        live: mine.find((r) => r.status === 'published') ?? null,
        draft: mine.find((r) => r.status === 'draft') ?? null,
        versionCount: mine.length,
      };
    });
  }

  async detail(slug: string, viewer: AdminRequestContext) {
    this.slugOrThrow(slug);
    const [versions, archiveReasons] = await Promise.all([this.repo.versionsOf(slug), this.repo.archiveReasons()]);
    const draft = versions.find((v) => v.status === 'draft') ?? null;
    const verdict = draft ? publishVerdict({ pageKind: draft.pageKind, createdBy: draft.createdByAdminId, lastEditedByAdminId: draft.lastEditedByAdminId }, viewer.userId) : null;
    return {
      slug, versions, archiveReasons,
      viewer: {
        adminId: viewer.userId,
        // "maker-checker by absence": the console draws the publish control only when this is true; the server refuses anyway.
        canPublishDraft: verdict === 'ok' && hasOwnerPermission(viewer.permissions, 'platform.pages.publish'),
        draftHasNamedMaker: draft ? Boolean(draft.createdByAdminId || draft.lastEditedByAdminId) : false,
      },
    };
  }

  /** A new draft: the next version of the slug. One open draft per slug (also 0242's partial UNIQUE). */
  async createDraft(actor: AdminRequestContext, slug: string, dto: CreateDraftDto, idempotencyKey: unknown): Promise<VersionDetail> {
    this.slugOrThrow(slug);
    return this.idem.run(actor.userId, `platform-pages.create-draft:${slug}`, idempotencyKey, async () => {
      const languages = await this.repo.activeLanguages();
      try {
        return await this.pool.withTx(async (c) => {
          await this.repo.lockSlug(c, slug);
          const state = await this.repo.slugState(c, slug);
          if (state.openDraft !== null) throw new PlatformPageDraftExistsError(slug, state.openDraft);
          const source = (dto.languageCode ?? state.latestLanguage ?? '').toLowerCase();
          if (!languages.includes(source)) {
            throw new PlatformPageRefusedError([{ code: 'unknown_language', detail: `Language '${source || '?'}' is not an active language.` }]);
          }
          const verdict = assessWords(dto, source, languages);
          if (!verdict.ok) throw new PlatformPageRefusedError(verdict.problems);
          const version = state.maxVersion + 1;
          const id = await this.repo.insertDraft(c, { slug, version, title: verdict.words.title, body: verdict.words.body, languageCode: source, adminId: actor.userId });
          if (verdict.words.translations.length) await this.repo.replaceTranslations(c, id, verdict.words.translations, actor.userId);
          await this.audit.write(c, {
            actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
            action: 'platform_pages.draft_created', entityType: 'cms_page', entityId: id,
            newValue: { slug, version, languageCode: source, ...wordsFact(verdict.words) },
            reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
          });
          const out = await this.repo.detailById(c, id);
          if (!out) throw new PlatformPageNotFoundError(id);
          return out;
        });
      } catch (e) { throw mapPageDbError(e, slug, 0); }
    });
  }

  /** Save a draft. Saving — even unchanged — records the caller as the last editor: that is how an operator ADOPTS a loaded draft
   *  (a maker is named, so a different operator may then publish). */
  async editDraft(actor: AdminRequestContext, id: string, dto: EditDraftDto, idempotencyKey: unknown): Promise<VersionDetail> {
    return this.idem.run(actor.userId, `platform-pages.edit:${id}`, idempotencyKey, async () => {
      const languages = await this.repo.activeLanguages();
      return this.pool.withTx(async (c) => {
        const cur = await this.repo.lockById(c, id);
        if (!cur) throw new PlatformPageNotFoundError(id);
        await this.repo.lockSlug(c, cur.slug);
        if (cur.status !== 'draft') throw new PlatformPageNotDraftError(cur.status, cur.version);
        if (dto.expectUpdatedAt && new Date(dto.expectUpdatedAt).toISOString() !== cur.updatedAt) throw new PlatformPageChangedError();
        const before = await this.repo.detailById(c, id);
        const verdict = assessWords({
          title: dto.title ?? cur.title, body: dto.body ?? cur.body,
          translations: dto.translations ?? (before?.translations ?? []),
        }, cur.languageCode ?? '', languages);
        if (!verdict.ok) throw new PlatformPageRefusedError(verdict.problems);
        await this.repo.updateDraft(c, id, { title: verdict.words.title, body: verdict.words.body, adminId: actor.userId });
        if (dto.translations !== undefined) await this.repo.replaceTranslations(c, id, verdict.words.translations, actor.userId);
        await this.audit.write(c, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'platform_pages.draft_edited', entityType: 'cms_page', entityId: id,
          oldValue: before ? { lastEditedByAdminId: cur.lastEditedByAdminId, ...wordsFact(before) } : null,
          newValue: { slug: cur.slug, version: cur.version, lastEditedByAdminId: actor.userId, ...wordsFact(verdict.words) },
          reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
        });
        const out = await this.repo.detailById(c, id);
        if (!out) throw new PlatformPageNotFoundError(id);
        return out;
      });
    });
  }

  /** Publish a draft: the slug's live version is archived (`superseded`) in the same transaction — one live version, always. */
  async publish(actor: AdminRequestContext, id: string, dto: PublishDto, idempotencyKey: unknown): Promise<VersionDetail> {
    return this.idem.run(actor.userId, `platform-pages.publish:${id}`, idempotencyKey, async () => {
      let ref = { slug: '?', version: 0 };
      try {
        return await this.pool.withTx(async (c) => {
          const cur = await this.repo.lockById(c, id);
          if (!cur) throw new PlatformPageNotFoundError(id);
          ref = { slug: cur.slug, version: cur.version };
          await this.repo.lockSlug(c, cur.slug);
          if (cur.status !== 'draft') throw new PlatformPageNotDraftError(cur.status, cur.version);
          const verdict = publishVerdict({ pageKind: cur.pageKind, createdBy: cur.createdByAdminId, lastEditedByAdminId: cur.lastEditedByAdminId }, actor.userId);
          if (verdict === 'maker_unnamed') throw new PlatformPageMakerUnnamedError(cur.slug, cur.version);
          if (verdict === 'maker_is_checker') throw new PlatformPageCheckerRequiredError(cur.slug, cur.version);
          const superseded = await this.repo.supersedeLive(c, cur.slug, actor.userId);
          await this.repo.markPublished(c, id, actor.userId);
          await this.audit.write(c, {
            actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
            action: 'platform_pages.published', entityType: 'cms_page', entityId: id,
            oldValue: { status: 'draft', liveVersion: superseded?.version ?? null },
            newValue: { slug: cur.slug, version: cur.version, status: 'published', supersededVersion: superseded?.version ?? null,
              makers: [cur.createdByAdminId, cur.lastEditedByAdminId].filter(Boolean), ...wordsFact({ title: cur.title, body: cur.body }) },
            reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
          });
          const out = await this.repo.detailById(c, id);
          if (!out) throw new PlatformPageNotFoundError(id);
          return out;
        });
      } catch (e) { throw mapPageDbError(e, ref.slug, ref.version); }
    });
  }

  /** Archive: a draft (abandon — the author's act) or the LIVE version (take the page down — the checker's act; the storefront then says
   *  "not published yet"). */
  async archive(actor: AdminRequestContext, id: string, dto: ArchiveDto, idempotencyKey: unknown): Promise<VersionDetail> {
    return this.idem.run(actor.userId, `platform-pages.archive:${id}`, idempotencyKey, async () => {
      const reasons = await this.repo.archiveReasons();
      if (!reasons.some((r) => r.code === dto.archiveReason)) throw new ArchiveReasonUnknownError(dto.archiveReason);
      return this.pool.withTx(async (c) => {
        const cur: VersionSummary | null = await this.repo.lockById(c, id);
        if (!cur) throw new PlatformPageNotFoundError(id);
        await this.repo.lockSlug(c, cur.slug);
        if (!canTransition(cur.status, 'archived')) throw new PlatformPageTransitionError(cur.status, 'archived');
        const needed = archivePermissionFor(cur.status);
        if (!hasOwnerPermission(actor.permissions, needed)) throw new PlatformPagePermissionError(needed);
        await this.repo.markArchived(c, id, dto.archiveReason, actor.userId);
        await this.audit.write(c, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'platform_pages.archived', entityType: 'cms_page', entityId: id,
          oldValue: { status: cur.status }, newValue: { slug: cur.slug, version: cur.version, status: 'archived', archiveReason: dto.archiveReason },
          reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
        });
        const out = await this.repo.detailById(c, id);
        if (!out) throw new PlatformPageNotFoundError(id);
        return out;
      });
    });
  }
}
