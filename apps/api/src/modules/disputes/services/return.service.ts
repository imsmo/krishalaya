// modules/disputes/services/return.service.ts
// Returns/RMA lifecycle use-cases. Every write: one ACID tx (UoW), status via the machine (Law 5),
// outbox events in the SAME tx (Law 4), audit on moderator actions. NO money moves here — refunding a
// return emits disputes.return_refunded and orders/payments apply the wallet reversal downstream
// (flagged). Party roles (buyer/seller) are resolved from the order's dispute_eligibility recorded at
// delivery — never client-supplied (anti-IDOR). No version column → mutations lock the row FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Return } from '../domain/return.entity';
import { DomainEvent } from '../domain/disputes.events';
import { ReturnRepository } from '../repositories/return.repository';
import { DisputeRepository } from '../repositories/dispute.repository';
import { CreateReturnDto } from '../dto/create-return.dto';
import {
  ReturnNotFoundError, ReturnForbiddenError, DuplicateReturnError, NotEligibleToReturnError, InvalidReturnError,
} from '../domain/disputes.errors';

export interface ReturnActor { userId: string; canModerate: boolean; }
type PartyRole = 'buyer' | 'seller' | 'moderator';

@Injectable()
export class ReturnService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: ReturnRepository,
    private readonly disputes: DisputeRepository,
  ) {}

  /** The order's BUYER requests a return (after delivery). Idempotent on the caller's key. */
  async request(tenantId: string, buyerUserId: string, idemKey: string, dto: CreateReturnDto) {
    return this.idem.remember(idemKey, buyerUserId, 'returns.request', () =>
      timed(this.metrics, 'returns.request', { tenant: tenantId }, async () => {
        const elig = await this.disputes.eligibilityFor(tenantId, dto.orderId);
        if (!elig) throw new NotEligibleToReturnError();
        if (buyerUserId !== elig.buyerUserId) throw new NotEligibleToReturnError();   // only the buyer returns
        let reasonId: string | null = null;
        if (dto.reasonCode) {
          reasonId = await this.disputes.resolveReasonId(tenantId, dto.reasonCode);
          if (!reasonId) throw new InvalidReturnError('unknown return reason');
        }
        const ret = Return.request({ id: uuidv7(), tenantId, orderId: dto.orderId, disputeId: dto.disputeId ?? null, reasonId });
        return this.uow.run(tenantId, async (tx) => {
          if (await this.repo.hasActiveForOrder(tx, tenantId, dto.orderId)) throw new DuplicateReturnError();
          await this.repo.insert(tx, ret);
          await this.flush(tx, tenantId, ret.id, ret.pullEvents());
          return this.serialize(ret.toProps(), dto.reasonCode ?? null);   // the code is in hand — no lookup round trip
        }, { userId: buyerUserId });
      }));
  }

  approve(t: string, a: ReturnActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'approve', ['seller', 'moderator'], (r) => r.approve(), ip); }
  reject(t: string, a: ReturnActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'reject', ['seller', 'moderator'], (r) => r.reject(), ip); }
  ship(t: string, a: ReturnActor, id: string) { return this.mutate(t, a, id, 'ship', ['buyer', 'moderator'], (r) => r.ship()); }
  receive(t: string, a: ReturnActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'receive', ['seller', 'moderator'], (r) => r.receive(), ip); }
  /** Refund a received return (moderator only). Emits return_refunded; orders/payments apply the reversal. */
  refund(t: string, a: ReturnActor, id: string, ip: string | null) {
    if (!a.canModerate) throw new ReturnForbiddenError('requires dispute.resolve');
    return this.mutate(t, a, id, 'refund', ['moderator'], (r) => r.refund(null), ip);
  }

  async getById(tenantId: string, actor: ReturnActor, id: string) {
    const ret = await this.repo.getById(tenantId, id);
    if (!ret) throw new ReturnNotFoundError(id);
    if (!(await this.roleOf(tenantId, ret.orderId, actor))) throw new ReturnNotFoundError(id);   // 404 not 403 (no enumeration)
    return (await this.withReasonCodes(tenantId, [this.serialize(ret.toProps())]))[0];
  }

  async list(tenantId: string, actor: ReturnActor, q: { box: 'mine' | 'against' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all') {
      if (!actor.canModerate) throw new ReturnForbiddenError('requires dispute.resolve');
      const rows = await this.repo.listFor(tenantId, { allTenant: true, status: q.status, cursor: q.cursor, limit: q.limit });
      return this.page(tenantId, rows, q.limit);
    }
    const role: 'buyer' | 'seller' = q.box === 'mine' ? 'buyer' : 'seller';
    const orderIds = await this.repo.orderIdsForParty(tenantId, actor.userId, role);
    const rows = await this.repo.listFor(tenantId, { orderIds, status: q.status, cursor: q.cursor, limit: q.limit });
    return this.page(tenantId, rows, q.limit);
  }

  // ---- internals ----
  private async mutate(tenantId: string, actor: ReturnActor, id: string, action: string, allowed: PartyRole[], apply: (r: Return) => void, ip: string | null = null) {
    const row = await timed(this.metrics, `returns.${action}`, { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const ret = await this.repo.getForUpdate(tx, tenantId, id);
        if (!ret) throw new ReturnNotFoundError(id);
        const role = await this.roleOf(tenantId, ret.orderId, actor);
        if (!role) throw new ReturnNotFoundError(id);             // not a party → 404 (no enumeration)
        if (!allowed.includes(role)) throw new ReturnForbiddenError(`only ${allowed.join('/')} may ${action} this return`);
        apply(ret);
        await this.repo.update(tx, ret);
        if (role === 'moderator') await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `return.${action}`, entityType: 'return', entityId: id, newValue: { status: ret.status }, ip });
        await this.flush(tx, tenantId, id, ret.pullEvents());
        return this.serialize(ret.toProps());
      }, { userId: actor.userId }));
    // enriched after commit: a lookup read has no business inside the write transaction
    return (await this.withReasonCodes(tenantId, [row]))[0];
  }

  /** Resolve the actor's role on the order: moderator wins; else buyer/seller from eligibility; else null. */
  private async roleOf(tenantId: string, orderId: string, actor: ReturnActor): Promise<PartyRole | null> {
    if (actor.canModerate) return 'moderator';
    const elig = await this.disputes.eligibilityFor(tenantId, orderId);
    if (!elig) return null;
    if (actor.userId === elig.buyerUserId) return 'buyer';
    if (actor.userId === elig.sellerUserId) return 'seller';
    return null;
  }

  private async page(tenantId: string, rows: Return[], limit: number) {
    const items = await this.withReasonCodes(tenantId, rows.map((r) => this.serialize(r.toProps())));
    const last = items[items.length - 1];
    const nextCursor = items.length === limit && last ? Buffer.from(`${(last as any).createdAt.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private serialize(p: ReturnType<Return['toProps']>, reasonCode?: string | null) {
    return { id: p.id, orderId: p.orderId, disputeId: p.disputeId, status: p.status, reasonId: p.reasonId,
      reasonCode: reasonCode ?? null, refundTxnId: p.refundTxnId, createdAt: p.createdAt };
  }

  /** Attach the human-usable reason code to already-serialized rows. `reasonCode: null` where the id resolves to
   *  nothing is DELIBERATE: a reason we cannot name must read as unknown, never as a plausible-looking default. */
  private async withReasonCodes<T extends { reasonId?: string | null }>(tenantId: string, rows: T[]): Promise<T[]> {
    const ids = rows.map((r) => r.reasonId).filter((x): x is string => !!x);
    if (ids.length === 0) return rows;
    const codes = await this.repo.reasonCodesFor(tenantId, ids);
    for (const r of rows) (r as { reasonCode?: string | null }).reasonCode = r.reasonId ? codes.get(r.reasonId) ?? null : null;
    return rows;
  }
  private async flush(tx: TxContext, tenantId: string, returnId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'return', aggregateId: returnId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
