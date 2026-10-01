// modules/identity/domain/kyc-document.entity.ts
// A submitted KYC document + its verification lifecycle (state machine). Only a
// MASKED document number is stored here; the verified identifier lives in an
// external vault (referenced from the user). Expiry is tracked for renewals.
//
// [PC-56 TENANT-9a] A document has a SUBJECT — a person (`user`) or the organisation itself (`organisation`, the tenant;
// F-5: the cooperative's licence is not its admin's personal document). It names its MAKER (`submittedBy`), the document it
// FOLLOWS (`supersedesId` — a renewal or a resubmission is a new row; the old one is never touched by the upload, F-2), and
// a refusal carries a CODED reason (`reasonCode`, the `kyc_decision_reason` vocabulary). Its outbox events carry
// `notifyUserId` (the subject, or the submitter of an organisation document) and the document type, so the notice names
// what was decided (F-15).
import { KycStatus, assertKycTransition } from './kyc-document.state';
import type { DomainEvent } from './user.entity';

export type KycSubjectKind = 'user' | 'organisation';

export interface KycDocumentProps {
  id: string;
  tenantId: string | null;
  subjectKind: KycSubjectKind;
  userId: string | null;
  organisationId: string | null;
  roleId: string | null;
  docTypeId: string;
  docTypeCode: string | null;
  mediaId: string | null;   // null for eKYC (provider attestation, no uploaded image); required for manual submit
  docNoMasked: string | null;
  issuedBy: string | null;
  validFrom: string | null;
  validUntil: string | null;
  status: KycStatus;
  verifyMethod: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
  reasonCode: string | null;
  lastDecision: string;
  submittedBy: string;
  supersedesId: string | null;
}

export class KycDocument {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: KycDocumentProps) {}

  static submit(input: {
    id: string; tenantId: string | null; userId?: string | null; subjectKind?: KycSubjectKind; organisationId?: string | null;
    roleId?: string | null; docTypeId: string; docTypeCode?: string | null; mediaId?: string | null; docNoMasked?: string | null;
    issuedBy?: string | null; validFrom?: string | null; validUntil?: string | null; verifyMethod?: string;
    submittedBy?: string; supersedesId?: string | null;
  }): KycDocument {
    const subjectKind = input.subjectKind ?? 'user';
    const userId = subjectKind === 'user' ? (input.userId ?? null) : null;
    const submittedBy = input.submittedBy ?? userId;
    if (!submittedBy) throw new Error('KycDocument.submit: a document names who submitted it');
    const d = new KycDocument({
      id: input.id, tenantId: input.tenantId, subjectKind, userId,
      organisationId: subjectKind === 'organisation' ? (input.organisationId ?? input.tenantId) : null,
      roleId: input.roleId ?? null, docTypeId: input.docTypeId, docTypeCode: input.docTypeCode ?? null,
      mediaId: input.mediaId ?? null, docNoMasked: input.docNoMasked ?? null,
      issuedBy: input.issuedBy ?? null, validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null,
      status: 'pending', verifyMethod: input.verifyMethod ?? 'manual', reviewedBy: null, reviewedAt: null, rejectReason: null,
      reasonCode: null, lastDecision: 'submit', submittedBy, supersedesId: input.supersedesId ?? null,
    });
    d.events.push({ type: 'identity.kyc_submitted', payload: { kycId: d.props.id, userId: d.props.userId, tenantId: d.props.tenantId, subjectKind, docTypeCode: d.props.docTypeCode } });
    return d;
  }
  static rehydrate(props: KycDocumentProps): KycDocument { return new KycDocument(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get userId() { return this.props.userId; }
  /** Who a notice about this document goes to: the person it is about, else (an organisation's) whoever submitted it. */
  get notifyUserId(): string { return this.props.userId ?? this.props.submittedBy; }
  toProps(): Readonly<KycDocumentProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** A desk verification (`reviewerId` a person) or a provider attestation (`reviewerId` null — 0180: no human reviewer;
   *  before 0180 the subject was recorded as their own reviewer). */
  verify(reviewerId: string | null, now: Date = new Date(), extra: Record<string, unknown> = {}): void {
    assertKycTransition(this.props.status, 'verified');
    this.props.status = 'verified'; this.props.reviewedBy = reviewerId; this.props.reviewedAt = now; this.props.rejectReason = null;
    this.props.reasonCode = null; this.props.lastDecision = 'verify';
    this.events.push({ type: 'identity.kyc_verified', payload: { kycId: this.props.id, userId: this.props.userId, tenantId: this.props.tenantId, notifyUserId: this.notifyUserId, docTypeCode: this.props.docTypeCode, ...extra } });
  }
  /** Reject (or ask for more — `decision`), with a CODED reason; `note` is the reviewer's own words when given. */
  reject(reviewerId: string, reason: string, now: Date = new Date(), opts: { reasonCode?: string; decision?: 'reject' | 'request_more'; extra?: Record<string, unknown> } = {}): void {
    assertKycTransition(this.props.status, 'rejected');
    this.props.status = 'rejected'; this.props.reviewedBy = reviewerId; this.props.reviewedAt = now; this.props.rejectReason = reason;
    this.props.reasonCode = opts.reasonCode ?? 'other'; this.props.lastDecision = opts.decision ?? 'reject';
    this.events.push({ type: 'identity.kyc_rejected', payload: { kycId: this.props.id, userId: this.props.userId, reason, reasonCode: this.props.reasonCode, decision: this.props.lastDecision, notifyUserId: this.notifyUserId, docTypeCode: this.props.docTypeCode, ...(opts.extra ?? {}) } });
  }
  expire(): void { assertKycTransition(this.props.status, 'expired'); this.props.status = 'expired'; this.props.lastDecision = 'expire'; }
}
