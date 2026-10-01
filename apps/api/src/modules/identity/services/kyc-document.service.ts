// modules/identity/services/kyc-document.service.ts · KYC: a member's own submission + the reviewer's reads.
//
// [PC-56 TENANT-9a] The writes moved to `KycDeskService` (one reviewed submit, one set of acts — F-1/F-2's single writer
// of role status is `projectRoleKyc`). This service keeps the member's own reads and adapts the legacy self-submit
// (`docTypeId` + optional `roleId`) and the legacy review route (`decision` + free-text reason) onto the desk, so the old
// SDK calls keep working under the new rules instead of the old ones.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { SubmitKycDto, ReviewKycDto } from '../dto/create-kyc-document.dto';
import { KycDeskService, DeskActor } from './kyc-desk.service';
import { encodeKeyset, KeysetCursor } from '../domain/kyc-cursor';

@Injectable()
export class KycDocumentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly kyc: KycDocumentRepository,
    private readonly desk: KycDeskService,
  ) {}

  /** A member's OWN document (no desk verb: it is theirs). Reviewed by the desk's builder; the key is the caller's. */
  async submit(tenantId: string, actor: DeskActor, dto: SubmitKycDto, key: string) {
    const codes = await this.uow.run(tenantId, async (tx) => {
      const docTypeCode = await this.kyc.docTypeCodeOf(tx, dto.docTypeId);
      const role = dto.roleId ? await tx.query<{ code: string }>(`SELECT code FROM roles WHERE id = $1`, [dto.roleId]) : null;
      return { docTypeCode, roleCode: role?.rows[0]?.code ?? null };
    }, { userId: actor.userId });
    const r = await this.desk.submit(tenantId, actor, {
      subjectKind: 'user', userId: actor.userId, docTypeCode: codes.docTypeCode ?? dto.docTypeId, roleCode: codes.roleCode ?? (dto.roleId ? dto.roleId : null),
      mediaId: dto.mediaId, docNoMasked: dto.docNoMasked, issuedBy: dto.issuedBy, validFrom: dto.validFrom, validUntil: dto.validUntil,
    }, key);
    return { id: r.id, evidences: r.evidences, follows: r.follows };
  }

  /** The legacy review route, on the desk's rules (kyc.review, maker ≠ checker, evidence before decision, coded reason). */
  review(tenantId: string, actor: DeskActor, kycId: string, dto: ReviewKycDto, key: string) {
    const act = dto.decision === 'verify' ? 'verify' as const : 'reject' as const;
    return this.desk.act(tenantId, actor, kycId, act, { reasonCode: act === 'reject' ? (dto.reasonCode ?? 'other') : null, note: dto.reason ?? null }, key)
      .then((r) => ({ status: r.status, roleWrites: r.roleWrites }));
  }

  list(tenantId: string, userId: string, status?: string) {
    return this.kyc.listByUser(tenantId, userId, status).then((docs) => docs.map((d) => d.toProps()));
  }

  /** PC-54 W54-1 → PC-56 TENANT-9a: the reviewer QUEUE, keyset on the microsecond instant (F-7). */
  async reviewQueue(tenantId: string, q: { status: string; cursor?: KeysetCursor; limit: number }) {
    const rows = await this.kyc.listForReview(tenantId, q);
    const items = rows.map((r) => ({ ...r.doc.toProps(), createdAt: r.createdAt }));
    const last = rows[rows.length - 1];
    const nextCursor = items.length === q.limit && last ? encodeKeyset(last.cursorTs, last.doc.id) : null;
    return { items, nextCursor };
  }
  async reviewCase(tenantId: string, id: string) {
    const doc = await this.kyc.getById(tenantId, id);
    return doc ? doc.toProps() : null;
  }
  listExpiring(tenantId: string, userId: string, days = 90) {
    return this.kyc.listExpiring(tenantId, userId, days).then((docs) => docs.map((d) => d.toProps()));
  }
  listDocTypes(tenantId: string) {
    return this.kyc.listDocTypes(tenantId);
  }
}
