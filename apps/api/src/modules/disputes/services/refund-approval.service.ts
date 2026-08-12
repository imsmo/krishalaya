// modules/disputes/services/refund-approval.service.ts · the maker-checker plane for tenant refunds (PC-56
// TENANT-3b, schema 0139).
//
// THE SHAPE, AND WHY IT IS THIS SHAPE:
//   propose  — the person working the case (dispute.resolve) writes down WHAT they want to refund and WHY.
//   approve  — a DIFFERENT person holding order.refund signs for that exact amount.
//   apply    — the refund itself, in the same transaction as the money leg's outbox event, marking the approval
//              applied. A refund that rolls back leaves its approval usable; a refund that commits can never be
//              applied twice (0139's uq_refund_approval_applied).
//
// **THE THRESHOLD IS READ ON THE PRIMARY, INSIDE THE DECIDING TRANSACTION.** Reading it from a replica would mean a
// tenant who tightens the rule at 14:00 can still have a large refund go out on one signature at 14:00:03 — the
// window is small and the loss is somebody's money.
//
// NO MONEY MOVES IN THIS FILE (Law 2). It decides whether money MAY move; the wallet legs live in payments.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AppError, NotFoundError } from '../../../shared/errors/app-error';
import { RefundApprovalRepository, RefundApprovalRow } from '../repositories/refund-approval.repository';
import {
  CHECKER_THRESHOLD_KEY, RefundSubject, RefundGate, assertCheckerDistinct, assertNote, needsChecker, refundGate,
  thresholdFrom,
} from '../domain/refund-gate';

export interface RefundActor { userId: string; canResolve: boolean; canRefund: boolean }

export class RefundApprovalNotFoundError extends NotFoundError {
  constructor(id: string) { super('Refund approval not found'); (this as any).details = { id }; }
}
export class DuplicateRefundProposalError extends AppError {
  constructor() { super('REFUND_PROPOSAL_DUPLICATE', 'A refund proposal is already open on this case', 409); }
}
export class RefundApprovalDecidedError extends AppError {
  constructor(status: string) { super('REFUND_PROPOSAL_DECIDED', `This proposal is already ${status}`, 409, { status }); }
}
export class RefundPermissionError extends AppError {
  constructor(perm: string) { super('REFUND_FORBIDDEN', `Requires ${perm}`, 403, { permission: perm }); }
}

@Injectable()
export class RefundApprovalService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly repo: RefundApprovalRepository,
  ) {}

  /** The tenant's threshold, with the honest flag when the shipped default was used. */
  async threshold(tx: TxContext, tenantId: string): Promise<{ minor: bigint; usedDefault: boolean }> {
    return thresholdFrom(await this.repo.thresholdSetting(tx, tenantId, CHECKER_THRESHOLD_KEY));
  }

  /** The gate for a refund of `amountMinor` on this subject, inside a transaction. Callers that are about to move
   *  money use this; the read paths use `gateFor` below. */
  async gateInTx(tx: TxContext, tenantId: string, subjectType: RefundSubject, subjectId: string, amountMinor: bigint): Promise<{ gate: RefundGate; thresholdMinor: bigint; usedDefault: boolean; approval: RefundApprovalRow | null }> {
    const t = await this.threshold(tx, tenantId);
    const approval = await this.repo.currentFor(tx, tenantId, subjectType, subjectId);
    const gate = refundGate({
      amountMinor, thresholdMinor: t.minor,
      approval: approval ? { id: approval.id, status: approval.status, amountMinor: approval.amountMinor, proposedBy: approval.proposedBy, decidedBy: approval.decidedBy } : null,
    });
    return { gate, thresholdMinor: t.minor, usedDefault: t.usedDefault, approval };
  }

  /** Record a proposal. Requires dispute.resolve — the person deciding the case is the person who proposes the
   *  figure. It does NOT require order.refund: a support agent may work a dispute to a decision and ask for the
   *  money; they simply cannot be the one who releases it (0139 §139.4 explains the split). */
  async propose(tenantId: string, actor: RefundActor, input: {
    subjectType: RefundSubject; subjectId: string; amountMinor: bigint;
    resolutionType?: string | null; note: string;
  }, ip: string | null = null) {
    if (!actor.canResolve) throw new RefundPermissionError('dispute.resolve');
    const note = assertNote(input.note, 'proposal');
    return this.uow.run(tenantId, async (tx) => {
      const t = await this.threshold(tx, tenantId);
      // A proposal BELOW the threshold is not refused — it is allowed, and that matters: a tenant may want a second
      // pair of eyes on a case that is small but ugly. What is refused is a SECOND open proposal.
      const orderId = await this.repo.subjectOrderId(tx, tenantId, input.subjectType, input.subjectId);
      if (!orderId) throw new RefundApprovalNotFoundError(input.subjectId);   // 404, not 403 (no enumeration)
      const open = await this.repo.currentFor(tx, tenantId, input.subjectType, input.subjectId);
      if (open && open.status === 'pending') throw new DuplicateRefundProposalError();
      if (open && open.status === 'applied') throw new RefundApprovalDecidedError('applied');
      const id = uuidv7();
      await this.repo.insert(tx, {
        id, tenantId, subjectType: input.subjectType, subjectId: input.subjectId, orderId,
        amountMinor: input.amountMinor, resolutionType: input.resolutionType ?? null,
        proposedBy: actor.userId, proposalNote: note, thresholdMinor: t.minor,
      });
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'refund.proposed', entityType: input.subjectType, entityId: input.subjectId,
        newValue: { approvalId: id, amountMinor: input.amountMinor.toString(), thresholdMinor: t.minor.toString(), needsChecker: needsChecker(input.amountMinor, t.minor) },
        reason: note, ip,
      });
      return { id, status: 'pending' as const, amountMinor: input.amountMinor.toString(), thresholdMinor: t.minor.toString(), usedDefaultThreshold: t.usedDefault, needsChecker: needsChecker(input.amountMinor, t.minor) };
    }, { userId: actor.userId });
  }

  /** The checker's signature or refusal. Requires order.refund — this is the money key — and a DIFFERENT human. */
  async decide(tenantId: string, actor: RefundActor, approvalId: string, decision: 'approved' | 'rejected', note: string | null, ip: string | null = null) {
    if (!actor.canRefund) throw new RefundPermissionError('order.refund');
    return this.uow.run(tenantId, async (tx) => {
      const row = await this.repo.getForUpdate(tx, tenantId, approvalId);
      if (!row) throw new RefundApprovalNotFoundError(approvalId);
      if (row.status !== 'pending') throw new RefundApprovalDecidedError(row.status);
      assertCheckerDistinct(row.proposedBy, actor.userId);
      const decisionNote = decision === 'rejected' ? assertNote(note, 'decision') : (note ?? '').trim() || null;
      const n = await this.repo.decide(tx, tenantId, approvalId, { status: decision, decidedBy: actor.userId, note: decisionNote });
      // Zero rows means somebody else decided between the lock and the write — impossible under FOR UPDATE, and
      // still checked, because a silent no-op here would report a signature that does not exist.
      if (n === 0) throw new RefundApprovalDecidedError('decided');
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: `refund.${decision}`, entityType: row.subjectType, entityId: row.subjectId,
        oldValue: { status: 'pending' }, newValue: { approvalId, status: decision, amountMinor: row.amountMinor.toString() },
        reason: decisionNote, ip,
      });
      return { id: approvalId, status: decision, amountMinor: row.amountMinor.toString(), subjectType: row.subjectType, subjectId: row.subjectId };
    }, { userId: actor.userId });
  }

  /** Consume the approval that authorised a refund — called INSIDE the refund's own transaction. */
  async markApplied(tx: TxContext, tenantId: string, approvalId: string): Promise<void> {
    const n = await this.repo.markApplied(tx, tenantId, approvalId);
    if (n === 0) throw new RefundApprovalDecidedError('not approved');
  }

  listPending(tenantId: string, actor: RefundActor, q: { cursor?: { c: string; id: string }; limit: number }) {
    if (!actor.canResolve && !actor.canRefund) throw new RefundPermissionError('order.refund');
    return this.repo.listPending(tenantId, q).then((rows) => ({ items: rows.map(serialize), nextCursor: cursorOf(rows, q.limit) }));
  }

  historyFor(tenantId: string, actor: RefundActor, subjectType: RefundSubject, subjectId: string) {
    if (!actor.canResolve && !actor.canRefund) throw new RefundPermissionError('order.refund');
    return this.repo.historyFor(tenantId, subjectType, subjectId).then((rows) => rows.map(serialize));
  }
}

export function serialize(r: RefundApprovalRow) {
  return {
    id: r.id, subjectType: r.subjectType, subjectId: r.subjectId, orderId: r.orderId,
    amountMinor: r.amountMinor.toString(), resolutionType: r.resolutionType, status: r.status,
    proposedBy: r.proposedBy, proposedAt: r.proposedAt, proposalNote: r.proposalNote,
    thresholdMinor: r.thresholdMinor.toString(), decidedBy: r.decidedBy, decidedAt: r.decidedAt,
    decisionNote: r.decisionNote, appliedAt: r.appliedAt,
  };
}

/** Keyset forward on (proposed_at, id) — ASC, because the checker queue is worked oldest first. */
function cursorOf(rows: RefundApprovalRow[], limit: number): string | null {
  const last = rows[rows.length - 1];
  if (!last || rows.length < limit) return null;
  return Buffer.from(`${last.proposedAt.toISOString()}|${last.id}`).toString('base64');
}
