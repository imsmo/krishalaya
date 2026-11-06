// modules/warehousing/__tests__/ops2b-receipts.service.spec.ts · PC-56 OPS-2b — RECEIPTS AND QUALITY, unit (fakes). Founder Q3-A, Q5-A, Q11-A,
// Q13-A (2026-11-06). Real SQL = integration (`src/__tests__/ops2b-receipts.integration.spec.ts`).
//   B2 · eNWR issue → 409 ENWR_ISSUE_NOT_ON_PLATFORM after the permission check and BEFORE idem.remember, the unit of work and any read or write
//        (an ORDERING SPY — the OPS-1a M2 lesson: a refusal moved inside the remembered unit of work still rolls everything back, so only the
//        order of calls can see it);
//   B1 · standalone release → 409 ENWR_RELEASE_NOT_STANDALONE before any lock or write; cancel → the warehouse's NAMED operator only (403 by name,
//        no administrator escape), a reason required (400 by name, before idem.remember), ONE audit row with status before/after + the reason;
//   B4 · the assay record writes ONE audit row; Q11-A strict: a tenant administrator who is not the named operator is refused (403 by name);
//        F-16: a booking that is not `stored` → 409 BOOKING_NOT_STORED.
import { NwrReceiptService } from '../services/nwr-receipt.service';
import { AssayReportService } from '../services/assay-report.service';
import { NwrReceipt } from '../domain/nwr-receipt.entity';
import { StorageBooking } from '../domain/storage-booking.entity';
import { Warehouse } from '../domain/warehouse.entity';
import {
  EnwrIssueNotOnPlatformError, ENWR_ISSUE_NOT_ON_PLATFORM_SENTENCE, EnwrReleaseNotStandaloneError, ENWR_RELEASE_NOT_STANDALONE_SENTENCE,
  EnwrCancelReasonRequiredError, ENWR_CANCEL_REASON_REQUIRED_SENTENCE, WarehouseOperatorOnlyError, WAREHOUSE_OPERATOR_ONLY_SENTENCE, BookingNotStoredError,
} from '../domain/warehousing.errors';

const warehouse = (over: any = {}) => Warehouse.rehydrate({ id: 'w1', tenantId: 't1', operatorUserId: 'op1', defaultName: 'W', wdraRegNo: null, addressId: null, capacityMt: null, storageKinds: [], commoditiesAccepted: [], ratePerQtlMonthMinor: 5000n, insurancePolicyRef: null, isActive: true, ...over });
function booking(status: 'confirmed' | 'stored' = 'stored') {
  const b = StorageBooking.request({ id: 'b1', tenantId: 't1', warehouseId: 'w1', depositorUserId: 'dep1', productId: 'p1', quantityMilli: 100000n, unitCode: 'quintal', expectedArrival: null });
  b.confirm(); if (status === 'stored') b.store(new Date()); b.pullEvents();
  return b;
}
const receipt = () => NwrReceipt.rehydrate({ id: 'n1', tenantId: 't1', storageBookingId: 'b1', repository: 'NERL' as any, enwrNo: 'TEST-0001', holderUserId: 'dep1',
  quantityMilli: 100000n, valuationMinor: 1000n, status: 'issued', pledgedLoanId: null, issuedAt: new Date('2026-10-01T00:00:00Z'), expiresAt: null });

/** Every collaborator records its call in ONE ordered list (the spy). */
function nwrHarness(wh: Warehouse | null = warehouse()) {
  const calls: string[] = [];
  const rec = (name: string, out?: () => unknown) => jest.fn(async (..._a: any[]) => { calls.push(name); return out ? out() : undefined; });
  const tx = { query: rec('tx.query', () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: any) => { calls.push('uow.run'); return fn(tx); }) };
  const store = new Map<string, unknown>();
  const idem = { remember: jest.fn(async (k: string, _u: string, _e: string, fn: any) => { calls.push('idem.remember'); if (store.has(k)) return store.get(k); const out = await fn(); store.set(k, out); return out; }) };
  const outbox = { write: rec('outbox.write') }; const audit = { write: rec('audit.write') };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const repo = { getForUpdate: rec('repo.getForUpdate', () => receipt()), getById: rec('repo.getById', () => receipt()), update: rec('repo.update'), insert: rec('repo.insert'), findActiveForBooking: rec('repo.findActiveForBooking', () => null) };
  const bookings = { getById: rec('bookings.getById', () => booking()), getForUpdate: rec('bookings.getForUpdate', () => booking()) };
  const warehouses = { getBookable: rec('warehouses.getBookable', () => wh) };
  const svc = new NwrReceiptService(uow as any, outbox as any, idem as any, metrics as any, audit as any, repo as any, bookings as any, warehouses as any);
  return { svc, calls, idem, uow, repo, audit, outbox, bookings, warehouses };
}
const op = { userId: 'op1', canManage: true, canStore: false, isAdmin: false };
const otherAdmin = { userId: 'admin2', canManage: true, canStore: false, isAdmin: true };   // a tenant_admin (booking.manage) who is NOT the operator
const issueDto = { storageBookingId: 'b1', repository: 'NERL', enwrNo: 'TEST-0001', valuationMinor: '1000' } as any;

describe('PC-56 OPS-2b · B2 — eNWR issue is refused BY NAME before idem.remember (ordering spy)', () => {
  it('409 ENWR_ISSUE_NOT_ON_PLATFORM with the sentence; NOTHING was called — not idem.remember, not the uow, no read, no write', async () => {
    const h = nwrHarness();
    const e: any = await h.svc.issue('t1', op, 'idem-i', issueDto, null).catch((x) => x);
    expect(e).toBeInstanceOf(EnwrIssueNotOnPlatformError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['ENWR_ISSUE_NOT_ON_PLATFORM', 409, ENWR_ISSUE_NOT_ON_PLATFORM_SENTENCE]);
    expect(e.message).toBe('This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name. Nothing was recorded.');
    expect(h.calls).toEqual([]);
  });
  it('an administrator, a replay with the same key: the same refusal, nothing remembered to replay', async () => {
    const h = nwrHarness();
    for (const a of [op, otherAdmin, op]) await expect(h.svc.issue('t1', a, 'idem-same', issueDto, null)).rejects.toBeInstanceOf(EnwrIssueNotOnPlatformError);
    expect(h.calls).toEqual([]);
  });
  it('the permission check still comes first: no warehouse.manage → 403 WAREHOUSING_FORBIDDEN', async () => {
    const h = nwrHarness();
    const e: any = await h.svc.issue('t1', { ...op, canManage: false }, 'idem-p', issueDto, null).catch((x) => x);
    expect([e.code, e.httpStatus]).toEqual(['WAREHOUSING_FORBIDDEN', 403]);
    expect(h.calls).toEqual([]);
  });
});

describe('PC-56 OPS-2b · B1 — a receipt is never released on its own', () => {
  it('409 ENWR_RELEASE_NOT_STANDALONE with the sentence, for the operator and an administrator; nothing locked or written', async () => {
    for (const a of [op, otherAdmin]) {
      const h = nwrHarness();
      const e: any = await h.svc.release('t1', a, 'n1').catch((x) => x);
      expect(e).toBeInstanceOf(EnwrReleaseNotStandaloneError);
      expect([e.code, e.httpStatus, e.message]).toEqual(['ENWR_RELEASE_NOT_STANDALONE', 409, ENWR_RELEASE_NOT_STANDALONE_SENTENCE]);
      expect(h.calls).toEqual([]);
    }
  });
});

describe('PC-56 OPS-2b · B1 — cancel: the named operator, a key, a reason, one audit row', () => {
  it('the operator with a reason: issued → cancelled, ONE audit row (status before/after + the reason), in order inside one unit of work', async () => {
    const h = nwrHarness();
    const out = await h.svc.cancel('t1', op, 'n1', 'idem-c', '  goods were never deposited  ', '10.0.0.1');
    expect(out.status).toBe('cancelled');
    expect(h.calls).toEqual(['idem.remember', 'uow.run', 'repo.getForUpdate', 'bookings.getById', 'warehouses.getBookable', 'repo.update', 'audit.write', 'outbox.write']);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const row: any = (h.audit.write.mock.calls as any[])[0][1];
    expect(row).toMatchObject({ tenantId: 't1', actorUserId: 'op1', action: 'warehousing.nwr.cancelled', entityType: 'nwr_receipt', entityId: 'n1',
      oldValue: { status: 'issued' }, newValue: { status: 'cancelled' }, reason: 'goods were never deposited', ip: '10.0.0.1' });
  });
  it('a replay with the same key returns the same response and writes NOTHING more (one audit row in all)', async () => {
    const h = nwrHarness();
    const a = await h.svc.cancel('t1', op, 'n1', 'idem-r', 'a reason', null);
    const b = await h.svc.cancel('t1', op, 'n1', 'idem-r', 'a reason', null);
    expect(b).toEqual(a);
    expect([h.audit.write.mock.calls.length, h.repo.update.mock.calls.length, h.uow.run.mock.calls.length]).toEqual([1, 1, 1]);
  });
  it.each([[undefined], [null], [''], ['   '], ['x'.repeat(501)]])('reason %p → 400 ENWR_CANCEL_REASON_REQUIRED before idem.remember; nothing called', async (reason) => {
    const h = nwrHarness();
    const e: any = await h.svc.cancel('t1', op, 'n1', 'idem-n', reason as any, null).catch((x) => x);
    expect(e).toBeInstanceOf(EnwrCancelReasonRequiredError);
    expect([e.code, e.httpStatus, e.message]).toEqual(['ENWR_CANCEL_REASON_REQUIRED', 400, ENWR_CANCEL_REASON_REQUIRED_SENTENCE]);
    expect(h.calls).toEqual([]);
  });
  it('Q11-A strict: a tenant administrator who is NOT the named operator → 403 WAREHOUSE_OPERATOR_ONLY; nothing updated or audited', async () => {
    const h = nwrHarness();
    const e: any = await h.svc.cancel('t1', otherAdmin, 'n1', 'idem-a', 'a reason', null).catch((x) => x);
    expect(e).toBeInstanceOf(WarehouseOperatorOnlyError);
    expect([e.code, e.httpStatus, e.message, e.details]).toEqual(['WAREHOUSE_OPERATOR_ONLY', 403, WAREHOUSE_OPERATOR_ONLY_SENTENCE, { act: 'nwr.cancel' }]);
    for (const m of [h.repo.update, h.audit.write, h.outbox.write]) expect(m).not.toHaveBeenCalled();
  });
  it('a warehouse with NO operator: even an administrator is refused (403 by name)', async () => {
    const h = nwrHarness(warehouse({ operatorUserId: null }));
    await expect(h.svc.cancel('t1', otherAdmin, 'n1', 'idem-z', 'a reason', null)).rejects.toBeInstanceOf(WarehouseOperatorOnlyError);
    expect(h.audit.write).not.toHaveBeenCalled();
  });
  it('no warehouse.manage → 403 WAREHOUSING_FORBIDDEN first (before the reason)', async () => {
    const h = nwrHarness();
    const e: any = await h.svc.cancel('t1', { ...op, canManage: false }, 'n1', 'idem-f', '', null).catch((x) => x);
    expect([e.code, e.httpStatus]).toEqual(['WAREHOUSING_FORBIDDEN', 403]);
    expect(h.calls).toEqual([]);
  });
});

function assayHarness(status: 'confirmed' | 'stored' = 'stored', wh: Warehouse | null = warehouse()) {
  const calls: string[] = [];
  const rec = (name: string, out?: () => unknown) => jest.fn(async (..._a: any[]) => { calls.push(name); return out ? out() : undefined; });
  const tx = { query: rec('tx.query', () => ({ rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: any) => { calls.push('uow.run'); return fn(tx); }) };
  const outbox = { write: rec('outbox.write') }; const audit = { write: rec('audit.write') };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const repo = { insert: rec('repo.insert'), listForBooking: rec('repo.listForBooking', () => []) };
  const bookings = { getById: rec('bookings.getById', () => booking(status)) };
  const warehouses = { getBookable: rec('warehouses.getBookable', () => wh) };
  const svc = new AssayReportService(uow as any, outbox as any, metrics as any, audit as any, repo as any, bookings as any, warehouses as any);
  return { svc, calls, audit, repo, outbox };
}
const assayDto = { storageBookingId: 'b1', assayerName: 'Test lab', parameters: { moisture: '11.5', grade: 'FAQ' }, validUntil: '2026-12-31' } as any;

describe('PC-56 OPS-2b · B4 / Q11-A / F-16 — the assay record', () => {
  it('the named operator on a stored booking: ONE audit row (what was entered, never a price), in the same unit of work as the insert', async () => {
    const h = assayHarness();
    const out = await h.svc.record('t1', op, assayDto, '10.0.0.2');
    expect(out.assayerName).toBe('Test lab');
    expect(h.calls).toEqual(['uow.run', 'bookings.getById', 'warehouses.getBookable', 'repo.insert', 'audit.write', 'outbox.write']);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const row: any = (h.audit.write.mock.calls as any[])[0][1];
    expect(row).toMatchObject({ tenantId: 't1', actorUserId: 'op1', action: 'warehousing.assay.recorded', entityType: 'assay_report', ip: '10.0.0.2',
      newValue: { storageBookingId: 'b1', assayerName: 'Test lab', parameterNames: ['grade', 'moisture'], validUntil: '2026-12-31' } });
    expect(JSON.stringify(row)).not.toMatch(/valuation|price|Minor/i);
  });
  it('Q11-A strict: a tenant administrator who is not the named operator → 403 WAREHOUSE_OPERATOR_ONLY; nothing inserted or audited', async () => {
    const h = assayHarness();
    const e: any = await h.svc.record('t1', otherAdmin, assayDto).catch((x) => x);
    expect(e).toBeInstanceOf(WarehouseOperatorOnlyError);
    expect([e.code, e.httpStatus, e.details]).toEqual(['WAREHOUSE_OPERATOR_ONLY', 403, { act: 'assay.record' }]);
    for (const m of [h.repo.insert, h.audit.write, h.outbox.write]) expect(m).not.toHaveBeenCalled();
  });
  it('F-16: a booking that is not stored → 409 BOOKING_NOT_STORED (before the operator check); nothing inserted or audited', async () => {
    const h = assayHarness('confirmed');
    const e: any = await h.svc.record('t1', op, assayDto).catch((x) => x);
    expect(e).toBeInstanceOf(BookingNotStoredError);
    expect([e.code, e.httpStatus]).toEqual(['BOOKING_NOT_STORED', 409]);
    expect(h.audit.write).not.toHaveBeenCalled(); expect(h.repo.insert).not.toHaveBeenCalled();
  });
});
