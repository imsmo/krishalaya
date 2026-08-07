// apps/admin-api/src/modules/ledger-correction/services/correction.service.ts · W068 (PC-56 ADMIN-5e).
//
// The platform's EIGHTH maker-checker site, and the one where the two people are furthest apart in what they are
// trusted with: `ledger.investigate` drafts and cannot post; `ledger.correct` posts and, on this platform, will
// usually not have drafted.
//
// THE ORDER OF OPERATIONS IN `approve` IS THE WHOLE SERVICE, so it is stated once here and again inline:
//   1. lock the draft, 2. re-verify the balance against the legs AS THEY ARE NOW, 3. refuse the maker,
//   4. POST TO THE WALLET-SERVICE, 5. only then record the decision and close the case, in one transaction.
// Step 4 before step 5 is deliberate and is the opposite of the usual advice. A draft marked `posted` with no
// transaction id is a lie that survives; a posted transaction with an un-updated draft is a discrepancy the very
// recon plane this correction came from will surface tomorrow. Given a choice of which side of a crash to be on,
// be on the side where the ledger is right.
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { isSecondPerson } from '../../../core/approval/two-person-rule';
import { WALLET_ADMIN, WalletAdminPort } from '../../../core/wallet/wallet-admin.port';
import { CorrectionRepository } from '../repositories/correction.repository';
import {
  assertLeg, assertSubmittable, assertApprovable, submitState, approveState, balanceOf, buildPost,
  formatMinor, FOUNDER_THRESHOLD_MINOR, REASON_MIN, CORRECTION_TXN_TYPE, type CorrectionDraft,
} from '../domain/correction';
import {
  InvalidCorrectionError, CorrectionNotFoundError, CorrectionPostFailedError,
} from '../domain/ledger-correction.errors';
import type { OpenDraftDto, SaveLegsDto, DecideDto } from '../dto/ledger-correction.dto';

/** WHAT LEAVES THE SERVICE IS INFERRED FROM `view()` RATHER THAN DECLARED HERE.
 *
 *  A hand-written interface beside a builder is a second place the money shape can be stated, and the two drift —
 *  the risk being a declared `amountMinor: number` sitting above a builder that correctly emits a string, which
 *  type-checks against nothing and documents a lie. The one fact worth stating in prose is the one the types cannot:
 *  **every amount crossing this boundary is a STRING of minor units plus a preformatted display string.** A bigint
 *  does not survive `JSON.stringify`, and converting it to a number on the way out would undo Law 2 at the last
 *  possible moment.
 */

@Injectable()
export class CorrectionService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: CorrectionRepository,
    @Inject(WALLET_ADMIN) private readonly wallet: WalletAdminPort,
  ) {}

  private view(d: CorrectionDraft, viewer: string | null) {
    const b = balanceOf(d.legs);
    const s = submitState(d);
    const a = approveState(d);
    return {
      id: d.id, investigationId: d.investigationId, tenantId: d.tenantId, status: d.status,
      currencyCode: d.currencyCode, reason: d.reason, sourceDocument: d.sourceDocument,
      idempotencyKey: d.idempotencyKey, makerId: d.makerId, submittedAt: d.submittedAt,
      checkerId: d.checkerId, checkedAt: d.checkedAt, checkerNote: d.checkerNote,
      postedTxnId: d.postedTxnId, postedAt: d.postedAt,
      legs: d.legs.map((l) => ({
        ownerKind: l.ownerKind, ownerId: l.ownerId, accountCode: l.accountCode,
        amountMinor: l.amountMinor.toString(), amountText: formatMinor(l.amountMinor, d.currencyCode),
        legNote: l.legNote,
      })),
      balance: {
        sumMinor: b.sumMinor.toString(), sumText: formatMinor(b.sumMinor, d.currencyCode),
        balanced: b.balanced, legCount: b.legCount,
        grossMinor: b.grossMinor.toString(), grossText: formatMinor(b.grossMinor, d.currencyCode),
      },
      submitState: s,
      approveState: a,
      // MAKER-CHECKER BY ABSENCE. The console draws Approve only when this is true.
      approveOfferable: a.ok && isSecondPerson(d.makerId, viewer),
      aboveFounderThreshold: b.grossMinor >= FOUNDER_THRESHOLD_MINOR,
      founderThresholdMinor: FOUNDER_THRESHOLD_MINOR.toString(),
      founderThresholdText: formatMinor(FOUNDER_THRESHOLD_MINOR),
      reasonMin: REASON_MIN,
    };
  }

  async list(q: { status?: CorrectionDraft['status']; cursor?: { c: string; id: string }; limit: number }, viewer: string | null) {
    const rows = await this.repo.list({ status: q.status, cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => this.view(d, viewer)),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${new Date(last.submittedAt ?? last.postedAt ?? Date.now()).toISOString()}|${last.id}`).toString('base64') : null,
    };
  }

  async get(id: string, viewer: string | null) {
    const d = await this.repo.get(id);
    if (!d) throw new CorrectionNotFoundError('no such correction draft');
    return this.view(d, viewer);
  }

  /** Open a draft against an investigation. */
  async open(actor: AdminRequestContext, dto: OpenDraftDto) {
    const inv = await this.repo.investigation(dto.investigationId);
    if (!inv) throw new CorrectionNotFoundError('no such investigation — a correction starts from a case, never from a blank ledger write');
    if (inv.status === 'resolved' || inv.status === 'false_positive') {
      throw new InvalidCorrectionError(`investigation ${dto.investigationId} is already ${inv.status}; reopen it before correcting against it`);
    }
    if (dto.reason.trim().length < REASON_MIN) {
      throw new InvalidCorrectionError(`a reason of at least ${REASON_MIN} characters is required, recorded verbatim`);
    }
    return this.pool.withTx(async (c) => {
      const id = await this.repo.openDraft(c, {
        investigationId: dto.investigationId, tenantId: dto.tenantId ?? null,
        reason: dto.reason.trim(), sourceDocument: dto.sourceDocument?.trim() || null,
        // MINTED ONCE, HERE. Reused on every post attempt for the life of the draft, which is what makes a retried
        // post a no-op. A key minted at post time would be a fresh key on each retry and a second correction on the
        // second attempt.
        idempotencyKey: `correction:${randomUUID()}`,
        makerId: actor.userId, currencyCode: dto.currencyCode ?? 'INR',
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_drafted', entityType: 'correction_draft', entityId: id,
        newValue: { investigationId: dto.investigationId },
        reason: dto.reason.trim(), ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id };
    });
  }

  /** Replace the legs. Only while drafting — a submitted draft is what a checker is reading. */
  async saveLegs(actor: AdminRequestContext, id: string, dto: SaveLegsDto) {
    return this.pool.withTx(async (c) => {
      const d = await this.repo.getForUpdate(c, id);
      if (!d) throw new CorrectionNotFoundError('no such correction draft');
      if (d.status !== 'drafting') throw new InvalidCorrectionError('this correction is no longer a draft');
      if (d.makerId !== actor.userId) {
        // Not a permission failure — a different person editing somebody's draft mid-review is a correctness
        // failure, and the maker's name is on the submission.
        throw new InvalidCorrectionError('only the operator who opened this draft may edit its legs');
      }
      const legs = dto.legs.map((l) => assertLeg(l));
      await this.repo.replaceLegs(c, id, legs);
      const b = balanceOf(legs);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_legs_saved', entityType: 'correction_draft', entityId: id,
        // The legs land in the audit ledger as they were saved. If a correction is ever disputed, the question is
        // what the maker wrote and what the checker saw, and both are here.
        newValue: { legs: legs.map((l) => ({ ...l, amountMinor: l.amountMinor.toString() })), sumMinor: b.sumMinor.toString() },
        reason: 'correction legs saved', ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, balanced: b.balanced, sumMinor: b.sumMinor.toString() };
    });
  }

  async submit(actor: AdminRequestContext, id: string) {
    return this.pool.withTx(async (c) => {
      const d = await this.repo.getForUpdate(c, id);
      if (!d) throw new CorrectionNotFoundError('no such correction draft');
      if (d.makerId !== actor.userId) throw new InvalidCorrectionError('only the operator who opened this draft may submit it');
      // Throws with the real Σ in the message, so W068's "Legs do not balance — Σ = +12,450 ≠ 0" is the server's
      // sentence and not a number the console computed separately and might disagree about.
      const { gross, needsFounderConfirmation } = assertSubmittable(d);
      await this.repo.submit(c, id, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_submitted', entityType: 'correction_draft', entityId: id,
        newValue: { grossMinor: gross.toString(), aboveFounderThreshold: needsFounderConfirmation },
        reason: d.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      // The COMMIT here is where 0111's deferred trigger runs. If the legs changed under us the transaction aborts
      // and nothing was submitted.
      return { ok: true, grossMinor: gross.toString(), needsFounderConfirmation };
    });
  }

  /**
   * Approve and post — the act this whole module exists to make safe.
   *
   * The wallet call happens INSIDE the transaction, which is unusual and is argued for at the top of this file. The
   * risk it accepts is a post that succeeds while the transaction rolls back, leaving a real ledger entry and a
   * draft still marked `awaiting_checker`. That state is recoverable and self-announcing: the idempotency key means
   * re-approving returns the SAME transaction rather than posting a second one, and the recon plane sees the entry.
   * The state we refuse to risk is the reverse — a draft that says `posted` with money that never moved.
   */
  async approve(actor: AdminRequestContext, id: string, dto: DecideDto) {
    return this.pool.withTx(async (c) => {
      const d = await this.repo.getForUpdate(c, id);
      if (!d) throw new CorrectionNotFoundError('no such correction draft');
      // Re-verifies the balance against the legs as they are NOW, refuses the maker, and refuses a high-value
      // correction whose founder confirmation is absent.
      const { gross } = assertApprovable(d, actor.userId, dto.founderInformed === true);

      const post = buildPost(d);
      let txnId: string;
      let alreadyApplied = false;
      try {
        const r = await this.wallet.post({
          tenantId: post.tenantId, txnType: post.txnType, idempotencyKey: post.idempotencyKey,
          currencyCode: post.currencyCode, referenceType: post.referenceType, referenceId: post.referenceId,
          initiatedBy: actor.userId, description: post.description,
          legs: post.legs.map((l) => ({ ownerKind: l.ownerKind, ownerId: l.ownerId, accountCode: l.accountCode, amountMinor: l.amountMinor })),
        });
        txnId = r.txnId;
        alreadyApplied = r.alreadyApplied;
      } catch (e) {
        // The transaction rolls back with the draft untouched. The error tells the operator that retrying is SAFE,
        // which on a money screen is the difference between a retry and a phone call.
        throw new CorrectionPostFailedError(e instanceof Error ? e.message : 'the wallet service refused the correction.');
      }

      await this.repo.recordDecision(c, id, { checkerId: actor.userId, note: dto.note, status: 'posted', txnId });
      // "Approval posts txn type `correction` and closes the case atomically." Same transaction, so the case cannot
      // be left open by a crash between the two.
      await this.repo.resolveInvestigation(c, d.investigationId, actor.userId, `corrected by ${CORRECTION_TXN_TYPE} txn ${txnId}`);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_posted', entityType: 'correction_draft', entityId: id,
        oldValue: { status: 'awaiting_checker' },
        newValue: {
          status: 'posted', txnId, grossMinor: gross.toString(), makerId: d.makerId,
          alreadyApplied,
          // Recorded as a CLAIM by a named person, because that is exactly what it is — the platform cannot page
          // anybody and this flag is somebody saying they did.
          founderInformedByChecker: dto.founderInformed === true,
        },
        reason: dto.note, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, txnId, alreadyApplied, grossMinor: gross.toString() };
    });
  }

  async reject(actor: AdminRequestContext, id: string, dto: DecideDto) {
    return this.pool.withTx(async (c) => {
      const d = await this.repo.getForUpdate(c, id);
      if (!d) throw new CorrectionNotFoundError('no such correction draft');
      if (d.status !== 'awaiting_checker') throw new InvalidCorrectionError('this correction is not awaiting a decision');
      if (!dto.note?.trim()) throw new InvalidCorrectionError('a rejection must say why');
      await this.repo.recordDecision(c, id, { checkerId: actor.userId, note: dto.note.trim(), status: 'rejected' });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_rejected', entityType: 'correction_draft', entityId: id,
        newValue: { status: 'rejected', makerId: d.makerId }, reason: dto.note.trim(),
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true };
    });
  }

  async withdraw(actor: AdminRequestContext, id: string, note: string) {
    return this.pool.withTx(async (c) => {
      const d = await this.repo.getForUpdate(c, id);
      if (!d) throw new CorrectionNotFoundError('no such correction draft');
      if (d.makerId !== actor.userId) throw new InvalidCorrectionError('only the operator who opened this draft may withdraw it');
      if (d.status === 'posted') {
        // W068: "There is no delete. A wrong correction is fixed by another correction."
        throw new InvalidCorrectionError(
          'a posted correction cannot be withdrawn. There is no delete — a wrong correction is fixed by another '
          + 'correction, so the ledger tells the whole story forever');
      }
      await this.repo.withdraw(c, id, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ledger.correction_withdrawn', entityType: 'correction_draft', entityId: id,
        reason: note, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true };
    });
  }
}
