// modules/warehousing/__tests__/ops2a-intake.service.spec.ts · PC-56 OPS-2a — the INTAKE trust path, unit (fakes with an ORDERING SPY).
//   B3 (founder Q11-A): confirm and store are the warehouse's NAMED operator's only — a `warehouse.manage` holder who is not the operator gets 403
//       WAREHOUSE_OPERATOR_ONLY and nothing is written; the administrator flag is gone from the actor and the labour permission from the module
//       (a SOURCE assertion over every non-test file of modules/warehousing).
//   B4: confirm and store each write ONE audit row (`warehousing.booking.confirmed` / `.stored`, status before → after) in the same transaction.
//   D1 / D2 (2026-11-08): the operator may set any field; anyone else with warehouse.manage may set ONLY `operatorUserId` (403 WAREHOUSE_REASSIGN_ONLY
//       otherwise, nothing written); the B6 member check and the B4 audit row unchanged.
//   D3: cancel — the depositor herself (reason optional) or the named operator (a reason of 1–500 characters, 400 BOOKING_CANCEL_REASON_REQUIRED,
//       thrown BEFORE the unit of work and any lock — the spy is the proof); anyone else 403 BOOKING_CANCEL_NOT_PERMITTED; ONE audit row per cancel.
//   The route guard `RequireAnyPermission` admits either permission and refuses a caller with neither.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Reflector } from '@nestjs/core';
import { StorageBookingService } from '../services/storage-booking.service';
import { WarehouseService } from '../services/warehouse.service';
import { StorageBooking } from '../domain/storage-booking.entity';
import { Warehouse } from '../domain/warehouse.entity';
import { WarehouseOperatorOnlyError, WAREHOUSE_OPERATOR_ONLY_SENTENCE, WarehouseReassignOnlyError, WAREHOUSE_REASSIGN_ONLY_SENTENCE, WarehousingForbiddenError,
  BookingCancelReasonRequiredError, BOOKING_CANCEL_REASON_REQUIRED_SENTENCE, BookingCancelNotPermittedError, BOOKING_CANCEL_NOT_PERMITTED_SENTENCE,
  WarehouseOperatorNotAMemberError } from '../domain/warehousing.errors';
import { PermissionsGuard, RequireAnyPermission, ANY_PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import * as rc from '../../../core/tenancy-context/request-context';

const wh = (over: any = {}) => Warehouse.rehydrate({ id: 'w1', tenantId: 't1', operatorUserId: 'op1', defaultName: 'W', wdraRegNo: null, addressId: null, capacityMt: null, storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: 900n, insurancePolicyRef: null, isActive: true, ...over });
const booking = (status: 'requested' | 'confirmed' = 'requested', depositor = 'dep1') => {
  const b = StorageBooking.request({ id: 'b1', tenantId: 't1', warehouseId: 'w1', depositorUserId: depositor, productId: 'p1', quantityMilli: 62600n, unitCode: 'quintal', expectedArrival: null });
  if (status === 'confirmed') b.confirm();
  b.pullEvents(); return b;
};
const op = { userId: 'op1', canManage: true, canStore: false };
const otherAdmin = { userId: 'admin2', canManage: true, canStore: false };          // a tenant_admin who is NOT the warehouse's operator
const dep = { userId: 'dep1', canManage: false, canStore: true };
const farmer2 = { userId: 'f2', canManage: false, canStore: true };

function bookingHarness(status: 'requested' | 'confirmed' = 'requested', w: Warehouse = wh()) {
  const calls: string[] = [];
  const rec = (name: string, impl?: (...a: any[]) => any) => jest.fn(async (...a: any[]) => { calls.push(name); return impl ? impl(...a) : undefined; });
  const tx = { query: rec('tx.query') };
  const uow = { run: jest.fn(async (_t: string, fn: any) => { calls.push('uow.run'); return fn(tx); }) };
  const idem = { remember: rec('idem.remember', (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const outbox = { write: rec('outbox.write') }; const audit = { write: rec('audit.write') };
  const metrics = { inc: jest.fn(), observe: jest.fn() }; const wallet = { post: rec('wallet.post'), balanceMinor: jest.fn() };
  const repo = { getForUpdate: rec('repo.getForUpdate', () => booking(status)), getById: rec('repo.getById', () => booking(status)), update: rec('repo.update') };
  const warehouses = { getBookable: rec('warehouses.getBookable', () => w) };
  const svc = new StorageBookingService(uow as any, outbox as any, idem as any, metrics as any, audit as any, wallet as any, repo as any, warehouses as any);
  return { svc, calls, audit, repo, uow, outbox, warehouses };
}

describe('PC-56 OPS-2a · B3 / B4 — confirm and store: the named operator only, ONE audit row each', () => {
  it.each([['confirm', 'requested', 'confirmed', 'warehousing.booking.confirmed'], ['store', 'confirmed', 'stored', 'warehousing.booking.stored']] as const)(
    '%s by the operator: one audit row (status before → after), in the same unit of work, after the update', async (act, from, to, action) => {
      const h = bookingHarness(from);
      const out = await (h.svc as any)[act]('t1', op, 'b1', '1.2.3.4');
      expect(out.status).toBe(to);
      expect(h.calls).toEqual(['uow.run', 'repo.getForUpdate', 'warehouses.getBookable', 'repo.update', 'audit.write', 'outbox.write']);
      expect(h.audit.write).toHaveBeenCalledTimes(1);
      const row: any = (h.audit.write.mock.calls as any[])[0][1];
      expect(row).toEqual({ tenantId: 't1', actorUserId: 'op1', action, entityType: 'storage_booking', entityId: 'b1', oldValue: { status: from }, newValue: { status: to }, ip: '1.2.3.4' });
    });
  it.each([['confirm', 'requested', 'booking.confirm'], ['store', 'confirmed', 'booking.store']] as const)(
    '%s by a warehouse.manage holder who is NOT the operator → 403 WAREHOUSE_OPERATOR_ONLY by name; nothing updated, audited or emitted', async (act, from, named) => {
      const h = bookingHarness(from);
      const e: any = await (h.svc as any)[act]('t1', otherAdmin, 'b1').catch((x: unknown) => x);
      expect(e).toBeInstanceOf(WarehouseOperatorOnlyError);
      expect([e.code, e.httpStatus, e.message, e.details]).toEqual(['WAREHOUSE_OPERATOR_ONLY', 403, WAREHOUSE_OPERATOR_ONLY_SENTENCE, { act: named }]);
      for (const m of [h.repo.update, h.audit.write, h.outbox.write]) expect(m).not.toHaveBeenCalled();
    });
  it('a platform-global warehouse with no operator: nobody passes (the old escape would have admitted any administrator)', async () => {
    const h = bookingHarness('requested', wh({ tenantId: null, operatorUserId: null }));
    await expect(h.svc.confirm('t1', otherAdmin, 'b1')).rejects.toBeInstanceOf(WarehouseOperatorOnlyError);
    expect(h.repo.update).not.toHaveBeenCalled();
  });
});

describe('PC-56 OPS-2a · D3 — booking cancel: the depositor herself or the named operator; the operator\'s reason before the unit of work', () => {
  it('the operator WITHOUT a reason → 400 BOOKING_CANCEL_REASON_REQUIRED by name, thrown BEFORE the unit of work and any lock (spy: no uow, no FOR UPDATE, no write)', async () => {
    for (const reason of [undefined, null, '', '   ']) {
      const h = bookingHarness();
      const e: any = await h.svc.cancel('t1', op, 'b1', reason as any).catch((x) => x);
      expect(e).toBeInstanceOf(BookingCancelReasonRequiredError);
      expect([e.code, e.httpStatus, e.message]).toEqual(['BOOKING_CANCEL_REASON_REQUIRED', 400, BOOKING_CANCEL_REASON_REQUIRED_SENTENCE]);
      expect(h.calls).toEqual(['repo.getById', 'warehouses.getBookable']);          // two unlocked reads — then the refusal; never uow.run / getForUpdate
    }
  });
  it('a reason over 500 characters is refused by name for anyone, before ANY read', async () => {
    for (const actor of [op, dep]) {
      const h = bookingHarness();
      await expect(h.svc.cancel('t1', actor, 'b1', 'x'.repeat(501))).rejects.toBeInstanceOf(BookingCancelReasonRequiredError);
      expect(h.calls).toEqual([]);
    }
  });
  it('the operator WITH a reason: requested → cancelled, ONE audit row carrying the reason and "operator", in order inside one unit of work', async () => {
    const h = bookingHarness();
    const out = await h.svc.cancel('t1', op, 'b1', '  Lorry did not arrive  ', '1.2.3.4');
    expect(out.status).toBe('cancelled');
    expect(h.calls).toEqual(['repo.getById', 'warehouses.getBookable', 'uow.run', 'repo.getForUpdate', 'warehouses.getBookable', 'repo.update', 'audit.write', 'outbox.write']);
    expect((h.audit.write.mock.calls as any[])[0][1]).toEqual({ tenantId: 't1', actorUserId: 'op1', action: 'warehousing.booking.cancelled', entityType: 'storage_booking', entityId: 'b1',
      oldValue: { status: 'requested' }, newValue: { status: 'cancelled', cancelledBy: 'operator' }, reason: 'Lorry did not arrive', ip: '1.2.3.4' });
    expect(h.audit.write).toHaveBeenCalledTimes(1);
  });
  it('the depositor herself WITHOUT a reason: cancelled, ONE audit row ("depositor", no reason); her warehouse is never read', async () => {
    const h = bookingHarness('confirmed');
    const out = await h.svc.cancel('t1', dep, 'b1', undefined);
    expect(out.status).toBe('cancelled');
    expect(h.calls).toEqual(['repo.getById', 'uow.run', 'repo.getForUpdate', 'repo.update', 'audit.write', 'outbox.write']);
    expect((h.audit.write.mock.calls as any[])[0][1]).toMatchObject({ action: 'warehousing.booking.cancelled', oldValue: { status: 'confirmed' }, newValue: { status: 'cancelled', cancelledBy: 'depositor' }, reason: null });
  });
  it('an unrelated farmer, and a warehouse.manage holder who is not the operator → 403 BOOKING_CANCEL_NOT_PERMITTED; nothing locked or written', async () => {
    for (const actor of [farmer2, otherAdmin]) {
      const h = bookingHarness();
      const e: any = await h.svc.cancel('t1', actor, 'b1', 'any reason').catch((x) => x);
      expect(e).toBeInstanceOf(BookingCancelNotPermittedError);
      expect([e.code, e.httpStatus, e.message]).toEqual(['BOOKING_CANCEL_NOT_PERMITTED', 403, BOOKING_CANCEL_NOT_PERMITTED_SENTENCE]);
      expect(h.uow.run).not.toHaveBeenCalled(); expect(h.repo.getForUpdate).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
    }
  });
  it('a caller with neither permission is refused before any read', async () => {
    const h = bookingHarness();
    await expect(h.svc.cancel('t1', { userId: 'x', canManage: false, canStore: false }, 'b1', 'r')).rejects.toBeInstanceOf(WarehousingForbiddenError);
    expect(h.calls).toEqual([]);
  });
  it('the operator reassigned between the read and the lock: the locked check refuses (nothing written)', async () => {
    const h = bookingHarness();
    h.warehouses.getBookable.mockImplementationOnce(async () => { h.calls.push('warehouses.getBookable'); return wh(); })
      .mockImplementationOnce(async () => { h.calls.push('warehouses.getBookable'); return wh({ operatorUserId: 'someone-else' }); });
    await expect(h.svc.cancel('t1', op, 'b1', 'a reason')).rejects.toBeInstanceOf(BookingCancelNotPermittedError);
    expect(h.repo.update).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });
});

function warehouseHarness(existing: Warehouse, member = true) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn() }; const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() }; const audit = { write: jest.fn() };
  const repo = { getForUpdate: jest.fn(async () => existing), update: jest.fn(), isActiveTenantMember: jest.fn(async () => member), listFor: jest.fn(async () => []) };
  const svc = new WarehouseService(uow as any, outbox as any, idem as any, quota as any, metrics as any, audit as any, repo as any);
  return { svc, audit, repo, outbox };
}
const MEMBER = '0192d2c4-0000-7000-8000-00000000000b';

describe('PC-56 OPS-2a · D1 / D2 — who may edit a warehouse', () => {
  it('D1: the operator changes the rate → updated, ONE audit row (old/new rate)', async () => {
    const h = warehouseHarness(wh());
    await h.svc.update('t1', op, 'w1', { ratePerQtlMonthMinor: '1200' } as any);
    expect(h.repo.update).toHaveBeenCalledTimes(1); expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect((h.audit.write.mock.calls as any[])[0][1]).toMatchObject({ oldValue: { ratePerQtlMonthMinor: '900' }, newValue: { ratePerQtlMonthMinor: '1200' } });
  });
  it.each([[{ ratePerQtlMonthMinor: '1' }, ['ratePerQtlMonthMinor']], [{ defaultName: 'X' }, ['defaultName']], [{ isActive: false }, ['isActive']],
    [{ operatorUserId: MEMBER, ratePerQtlMonthMinor: '5' }, ['ratePerQtlMonthMinor']]])(
    'D1: a non-operator administrator sending %j → 403 WAREHOUSE_REASSIGN_ONLY by name; nothing updated, audited or emitted', async (dto, refused) => {
      const h = warehouseHarness(wh());
      const e: any = await h.svc.update('t1', otherAdmin, 'w1', dto as any).catch((x) => x);
      expect(e).toBeInstanceOf(WarehouseReassignOnlyError);
      expect(e).toBeInstanceOf(WarehousingForbiddenError);
      expect([e.code, e.httpStatus, e.message, e.details]).toEqual(['WAREHOUSE_REASSIGN_ONLY', 403, WAREHOUSE_REASSIGN_ONLY_SENTENCE, { allowed: ['operatorUserId'], refused }]);
      for (const m of [h.repo.update, h.audit.write, h.outbox.write, h.repo.isActiveTenantMember]) expect(m).not.toHaveBeenCalled();
    });
  it('D2: a non-operator administrator sending ONLY operatorUserId (a member) → reassigned, ONE audit row with before/after; the current operator is not asked', async () => {
    const h = warehouseHarness(wh());
    const out = await h.svc.update('t1', otherAdmin, 'w1', { operatorUserId: MEMBER } as any);
    expect(out.operatorUserId).toBe(MEMBER);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect((h.audit.write.mock.calls as any[])[0][1]).toMatchObject({ actorUserId: 'admin2', action: 'warehousing.warehouse.updated', oldValue: { operatorUserId: 'op1' }, newValue: { operatorUserId: MEMBER, fields: ['operatorUserId'] } });
  });
  it('D2 + B6: to a non-member → 422 WAREHOUSE_OPERATOR_NOT_A_MEMBER; nothing written', async () => {
    const h = warehouseHarness(wh(), false);
    await expect(h.svc.update('t1', otherAdmin, 'w1', { operatorUserId: MEMBER } as any)).rejects.toBeInstanceOf(WarehouseOperatorNotAMemberError);
    for (const m of [h.repo.update, h.audit.write]) expect(m).not.toHaveBeenCalled();
  });
  it('box=all needs warehouse.manage (it read the labour permission before)', async () => {
    const h = warehouseHarness(wh());
    await expect(h.svc.list('t1', dep, { box: 'all', activeOnly: true, limit: 10 })).rejects.toBeInstanceOf(WarehousingForbiddenError);
    await expect(h.svc.list('t1', otherAdmin, { box: 'all', activeOnly: true, limit: 10 })).resolves.toEqual({ items: [], nextCursor: null });
  });
});

describe('PC-56 OPS-2a · the route guard for cancel admits either permission', () => {
  const guardFor = (perms: string[]) => {
    jest.spyOn(rc, 'getRequestContext').mockReturnValue({ permissions: new Set(perms) } as any);
    class C { @RequireAnyPermission('warehouse.store', 'warehouse.manage') h() { return 1; } }
    const ctx: any = { getHandler: () => C.prototype.h, getClass: () => C };
    return () => new PermissionsGuard(new Reflector()).canActivate(ctx);
  };
  afterEach(() => jest.restoreAllMocks());
  it('the metadata is the any-of key; store alone, manage alone, both and `*` pass; neither is 403', () => {
    class M { @RequireAnyPermission('a', 'b') m() { return 0; } }
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, M.prototype.m)).toEqual(['a', 'b']);
    for (const p of [['warehouse.store'], ['warehouse.manage'], ['warehouse.store', 'warehouse.manage'], ['*']]) expect(guardFor(p)()).toBe(true);
    expect(guardFor(['loan.borrow'])).toThrow(/Missing any of: warehouse.store, warehouse.manage/);
  });
});

describe('PC-56 OPS-2a · Q11-A source assertion: the labour permission and the administrator flag are gone from warehousing', () => {
  const ROOT = path.join(__dirname, '..');
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === '__tests__' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  it('CONTROL: the pattern finds `booking.manage` where it really is (the labour module\'s policies)', () => {
    const labour = fs.readFileSync(path.join(ROOT, '..', 'labour', 'policies', 'labour.policies.ts'), 'utf8');
    expect(/booking\.manage/.test(labour)).toBe(true);
  });
  it('no non-test file of modules/warehousing names `booking.manage`, `isWarehouseAdmin` or `isAdmin`', () => {
    const files = walk(ROOT);
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect([path.relative(ROOT, f), /booking\.manage|isWarehouseAdmin|\bisAdmin\b/.test(fs.readFileSync(f, 'utf8'))]).toEqual([path.relative(ROOT, f), false]);
  });
});
