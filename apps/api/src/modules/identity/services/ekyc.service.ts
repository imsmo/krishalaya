// modules/identity/services/ekyc.service.ts · Aadhaar/PAN eKYC start + OTP verify (audited, tokenised).
//
// FLOW (the raw id NEVER leaves this method's argument → provider boundary):
//   start(docType, idNumber):
//     1. validate the raw id locally (format + checksum) — reject BEFORE any provider call (anti-abuse).
//     2. call provider.start(rawId) — the adapter is the LAST place the raw id exists; it returns an opaque ref.
//     3. persist an ekyc_session bound to (tenant,user) with ONLY masked id + last-4 + provider ref. Never the raw id.
//   verify(sessionId, otp):
//     1. re-resolve the session by id AND the calling user (anti-IDOR; 404 to anyone else).
//     2. call provider.verify(ref, otp). On success → write the VAULT REF + last-4 onto the user, create a verified
//        kyc_documents row (verify_method=ekyc:<provider>, NO PII in verify_payload), flip the role kyc_status, audit.
//        On failure → count the attempt; lock after the cap.
//
// Idempotency, UoW (tx), outbox-in-tx and append-only audit are all honoured. Money is not involved.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { EKYC_PROVIDER, EkycProvider } from '../gateway/ekyc-provider.port';
import { EkycSession, EkycDoc } from '../domain/ekyc-session.entity';
import { EkycSessionRepository } from '../repositories/ekyc-session.repository';
import { UserRepository } from '../repositories/user.repository';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { KycDocument } from '../domain/kyc-document.entity';
import { projectRoleKyc } from './kyc-role-projector';
import { isValidId, maskId, last4 } from '../domain/id-masking';
import {
  InvalidGovIdError, EkycSessionNotFoundError, EkycVerificationFailedError, EkycTooManyAttemptsError, UserNotFoundError,
} from '../domain/identity.errors';

interface StartInput { docType: EkycDoc; idNumber: string; fullName?: string | null }
interface VerifyInput { sessionId: string; otp: string }

@Injectable()
export class EkycService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(EKYC_PROVIDER) private readonly provider: EkycProvider,
    private readonly audit: AuditWriter,
    private readonly sessions: EkycSessionRepository,
    private readonly users: UserRepository,
    private readonly kyc: KycDocumentRepository,
    private readonly utr: UserTenantRoleRepository,
  ) {}

  /** Begin a verification. The raw id is validated, sent to the provider, then discarded — only masked + ref persist. */
  async start(tenantId: string, userId: string, dto: StartInput) {
    // (1) local validation — never call the provider on garbage; never log the raw id.
    if (!isValidId(dto.docType, dto.idNumber)) throw new InvalidGovIdError(dto.docType);

    // (2) provider start (the raw id boundary). Outside the tx — it's a remote call; the breaker/timeout guard it.
    const started = await this.provider.start({ docType: dto.docType, idNumber: dto.idNumber, fullName: dto.fullName ?? null });
    const maskedId = maskId(dto.docType, dto.idNumber);
    const l4 = last4(dto.idNumber);

    // (3) persist the session (masked-only) bound to the user; one in-flight per (user,docType).
    const result = await this.uow.run(tenantId, async (tx) => {
      const existing = await this.sessions.findPending(tx, tenantId, userId, dto.docType);
      if (existing) existing.expire(), await this.sessions.update(tx, existing); // supersede any stale pending one

      const session = EkycSession.start({
        id: uuidv7(), tenantId, userId, docType: dto.docType, providerCode: this.provider.providerCode,
        providerRef: started.providerRef, maskedId, last4: l4, otpRequired: started.otpRequired,
      });
      await this.sessions.insert(tx, session);
      await this.flush(tx, session.id, session.pullEvents(), tenantId);
      await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'identity.ekyc.start', entityType: 'ekyc_session', entityId: session.id, oldValue: null, newValue: { docType: dto.docType, maskedId, otpRequired: started.otpRequired }, reason: null, ip: null });
      return { id: session.id, docType: dto.docType, maskedId, otpRequired: started.otpRequired };
    }, { userId });
    return result;
  }

  /** Submit the OTP for a session. On success the verified vault ref + last-4 land on the user + a KYC doc is written. */
  async verify(tenantId: string, userId: string, dto: VerifyInput) {
    // load + anti-IDOR guard (id + user) and attempt-cap check BEFORE the remote call
    const pre = await this.uow.run(tenantId, async (tx) => {
      const s = await this.sessions.getOwnedForUpdate(tx, tenantId, dto.sessionId, userId);
      if (!s || s.status !== 'pending') throw new EkycSessionNotFoundError(dto.sessionId);
      if (s.isExpired()) { s.expire(); await this.sessions.update(tx, s); throw new EkycSessionNotFoundError(dto.sessionId); }
      s.assertCanAttempt();
      return { providerRef: s.providerRef, docType: s.docType };
    }, { userId });

    // remote verify (single attempt — adapter does NOT auto-retry an OTP). Outside the tx.
    const out = await this.provider.verify({ providerRef: pre.providerRef, otp: dto.otp });

    // apply the outcome in one tx (re-load under lock to avoid a lost update)
    return this.uow.run(tenantId, async (tx) => {
      const s = await this.sessions.getOwnedForUpdate(tx, tenantId, dto.sessionId, userId);
      if (!s || s.status !== 'pending') throw new EkycSessionNotFoundError(dto.sessionId);

      if (!out.verified || !out.vaultRef) {
        s.recordFailure(out.failureReason ?? 'verification_failed');
        await this.sessions.update(tx, s);
        await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'identity.ekyc.verify_failed', entityType: 'ekyc_session', entityId: s.id, oldValue: null, newValue: { reason: out.failureReason ?? 'verification_failed', attempts: s.toProps().attempts }, reason: null, ip: null });
        await this.flush(tx, s.id, s.pullEvents(), tenantId);
        if (s.toProps().status === 'failed') throw new EkycTooManyAttemptsError();
        throw new EkycVerificationFailedError(out.failureReason ?? 'verification failed');
      }

      // SUCCESS — persist ONLY the opaque vault ref + last-4 (the raw id was never stored).
      s.markVerified({ nameMatch: out.nameMatch ?? null, validUntil: out.validUntil ?? null });
      await this.sessions.update(tx, s);

      const user = await this.users.getForUpdate(tx, userId);
      if (!user) throw new UserNotFoundError(userId);
      const props = s.toProps();
      if (props.docType === 'aadhaar') await this.users.setVaultRef(tx, userId, { aadhaarVaultRef: out.vaultRef, aadhaarLast4: props.last4 });
      else await this.users.setVaultRef(tx, userId, { panVaultRef: out.vaultRef });

      // [PC-56 TENANT-9a] F-1: a provider attestation verifies ONLY the roles its document type evidences (0180's
      // `kyc_doc_type_roles` — Aadhaar evidences the identity-only capacities, never a seller's), through the one writer of
      // role status (`projectRoleKyc`). No human reviewed it, so `reviewed_by` stays NULL (before 0180 the subject was
      // recorded as their own reviewer). And a NAME MISMATCH no longer verifies anything: the document is filed `pending`
      // for the desk, which decides it with the evidence in front of it.
      const docTypeId = await this.kyc.resolveDocTypeId(tx, tenantId, props.docType);
      let roleWrites: unknown[] = [];
      if (docTypeId) {
        const nameMismatch = out.nameMatch === false;
        const open = nameMismatch ? await this.kyc.openSubmission(tx, tenantId, 'user', userId, props.docType) : null;
        if (!open) {
          const doc = KycDocument.submit({ id: uuidv7(), tenantId, userId, docTypeId, docTypeCode: props.docType, mediaId: null, docNoMasked: props.maskedId, verifyMethod: `ekyc:${this.provider.providerCode}`, validUntil: props.validUntil, submittedBy: userId });
          if (!nameMismatch) doc.verify(null);
          await this.kyc.insert(tx, doc);
          await this.kyc.insertDecision(tx, nameMismatch
            ? { tenantId, documentId: doc.id, act: 'submit', fromStatus: null, toStatus: 'pending', decidedBy: userId, via: 'submitter', note: 'eKYC name mismatch — filed for the desk' }
            : { tenantId, documentId: doc.id, act: 'verify', fromStatus: null, toStatus: 'verified', decidedBy: null, via: 'ekyc' });
          await this.flush(tx, doc.id, doc.pullEvents(), tenantId);
        }
        roleWrites = await projectRoleKyc(tx, tenantId, userId, this.kyc, this.utr);
      }

      await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'identity.ekyc.verified', entityType: 'ekyc_session', entityId: s.id, oldValue: null, newValue: { docType: props.docType, maskedId: props.maskedId, nameMatch: out.nameMatch ?? null, roleWrites }, reason: null, ip: null });
      await this.flush(tx, s.id, s.pullEvents(), tenantId);
      return { id: s.id, status: 'verified' as const, docType: props.docType, maskedId: props.maskedId, nameMatch: out.nameMatch ?? null };
    }, { userId });
  }

  /** Owner's recent eKYC sessions (masked-only). Keyset pagination. */
  async list(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.sessions.listForUser(tenantId, userId, opts);
    return rows.map((s) => {
      const p = s.toProps();
      return { id: p.id, docType: p.docType, maskedId: p.maskedId, status: p.status, nameMatch: p.nameMatch, createdAt: undefined };
    });
  }

  private async flush(tx: TxContext, id: string, events: { type: string; payload: Record<string, unknown> }[], tenantId: string) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'ekyc_session', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
