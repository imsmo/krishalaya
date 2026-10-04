// modules/identity/services/kyc-queue.service.ts · PC-56 TENANT-SW-c · A2 — W157 "Take next", W158 "Skip (take next)".
//
// TAKE NEXT = one transaction: return the caller's own live claim if they hold one (taking next twice is one claim); else release their
// stale claims, lock the OLDEST pending member document they may decide FOR UPDATE SKIP LOCKED (not theirs, not submitted by them, not
// one they are recused from — the database's `kv_kyc_recusal` — and not live-claimed), release a stale claim left on it, and insert a
// 15-minute claim (0199's trigger re-checks every rule and the session). Two people taking next at the same instant get two documents.
// SKIP = release the claim with a coded reason (`other` needs words) and take next, never the same document again in that act.
// RELEASE = give it back. The EXPIRY JOB releases claims left past their 15 minutes (kv_app UoW per tenant).
// Needs `kyc.review` (the desk verb). Every act is audited (the reason is a code, never a member's data).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { VerificationTeamRepository, ClaimRow } from '../repositories/verification-team.repository';
import { KycDeskRestrictedError } from '../domain/identity.errors';
import { CLAIM_MINUTES, cleanReason, skipRefusal } from '../domain/verification-team';
import { namedSwcRefusal, swcRefused } from '../domain/swc.errors';
import { KYC_REVIEW, DeskActor } from './kyc-desk.service';

const can = (a: DeskActor, p: string) => a.permissions.has(p) || a.permissions.has('*');
export interface ClaimResult { claim: ClaimRow | null; documentId: string | null; reason: 'claimed' | 'already_holding' | 'queue_empty'; minutes: number }

@Injectable()
export class KycQueueService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly repo: VerificationTeamRepository,
  ) {}

  private assertReviewer(a: DeskActor) { if (!can(a, KYC_REVIEW)) throw new KycDeskRestrictedError(); }

  /** One claim inside the caller's transaction; `exclude` = the document just skipped. */
  private async claimIn(tx: TxContext, tenantId: string, a: DeskActor, exclude: string | null): Promise<ClaimResult> {
    const held = await this.repo.liveClaimOfTx(tx, tenantId, a.userId);
    if (held && (await this.repo.documentStatusTx(tx, tenantId, held.documentId)) === 'pending') {
      return { claim: held, documentId: held.documentId, reason: 'already_holding', minutes: CLAIM_MINUTES };
    }
    if (held) await this.repo.releaseTx(tx, tenantId, held.id, a.userId, 'released', null, 'document no longer pending');
    await this.repo.releaseOwnStaleTx(tx, tenantId, a.userId);
    const docId = await this.repo.lockNextTx(tx, tenantId, a.userId, exclude);
    if (!docId) return { claim: null, documentId: null, reason: 'queue_empty', minutes: CLAIM_MINUTES };
    await this.repo.releaseStaleOnDocTx(tx, tenantId, docId);
    const claim = await this.repo.insertClaimTx(tx, tenantId, docId, a.userId);
    await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'kyc.claim.taken', entityType: 'kyc_document', entityId: docId,
      newValue: { claimId: claim.id, expiresAt: claim.expiresAt }, ip: a.ip, requestId: a.requestId });
    return { claim, documentId: docId, reason: 'claimed', minutes: CLAIM_MINUTES };
  }

  async takeNext(tenantId: string, a: DeskActor, key: string): Promise<ClaimResult> {
    this.assertReviewer(a);
    try {
      return await this.idem.remember(key, a.userId, 'identity.kyc.claim', () => this.uow.run(tenantId, (tx) => this.claimIn(tx, tenantId, a, null), { userId: a.userId }));
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async skip(tenantId: string, a: DeskActor, claimId: string, input: { reasonCode?: string; note?: string }, key: string): Promise<ClaimResult & { skipped: string }> {
    this.assertReviewer(a);
    const refusal = skipRefusal(input.reasonCode, input.note);
    if (refusal) throw swcRefused(refusal);
    const note = cleanReason(input.note) || null;
    try {
      return await this.idem.remember(key, a.userId, 'identity.kyc.skip', () => this.uow.run(tenantId, async (tx) => {
        const c = await this.repo.claimByIdTx(tx, tenantId, claimId);
        if (!c || c.releasedAt || c.claimedBy !== a.userId) throw swcRefused('CLAIM_NOT_FOUND');
        await this.repo.releaseTx(tx, tenantId, c.id, a.userId, 'skip', input.reasonCode!, note);
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'kyc.claim.skipped', entityType: 'kyc_document', entityId: c.documentId,
          newValue: { claimId: c.id, reasonCode: input.reasonCode }, reason: input.reasonCode ?? null, ip: a.ip, requestId: a.requestId });
        const next = await this.claimIn(tx, tenantId, a, c.documentId);
        return { ...next, skipped: c.documentId };
      }, { userId: a.userId }));
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async release(tenantId: string, a: DeskActor, claimId: string): Promise<{ released: true; documentId: string }> {
    this.assertReviewer(a);
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const c = await this.repo.claimByIdTx(tx, tenantId, claimId);
        if (!c || c.releasedAt || c.claimedBy !== a.userId) throw swcRefused('CLAIM_NOT_FOUND');
        await this.repo.releaseTx(tx, tenantId, c.id, a.userId, 'released', null, null);
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'kyc.claim.released', entityType: 'kyc_document', entityId: c.documentId,
          newValue: { claimId: c.id }, ip: a.ip, requestId: a.requestId });
        return { released: true as const, documentId: c.documentId };
      }, { userId: a.userId });
    } catch (e) { throw namedSwcRefusal(e); }
  }

  async mine(tenantId: string, a: DeskActor): Promise<ClaimRow | null> {
    this.assertReviewer(a);
    return this.uow.run(tenantId, (tx) => this.repo.liveClaimOfTx(tx, tenantId, a.userId), { userId: a.userId });
  }

  /** The expiry job's one tenant: release every claim left past its 15 minutes. */
  async expireStale(tenantId: string, limit = 200): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      let n = 0;
      for (const id of await this.repo.staleClaimIdsTx(tx, tenantId, limit)) if (await this.repo.expireClaimTx(tx, tenantId, id)) n++;
      return n;
    }, { userId: undefined });
  }
}
