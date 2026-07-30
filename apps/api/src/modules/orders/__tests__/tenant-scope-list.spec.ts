/**
 * DEV-50 / DELTA-069 (2026-07-29) — moderator-scoped tenant-wide GET orders list.
 *
 * Origin: Founder Review Queue item 10 (DEV-45 QA) — `GET orders` was hardcoded
 * to the caller's own identity (`buyer_user_id/seller_user_id = ctx.userId`)
 * with no moderator branch, unlike `GET orders/stats` and `GET orders/:id`,
 * so canon 547's tenant-owner worklist (rows spanning many farmers/buyers)
 * could never render real data.
 *
 * Contract proven here:
 *  (1) default scope ('own') is byte-identical to the old behavior — identity
 *      predicate present, no extra fields leaked;
 *  (2) scope=tenant + canModerate → repo called with userId=null (tenant-wide),
 *      rows carry BOTH parties;
 *  (3) scope=tenant WITHOUT canModerate → ForbiddenError, never a silent
 *      fallback to someone's own list;
 *  (4) repository SQL: null userId drops the identity predicate but NEVER the
 *      tenant_id predicate (RLS-belt-and-braces).
 */
import * as fs from 'fs';
import * as path from 'path';
import { OrderTimelineReadModel } from '../read-models/order-timeline.read-model';
import { QueryOrderSchema } from '../dto/query-order.dto';

const mkOrder = (id: string, buyer: string, seller: string) => ({
  id,
  toProps: () => ({
    id, orderNo: 'KV-' + id, status: 'confirmed', totalMinor: 1000n,
    buyerUserId: buyer, sellerUserId: seller, createdAt: '2026-07-29T00:00:00.000Z',
  }),
});

function mkRepo() {
  return {
    listFor: jest.fn(async () => [mkOrder('o1', 'buyerA', 'farmer1'), mkOrder('o2', 'buyerB', 'farmer2')]),
    primaryItemsFor: jest.fn(async () => new Map()),
  };
}

describe('DELTA-069 — tenant-wide order list (canon 547 worklist)', () => {
  it('scope defaults to own; dto stays strict', () => {
    const q = QueryOrderSchema.parse({});
    expect(q.scope).toBe('own');
    expect(() => QueryOrderSchema.parse({ scope: 'everything' })).toThrow();
  });

  it('own scope: repo receives the caller identity; rows carry no extra party fields', async () => {
    const repo = mkRepo();
    const rm = new OrderTimelineReadModel(repo as any);
    const q = QueryOrderSchema.parse({ role: 'seller' });
    const res = await rm.list('t1', 'me', q);
    expect(repo.listFor).toHaveBeenCalledWith('t1', 'seller', 'me', expect.objectContaining({ limit: q.limit + 1 }));
    expect(res.items[0]).not.toHaveProperty('buyerUserId');
    expect(res.items[0]).not.toHaveProperty('sellerUserId');
  });

  it('tenant scope (userId=null): repo receives null; rows expose BOTH parties', async () => {
    const repo = mkRepo();
    const rm = new OrderTimelineReadModel(repo as any);
    const q = QueryOrderSchema.parse({ scope: 'tenant' });
    const res = await rm.list('t1', null, q);
    expect(repo.listFor).toHaveBeenCalledWith('t1', 'buyer', null, expect.anything());
    expect(res.items[0]).toMatchObject({ buyerUserId: 'buyerA', sellerUserId: 'farmer1' });
    expect(res.items[1]).toMatchObject({ buyerUserId: 'buyerB', sellerUserId: 'farmer2' });
  });

  it('controller law: scope=tenant without moderation permission throws ForbiddenError (source-asserted)', () => {
    // The controller wiring is asserted statically (unit DI for the full controller
    // would drag guards/decorators; the branch is 5 lines and the read-model/repo
    // behavior above is executed for real).
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'v1', 'orders.controller.ts'), 'utf8');
    const block = src.slice(src.indexOf('@Get() list('), src.indexOf('@Get(\'stats\')'));
    expect(block).toContain("if (q.scope === 'tenant')");
    expect(block).toContain('if (!canModerateOrder(ctx)) throw new ForbiddenError');
    expect(block).toContain('userId = null;');
  });

  it('repository SQL law: null userId drops identity predicate, never tenant_id (source-asserted)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'order.repository.ts'), 'utf8');
    const block = src.slice(src.indexOf('async listFor('), src.indexOf('async findDue('));
    expect(block).toContain("userId === null ? `tenant_id=$1` : `tenant_id=$1 AND ${col}=$2`");
    expect(block).toContain('userId === null ? [tenantId] : [tenantId, userId]');
  });
});
