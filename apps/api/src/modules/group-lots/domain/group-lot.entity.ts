// modules/group-lots/domain/group-lot.entity.ts · the group_lots aggregate (FPO pooling, 0005 + 0188). Quantities are
// numeric(14,3) decimal strings handled as integer milli-units (never a float); money is bigint minor units.
//
// PC-56 TENANT-11c — every lifecycle edge now has a writer, and each one is guarded HERE (the DB trigger trg_gl_moves is the
// wall behind it):
//   pledging → ready     by hand at any % (below target needs a reason — the canon's "list at 86 qtl"), or automatically when
//                        a pledge reaches the target;
//   ready    → listed    `markListed(listingId)` — the lot's ONE listing exists (seller = coordinator, the pledged quantity);
//   listed   → sold      `markSold(...)` — the sale order completed and its seller net is HELD (the consumer, not a person);
//   sold     → settled   `markSettled(txnId)` — the second person confirmed the prepared shares and the money moved;
//   pledging | ready | listed → cancelled   with a reason from the lookup (pledges released, members told).
// Extend once (≤ 48 h past the current deadline) while pledging; pledges and withdrawals move the running total.
// serialize() is the wire shape.
import { GroupLotStatus, assertTransition } from './group-lot.state';
import { DomainEvent, GroupLotEventType } from './group-lot.events';
import {
  AlreadyExtendedError, ExtensionTooLongError, InvalidGroupLotError, PledgeClosedError, ReadyReasonRequiredError, WithdrawClosedError,
} from './group-lot.errors';
import { parseQtyMilli, formatQtyMilli } from './settle';

/** The fee cap — ONE value. 2000 bps = 20 %. The old group-lots DTO allowed 10000 (100 %), the listings duplicate 2000; the
 *  stricter wins, because the fee is taken off every smallholder's share and the canon's own lot charges 50 bps. Also a DB
 *  CHECK (0188 ck_gl_fee_cap) and a CHECK on every settlement row. */
export const MAX_FEE_BPS = 2000;
/** "Extend once (max 48h)" — W136. */
export const MAX_EXTENSION_MS = 48 * 3600_000;

export interface GroupLotProps {
  id: string; tenantId: string; lotNo?: string | null; coordinatorUserId: string; productId: string;
  targetQuantity: string; pledgedQuantity: string; unitCode: string;
  pledgeDeadline: string; status: GroupLotStatus; coordinationFeeBps: number; createdAt?: Date;
  createdAtText?: string | null; deadlineText?: string | null;
  listingId?: string | null; listedAt?: Date | null; soldAt?: Date | null; saleOrderId?: string | null;
  grossProceedsMinor?: bigint | null; holdTxnId?: string | null; settlementTxnId?: string | null; settledAt?: Date | null;
  extendedOnce?: boolean; extendedAt?: Date | null; originalDeadline?: string | null; lastNudgedAt?: Date | null;
  readyAt?: Date | null; readyReason?: string | null;
  cancelReasonId?: string | null; cancelReasonCode?: string | null; cancelReasonText?: string | null; cancelledAt?: Date | null; cancelledBy?: string | null;
  appointedBy?: string | null; consentId?: string | null;
}

export class GroupLot {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: GroupLotProps) {}

  static create(input: Pick<GroupLotProps, 'id' | 'tenantId' | 'coordinatorUserId' | 'productId' | 'targetQuantity' | 'unitCode' | 'pledgeDeadline' | 'coordinationFeeBps'>
    & { appointedBy?: string | null; now?: Date }): GroupLot {
    if (parseQtyMilli(input.targetQuantity) <= 0n) throw new InvalidGroupLotError('target quantity must be greater than zero', 'GROUP_LOT_TARGET_INVALID');
    if (!Number.isInteger(input.coordinationFeeBps) || input.coordinationFeeBps < 0 || input.coordinationFeeBps > MAX_FEE_BPS) {
      throw new InvalidGroupLotError(`coordination fee must be 0–${MAX_FEE_BPS} bps`, 'GROUP_LOT_FEE_INVALID');
    }
    const now = input.now ?? new Date();
    if (!(new Date(input.pledgeDeadline).getTime() > now.getTime())) throw new InvalidGroupLotError('the pledge deadline must be in the future', 'GROUP_LOT_DEADLINE_INVALID');
    const g = new GroupLot({
      id: input.id, tenantId: input.tenantId, coordinatorUserId: input.coordinatorUserId, productId: input.productId,
      targetQuantity: formatQtyMilli(parseQtyMilli(input.targetQuantity)), unitCode: input.unitCode, pledgeDeadline: input.pledgeDeadline,
      coordinationFeeBps: input.coordinationFeeBps, pledgedQuantity: '0.000', status: 'pledging', extendedOnce: false, appointedBy: input.appointedBy ?? null,
    });
    g.events.push({ type: GroupLotEventType.Created, payload: { groupLotId: g.props.id, productId: g.props.productId, targetQuantity: g.props.targetQuantity, coordinatorUserId: g.props.coordinatorUserId } });
    return g;
  }
  static rehydrate(props: GroupLotProps): GroupLot { return new GroupLot(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get status() { return this.props.status; }
  get coordinatorUserId() { return this.props.coordinatorUserId; }
  get coordinationFeeBps() { return this.props.coordinationFeeBps; }
  get listingId() { return this.props.listingId ?? null; }
  toProps(): Readonly<GroupLotProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  private event(type: string, payload: Record<string, unknown> = {}) { this.events.push({ type, payload: { groupLotId: this.props.id, lotNo: this.props.lotNo ?? null, ...payload } }); }

  pledgedMilli(): bigint { return parseQtyMilli(this.props.pledgedQuantity); }
  targetMilli(): bigint { return parseQtyMilli(this.props.targetQuantity); }

  /** Add a pledged quantity (milli) — only while pledging and before the deadline. Reaching the target makes the lot READY. */
  applyPledge(qtyMilli: bigint, now: Date): { autoReady: boolean } {
    if (qtyMilli <= 0n) throw new InvalidGroupLotError('pledge quantity must be greater than zero', 'GROUP_LOT_QUANTITY_INVALID');
    if (this.props.status !== 'pledging') throw new PledgeClosedError();
    if (new Date(this.props.pledgeDeadline).getTime() <= now.getTime()) throw new PledgeClosedError();
    const next = this.pledgedMilli() + qtyMilli;
    this.props.pledgedQuantity = formatQtyMilli(next);
    this.event(GroupLotEventType.Pledged, { pledgedQuantity: this.props.pledgedQuantity });
    if (next >= this.targetMilli()) { this.toReady(now, null, true); return { autoReady: true }; }
    return { autoReady: false };
  }
  /** A member withdraws (canon: "a pledge is a promise, not a lock") — only until the lot lists. */
  withdrawPledge(qtyMilli: bigint): void {
    if (this.props.status !== 'pledging' && this.props.status !== 'ready') throw new WithdrawClosedError();
    const next = this.pledgedMilli() - qtyMilli;
    this.props.pledgedQuantity = formatQtyMilli(next < 0n ? 0n : next);
    this.event(GroupLotEventType.PledgeWithdrawn, { pledgedQuantity: this.props.pledgedQuantity });
  }
  /** By hand: at any %; below the target the coordinator says why (W136 "List at 86 qtl"). */
  markReady(now: Date, reason: string | null): void {
    const below = this.pledgedMilli() < this.targetMilli();
    if (below && !reason) throw new ReadyReasonRequiredError();
    this.toReady(now, reason, false);
  }
  private toReady(now: Date, reason: string | null, auto: boolean) {
    assertTransition(this.props.status, 'ready');
    this.props.status = 'ready';
    this.props.readyAt = now;
    this.props.readyReason = reason;
    this.event(GroupLotEventType.Ready, { pledgedQuantity: this.props.pledgedQuantity, auto });
  }
  /** ready → listed: the lot's ONE listing (seller = the coordinator) now exists. */
  markListed(listingId: string, now: Date): void {
    if (this.pledgedMilli() <= 0n) throw new InvalidGroupLotError('a lot with nothing pledged cannot be listed', 'GROUP_LOT_EMPTY');
    assertTransition(this.props.status, 'listed');
    this.props.status = 'listed';
    this.props.listingId = listingId;
    this.props.listedAt = now;
    this.event(GroupLotEventType.Listed, { listingId, quantity: this.props.pledgedQuantity });
  }
  /** listed → sold: the sale order completed and its seller net is HELD in the coordinator's Hold. */
  markSold(input: { orderId: string; grossMinor: bigint; holdTxnId: string; now: Date }): void {
    assertTransition(this.props.status, 'sold');
    this.props.status = 'sold';
    this.props.saleOrderId = input.orderId;
    this.props.grossProceedsMinor = input.grossMinor;
    this.props.holdTxnId = input.holdTxnId;
    this.props.soldAt = input.now;
    this.event(GroupLotEventType.Sold, { orderId: input.orderId, grossProceedsMinor: input.grossMinor.toString() });
  }
  /** Once, while pledging, by at most 48 h past the CURRENT deadline, and to a moment still in the future. */
  extend(newDeadlineIso: string, now: Date): void {
    if (this.props.status !== 'pledging') throw new PledgeClosedError();
    if (this.props.extendedOnce) throw new AlreadyExtendedError();
    const cur = new Date(this.props.pledgeDeadline).getTime();
    const next = new Date(newDeadlineIso).getTime();
    const max = cur + MAX_EXTENSION_MS;
    if (!(next > cur) || !(next > now.getTime())) throw new InvalidGroupLotError('the new deadline must be later than the current one and in the future', 'GROUP_LOT_DEADLINE_INVALID');
    if (next > max) throw new ExtensionTooLongError(new Date(max).toISOString());
    this.props.originalDeadline = this.props.pledgeDeadline;
    this.props.pledgeDeadline = new Date(next).toISOString();
    this.props.extendedOnce = true;
    this.props.extendedAt = now;
  }
  markNudged(now: Date): void { this.props.lastNudgedAt = now; }
  cancel(input: { reasonId: string; reasonCode: string; reasonText: string | null; by: string; now: Date }): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled';
    this.props.cancelReasonId = input.reasonId;
    this.props.cancelReasonCode = input.reasonCode;
    this.props.cancelReasonText = input.reasonText;
    this.props.cancelledAt = input.now;
    this.props.cancelledBy = input.by;
  }
  markSettled(txnId: string, now: Date): void {
    assertTransition(this.props.status, 'settled');
    this.props.status = 'settled';
    this.props.settlementTxnId = txnId;
    this.props.settledAt = now;
  }

  /** Fraction pledged, as integer basis points of target (display only; float-free). */
  pledgeProgressBps(): number {
    const target = this.targetMilli();
    if (target <= 0n) return 0;
    const pct = (this.pledgedMilli() * 10000n) / target;
    return Number(pct > 10000n ? 10000n : pct);
  }

  serialize() {
    const p = this.props;
    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      id: p.id, lotNo: p.lotNo ?? null, coordinatorUserId: p.coordinatorUserId, productId: p.productId, targetQuantity: p.targetQuantity,
      pledgedQuantity: p.pledgedQuantity, unitCode: p.unitCode, pledgeDeadline: p.pledgeDeadline, status: p.status,
      coordinationFeeBps: p.coordinationFeeBps, progressBps: this.pledgeProgressBps(), createdAt: iso(p.createdAt),
      listingId: p.listingId ?? null, listedAt: iso(p.listedAt), soldAt: iso(p.soldAt), saleOrderId: p.saleOrderId ?? null,
      grossProceedsMinor: p.grossProceedsMinor != null ? p.grossProceedsMinor.toString() : null, settledAt: iso(p.settledAt),
      extendedOnce: !!p.extendedOnce, originalDeadline: p.originalDeadline ?? null, lastNudgedAt: iso(p.lastNudgedAt),
      readyAt: iso(p.readyAt), readyReason: p.readyReason ?? null,
      cancelReasonCode: p.cancelReasonCode ?? null, cancelReasonText: p.cancelReasonText ?? null, cancelledAt: iso(p.cancelledAt),
      appointed: !!p.appointedBy,
    };
  }
}
