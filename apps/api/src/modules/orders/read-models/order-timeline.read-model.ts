// modules/orders/read-models/order-timeline.read-model.ts
// CQRS read path (Law 12): buyer/seller order history on the replica, keyset (cursor) paginated
// on (created_at,id) — which also prunes the recent order partitions. Never OFFSET.
//
// PC-56 HOTFIX-5 · B3 (survey F-7 / F-14; HOTFIX-4 D3): the BUYER's list printed the seller's USER UUID as "Seller" (`counterparty`). A
// buyer's row now names the ORGANISATION (the order's tenant: slug + display name) and carries no person id; the SELLER's own list keeps
// `counterparty` (the buyer, for the seller's worklist) and the moderator's tenant-wide list keeps both parties (DELTA-069). Every row now
// carries the order's `currencyCode` (Rule Zero — the storefront printed 'INR'), HOTFIX-4's `paymentState` (one bounded batch read of the
// page's timelines) and `acceptanceDeadline`.
import { Injectable } from '@nestjs/common';
import { OrderRepository } from '../repositories/order.repository';
import { QueryOrderDto } from '../dto/query-order.dto';
import { orderPaymentState } from '../domain/order-payment-state';

const enc = (s: string) => Buffer.from(s).toString('base64url');
const dec = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

@Injectable()
export class OrderTimelineReadModel {
  constructor(private readonly repo: OrderRepository) {}
  /** DELTA-069 (DEV-50): userId=null = moderator tenant-wide list; rows then carry BOTH
   *  parties (a tenant worklist row spans many farmers/buyers — canon 547). */
  async list(tenantId: string, userId: string | null, q: QueryOrderDto) {
    let cursor: { c: string; id: string } | undefined;
    if (q.cursor) { try { cursor = JSON.parse(dec(q.cursor)); } catch { /* first page */ } }
    const rows = await this.repo.listFor(tenantId, q.role, userId, { status: q.status, cursor, limit: q.limit + 1 });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    // Enrich each card with its PRIMARY line item (crop title + qty) + total item count (screen 56 seller list /
    // screen 22 buyer list). One bounded, partition-pruned batch read for the whole page; degrades to no-item.
    const refs = page.map((o) => { const p = o.toProps(); return { id: p.id, createdAt: p.createdAt }; });
    const [primary, facts, organisation] = await Promise.all([
      this.repo.primaryItemsFor(tenantId, refs), this.repo.paymentFactsFor(tenantId, refs), page.length ? this.repo.organisationOf(tenantId) : Promise.resolve(null),
    ]);
    const buyerView = q.role === 'buyer' && userId !== null;
    const items = page.map((o) => {
      const p = o.toProps();
      const pi = primary.get(p.id) ?? null;
      const f = facts.get(p.id) ?? { placedAwaitingPayment: false, cancelledFrom: null, cancelledBySystem: false };
      return {
        id: p.id, orderNo: p.orderNo, status: p.status, totalMinor: p.totalMinor.toString(), currencyCode: p.currencyCode,
        paymentState: orderPaymentState(p.status, f), acceptanceDeadline: p.acceptanceDeadline ?? null,
        organisation, createdAt: p.createdAt,
        ...(buyerView ? {} : { counterparty: q.role === 'buyer' ? p.sellerUserId : p.buyerUserId }),
        ...(userId === null ? { buyerUserId: p.buyerUserId, sellerUserId: p.sellerUserId } : {}),
        primaryItem: pi ? { title: pi.title, quantity: pi.quantity, unitCode: pi.unitCode } : null,
        itemCount: pi ? pi.itemCount : 0,
      };
    });
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? enc(JSON.stringify({ c: new Date(last.toProps().createdAt).toISOString(), id: last.id })) : null;
    return { items, nextCursor };
  }
}
