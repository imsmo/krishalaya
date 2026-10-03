// modules/tenancy/services/tenant-branding.service.ts · PC-56 TENANT-13d · W191 WHITE-LABEL THEMING (F-13).
//
// Founder decision 2026-10-03: BRAND FOR ALL (Rule Zero — no plan gate on branding); PUBLISH NEEDS A CHECKER; CONTRAST LAW.
//
//   • GET  /tenant-branding                    tenant.settings. The draft, the published version, the contrast panel (every pair, AA / AAA
//                                               honest), the plan facts read for real (custom_domain, white_label_unbranded), the coverage
//                                               list (real or named), the live proposal, the admin count.
//   • POST /tenant-branding/preview            W2794's review: the diff against the current draft, every refusal against its field, the
//                                               contrast of the result, and whether it could be published as it stands. Writes nothing.
//   • PUT  /tenant-branding/draft              W2793 → W2795: save the draft (direct, one tenant_admin), audited before → after.
//   • POST /tenant-branding/logo               the logo UPLOAD (raw image/png | image/svg+xml body, ≤ 512 KB): judged and sanitised
//                                               (logo-rules.ts), stored in the media store, born `pending` until the antivirus scan.
//   • POST /tenant-branding/proposals          W2797: PUBLISH — the contrast + logo checks (blocking), a reason, a second administrator.
//   • POST /tenant-branding/rollback           re-publish a history version through the SAME checker path ("reversible with history").
//   • POST …/proposals/:id/confirm             W2798: a DIFFERENT tenant_admin. 0194's trigger is the wall (maker ≠ checker); this service
//                                               names its refusal. The SAME transaction publishes: history row, the pointer, tenants.
//                                               display_name / logo_url in sync, audit, outbox `tenancy.brand_published` → the member
//                                               one-time notice ("same organisation, new look") in each member's language.
//   • POST …/proposals/:id/refuse              a tenant_admin (the proposer withdrawing, or the checker refusing), with a reason.
//   • GET  /tenant-branding/history | /proposals | /proposals/:id   µs keyset.
//   • GET  /storefront/branding/logo/:tenant/:version   PUBLIC: the PUBLISHED logo of that version, content-type LOCKED to what was
//                                               published, nosniff, an SVG sandboxed by CSP. Never a draft, never an unscanned file.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { ObjectStore } from '../../../core/media/s3-presign.service';
import { objectKey } from '../../../core/media/media.domain';
import { uuidv7 } from '../../../core/database/uuid.util';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { PLATFORM_BRAND, TRUST_SURFACES, PUBLISH_MIN_RATIO, type ContrastReport } from '@krishalaya/tokens';
import {
  BRAND_REASON_MIN, BRAND_REFUSE_MIN, BrandDraftInput, BrandDraftValues, BrandRefusal, brandReasonProblem, contrastOf, contrastRefusals, defaultDraft,
  draftDiff, judgeDraft, publicLogoUrl, publishRefusals, sameDraft,
} from '../domain/brand-rules';
import { judgeLogo } from '../domain/logo-rules';
import { assertBrandProposalMove } from '../domain/brand-domain.state';
import {
  BrandCheckerIsMakerError, BrandContrastError, BrandLogoError, BrandNothingToPublishError, BrandProposalClosedError, BrandProposalLiveError,
  BrandProposalNotFoundError, BrandProposalStaleError, BrandRefusedError, BrandVersionNotFoundError, PoweredByPlanRequiredError,
  SettingNeedsSecondAdminError, TenantForbiddenError,
} from '../domain/tenancy.errors';
import { BrandHistoryRow, BrandProposalRow, BrandRow, BrandSnapshot, TenantBrandingRepository } from '../repositories/tenant-branding.repository';
import { SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { TenantActor } from '../policies/tenancy.policies';

export const BRAND_PUBLISHED_EVENT = 'tenancy.brand_published';
export const BRAND_DRAFT_SAVED_EVENT = 'tenancy.brand_draft_saved';

type LogoState = 'none' | 'pending_scan' | 'clean' | 'infected' | 'failed' | 'missing';

/** Map a 0194 trigger / constraint refusal to the named error the API answers with. Anything else is re-thrown as is. */
function mapBrandDbError(e: unknown, proposalId: string): never {
  const err = e as { message?: string; code?: string; constraint?: string };
  const msg = String(err?.message ?? '');
  if (msg.includes('[BRAND_CHECKER_IS_MAKER]')) throw new BrandCheckerIsMakerError(proposalId);
  if (msg.includes('[BRAND_CHECKER_NOT_ADMIN]') || msg.includes('[BRAND_PROPOSER_NOT_ADMIN]')) throw new TenantForbiddenError('Only an active tenant administrator may propose, confirm or refuse a brand');
  if (msg.includes('[BRAND_PROPOSAL_EXPIRED]')) throw new BrandProposalClosedError(proposalId, 'expired');
  if (msg.includes('[BRAND_PROPOSAL_STALE]')) throw new BrandProposalStaleError(proposalId);
  if (msg.includes('[BRAND_LOGO_NOT_READY]')) throw new BrandRefusedError('BRAND_LOGO_NOT_READY', 'The logo is not a clean upload of this organisation', [{ field: 'logoMediaId', code: 'BRAND_LOGO_NOT_READY' }]);
  // the contrast floor is ALSO a CHECK on the proposal (0194 ck_tbp_contrast_floor): reaching it means the service's own gate did not run
  if (err?.code === '23514' && err?.constraint === 'ck_tbp_contrast_floor') throw new BrandRefusedError('BRAND_CONTRAST_FLOOR_DB', 'The database refused a pair below 4.5:1', []);
  if (err?.code === '23505' && String(err?.constraint ?? '') === 'uq_tbp_live') throw new BrandProposalLiveError('');
  throw e;
}

@Injectable()
export class TenantBrandingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: TenantBrandingRepository,
    private readonly gov: SettingGovernanceRepository,
    private readonly store: ObjectStore,
  ) {}

  private assertManager(a: TenantActor) { if (!a.canManage) throw new TenantForbiddenError(); }

  /* ================================================================================================================== */
  /* READS                                                                                                              */
  /* ================================================================================================================== */

  /** The draft values: the stored row, or the platform default a tenant starts from (its own name, platform colours). */
  private async draftOf(tenantId: string, tx?: TxContext): Promise<{ row: BrandRow | null; values: BrandDraftValues }> {
    const row = await this.repo.brand(tenantId, tx);
    if (row) return { row, values: { displayName: row.displayName, appShortName: row.appShortName, logoMediaId: row.logoMediaId, colours: row.colours, poweredByHidden: row.poweredByHidden } };
    const t = await this.repo.tenantFacts(tenantId, tx);
    return { row: null, values: defaultDraft(t?.displayName ?? '') };
  }

  private async logoState(tenantId: string, mediaId: string | null, tx?: TxContext): Promise<{ state: LogoState; mime: string | null }> {
    if (!mediaId) return { state: 'none', mime: null };
    const m = await this.repo.logo(tenantId, mediaId, tx);
    if (!m || m.deleted || m.kind !== 'image') return { state: 'missing', mime: null };
    const state: LogoState = m.scanStatus === 'clean' ? 'clean' : m.scanStatus === 'pending' ? 'pending_scan' : m.scanStatus === 'infected' ? 'infected' : 'failed';
    return { state, mime: m.mime };
  }

  private contrastView(r: ContrastReport) {
    return {
      passes: r.passes, minRatio: Number(r.minRatio.toFixed(3)), gate: PUBLISH_MIN_RATIO,
      pairs: r.pairs.map((p) => ({ code: p.code, fg: p.fg, bg: p.bg, ratio: Number(p.ratio.toFixed(3)), display: p.display, aa: p.aa, aaLarge: p.aaLarge, aaa: p.aaa, aaaLarge: p.aaaLarge })),
      seniorMode: r.seniorMode,
    };
  }

  private proposalView(p: BrandProposalRow, me: string) {
    return {
      id: p.id, kind: p.kind, status: p.status, publishesVersion: p.publishesVersion, rollbackTo: p.rollbackTo,
      values: { displayName: p.displayName, appShortName: p.appShortName, logoMediaId: p.logoMediaId, logoMime: p.logoMime, colours: p.colours, poweredByHidden: p.poweredByHidden },
      contrast: p.contrast, contrastMin: p.contrastMin, reason: p.reason,
      proposedBy: p.proposedBy, proposedByName: p.proposedByName, proposedAt: p.proposedAt, expiresAt: p.expiresAt,
      confirmedBy: p.confirmedBy, confirmedByName: p.confirmedByName, confirmedAt: p.confirmedAt,
      refusedBy: p.refusedBy, refusedAt: p.refusedAt, refuseReason: p.refuseReason, expiredAt: p.expiredAt,
      youProposed: p.proposedBy === me,
      // the screen offers Confirm only to someone the trigger will accept; the API (and the trigger) judge again
      canConfirm: p.status === 'proposed' && p.proposedBy !== me,
      canRefuse: p.status === 'proposed',
    };
  }
  private historyView(h: BrandHistoryRow) {
    return {
      id: h.id, version: h.version, kind: h.kind, rolledBackTo: h.rolledBackTo,
      values: { displayName: h.displayName, appShortName: h.appShortName, logoMediaId: h.logoMediaId, logoMime: h.logoMime, colours: h.colours, poweredByHidden: h.poweredByHidden },
      contrastMin: h.contrastMin, proposalId: h.proposalId, proposedBy: h.proposedBy, proposedByName: h.proposedByName,
      confirmedBy: h.confirmedBy, confirmedByName: h.confirmedByName, reason: h.reason, publishedAt: h.publishedAt,
    };
  }

  /** The plan facts W191's banner prints — read for real; branding itself is never among them (Rule Zero). */
  private async planFacts(tenantId: string) {
    const [domain, unbranded, domainPlans, unbrandedPlans] = await Promise.all([
      this.repo.planFeature(tenantId, 'custom_domain'), this.repo.planFeature(tenantId, 'white_label_unbranded'),
      this.repo.plansWith(tenantId, 'custom_domain'), this.repo.plansWith(tenantId, 'white_label_unbranded'),
    ]);
    return {
      planCode: domain.planCode ?? unbranded.planCode,
      branding: { includedOnEveryPlan: true as const },
      customDomain: { enabled: domain.enabled, plansWith: domainPlans },
      removePoweredBy: { enabled: unbranded.enabled, plansWith: unbrandedPlans },
    };
  }

  /** W191's coverage list, each line real or named (brief C). */
  private coverage(published: boolean, plan: { removePoweredBy: { enabled: boolean } }) {
    return [
      { code: 'member_app', state: published ? 'live' : 'after_publish', detail: 'app name, short name, icon, colours — manifest, metadata and theme' },
      { code: 'statements_invoices', state: published ? 'name_only' : 'after_publish', detail: 'settlement statements and tax invoices print the published name; the PDF writer draws text only, so the logo is not printed (named, not faked)' },
      { code: 'certificates', state: 'not_yet', detail: 'no certificate generator exists (enrollments.certificate_media_id has no renderer)' },
      { code: 'custom_domain', state: 'see_domains', detail: '/settings/branding/domains' },
      { code: 'powered_by', state: plan.removePoweredBy.enabled ? 'removable' : 'stays', detail: PLATFORM_BRAND.poweredByMark },
      { code: 'trust_surfaces', state: 'platform_marks', detail: [...TRUST_SURFACES].join(', ') },
      { code: 'sms_sender', state: 'dlt_registered', detail: 'the SMS sender ID is a DLT registration and is not part of the brand' },
    ];
  }

  async console(tenantId: string, actor: TenantActor) {
    this.assertManager(actor);
    const [{ row, values }, plan, admins, live] = await Promise.all([
      this.draftOf(tenantId), this.planFacts(tenantId), this.gov.adminIds(tenantId), this.repo.liveProposal(tenantId),
    ]);
    const logo = await this.logoState(tenantId, values.logoMediaId);
    const publishedRow = row && row.version > 0 ? await this.repo.history(tenantId, row.version) : null;
    return {
      exists: row !== null,
      draft: {
        values, status: row?.status ?? 'draft', draftRevision: row?.draftRevision ?? 0, updatedAt: row?.updatedAt ?? null,
        logo: { mediaId: values.logoMediaId, ...logo },
        contrast: this.contrastView(contrastOf(values.colours)),
        publishChecks: publishRefusals(values, values.logoMediaId ? { ready: logo.state === 'clean', state: logo.state } : null, plan.removePoweredBy.enabled),
      },
      published: publishedRow ? this.historyView(publishedRow) : null,
      // "Default Krishalaya brand": nothing published — members see the platform brand with this organisation's name
      membersSee: publishedRow ? 'published_brand' : 'platform_brand_with_your_name',
      plan,
      coverage: this.coverage(publishedRow !== null, plan),
      admins: { count: admins.length, youAreAdmin: admins.includes(actor.userId) },
      liveProposal: live ? this.proposalView(live, actor.userId) : null,
      discipline: { reasonMin: BRAND_REASON_MIN, proposalTtlDays: 7, logo: { maxBytes: 512 * 1024, types: ['image/png', 'image/svg+xml'], shape: 'square_or_wide' } },
    };
  }

  /** W2794: review a draft edit — before / after / every refusal / contrast / whether it could be published now. Writes nothing. */
  async preview(tenantId: string, actor: TenantActor, input: BrandDraftInput) {
    this.assertManager(actor);
    const { values: before } = await this.draftOf(tenantId);
    const { values: after, refusals } = judgeDraft(before, input);
    if (after.logoMediaId && after.logoMediaId !== before.logoMediaId) {
      const l = await this.logoState(tenantId, after.logoMediaId);
      if (l.state === 'missing') refusals.push({ field: 'logoMediaId', code: 'BRAND_LOGO_INVALID' });
    }
    const plan = await this.planFacts(tenantId);
    if (after.poweredByHidden && !plan.removePoweredBy.enabled) refusals.push({ field: 'poweredByHidden', code: 'POWERED_BY_PLAN_REQUIRED', detail: { feature: 'white_label_unbranded', plansWith: plan.removePoweredBy.plansWith } });
    const diff = draftDiff(before, after);
    if (diff.length === 0 && refusals.length === 0) refusals.push({ field: null, code: 'BRAND_UNCHANGED' });
    const logo = await this.logoState(tenantId, after.logoMediaId);
    return {
      before, after, diff, refusals, ready: refusals.length === 0,
      contrast: this.contrastView(contrastOf(after.colours)),
      // the draft may be saved with a failing pair (the work is never lost); it cannot be PUBLISHED until every pair passes
      publishChecks: publishRefusals(after, after.logoMediaId ? { ready: logo.state === 'clean', state: logo.state } : null, plan.removePoweredBy.enabled),
    };
  }

  async history(tenantId: string, actor: TenantActor, q: { cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listHistory(tenantId, decodeKeyset(q.cursor, UUID_RE), q.limit);
    const last = rows[rows.length - 1];
    const current = (await this.repo.brand(tenantId))?.version ?? 0;
    return { items: rows.map((h) => ({ ...this.historyView(h), current: h.version === current })), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }
  async proposals(tenantId: string, actor: TenantActor, q: { cursor?: string; limit: number }) {
    this.assertManager(actor);
    const rows = await this.repo.listProposals(tenantId, decodeKeyset(q.cursor, UUID_RE), q.limit);
    const last = rows[rows.length - 1];
    return { items: rows.map((p) => this.proposalView(p, actor.userId)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }
  async proposal(tenantId: string, actor: TenantActor, id: string) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new BrandProposalNotFoundError(id);
    const p = await this.repo.proposal(tenantId, id);
    if (!p) throw new BrandProposalNotFoundError(id);
    const admins = await this.gov.adminIds(tenantId);
    const current = (await this.repo.brand(tenantId))?.version ?? 0;
    return { ...this.proposalView(p, actor.userId), admins: admins.length, currentVersion: current };
  }

  /* ================================================================================================================== */
  /* THE DRAFT (direct, one tenant_admin, audited before → after)                                                       */
  /* ================================================================================================================== */

  async saveDraft(tenantId: string, actor: TenantActor, idemKey: string, input: BrandDraftInput & { reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    const reason = input.reason?.trim() ? input.reason.trim().slice(0, 500) : null;
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_draft_save', () =>
      timed(this.metrics, 'tenancy.brand_draft_save', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const { row, values: before } = await this.draftOf(tenantId, tx);
          if (row) await this.repo.brand(tenantId, tx, true);   // lock
          const { values: after, refusals } = judgeDraft(before, input);
          if (after.logoMediaId && after.logoMediaId !== before.logoMediaId) {
            const l = await this.logoState(tenantId, after.logoMediaId, tx);
            if (l.state === 'missing') refusals.push({ field: 'logoMediaId', code: 'BRAND_LOGO_INVALID' });
          }
          if (after.poweredByHidden && !before.poweredByHidden) {
            const plan = await this.repo.planFeature(tenantId, 'white_label_unbranded', tx);
            if (!plan.enabled) refusals.push({ field: 'poweredByHidden', code: 'POWERED_BY_PLAN_REQUIRED', detail: { feature: 'white_label_unbranded' } });
          }
          if (refusals.length) throw new BrandRefusedError('BRAND_DRAFT_INVALID', 'The draft was not saved — every refusal is listed', refusals);
          const diff = draftDiff(before, after);
          if (row && diff.length === 0) throw new BrandRefusedError('BRAND_UNCHANGED', 'Nothing changed', [{ field: null, code: 'BRAND_UNCHANGED' }], 409);
          let revision: number;
          if (row) revision = await this.repo.updateDraftTx(tx, tenantId, after, actor.userId, 'draft');
          else { await this.repo.insertDraftTx(tx, tenantId, after, actor.userId); revision = 1; }
          const saved = (await this.repo.brand(tenantId, tx))!;
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.brand_draft_saved', entityType: 'tenant_branding', entityId: saved.id,
            oldValue: row ? { values: before, draftRevision: row.draftRevision, status: row.status } : { values: null, note: 'no draft yet (platform default)' },
            newValue: { values: after, draftRevision: revision, status: 'draft', diff }, reason, ip });
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_branding', aggregateId: saved.id, eventType: BRAND_DRAFT_SAVED_EVENT, payload: { v: 1, tenantId, draftRevision: revision } });
          return { brandId: saved.id, values: after, draftRevision: revision, status: 'draft' as const, diff, contrast: this.contrastView(contrastOf(after.colours)) };
        }, { userId: actor.userId })));
  }

  /** The logo UPLOAD: judged + sanitised here, stored in the media store, born pending until the antivirus scan clears it. */
  async uploadLogo(tenantId: string, actor: TenantActor, idemKey: string, body: Buffer, contentType: string, ip: string | null) {
    this.assertManager(actor);
    const verdict = judgeLogo(body, contentType);
    if (!verdict.ok) throw new BrandLogoError(verdict.code, verdict.detail);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_logo_upload', () =>
      timed(this.metrics, 'tenancy.brand_logo_upload', { tenant: tenantId }, async () => {
        const id = uuidv7();
        const s3Key = objectKey(tenantId, 'image', id, verdict.mime === 'image/png' ? 'image/png' : 'image/svg+xml').replace(/\.bin$/, '.svg');
        // the sanitised bytes are what is stored — the upload itself never reaches the bucket
        await this.store.putObject(s3Key, verdict.bytes, verdict.mime);
        return this.uow.run(tenantId, async (tx) => {
          const sha256 = createHash('sha256').update(verdict.bytes).digest('hex');
          await this.repo.insertLogoMediaTx(tx, { id, tenantId, userId: actor.userId, s3Key, mime: verdict.mime, bytes: verdict.bytes.length, sha256, width: verdict.width, height: verdict.height });
          const { row, values: before } = await this.draftOf(tenantId, tx);
          const after: BrandDraftValues = { ...before, colours: { ...before.colours }, logoMediaId: id };
          let revision: number;
          if (row) revision = await this.repo.updateDraftTx(tx, tenantId, after, actor.userId, 'draft');
          else { await this.repo.insertDraftTx(tx, tenantId, after, actor.userId); revision = 1; }
          const saved = (await this.repo.brand(tenantId, tx))!;
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'tenancy.brand_logo_uploaded', entityType: 'tenant_branding', entityId: saved.id,
            oldValue: { logoMediaId: before.logoMediaId }, newValue: { logoMediaId: id, mime: verdict.mime, bytes: verdict.bytes.length, width: verdict.width, height: verdict.height, stripped: verdict.stripped, scan: 'pending' }, ip });
          return { mediaId: id, mime: verdict.mime, bytes: verdict.bytes.length, width: verdict.width, height: verdict.height, stripped: verdict.stripped,
                   state: 'pending_scan' as const, draftRevision: revision };
        }, { userId: actor.userId });
      }));
  }

  /** The console's preview of the DRAFT logo — only once the antivirus scan cleared it (the media plane's rule). */
  async draftLogo(tenantId: string, actor: TenantActor, mediaId: string): Promise<{ bytes: Buffer; mime: string }> {
    this.assertManager(actor);
    if (!UUID_RE.test(mediaId)) throw new BrandVersionNotFoundError(0);
    const m = await this.repo.logo(tenantId, mediaId);
    if (!m || m.deleted || m.kind !== 'image' || (m.mime !== 'image/png' && m.mime !== 'image/svg+xml')) throw new BrandVersionNotFoundError(0);
    if (m.scanStatus !== 'clean') throw new BrandRefusedError('BRAND_LOGO_NOT_READY', 'The logo is waiting for the antivirus scan', [{ field: 'logoMediaId', code: 'BRAND_LOGO_NOT_READY', detail: { state: m.scanStatus } }], 409);
    return { bytes: await this.store.getObject(m.s3Key), mime: m.mime };
  }

  /* ================================================================================================================== */
  /* PUBLISH / ROLLBACK — proposals, a second administrator                                                             */
  /* ================================================================================================================== */

  private snapshotFromDraft(v: BrandDraftValues, mime: string): BrandSnapshot {
    return { ...v, colours: { ...v.colours }, logoMime: mime === 'image/png' ? 'image/png' : 'image/svg+xml' };
  }

  /** W2797: propose publishing the draft as it stands now (frozen on the proposal). */
  async propose(tenantId: string, actor: TenantActor, idemKey: string, input: { reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_propose', () =>
      timed(this.metrics, 'tenancy.brand_propose', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const row = await this.repo.brand(tenantId, tx, true);
          if (!row) throw new BrandRefusedError('BRAND_NO_DRAFT', 'There is no draft to publish yet — save one first', [{ field: null, code: 'BRAND_NO_DRAFT' }], 409);
          if (row.status === 'published' && row.version > 0) throw new BrandNothingToPublishError();
          const values: BrandDraftValues = { displayName: row.displayName, appShortName: row.appShortName, logoMediaId: row.logoMediaId, colours: row.colours, poweredByHidden: row.poweredByHidden };
          return this.proposeTx(tx, tenantId, actor, row, values, 'publish', null, input.reason, ip);
        }, { userId: actor.userId })));
  }

  /** "Reversible with history": re-publish an older version through the SAME checker path. */
  async proposeRollback(tenantId: string, actor: TenantActor, idemKey: string, input: { version: number; reason?: string | null }, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_rollback', () =>
      this.uow.run(tenantId, async (tx) => {
        const row = await this.repo.brand(tenantId, tx, true);
        if (!row || row.version === 0) throw new BrandVersionNotFoundError(input.version);
        const h = await this.repo.history(tenantId, input.version, tx);
        if (!h) throw new BrandVersionNotFoundError(input.version);
        if (h.version === row.version) throw new BrandRefusedError('BRAND_ROLLBACK_CURRENT', 'That version is the one members see now', [{ field: 'version', code: 'BRAND_ROLLBACK_CURRENT' }], 409);
        return this.proposeTx(tx, tenantId, actor, row, h, 'rollback', h.version, input.reason, ip);
      }, { userId: actor.userId }));
  }

  private async proposeTx(tx: TxContext, tenantId: string, actor: TenantActor, row: BrandRow, values: BrandDraftValues, kind: 'publish' | 'rollback',
                          rollbackTo: number | null, rawReason: string | null | undefined, ip: string | null) {
    const reasonProblem = brandReasonProblem(rawReason);
    const refusals: BrandRefusal[] = [];
    if (reasonProblem) refusals.push({ field: 'reason', code: 'BRAND_REASON_INVALID', detail: { problem: reasonProblem, min: BRAND_REASON_MIN } });
    const admins = await this.gov.adminIds(tenantId, tx);
    if (admins.length < 2) throw new SettingNeedsSecondAdminError(admins.length);
    const live = await this.repo.liveProposal(tenantId, tx);
    if (live) throw new BrandProposalLiveError(live.id);
    // THE CONTRAST LAW — step 1 of the canon's publish flow, automatic and blocking: every failing pair named with its ratio.
    const report = contrastOf(values.colours);
    const failing = contrastRefusals(report);
    if (failing.length) throw new BrandContrastError(failing.map((f) => ({ pair: String(f.detail!.pair), ratio: Number(f.detail!.ratio), display: String(f.detail!.display) })));
    const logo = await this.logoState(tenantId, values.logoMediaId, tx);
    const plan = await this.repo.planFeature(tenantId, 'white_label_unbranded', tx);
    refusals.push(...publishRefusals(values, values.logoMediaId ? { ready: logo.state === 'clean', state: logo.state } : null, plan.enabled).filter((r) => r.code !== 'BRAND_CONTRAST_FAILED'));
    if (refusals.some((r) => r.code === 'POWERED_BY_PLAN_REQUIRED') && refusals.length === 1) throw new PoweredByPlanRequiredError(plan.planCode);
    if (refusals.length) throw new BrandRefusedError('BRAND_PUBLISH_REFUSED', 'The brand cannot be published yet — every refusal is listed', refusals);
    const snap = this.snapshotFromDraft(values, logo.mime!);
    const contrast = this.contrastView(report);
    let id: string;
    try {
      id = await this.repo.insertProposalTx(tx, { tenantId, kind, publishesVersion: row.version + 1, rollbackTo, snap, contrast, contrastMin: Number(report.minRatio.toFixed(3)),
        draftRevision: row.draftRevision, reason: rawReason!.trim(), proposedBy: actor.userId });
    } catch (e) { mapBrandDbError(e, ''); }
    await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: kind === 'publish' ? 'tenancy.brand_publish_proposed' : 'tenancy.brand_rollback_proposed',
      entityType: 'tenant_branding_proposal', entityId: id!,
      oldValue: { publishedVersion: row.version }, newValue: { publishesVersion: row.version + 1, rollbackTo, values: snap, contrastMin: contrast.minRatio }, reason: rawReason!.trim(), ip });
    const p = (await this.repo.proposal(tenantId, id!, tx))!;
    return this.proposalView(p, actor.userId);
  }

  /**
   * W2798: a SECOND administrator confirms — and this transaction publishes. No TypeScript maker ≠ checker check on purpose: 0194's
   * trigger is the wall, and removing it must turn a test red.
   */
  async confirm(tenantId: string, actor: TenantActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new BrandProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_confirm', () =>
      timed(this.metrics, 'tenancy.brand_confirm', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const before = await this.repo.proposal(tenantId, id, tx, true);
          if (!before) throw new BrandProposalNotFoundError(id);
          if (before.status !== 'proposed') throw new BrandProposalClosedError(id, before.status);
          assertBrandProposalMove(before.status, 'confirmed');
          try { await this.repo.confirmTx(tx, tenantId, id, actor.userId); } catch (e) { mapBrandDbError(e, id); }
          const p = (await this.repo.proposal(tenantId, id, tx))!;
          const brand = (await this.repo.brand(tenantId, tx, true))!;
          const previous = brand.version > 0 ? await this.repo.history(tenantId, brand.version, tx) : null;
          await this.repo.citeProposalTx(tx, id);
          let historyId: string;
          try {
            historyId = await this.repo.insertHistoryTx(tx, p);
            const working: BrandDraftValues = { displayName: brand.displayName, appShortName: brand.appShortName, logoMediaId: brand.logoMediaId, colours: brand.colours, poweredByHidden: brand.poweredByHidden };
            await this.repo.publishPointerTx(tx, p, sameDraft(working, p));
          } catch (e) { mapBrandDbError(e, id); }
          const origin = await this.repo.platformSetting(tenantId, 'platform.public_api_origin', tx);
          const logoUrl = publicLogoUrl(typeof origin === 'string' ? origin : null, tenantId, p.publishesVersion);
          const sync = await this.repo.syncTenantTx(tx, tenantId, p.displayName, logoUrl);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: p.kind === 'publish' ? 'tenancy.brand_published' : 'tenancy.brand_rolled_back',
            entityType: 'tenant_branding', entityId: brand.id,
            oldValue: { version: brand.version, values: previous ? this.historyView(previous).values : null, tenants: sync.before },
            newValue: { version: p.publishesVersion, proposalId: id, historyId: historyId!, rollbackTo: p.rollbackTo, proposedBy: p.proposedBy, confirmedBy: actor.userId,
                        values: { displayName: p.displayName, appShortName: p.appShortName, logoMediaId: p.logoMediaId, colours: p.colours, poweredByHidden: p.poweredByHidden },
                        tenants: { displayName: p.displayName, logoUrl } },
            reason: p.reason, ip });
          const recipientUserIds = await this.gov.memberUserIdsTx(tx, tenantId);
          // "Members see the new brand at next app open — with a one-time 'same organisation, new look' note in their language"
          await this.outbox.write(tx, { tenantId, aggregateType: 'tenant_branding', aggregateId: brand.id, eventType: BRAND_PUBLISHED_EVENT, payload: {
            v: 1, tenantId, version: p.publishesVersion, kind: p.kind, rollbackTo: p.rollbackTo, displayName: p.displayName, recipientUserIds,
          } });
          this.metrics.inc('tenancy_brand_published_total', { kind: p.kind });
          return {
            version: p.publishesVersion, kind: p.kind, publishedAt: new Date().toISOString(), historyId: historyId!, brandId: brand.id, logoUrl,
            audit: { entityType: 'tenant_branding', entityId: brand.id, action: p.kind === 'publish' ? 'tenancy.brand_published' : 'tenancy.brand_rolled_back' },
            membersSeeIt: 'next_app_open', noticeRecipients: recipientUserIds.length,
          };
        }, { userId: actor.userId })));
  }

  async refuse(tenantId: string, actor: TenantActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertManager(actor);
    if (!UUID_RE.test(id)) throw new BrandProposalNotFoundError(id);
    const problem = brandReasonProblem(reason, BRAND_REFUSE_MIN);
    if (problem) throw new BrandRefusedError('BRAND_REASON_INVALID', 'A refusal needs a reason', [{ field: 'reason', code: 'BRAND_REASON_INVALID', detail: { problem, min: BRAND_REFUSE_MIN } }]);
    return this.idem.remember(idemKey, actor.userId, 'tenancy.brand_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.proposal(tenantId, id, tx, true);
        if (!p) throw new BrandProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new BrandProposalClosedError(id, p.status);
        assertBrandProposalMove(p.status, 'refused');
        try { await this.repo.refuseTx(tx, tenantId, id, actor.userId, reason.trim()); } catch (e) { mapBrandDbError(e, id); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: p.proposedBy === actor.userId ? 'tenancy.brand_proposal_withdrawn' : 'tenancy.brand_proposal_refused',
          entityType: 'tenant_branding_proposal', entityId: id, oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'refused' }, reason: reason.trim(), ip });
        return { id, status: 'refused' as const };
      }, { userId: actor.userId }));
  }

  /** The clock: a proposal nobody confirmed in 7 days expires. */
  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.proposal(tenantId, id, tx, true);
      if (!p || p.status !== 'proposed') return false;
      const ok = await this.repo.expireTx(tx, tenantId, id);
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'tenancy.brand_proposal_expired', entityType: 'tenant_branding_proposal', entityId: id,
        oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }

  /* ================================================================================================================== */
  /* PUBLIC — the published logo, content-type locked                                                                    */
  /* ================================================================================================================== */

  async publicLogo(tenantId: string, version: number): Promise<{ bytes: Buffer; mime: 'image/png' | 'image/svg+xml' } | null> {
    if (!UUID_RE.test(tenantId) || !Number.isInteger(version) || version < 1) return null;
    const found = await this.uow.run(tenantId, async (tx) => {
      const live = await tx.query(`SELECT 1 FROM tenants WHERE id = $1 AND status IN ('trial','active','grace') AND deleted_at IS NULL`, [tenantId]);
      if (!live.rows[0]) return null;
      const h = await this.repo.history(tenantId, version, tx);
      if (!h) return null;
      const m = await this.repo.logo(tenantId, h.logoMediaId!, tx);
      if (!m || m.deleted || m.scanStatus !== 'clean' || m.mime !== h.logoMime) return null;
      return { s3Key: m.s3Key, mime: h.logoMime };
    }, { userId: undefined });
    if (!found) return null;
    return { bytes: await this.store.getObject(found.s3Key), mime: found.mime };
  }
}
