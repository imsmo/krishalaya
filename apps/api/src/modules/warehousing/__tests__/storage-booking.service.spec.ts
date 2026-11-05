// modules/warehousing/__tests__/storage-booking.service.spec.ts · StorageBookingService unit tests (fakes).
// Pins THE MONEY PATH. PC-56 OPS-1a (founder Q3-A): release() is REFUSED BY NAME before any lock, fee or write — the storage fee
// would leave the depositor's wallet on the operator's act alone. Real SQL = integration (ops1a-money-desks).
import { StorageBookingService } from '../services/storage-booking.service';
import { StorageBooking } from '../domain/storage-booking.entity';
import { Warehouse } from '../domain/warehouse.entity';
import { StorageReleaseAwaitsDepositorError, STORAGE_RELEASE_AWAITS_DEPOSITOR_SENTENCE } from '../domain/warehousing.errors';

const warehouse = (over: any = {}) => Warehouse.rehydrate({ id: 'w1', tenantId: 't1', operatorUserId: 'op1', defaultName: 'W', wdraRegNo: null, addressId: null, capacityMt: null, storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: 5000n, insurancePolicyRef: null, isActive: true, ...over });
function storedBooking() {
  const b = StorageBooking.request({ id: 'b1', tenantId: 't1', warehouseId: 'w1', depositorUserId: 'dep1', productId: 'p1', quantityMilli: 100000n, unitCode: 'quintal', expectedArrival: null });
  b.confirm(); b.store(new Date(Date.now() - 40 * 86400000)); b.pullEvents(); // 40 days ago → 2 months
  return b;
}
function harness(wh: Warehouse) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() }; const audit = { write: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 't', alreadyApplied: false })), balanceMinor: jest.fn() };
  const repo = { getForUpdate: jest.fn(async () => storedBooking()), getById: jest.fn(async () => storedBooking()), update: jest.fn() };
  const warehouses = { getBookable: jest.fn(async () => wh), getForUpdate: jest.fn(async () => wh) };
  const svc = new StorageBookingService(uow as any, outbox as any, idem as any, metrics as any, audit as any, wallet as any, repo as any, warehouses as any);
  return { svc, wallet, uow, idem, repo, warehouses, audit, outbox, tx };
}
const op = { userId: 'op1', canManage: true, canStore: false, isAdmin: false };

// PC-56 OPS-1a · NAMED UPDATE (founder Q3-A, 2026-11-05): the three cases below pinned release() SETTLING the storage fee
// (depositor → operator). The release that debits the depositor's wallet on the operator's act is now REFUSED BY NAME until she
// confirms it in her own session, so each case now pins the refusal, thrown before the idempotency record, the lock, the fee and any
// write — whatever the warehouse's rate or payee. The fee arithmetic itself stays pinned in warehousing-domain.spec.ts.
function nothingTouched(h: ReturnType<typeof harness>) {
  for (const m of [h.idem.remember, h.uow.run, h.repo.getForUpdate, h.repo.getById, h.repo.update, h.warehouses.getBookable, h.warehouses.getForUpdate,
    h.wallet.post, h.audit.write, h.outbox.write, h.tx.query]) expect(m).not.toHaveBeenCalled();
}
describe('release — PAUSED: refused by name before any lock, fee or write (OPS-1a, founder Q3-A)', () => {
  it('a fee-bearing warehouse: 409 STORAGE_RELEASE_AWAITS_DEPOSITOR, the founder\'s sentence, nothing locked, posted or written', async () => {
    const h = harness(warehouse());
    const e: any = await h.svc.release('t1', op, 'b1', 'idem-r', null).catch((x) => x);
    expect(e).toBeInstanceOf(StorageReleaseAwaitsDepositorError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['STORAGE_RELEASE_AWAITS_DEPOSITOR', 409,
      'A release cannot be made here yet: the storage fee would leave the depositor\'s wallet without her confirming it. Nothing was released or charged.']);
    expect(e.message).toBe(STORAGE_RELEASE_AWAITS_DEPOSITOR_SENTENCE);
    nothingTouched(h);
  });
  it('a free (zero-rate) warehouse is refused the same way (the refusal does not depend on the fee)', async () => {
    const h = harness(warehouse({ ratePerQtlMonthMinor: 0n }));
    await expect(h.svc.release('t1', op, 'b1', 'idem-r2', null)).rejects.toBeInstanceOf(StorageReleaseAwaitsDepositorError);
    nothingTouched(h);
  });
  it('a warehouse with no operator, by an admin: the same refusal (no payee lookup happens at all)', async () => {
    const h = harness(warehouse({ operatorUserId: null }));
    await expect(h.svc.release('t1', { ...op, isAdmin: true }, 'b1', 'idem-r3', null)).rejects.toBeInstanceOf(StorageReleaseAwaitsDepositorError);
    nothingTouched(h);
  });
  it('the permission check still comes first: no warehouse.manage → 403 WAREHOUSING_FORBIDDEN, not the refusal', async () => {
    const h = harness(warehouse());
    const e: any = await h.svc.release('t1', { ...op, canManage: false }, 'b1', 'idem-r4', null).catch((x) => x);
    expect([e.code, e.httpStatus]).toEqual(['WAREHOUSING_FORBIDDEN', 403]);
    nothingTouched(h);
  });
  it('a replay with the same Idempotency-Key gets the same refusal (nothing was remembered to replay)', async () => {
    const h = harness(warehouse());
    for (let i = 0; i < 2; i++) await expect(h.svc.release('t1', op, 'b1', 'idem-same', null)).rejects.toBeInstanceOf(StorageReleaseAwaitsDepositorError);
    nothingTouched(h);
  });
  it('the other operator acts are untouched: confirm still locks and writes (the refusal is release-only)', async () => {
    const h = harness(warehouse());
    h.repo.getForUpdate.mockImplementationOnce(async () => { const b = StorageBooking.request({ id: 'b2', tenantId: 't1', warehouseId: 'w1', depositorUserId: 'dep1', productId: 'p1', quantityMilli: 1000n, unitCode: 'quintal', expectedArrival: null }); b.pullEvents(); return b; });
    const out = await h.svc.confirm('t1', op, 'b2');
    expect(out.status).toBe('confirmed'); expect(h.repo.update).toHaveBeenCalledTimes(1);
  });
});
