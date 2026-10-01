// modules/identity/services/kyc-desk.service.ts · PC-56 TENANT-9a · THE KYC DESK (W121, W122, W2319–W2325).
//
// One service for the desk's reads and its two chains:
//   • SUBMIT (the form chain): a member's own document (no verb — it is theirs), a member's document on their behalf, or
//     the ORGANISATION's own document (both `kyc.manage`). The API computes the review (`buildSubmitReview`) and the writer
//     re-takes it inside the transaction; the submission writes the document, a `submit` decision row, an audit row (F-21
//     of the survey: `submit` wrote none), the outbox event — and re-derives the person's roles, which for a new pending
//     document changes ONLY roles the type evidences that had no valid verification (F-2: a renewal pauses nothing).
//   • ACT (the mutate chain): verify · reject · request_more on `kyc.review`, reveal on `member.pii.reveal` — verdicts
//     taken on the confirm page and re-taken on the locked row; keyed (Idempotency-Key from the confirm page), reasoned,
//     audited; a reveal is recorded BEFORE the evidence link is minted (1b's order: authorise → find → record → return).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { LangMap } from '../../../core/i18n/lang-map';
import { MediaService } from '../../../core/media/media-links.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { KycDocument } from '../domain/kyc-document.entity';
import { KycDeskRefusedError, KycDeskRestrictedError, KycNotFoundError } from '../domain/identity.errors';
import { SubmitInput, SubmitReview, buildSubmitReview } from '../domain/kyc-submit-review';
import { ActVerdict, KycAct, actVerdict } from '../domain/kyc-acts';
import { organisationVerdict } from '../domain/kyc-org-status';
import { RoleWrite } from '../domain/kyc-role-scope';
import { KeysetCursor, encodeKeyset } from '../domain/kyc-cursor';
import { daysUntil } from '../domain/kyc-expiry';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { KycDeskReadModel, QueueFilter } from '../read-models/kyc-desk.read-model';
import { projectRoleKyc } from './kyc-role-projector';

export interface DeskActor { userId: string; permissions: ReadonlySet<string>; ip: string | null; requestId: string | null }
const can = (a: DeskActor, p: string) => a.permissions.has(p) || a.permissions.has('*');
export const KYC_MANAGE = 'kyc.manage';
export const KYC_REVIEW = 'kyc.review';
export const PII_REVEAL = 'member.pii.reveal';

@Injectable()
export class KycDeskService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly kyc: KycDocumentRepository,
    private readonly utr: UserTenantRoleRepository,
    private readonly desk: KycDeskReadModel,
    private readonly ui: UiMessageRepository,
    private readonly media: MediaService,
  ) {}

  private assertDesk(a: DeskActor) { if (!can(a, KYC_REVIEW) && !can(a, KYC_MANAGE)) throw new KycDeskRestrictedError(); }

  // ------------------------------------------------------------------------------------------------ reads (W121, W122)

  async overview(tenantId: string, actor: DeskActor) {
    this.assertDesk(actor);
    const [org, tiles] = await Promise.all([this.desk.organisation(tenantId), this.desk.memberTiles(tenantId)]);
    const verdict = organisationVerdict(org.requirements, org.docs, org.today);
    // One row per declared type, plus any organisation document of a type the country does not list (still shown).
    const listed = new Set(org.requirements.map((r) => r.docTypeCode));
    const lines = verdict.lines.map((l) => {
      const d = l.documentId ? org.docs.find((x) => x.id === l.documentId) ?? null : null;
      const renewal = org.docs.find((x) => x.docTypeCode === l.docTypeCode && x.status === 'pending' && x.id !== l.documentId) ?? null;
      return { ...l, docTypeName: d?.docTypeName ?? null, docNoMasked: d?.docNoMasked ?? null, daysLeft: l.validUntil ? daysUntil(l.validUntil, org.today) : null, renewalPendingId: renewal?.id ?? null };
    });
    const extra = org.docs.filter((d) => !listed.has(d.docTypeCode));
    return {
      today: org.today, countryCode: org.countryCode,
      organisation: { verified: verdict.verified, reason: verdict.reason, missingRequired: verdict.missingRequired, verifiedAt: verdict.verifiedAt, lines,
        unlisted: extra.map((d) => ({ id: d.id, docTypeCode: d.docTypeCode, docTypeName: d.docTypeName, status: d.status, validUntil: d.validUntil, docNoMasked: d.docNoMasked })),
        documentCount: org.docs.length },
      members: tiles,
      can: { manage: can(actor, KYC_MANAGE), review: can(actor, KYC_REVIEW), reveal: can(actor, PII_REVEAL) },
    };
  }

  async queue(tenantId: string, actor: DeskActor, f: QueueFilter) {
    this.assertDesk(actor);
    const rows = await this.desk.queue(tenantId, f);
    const last = rows[rows.length - 1];
    return { items: rows, nextCursor: rows.length === f.limit && last ? encodeKeyset(last.cursorTs, last.id) : null };
  }

  async record(tenantId: string, actor: DeskActor, id: string) {
    const rec = await this.desk.record(tenantId, id);
    if (!rec) throw new KycNotFoundError(id);
    // A member may read their OWN document's record; anyone else needs the desk.
    if (!(rec.doc.userId === actor.userId) && !can(actor, KYC_REVIEW) && !can(actor, KYC_MANAGE)) throw new KycDeskRestrictedError();
    const acts = await this.uow.run(tenantId, (tx) => this.verdicts(tx, tenantId, actor, id), { userId: actor.userId });
    return { ...rec, acts, can: { manage: can(actor, KYC_MANAGE), review: can(actor, KYC_REVIEW), reveal: can(actor, PII_REVEAL) } };
  }

  async catalogue(tenantId: string, actor: DeskActor, userId: string | null) {
    const self = userId === null || userId === actor.userId;
    if (!self) this.assertDesk(actor);
    const [cat, reasons] = await Promise.all([
      this.desk.formCatalogue(tenantId, userId ?? actor.userId),
      this.uow.run(tenantId, (tx) => this.kyc.reasonRules(tx), { userId: actor.userId }),
    ]);
    return { ...cat, reasons: [...reasons.entries()].map(([code, r]) => ({ code, acts: r.acts, needsNote: r.needsNote, name: r.name })) };
  }

  // ------------------------------------------------------------------------------------------------ submit (W2319–W2322)

  private async submitFacts(tx: TxContext, tenantId: string, actor: DeskActor, input: SubmitInput) {
    const kind = (input.subjectKind ?? 'user').trim() || 'user';
    const subjectUser = kind === 'user' ? ((input.userId ?? '').trim() || actor.userId) : null;
    const code = (input.docTypeCode ?? '').trim();
    // Sequential: one transaction is one connection.
    const known = code ? await this.kyc.resolveDocTypeId(tx, tenantId, code) : null;
    const registry = code && (kind === 'user' || kind === 'organisation') ? await this.kyc.registryRow(tx, code, kind) : null;
    const heldRows = subjectUser && /^[0-9a-f-]{36}$/i.test(subjectUser) ? await this.utr.roleFacts(tx, tenantId, subjectUser) : [];
    const map = await this.kyc.roleMap(tx);
    const today = await this.kyc.today(tx, tenantId);
    const held = heldRows.filter((r) => r.isActive).map((r) => r.roleCode);
    const subjectRef = kind === 'organisation' ? tenantId : subjectUser;
    const mediaId = (input.mediaId ?? '').trim();
    const refOk = Boolean(code && subjectRef && /^[0-9a-f-]{36}$/i.test(subjectRef));
    const media = mediaId ? await this.kyc.mediaFacts(tx, tenantId, mediaId) : null;
    const dup = refOk ? await this.kyc.openSubmission(tx, tenantId, kind, subjectRef!, code) : null;
    const current = refOk ? await this.kyc.currentOfType(tx, tenantId, kind, subjectRef!, code) : null;
    return {
      docTypeId: known,
      facts: {
        actorUserId: actor.userId, canManage: can(actor, KYC_MANAGE), docType: registry, docTypeKnown: known !== null,
        heldRoles: kind === 'user' ? (held.length > 0 ? held : null) : [], map, media, openDuplicateId: dup, current, today,
      },
    };
  }

  /** W2320's review — the same function the writer re-takes. Read-only. */
  async previewSubmit(tenantId: string, actor: DeskActor, input: SubmitInput): Promise<SubmitReview> {
    return this.uow.run(tenantId, async (tx) => buildSubmitReview(input, (await this.submitFacts(tx, tenantId, actor, input)).facts), { userId: actor.userId });
  }

  async submit(tenantId: string, actor: DeskActor, input: SubmitInput, key: string): Promise<{ id: string; status: string; evidences: string[]; follows: SubmitReview['follows']; roleWrites: RoleWrite[] }> {
    return this.idem.remember(key, actor.userId, 'identity.kyc.submit', () => this.uow.run(tenantId, async (tx) => {
      const { facts, docTypeId } = await this.submitFacts(tx, tenantId, actor, input);
      const review = buildSubmitReview(input, facts);
      if (!review.ready || !docTypeId) throw new KycDeskRefusedError(review.refusals);
      const s = Object.fromEntries(review.fields.map((f) => [f.name, f.stored])) as Record<string, string | null>;
      const roleId = s.roleCode ? await this.roleIdOf(tx, s.roleCode) : null;
      const doc = KycDocument.submit({
        id: uuidv7(), tenantId, subjectKind: review.subjectKind!, userId: review.subjectKind === 'user' ? s.userId : null,
        organisationId: review.subjectKind === 'organisation' ? tenantId : null, roleId, docTypeId, docTypeCode: s.docTypeCode,
        mediaId: s.mediaId, docNoMasked: s.docNoMasked, issuedBy: s.issuedBy, validFrom: s.validFrom, validUntil: s.validUntil,
        submittedBy: actor.userId, supersedesId: review.follows?.id ?? null,
      });
      await this.kyc.insert(tx, doc);
      await this.kyc.insertDecision(tx, { tenantId, documentId: doc.id, act: 'submit', fromStatus: null, toStatus: 'pending', decidedBy: actor.userId, via: review.self ? 'submitter' : 'desk', idempotencyKey: key });
      const roleWrites = doc.userId ? await projectRoleKyc(tx, tenantId, doc.userId, this.kyc, this.utr) : [];
      await this.flush(tx, tenantId, doc.id, doc.pullEvents());
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'kyc.document.submitted', entityType: 'kyc_document', entityId: doc.id, oldValue: null,
        newValue: { subjectKind: review.subjectKind, userId: doc.userId, docTypeCode: s.docTypeCode, validUntil: s.validUntil, follows: review.follows, evidences: review.evidences, roleWrites },
        reason: null, ip: actor.ip, requestId: actor.requestId,
      });
      return { id: doc.id, status: 'pending', evidences: review.evidences, follows: review.follows, roleWrites };
    }, { userId: actor.userId }));
  }

  private async roleIdOf(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM roles WHERE code = $1`, [code]);
    return r.rows[0]?.id ?? null;
  }

  // ------------------------------------------------------------------------------------------------ acts (W2323–W2325)

  private async verdictFor(tx: TxContext, tenantId: string, actor: DeskActor, doc: KycDocument, act: KycAct, input: { reasonCode?: string | null; note?: string | null }, judgeWords: boolean): Promise<ActVerdict> {
    const p = doc.toProps();
    const isAdmin = await this.utr.isTenantAdmin(tx, tenantId, actor.userId);
    const revealed = await this.kyc.revealedBy(tx, tenantId, p.id, actor.userId);
    const media = p.mediaId ? await this.kyc.mediaFacts(tx, tenantId, p.mediaId) : null;
    const reasons = await this.kyc.reasonRules(tx);
    const today = await this.kyc.today(tx, tenantId);
    return actVerdict(act,
      { status: p.status, subjectKind: p.subjectKind, userId: p.userId, submittedBy: p.submittedBy, hasMedia: p.mediaId !== null, scanStatus: media?.scanStatus ?? null, validUntil: p.validUntil },
      { userId: actor.userId, canReview: can(actor, KYC_REVIEW), canReveal: can(actor, PII_REVEAL), isTenantAdmin: isAdmin },
      { revealedByActor: revealed, reasonCode: input.reasonCode, note: input.note, reasons, today, judgeWords });
  }

  /** Every act's verdict on a document, as the record page prints them (without judging words not typed yet). */
  private async verdicts(tx: TxContext, tenantId: string, actor: DeskActor, id: string): Promise<ActVerdict[]> {
    const doc = await this.kyc.getById(tenantId, id);
    if (!doc) return [];
    const out: ActVerdict[] = [];
    for (const a of ['reveal', 'verify', 'reject', 'request_more'] as KycAct[]) out.push(await this.verdictFor(tx, tenantId, actor, doc, a, {}, false));
    return out;
  }

  async previewAct(tenantId: string, actor: DeskActor, id: string, act: KycAct, input: { reasonCode?: string | null; note?: string | null }): Promise<ActVerdict & { document: { id: string; status: string; docTypeCode: string | null; subjectKind: string } }> {
    return this.uow.run(tenantId, async (tx) => {
      const doc = await this.kyc.getById(tenantId, id);
      if (!doc) throw new KycNotFoundError(id);
      const v = await this.verdictFor(tx, tenantId, actor, doc, act, input, true);
      const p = doc.toProps();
      return { ...v, document: { id: p.id, status: p.status, docTypeCode: p.docTypeCode, subjectKind: p.subjectKind } };
    }, { userId: actor.userId });
  }

  async act(tenantId: string, actor: DeskActor, id: string, act: KycAct, input: { reasonCode?: string | null; note?: string | null }, key: string) {
    if (act === 'reveal') return this.reveal(tenantId, actor, id, input.note ?? '', key);
    return this.idem.remember(key, actor.userId, `identity.kyc.${act}`, () => this.uow.run(tenantId, async (tx) => {
      const doc = await this.kyc.getForUpdate(tx, tenantId, id);
      if (!doc) throw new KycNotFoundError(id);
      const v = await this.verdictFor(tx, tenantId, actor, doc, act, input, true);
      if (!v.allowed) throw new KycDeskRefusedError(v.refusals.map((code) => ({ field: null, code })));
      const before = doc.status;
      const note = (input.note ?? '').replace(/\s+/g, ' ').trim() || null;
      const words = await this.words(tx, doc.toProps().docTypeCode, input.reasonCode ?? null);
      if (act === 'verify') doc.verify(actor.userId, new Date(), { document: words.document });
      else doc.reject(actor.userId, note ?? words.reasonName ?? 'rejected', new Date(), { reasonCode: input.reasonCode!, decision: act, extra: { document: words.document, reason: words.reason } });
      await this.kyc.update(tx, doc, actor.userId);
      await this.kyc.insertDecision(tx, { tenantId, documentId: doc.id, act, fromStatus: before, toStatus: doc.status, reasonCode: act === 'verify' ? null : input.reasonCode, note, decidedBy: actor.userId, via: 'desk', idempotencyKey: key });
      const roleWrites = doc.userId ? await projectRoleKyc(tx, tenantId, doc.userId, this.kyc, this.utr) : [];
      await this.flush(tx, tenantId, doc.id, doc.pullEvents());
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: `kyc.document.${act}`, entityType: 'kyc_document', entityId: doc.id,
        oldValue: { status: before }, newValue: { status: doc.status, reasonCode: doc.toProps().reasonCode, roleWrites },
        reason: note ?? input.reasonCode ?? null, ip: actor.ip, requestId: actor.requestId,
      });
      return { id: doc.id, status: doc.status as string, roleWrites, url: null as string | null, expiresInSec: null as number | null };
    }, { userId: actor.userId }));
  }

  /**
   * REVEAL THE EVIDENCE (W122 / W2323 "Reveal full document (recorded)"). Authorise → find → RECORD (a decision row + an
   * audit row, committed) → then mint the 15-minute signed read through core/media (a clean scan only). If the record
   * cannot be written, no link exists. The audit row carries the reason, never the document.
   */
  private async reveal(tenantId: string, actor: DeskActor, id: string, reason: string, key: string) {
    const recorded = await this.idem.remember(key, actor.userId, 'identity.kyc.reveal', () => this.uow.run(tenantId, async (tx) => {
      const doc = await this.kyc.getForUpdate(tx, tenantId, id);
      if (!doc) throw new KycNotFoundError(id);
      const v = await this.verdictFor(tx, tenantId, actor, doc, 'reveal', { note: reason }, true);
      if (!v.allowed) throw new KycDeskRefusedError(v.refusals.map((code) => ({ field: null, code })));
      const note = reason.replace(/\s+/g, ' ').trim();
      await this.kyc.insertDecision(tx, { tenantId, documentId: doc.id, act: 'reveal', fromStatus: doc.status, toStatus: doc.status, note, decidedBy: actor.userId, via: 'desk', idempotencyKey: key });
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'kyc.document.revealed', entityType: 'kyc_document', entityId: doc.id,
        oldValue: null, newValue: { field: 'evidence', mediaId: doc.toProps().mediaId }, reason: note, ip: actor.ip, requestId: actor.requestId,
      });
      return { id: doc.id, mediaId: doc.toProps().mediaId as string, status: doc.status as string };
    }, { userId: actor.userId }));
    const link = await this.media.getDownloadUrl(tenantId, { userId: actor.userId, canModerate: true }, recorded.mediaId);
    return { id: recorded.id, status: recorded.status, roleWrites: [] as RoleWrite[], url: link.url, expiresInSec: link.expiresInSec };
  }

  private async words(tx: TxContext, docTypeCode: string | null, reasonCode: string | null): Promise<{ document: LangMap; reason: LangMap | null; reasonName: string | null }> {
    const docs = await this.ui.mapsUnder('kyc.doc_type.', tx);
    const document = (docTypeCode && docs.get(`kyc.doc_type.${docTypeCode}`)) || { en: docTypeCode ?? 'document' };
    if (!reasonCode) return { document, reason: null, reasonName: null };
    const reasons = await this.ui.mapsUnder('kyc.reason.', tx);
    const reason = reasons.get(`kyc.reason.${reasonCode}`) ?? { en: reasonCode };
    return { document, reason, reasonName: reason.en };
  }

  async documentWords(tx: TxContext, docTypeCode: string | null): Promise<LangMap> { return (await this.words(tx, docTypeCode, null)).document; }

  private async flush(tx: TxContext, tenantId: string, id: string, events: { type: string; payload: Record<string, unknown> }[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'kyc_document', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}

export type { KeysetCursor };
