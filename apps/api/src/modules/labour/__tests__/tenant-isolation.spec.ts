// modules/labour/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every worker/booking/assignment read+write binds tenant_id (Law 1). labour_bookings HAS a version column
// → its update is an OPTIMISTIC compare-and-swap (WHERE version=$); the others lock FOR UPDATE. Lists are
// keyset (never OFFSET); the expiry finder is bounded + SKIP LOCKED. minimum_wages is global (no tenant).
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { BookingAssignmentRepository } from '../repositories/booking-assignment.repository';
import { MinimumWageRepository } from '../repositories/minimum-wage.repository';
import { LabourBooking } from '../domain/labour-booking.entity';
import { BookingAssignment } from '../domain/booking-assignment.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const booking = () => LabourBooking.rehydrate({
  id: 'b1', tenantId: 'tenantA', bookingNo: 'LB-X', employerUserId: 'emp1', demandTypeId: 'd1', taskSkillId: 's1',
  workersNeeded: 2, startDate: '2026-07-01', endDate: '2026-07-03', dailyHours: 8, wageKind: 'per_day',
  wageOfferedMinor: 50000n, minWageMinor: 38000n, currencyCode: 'INR', overtimeRateMultiplier: 1.5,
  womenOnly: false, farmLat: 22.3, farmLng: 71.1, status: 'open', respondBy: null, version: 3,
});

describe('worker_profiles isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new WorkerProfileRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'w1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['w1', 'tenantA']);
  });
  it('findByUser binds tenant_id + user_id (one-profile lookup)', async () => {
    const { provider, exec } = fakeReplica();
    await new WorkerProfileRepository(provider).findByUser('tenantA', 'u1');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND user_id=\$2/); expect(params).toEqual(['tenantA', 'u1']);
  });
  it('listFor is keyset (no OFFSET) + tenant-bound', async () => {
    const { provider, exec } = fakeReplica();
    await new WorkerProfileRepository(provider).listFor('tenantA', { limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/); expect(sql).not.toMatch(/OFFSET/i);
  });
});

describe('labour_bookings isolation + optimistic lock', () => {
  it('update is an OPTIMISTIC compare-and-swap on version, tenant-bound', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new LabourBookingRepository(fakeReplica().provider).update(tx as any, booking(), 3);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/version=version\+1/); expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2 AND version=\$5/);
    expect(params.slice(0, 5)).toEqual(['b1', 'tenantA', 'open', null, 3]);
  });
  it('insert binds tenant_id + carries version', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ booking_no: 'JOB-0713-01', created_at: new Date(), created_at_raw: '2026-07-13 06:00:00.123456+00' }], rowCount: 1 }) };
    const r = await new LabourBookingRepository(fakeReplica().provider).insert(tx as any, booking(), 'emp1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO labour_bookings/); expect(params).toContain('tenantA');
    // PC-56 TENANT-11b: the job number is the 0187 trigger's (NULL is sent) and the µs created_at is read back.
    expect(sql).toMatch(/VALUES \(\$1,\$2,NULL,/); expect(sql).toMatch(/RETURNING booking_no, created_at, created_at::text/);
    expect(r.bookingNo).toBe('JOB-0713-01');
  });
  it('listFor keyset (no OFFSET), open box filters status=open', async () => {
    const { provider, exec } = fakeReplica();
    await new LabourBookingRepository(provider).listFor('tenantA', { openOnly: true, limit: 20 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/status='open'/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('dueToExpire is bounded, per tenant (kv_app unit of work — F-9), over open bookings past respond_by', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new LabourBookingRepository(fakeReplica().provider).dueToExpire(tx as any, 'tenantA', new Date(), 100);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND status='open' AND respond_by IS NOT NULL AND respond_by < \$2/);
    expect(sql).toMatch(/LIMIT \$3/); expect(params[0]).toBe('tenantA');
  });
  it('demand-type resolution is platform-scoped (tenant_id IS NULL), never client id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'dt1' }], rowCount: 1 }) };
    await new LabourBookingRepository(fakeReplica().provider).resolveDemandTypeId(tx as any, 'daily_single');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/type_code='labour_demand_type'/); expect(sql).toMatch(/tenant_id IS NULL/); expect(params).toEqual(['daily_single']);
  });
});

describe('booking_assignments isolation', () => {
  it('listAcceptedForUpdate binds tenant + booking, locks, filters accepted', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new BookingAssignmentRepository(fakeReplica().provider).listAcceptedForUpdate(tx as any, 'tenantA', 'b1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/ba.tenant_id=\$1 AND ba.booking_id=\$2 AND ba.status IN \('accepted','paid'\)/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['tenantA', 'b1']);
  });
  it('insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const a = BookingAssignment.create({ id: 'a1', bookingId: 'b1', tenantId: 'tenantA', workerId: 'w1', wageMinor: 50000n });
    await new BookingAssignmentRepository(fakeReplica().provider).insert(tx as any, a, 'emp1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO booking_assignments/); expect(params).toContain('tenantA');
  });
});

describe('minimum_wages (global master data)', () => {
  it('resolve is region+skill+effective-dated, latest first (no tenant scoping)', async () => {
    const { provider, exec } = fakeReplica();
    await new MinimumWageRepository(provider).resolve('tenantA', 'r1', 'unskilled', '2026-07-01');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/region_id=\$1 AND skill_level=\$2 AND effective_from <= \$3::date/);
    expect(sql).toMatch(/ORDER BY effective_from DESC LIMIT 1/);
    expect(params).toEqual(['r1', 'unskilled', '2026-07-01']);
  });
});
