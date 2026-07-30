// modules/orders/read-models/order-timeline.read-model.ts
// CQRS read path (Law 12): buyer/seller order history on the replica, keyset (cursor) paginated
// on (created_at,id) — which also prunes the recent order partitions. Never OFFSET.
import { Injectable } from '@nestjs/common';
import { OrderRepository } from '../repositories/order.repository';
import { QueryOrderDto } from '../dto/query-order.dto';

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
    const primary = await this.repo.primaryItemsFor(tenantId, page.map((o) => { const p = o.toProps(); return { id: p.id, createdAt: p.createdAt }; }));
    const items = page.map((o) => {
      const p = o.toProps();
      const pi = primary.get(p.id) ?? null;
      return {
        id: p.id, orderNo: p.orderNo, status: p.status, totalMinor: p.totalMinor.toString(),
        counterparty: q.role === 'buyer' ? p.sellerUserId : p.buyerUserId, createdAt: p.createdAt,
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
