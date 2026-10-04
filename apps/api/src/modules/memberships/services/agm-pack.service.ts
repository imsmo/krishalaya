// modules/memberships/services/agm-pack.service.ts · PC-56 TENANT-SW-d · W199 + W2473–W2477 — THE AGM PACK.
//
// Founder decision (2026-10-04): AN IMMUTABLE PACK FROM FACTS ONLY. The lifecycle, every wall of which is 0200's trigger:
//   draft      — `POST /governance/agm-packs` assembles every section from the facts that exist (domain/agm-pack.ts `assemble`), each
//                with its METHOD; surplus / operating costs / the notice period are refused rows. A draft may be re-assembled and may
//                get its auditor annexure (a file the cooperative uploaded) — then it is assembled again.
//   proposed   — `POST …/:id/issue`: the MAKER (a tenant_admin, `governance.agm.issue`) asks for it to be issued (issued_by).
//   issuing    — `POST …/:id/confirm`: a DIFFERENT tenant_admin confirms (confirmed_by ≠ issued_by — the trigger; no TypeScript
//                duplicate of the rule, so removing the trigger turns a test red).
//   issued     — the render job (`governance-agm-pack-render`, kv_app UoW per tenant, registered): the PDF through the text
//                pdf-writer, stored as media (sha256 recorded on the media row), the content sha256, the human document id, the
//                dataset queued on the 6e-2 plane — all stamped in ONE update; from then on the row never changes (trigger) except
//                `superseded_by`, set once by its addendum as the addendum issues.
//   addendum   — `POST …/:id/addendum` with a reason: a NEW pack chained to an issued parent (trigger: parent issued, number + 1).
// Public verify: `GET /verify/agm/:documentId` (no auth) — issued_at, FY, the two sha256s, the addendum chain. No figures.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { MediaService } from '../../../core/media/media-links.service';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { renderTextPdf } from '../../../core/media/pdf/pdf-writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { AgmPackRepository, AgmPackRow, SectionRecord } from '../repositories/agm-pack.repository';
import {
  AgmSecondLanguage, PackFacts, SectionRow, assemble, contentSha256, documentIdFor, fiscalYear, pdfLines, verifyUrlFor,
} from '../domain/agm-pack';
import { namedSwdGovRefusal, swdGovRefusal } from '../domain/swd-gov.errors';

export const AGM_PACK_DATASET = 'governance.agm_pack';
export const AGM_PACK_ISSUED = 'governance.agm_pack_issued';
export interface AgmActor { userId: string; permissions: ReadonlySet<string>; ip?: string | null }
const can = (a: AgmActor, p: string) => a.permissions.has(p) || a.permissions.has('*');

@Injectable()
export class AgmPackService {
  private readonly log = new Logger(AgmPackService.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly repo: AgmPackRepository,
    private readonly media: MediaService,
    private readonly exportsPlane: ExportPlaneService,
    private readonly config: AppConfig,
    private readonly pools: PgPoolProvider,
  ) {}

  private assertIssuer(a: AgmActor) { if (!can(a, 'governance.agm.issue')) throw swdGovRefusal('AGM_RESTRICTED'); }
  private assertReader(a: AgmActor) { if (!can(a, 'governance.agm.issue') && !can(a, 'governance.manage')) throw swdGovRefusal('AGM_RESTRICTED'); }

  /** Read every fact the pack is assembled from, inside the caller's transaction (one snapshot). */
  private async facts(tx: TxContext, tenantId: string, p: { fyStart: string; zone: string; startMonth: number; startYear: number; auditorMediaId: string | null; currency: string | null }): Promise<PackFacts> {
    const fy = fiscalYear(p.startMonth, p.startYear);
    const [gmv, memberCount, memberCredits, platformFees, gstPayable, tenantCommission, statements, register, resolutions, annexure, quorum] = [
      await this.repo.gmv(tenantId, p.zone, fy.start, fy.endExclusive, tx), await this.repo.memberCount(tenantId, tx),
      await this.repo.memberCredits(tenantId, p.zone, fy.start, fy.endExclusive, tx),
      await this.repo.accountNet(tenantId, 'platform_fees', p.zone, fy.start, fy.endExclusive, tx),
      await this.repo.accountNet(tenantId, 'gst_payable', p.zone, fy.start, fy.endExclusive, tx),
      await this.repo.accountNet(tenantId, 'tenant_commission', p.zone, fy.start, fy.endExclusive, tx),
      await this.repo.statements(tenantId, fy.start, fy.endInclusive, tx), await this.repo.registerAtFyEnd(tenantId, p.zone, fy.endExclusive, tx),
      await this.repo.resolutions(tenantId, p.zone, fy.start, fy.endExclusive, tx), await this.repo.annexure(tenantId, p.auditorMediaId, tx), await this.repo.quorum(tenantId, tx),
    ];
    return { fy, zone: p.zone, countryCurrency: p.currency, memberCount, gmv, memberCredits, platformFees, gstPayable, tenantCommission, statements, register, resolutions, annexure, quorum };
  }

  private async reassembleTx(tx: TxContext, tenantId: string, pack: AgmPackRow): Promise<SectionRow[]> {
    const clock = await this.repo.clock(tenantId, tx);
    const startYear = Number(pack.fyStart.slice(0, 4));
    const rows = assemble(await this.facts(tx, tenantId, { fyStart: pack.fyStart, zone: pack.zone, startMonth: pack.fyStartMonth, startYear, auditorMediaId: pack.auditorMediaId, currency: clock?.currency ?? null }));
    await this.repo.replaceSectionsTx(tx, tenantId, pack.id, rows);
    await this.repo.touchAssembledTx(tx, tenantId, pack.id);
    return rows;
  }

  /** W199 "Generate pack": a DRAFT for the financial year that STARTED in `fyStartYear`, assembled from facts. */
  async draft(tenantId: string, actor: AgmActor, key: string, input: { fyStartYear: number; secondLanguage: AgmSecondLanguage; auditorMediaId?: string | null }) {
    this.assertIssuer(actor);
    return this.idem.remember(key, actor.userId, 'governance.agm_pack.draft', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const clock = await this.repo.clock(tenantId, tx);
          if (!clock) throw swdGovRefusal('AGM_NOT_FOUND');
          if (clock.fyMonth === null) throw swdGovRefusal('AGM_FY_BASIS_UNDECLARED');
          const fy = fiscalYear(clock.fyMonth, input.fyStartYear);
          if (!(await this.repo.fyEnded(tenantId, clock.zone, fy.endExclusive, tx))) throw swdGovRefusal('AGM_FY_NOT_ENDED', { fiscalYear: fy.label, endsAfter: fy.endInclusive });
          if (input.auditorMediaId && !(await this.repo.mediaOfTenant(tenantId, input.auditorMediaId, tx))) throw swdGovRefusal('AGM_ANNEXURE_NOT_FOUND');
          const id = uuidv7();
          await this.repo.insertPackTx(tx, { id, tenantId, label: fy.label, fyStart: fy.start, fyEnd: fy.endInclusive, fyStartMonth: fy.startMonth, fyBasisSource: clock.fyBasisSource,
            zone: clock.zone, secondLanguage: input.secondLanguage, draftedBy: actor.userId, parentPackId: null, addendumNo: 0, reason: null, auditorMediaId: input.auditorMediaId ?? null });
          const pack = (await this.repo.get(tenantId, id, tx))!;
          await this.reassembleTx(tx, tenantId, pack);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'governance.agm_pack.drafted', entityType: 'agm_pack', entityId: id, newValue: { fiscalYear: fy.label, fyBasis: clock.fyBasisSource }, ip: actor.ip ?? null });
          return this.viewTx(tx, tenantId, id);
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdGovRefusal(e); }
    });
  }

  /** W2476 "addendum": a correction is a NEW pack chained to the issued one (never an edit), with a reason. */
  async addendum(tenantId: string, actor: AgmActor, key: string, parentId: string, input: { reason: string; auditorMediaId?: string | null }) {
    this.assertIssuer(actor);
    const reason = (input.reason ?? '').trim();
    if (reason.length < 10 || reason.length > 500) throw swdGovRefusal('REASON_REQUIRED');
    return this.idem.remember(key, actor.userId, 'governance.agm_pack.addendum', async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const parent = await this.repo.get(tenantId, parentId, tx);
          if (!parent) throw swdGovRefusal('AGM_NOT_FOUND');
          const id = uuidv7();
          // the trigger is the wall: the parent must be ISSUED, not superseded, and this is its next number in the same FY
          await this.repo.insertPackTx(tx, { id, tenantId, label: parent.fiscalYearLabel, fyStart: parent.fyStart, fyEnd: parent.fyEnd, fyStartMonth: parent.fyStartMonth,
            fyBasisSource: parent.fyBasisSource, zone: parent.zone, secondLanguage: parent.secondLanguage, draftedBy: actor.userId, parentPackId: parent.id,
            addendumNo: parent.addendumNo + 1, reason, auditorMediaId: input.auditorMediaId ?? parent.auditorMediaId });
          await this.reassembleTx(tx, tenantId, (await this.repo.get(tenantId, id, tx))!);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'governance.agm_pack.addendum_drafted', entityType: 'agm_pack', entityId: id, newValue: { parent: parent.documentId, addendumNo: parent.addendumNo + 1 }, reason, ip: actor.ip ?? null });
          return this.viewTx(tx, tenantId, id);
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdGovRefusal(e); }
    });
  }

  /** Re-read the facts into a draft (a figure moved since it was drafted). Drafts only — the trigger freezes the rest. */
  async reassemble(tenantId: string, actor: AgmActor, id: string) {
    this.assertIssuer(actor);
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const pack = await this.repo.get(tenantId, id, tx, true);
        if (!pack) throw swdGovRefusal('AGM_NOT_FOUND');
        if (pack.status !== 'draft') throw swdGovRefusal('AGM_PACK_IMMUTABLE');
        await this.reassembleTx(tx, tenantId, pack);
        return this.viewTx(tx, tenantId, id);
      }, { userId: actor.userId });
    } catch (e) { throw namedSwdGovRefusal(e); }
  }

  /** W199 "Auditor annexure — upload (external CA)": attach a file THIS cooperative uploaded; the section re-assembles. */
  async attachAnnexure(tenantId: string, actor: AgmActor, id: string, mediaId: string | null) {
    this.assertIssuer(actor);
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const pack = await this.repo.get(tenantId, id, tx, true);
        if (!pack) throw swdGovRefusal('AGM_NOT_FOUND');
        if (pack.status !== 'draft') throw swdGovRefusal('AGM_PACK_IMMUTABLE');
        if (mediaId && !(await this.repo.mediaOfTenant(tenantId, mediaId, tx))) throw swdGovRefusal('AGM_ANNEXURE_NOT_FOUND');
        await this.repo.setAnnexureTx(tx, tenantId, id, mediaId);
        await this.reassembleTx(tx, tenantId, (await this.repo.get(tenantId, id, tx))!);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'governance.agm_pack.annexure_attached', entityType: 'agm_pack', entityId: id, newValue: { mediaId }, ip: actor.ip ?? null });
        return this.viewTx(tx, tenantId, id);
      }, { userId: actor.userId });
    } catch (e) { throw namedSwdGovRefusal(e); }
  }

  private async move(tenantId: string, actor: AgmActor, id: string, key: string, op: string, from: string, set: Record<string, unknown>, audit: { action: string; reason?: string | null }) {
    return this.idem.remember(key, actor.userId, `governance.agm_pack.${op}`, async () => {
      try {
        return await this.uow.run(tenantId, async (tx) => {
          const pack = await this.repo.get(tenantId, id, tx, true);
          if (!pack) throw swdGovRefusal('AGM_NOT_FOUND');
          if (pack.status !== from) throw swdGovRefusal('AGM_PACK_BAD_MOVE', { status: pack.status });
          if (!(await this.repo.moveTx(tx, tenantId, id, from, set))) throw swdGovRefusal('AGM_PACK_BAD_MOVE');
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: audit.action, entityType: 'agm_pack', entityId: id, oldValue: { status: from }, newValue: { status: set.status }, reason: audit.reason ?? null, ip: actor.ip ?? null });
          return this.viewTx(tx, tenantId, id);
        }, { userId: actor.userId });
      } catch (e) { throw namedSwdGovRefusal(e); }
    });
  }

  /** W2475 "Issue": the MAKER asks for the pack to be issued. */
  async requestIssue(tenantId: string, actor: AgmActor, id: string, key: string) {
    this.assertIssuer(actor);
    // refused up front when nobody else could ever confirm it (the trigger would refuse the lone admin's own confirmation anyway)
    if ((await this.repo.activeAdmins(tenantId)) < 2) throw swdGovRefusal('NEEDS_SECOND_ADMIN');
    return this.move(tenantId, actor, id, key, 'issue', 'draft', { status: 'proposed', issued_by: actor.userId, issue_requested_at: new Date().toISOString() }, { action: 'governance.agm_pack.issue_requested' });
  }
  /** The CHECKER confirms (confirmed_by ≠ issued_by is 0200's trigger). The render job finishes the issue. */
  async confirm(tenantId: string, actor: AgmActor, id: string, key: string) {
    this.assertIssuer(actor);
    return this.move(tenantId, actor, id, key, 'confirm', 'proposed', { status: 'issuing', confirmed_by: actor.userId, confirmed_at: new Date().toISOString() }, { action: 'governance.agm_pack.issue_confirmed' });
  }
  /** Back to draft (either administrator), with a reason — the maker and checker are cleared. */
  async sendBack(tenantId: string, actor: AgmActor, id: string, key: string, reason: string) {
    this.assertIssuer(actor);
    if ((reason ?? '').trim().length < 10) throw swdGovRefusal('REASON_REQUIRED');
    return this.move(tenantId, actor, id, key, 'send_back', 'proposed', { status: 'draft', issued_by: null, issue_requested_at: null }, { action: 'governance.agm_pack.sent_back', reason: reason.trim() });
  }
  async withdraw(tenantId: string, actor: AgmActor, id: string, key: string, reason: string) {
    this.assertIssuer(actor);
    const why = (reason ?? '').trim();
    if (why.length < 10 || why.length > 300) throw swdGovRefusal('REASON_REQUIRED');
    const pack = await this.repo.get(tenantId, id);
    const from = pack?.status === 'proposed' ? 'proposed' : 'draft';
    return this.move(tenantId, actor, id, key, 'withdraw', from, { status: 'withdrawn', withdrawn_by: actor.userId, withdrawn_at: new Date().toISOString(), withdraw_reason: why, issued_by: null, issue_requested_at: null }, { action: 'governance.agm_pack.withdrawn', reason: why });
  }

  /* ─────────────────────────────── the render (the job calls this, per tenant, in kv_app's unit of work) ─────────────────────────────── */
  async renderIssuing(tenantId: string): Promise<{ issued: number; failed: number }> {
    const ids = await this.repo.issuing(tenantId);
    let issued = 0, failed = 0;
    for (const id of ids) {
      try { if (await this.renderOne(tenantId, id)) issued++; }
      catch (e) {
        failed++;
        const msg = String((e as Error)?.message ?? e).slice(0, 200);
        this.log.warn(`agm pack ${id}: render failed — ${msg}`);
        await this.uow.run(tenantId, (tx) => this.repo.renderFailedTx(tx, tenantId, id, msg), { userId: 'system' }).catch(() => undefined);
      }
    }
    return { issued, failed };
  }

  async renderOne(tenantId: string, id: string): Promise<boolean> {
    // 1 · read what was confirmed (the sections are frozen since the maker asked to issue)
    const pack = await this.repo.get(tenantId, id);
    if (!pack || pack.status !== 'issuing') return false;
    const [sections, clock, parent] = await Promise.all([
      this.repo.sections(tenantId, id), this.repo.clock(tenantId), pack.parentPackId ? this.repo.get(tenantId, pack.parentPackId) : Promise.resolve(null),
    ]);
    if (!clock) return false;
    const documentId = documentIdFor(clock.slug, pack.fiscalYearLabel, pack.addendumNo);
    const issuedAt = new Date().toISOString();
    const rows: SectionRow[] = sections.map((s: SectionRecord) => ({ section: s.section, item: s.item, status: s.status, method: s.method, refusalCode: s.refusalCode, figures: s.figures, sourceRefs: s.sourceRefs, sortOrder: s.sortOrder }));
    const content = contentSha256({ documentId, fiscalYearLabel: pack.fiscalYearLabel, addendumNo: pack.addendumNo }, rows);
    const fy = fiscalYear(pack.fyStartMonth, Number(pack.fyStart.slice(0, 4)));
    const { title, lines } = pdfLines({
      organisation: clock.displayName, legalName: clock.legalName, documentId, fy, zone: pack.zone, fyBasisSource: pack.fyBasisSource, issuedAt,
      addendumNo: pack.addendumNo, parentDocumentId: parent?.documentId ?? null, reason: pack.reason,
      verifyUrl: verifyUrlFor(this.config.tenantConsoleBaseUrl ?? '', documentId), contentSha256: content, secondLanguage: pack.secondLanguage,
    }, rows);
    // 2 · render + store (the media row records the same digest)
    const pdf = renderTextPdf(title, lines);
    const sha = createHash('sha256').update(pdf).digest('hex');
    const mediaId = await this.media.putGeneratedDocument(tenantId, pdf);
    // 3 · ONE transaction: the parent superseded (an addendum), the dataset queued on the plane, the pack issued — or nothing
    return this.uow.run(tenantId, async (tx) => {
      const exp = await this.exportsPlane.enqueueInTx(tx, tenantId, pack.confirmedBy ?? pack.issuedBy ?? pack.draftedBy, { datasetCode: AGM_PACK_DATASET, params: { packId: id } });
      if (pack.parentPackId && !(await this.repo.supersedeTx(tx, tenantId, pack.parentPackId, id))) throw swdGovRefusal('AGM_PARENT_SUPERSEDED');
      const moved = await this.repo.moveTx(tx, tenantId, id, 'issuing', {
        status: 'issued', issued_at: issuedAt, document_id: documentId, pdf_sha256: sha, content_sha256: content, pdf_media_id: mediaId,
        export_job_id: exp.kind === 'queued' ? exp.jobId : null, export_note: exp.kind === 'off' ? 'exports_plane_off' : null, render_error: null,
      });
      if (!moved) return false;
      await this.audit.write(tx, { tenantId, actorUserId: pack.confirmedBy ?? undefined, action: 'governance.agm_pack.issued', entityType: 'agm_pack', entityId: id,
        newValue: { documentId, pdfSha256: sha, contentSha256: content, mediaId, exportJobId: exp.kind === 'queued' ? exp.jobId : null } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'agm_pack', aggregateId: id, eventType: AGM_PACK_ISSUED, payload: { v: 1, packId: id, documentId, fiscalYear: pack.fiscalYearLabel } });
      return true;
    }, { userId: 'system' });
  }

  /* ─────────────────────────────── reads ─────────────────────────────── */
  private async viewTx(tx: TxContext | null, tenantId: string, id: string) {
    const pack = await this.repo.get(tenantId, id, tx);
    if (!pack) throw swdGovRefusal('AGM_NOT_FOUND');
    const sections = await this.repo.sections(tenantId, id, tx);
    const names = await this.repo.userNames(tenantId, [pack.draftedBy, pack.issuedBy, pack.confirmedBy].filter((x): x is string => Boolean(x)), tx);
    const parent = pack.parentPackId ? await this.repo.get(tenantId, pack.parentPackId, tx) : null;
    return {
      ...pack, cursorTs: undefined,
      draftedByName: names.get(pack.draftedBy) ?? null, issuedByName: pack.issuedBy ? names.get(pack.issuedBy) ?? null : null,
      confirmedByName: pack.confirmedBy ? names.get(pack.confirmedBy) ?? null : null, parentDocumentId: parent?.documentId ?? null,
      verifyPath: pack.documentId ? `/verify/agm/${encodeURIComponent(pack.documentId)}` : null,
      sections: sections.map((s) => ({ section: s.section, item: s.item, status: s.status, method: s.method, refusalCode: s.refusalCode, figures: s.figures, sourceRefs: s.sourceRefs })),
      qr: 'refused' as const,
    };
  }
  async get(tenantId: string, actor: AgmActor, id: string) { this.assertReader(actor); return this.viewTx(null, tenantId, id); }

  /** W199's header: the declared FY basis, the FYs that have ended (newest first), and the packs (µs keyset). */
  async overview(tenantId: string, actor: AgmActor, after?: KeysetCursor, limit = 20) {
    this.assertReader(actor);
    const clock = await this.repo.clock(tenantId);
    if (!clock) throw swdGovRefusal('AGM_NOT_FOUND');
    const rows = await this.repo.page(tenantId, limit + 1, after);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    const now = new Date(); const fys: Array<{ startYear: number; label: string; start: string; endInclusive: string }> = [];
    if (clock.fyMonth !== null) {
      for (let y = now.getUTCFullYear(); y >= now.getUTCFullYear() - 6 && fys.length < 5; y--) {
        const fy = fiscalYear(clock.fyMonth, y);
        if (await this.repo.fyEnded(tenantId, clock.zone, fy.endExclusive)) fys.push({ startYear: y, label: fy.label, start: fy.start, endInclusive: fy.endInclusive });
      }
    }
    return {
      fyBasis: clock.fyMonth === null ? null : { startMonth: clock.fyMonth, source: clock.fyBasisSource }, zone: clock.zone, endedYears: fys,
      defaultSecondLanguage: clock.defaultLanguage === 'hi' || clock.defaultLanguage === 'gu' ? clock.defaultLanguage : null,
      items: page.map((p) => ({ id: p.id, fiscalYearLabel: p.fiscalYearLabel, status: p.status, documentId: p.documentId, addendumNo: p.addendumNo, parentPackId: p.parentPackId,
        supersededBy: p.supersededBy, issuedAt: p.issuedAt, createdAt: p.createdAt, exportJobId: p.exportJobId })),
      nextCursor: rows.length > limit && last ? encodeKeyset(last.cursorTs, last.id) : null,
    };
  }

  /** `GET /verify/agm/:documentId` — PUBLIC. 0200's SECURITY DEFINER read: no tenant context, no figures, no people. */
  async verify(documentId: string) {
    if (!/^AGM-[A-Z0-9-]{3,80}$/.test(documentId)) throw swdGovRefusal('AGM_VERIFY_NOT_FOUND');
    const x = await this.repo.verify(this.pools.writer(0), documentId);
    if (!x) throw swdGovRefusal('AGM_VERIFY_NOT_FOUND');
    return {
      documentId: x.document_id, organisation: x.organisation, fiscalYearLabel: x.fiscal_year_label, issuedAt: new Date(x.issued_at).toISOString(),
      pdfSha256: String(x.pdf_sha256).trim(), contentSha256: x.content_sha256 ? String(x.content_sha256).trim() : null, addendumNo: Number(x.addendum_no),
      parentDocumentId: x.parent_document_id ?? null, supersededByDocumentId: x.superseded_by_document_id ?? null,
    };
  }
}
