// modules/warehousing/__tests__/warehouse.service.spec.ts · WarehouseService unit tests (fakes).
// Pins: register quota-checks + drains warehouse_listed to the outbox + audits; update is operator-only (authz THROWS).
import { WarehouseService } from '../services/warehouse.service';
import { Warehouse } from '../domain/warehouse.entity';
import { WarehousingForbiddenError, WarehouseOperatorNotAMemberError, WAREHOUSE_OPERATOR_NOT_A_MEMBER_SENTENCE } from '../domain/warehousing.errors';

function harness(existing: Warehouse | null, member = true) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() }; const metrics = { inc: jest.fn(), observe: jest.fn() }; const audit = { write: jest.fn() };
  // PC-56 OPS-2c · NAMED UPDATE (B6): the repository gains `isActiveTenantMember` (the operator-membership read); the fake answers `member`.
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(async () => existing), update: jest.fn(), getBookable: jest.fn(), listFor: jest.fn(), isActiveTenantMember: jest.fn(async () => member) };
  const svc = new WarehouseService(uow as any, outbox as any, idem as any, quota as any, metrics as any, audit as any, repo as any);
  return { svc, outbox, quota, audit, repo, idem, uow, tx };
}
const op = { userId: 'op1', canManage: true, canStore: false, isAdmin: false };

describe('WarehouseService.register', () => {
  it('quota-checks, persists, audits + emits warehouse_listed', async () => {
    const { svc, outbox, quota, audit } = harness(null);
    const out = await svc.register('t1', op, 'idem-1', { defaultName: 'Anand WH', storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: '5000' } as any, '1.2.3.4');
    expect(quota.assertWithinLimit).toHaveBeenCalledWith('t1', 'warehouses');
    expect(out.defaultName).toBe('Anand WH'); expect(out.ratePerQtlMonthMinor).toBe('5000');
    expect(outbox.write.mock.calls[0][1].eventType).toBe('warehousing.warehouse_listed');
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
  it('requires warehouse.manage', async () => {
    const { svc } = harness(null);
    await expect(svc.register('t1', { ...op, canManage: false }, 'idem-2', { defaultName: 'X', storageKinds: [], commoditiesAccepted: [] } as any, null)).rejects.toBeInstanceOf(WarehousingForbiddenError);
  });
});

describe('WarehouseService.update authz', () => {
  it('forbids editing another operator\'s warehouse', async () => {
    const other = Warehouse.rehydrate({ id: 'w1', tenantId: 't1', operatorUserId: 'someone', defaultName: 'W', wdraRegNo: null, addressId: null, capacityMt: null, storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: null, insurancePolicyRef: null, isActive: true });
    const { svc } = harness(other);
    await expect(svc.update('t1', op, 'w1', { defaultName: 'New' } as any)).rejects.toBeInstanceOf(WarehousingForbiddenError);
  });
});

// ── PC-56 OPS-2c · OPS2-B4 / B6 (founder Q1-A, Q2-A, 2026-11-06) ──────────────────────────────────────────────────────────────────────────
const mine = (over: any = {}) => Warehouse.rehydrate({ id: 'w1', tenantId: 't1', operatorUserId: 'op1', defaultName: 'W', wdraRegNo: null, addressId: null, capacityMt: null, storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: 900n, insurancePolicyRef: null, isActive: true, ...over });

describe('PC-56 OPS-2c · B4 — every warehouse update writes EXACTLY ONE audit row with the rate / operator before → after', () => {
  it('a rate change: one row, warehousing.warehouse.updated, old/new rate only (the operator did not change), in the same tx', async () => {
    const h = harness(mine());
    await h.svc.update('t1', op, 'w1', { ratePerQtlMonthMinor: '1200' } as any, '1.2.3.4');
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const [tx, row] = h.audit.write.mock.calls[0];
    expect(tx).toBe(h.tx);
    expect(row).toMatchObject({ tenantId: 't1', actorUserId: 'op1', action: 'warehousing.warehouse.updated', entityType: 'warehouse', entityId: 'w1', ip: '1.2.3.4' });
    expect(row.oldValue).toEqual({ ratePerQtlMonthMinor: '900' });
    expect(row.newValue).toEqual({ ratePerQtlMonthMinor: '1200', fields: ['ratePerQtlMonthMinor'] });
  });
  it('an operator change: one row with old/new operator only; a rate AND operator change: both, in one row', async () => {
    const h = harness(mine());
    await h.svc.update('t1', op, 'w1', { operatorUserId: '0192d2c4-0000-7000-8000-00000000000b' } as any);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect(h.audit.write.mock.calls[0][1].oldValue).toEqual({ operatorUserId: 'op1' });
    expect(h.audit.write.mock.calls[0][1].newValue).toEqual({ operatorUserId: '0192d2c4-0000-7000-8000-00000000000b', fields: ['operatorUserId'] });
    const h2 = harness(mine());
    await h2.svc.update('t1', op, 'w1', { operatorUserId: '0192d2c4-0000-7000-8000-00000000000b', ratePerQtlMonthMinor: '0', defaultName: 'X' } as any);
    expect(h2.audit.write).toHaveBeenCalledTimes(1);
    expect(h2.audit.write.mock.calls[0][1].oldValue).toEqual({ ratePerQtlMonthMinor: '900', operatorUserId: 'op1' });
    expect(h2.audit.write.mock.calls[0][1].newValue).toEqual({ ratePerQtlMonthMinor: '0', operatorUserId: '0192d2c4-0000-7000-8000-00000000000b', fields: ['defaultName', 'operatorUserId', 'ratePerQtlMonthMinor'] });
  });
  it('an update that sets neither rate nor operator still writes its one row (the fields named, no before/after); a same-value rate records no change', async () => {
    const h = harness(mine());
    await h.svc.update('t1', op, 'w1', { defaultName: 'New' } as any);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ oldValue: {}, newValue: { fields: ['defaultName'] } });
    const h2 = harness(mine());
    await h2.svc.update('t1', op, 'w1', { ratePerQtlMonthMinor: '900' } as any);
    expect(h2.audit.write.mock.calls[0][1]).toMatchObject({ oldValue: {}, newValue: { fields: ['ratePerQtlMonthMinor'] } });
  });
  it('a refused update writes no audit row (another operator\'s warehouse)', async () => {
    const h = harness(mine({ operatorUserId: 'someone' }));
    await expect(h.svc.update('t1', op, 'w1', { ratePerQtlMonthMinor: '1' } as any)).rejects.toBeInstanceOf(WarehousingForbiddenError);
    expect(h.audit.write).not.toHaveBeenCalled(); expect(h.repo.update).not.toHaveBeenCalled();
  });
});

describe('PC-56 OPS-2c · B6 — a named operator who is not an active member of the tenant is refused BY NAME; nothing is written', () => {
  it('update: 422 WAREHOUSE_OPERATOR_NOT_A_MEMBER with the sentence; no update, no audit, no outbox', async () => {
    const h = harness(mine(), false);
    const e: any = await h.svc.update('t1', op, 'w1', { operatorUserId: '0192d2c4-0000-7000-8000-0000000000aa' } as any).catch((x) => x);
    expect(e).toBeInstanceOf(WarehouseOperatorNotAMemberError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['WAREHOUSE_OPERATOR_NOT_A_MEMBER', 422, WAREHOUSE_OPERATOR_NOT_A_MEMBER_SENTENCE]);
    expect(e.message).toBe('The person named as the warehouse operator is not an active member of this organisation. Nothing was saved.');
    expect(h.repo.isActiveTenantMember).toHaveBeenCalledWith(h.tx, 't1', '0192d2c4-0000-7000-8000-0000000000aa');
    for (const m of [h.repo.update, h.audit.write, h.outbox.write]) expect(m).not.toHaveBeenCalled();
  });
  it('register: a named non-member operator is refused before the insert; nothing persisted, audited or emitted', async () => {
    const h = harness(null, false);
    await expect(h.svc.register('t1', op, 'idem-3', { defaultName: 'X', operatorUserId: '0192d2c4-0000-7000-8000-0000000000aa', storageKinds: [], commoditiesAccepted: [] } as any, null))
      .rejects.toBeInstanceOf(WarehouseOperatorNotAMemberError);
    for (const m of [h.repo.insert, h.audit.write, h.outbox.write, h.quota.increment]) expect(m).not.toHaveBeenCalled();
  });
  it('a member operator passes (update and register); register with NO operator named asks nothing (the default is the caller)', async () => {
    const h = harness(mine());
    await h.svc.update('t1', op, 'w1', { operatorUserId: '0192d2c4-0000-7000-8000-00000000000b' } as any);
    expect(h.repo.update).toHaveBeenCalledTimes(1);
    const h2 = harness(null);
    await h2.svc.register('t1', op, 'idem-4', { defaultName: 'X', storageKinds: [], commoditiesAccepted: [] } as any, null);
    expect(h2.repo.isActiveTenantMember).not.toHaveBeenCalled(); expect(h2.repo.insert).toHaveBeenCalledTimes(1);
  });
});
