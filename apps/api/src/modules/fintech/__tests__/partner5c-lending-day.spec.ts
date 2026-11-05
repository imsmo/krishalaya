// modules/fintech/__tests__/partner5c-lending-day.spec.ts · PC-56 PARTNER-5c · founder 5c-4 (door Q6, LAW 9; survey P5-B9, F-5, F-12) — THE
// LENDING DAY IS THE INDIA-TIME DAY, unit level. Run under TZ=Asia/Kolkata AND TZ=UTC: every answer below must be the same in both.
//   • lendingDayOf: 00:00, 00:30, 05:29, 05:30 and 23:59 IST → the IST date, never the UTC date (which is a day earlier before 05:30);
//   • the zone constant equals 0232's partner-side arithmetic (read from the migration file), and `LENDING_TODAY_SQL` is its expression;
//   • BOTH repayment rails record the IST day of `now` as `due_date`: the repay route and the milk-bill deduction, with the clock frozen at
//     00:30 IST by jest's modern fake timers (`setSystemTime` — the settlement-statements-cadence-job.spec precedent);
//   • the desk's days-past-due SQL computes "today" as the IST day, never `CURRENT_DATE` (a source scan of the CODE, comments dropped).
// The live proof is src/__tests__/partner5c-sla.integration.spec.ts case (4).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LENDING_DAY_TZ, LENDING_TODAY_SQL, lendingDayOf } from '../domain/lending-day';
import { LoanService } from '../services/loan.service';

const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ist = (local: string) => new Date(`${local}+05:30`);

describe('PC-56 PARTNER-5c · the lending day is the India-time day (unit)', () => {
  it(`lendingDayOf → the IST calendar day at the five edges, whatever the process zone (TZ=${process.env.TZ ?? 'unset'})`, () => {
    const cases: Array<[string, string, string]> = [
      // [IST wall clock, the IST day, the UTC day of the same instant]
      ['2026-11-05T00:00:00', '2026-11-05', '2026-11-04'],
      ['2026-11-05T00:30:00', '2026-11-05', '2026-11-04'],
      ['2026-11-05T05:29:59', '2026-11-05', '2026-11-04'],
      ['2026-11-05T05:30:00', '2026-11-05', '2026-11-05'],
      ['2026-11-05T23:59:59', '2026-11-05', '2026-11-05'],
      // a month and a year boundary
      ['2027-01-01T00:30:00', '2027-01-01', '2026-12-31'],
      ['2026-03-01T04:00:00', '2026-03-01', '2026-02-28'],
    ];
    for (const [local, day, utcDay] of cases) {
      const at = ist(local);
      expect([local, lendingDayOf(at)]).toEqual([local, day]);
      expect([local, at.toISOString().slice(0, 10)]).toEqual([local, utcDay]);   // the old write, for the record
    }
    expect(() => lendingDayOf(new Date('nonsense'))).toThrow(/not a valid instant/);
  });
  it('ONE zone, and it equals the partner side\'s (0232 writes the literal); the SQL "today" is that zone\'s day from now()', () => {
    expect(LENDING_DAY_TZ).toBe('Asia/Kolkata');
    expect(LENDING_TODAY_SQL).toBe("(now() AT TIME ZONE 'Asia/Kolkata')::date");
    const m0232 = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0232_partner4b_lender_servicing.sql'), 'utf8');
    expect(m0232).toContain(`((now() AT TIME ZONE '${LENDING_DAY_TZ}')::date - l.next_due_date) BETWEEN 1 AND 30`);
  });
  it('the desk\'s days-past-due SQL uses the lending day, never the session\'s CURRENT_DATE (both queries, both places each)', () => {
    const src = code('repositories/servicing.repository.ts');
    expect(src).not.toMatch(/CURRENT_DATE/);
    expect((src.match(/\$\{LENDING_TODAY_SQL\}/g) ?? []).length).toBe(4);
    expect(src).toContain('(${LENDING_TODAY_SQL} - next_due_date)::int AS dpd');
    expect(src).toContain('next_due_date < ${LENDING_TODAY_SQL}');
  });
  it('no repayment due date is cut from an ISO string any more (both rails call lendingDayOf)', () => {
    const src = code('services/loan.service.ts');
    expect(src).not.toMatch(/dueDate:\s*now\.toISOString\(\)/);
    expect((src.match(/dueDate: lendingDayOf\(now\)/g) ?? []).length).toBe(2);
  });
});

describe('PC-56 PARTNER-5c · both repayment rails record the IST day at 00:30 IST (clock frozen)', () => {
  const AT = ist('2026-11-05T00:30:00');   // UTC day 2026-11-04
  const mk = () => {
    const loan = { borrowerUserId: 'u-member', repay: jest.fn(), outstandingMinor: 0n, pullEvents: () => [], toJSON: () => ({}) };
    const loans = { getForUpdate: jest.fn(async () => loan), update: jest.fn() };
    const wallet = { post: jest.fn(async () => ({ txnId: 'txn' })) }; const repayments = { insert: jest.fn() }; const audit = { write: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, f: (tx: unknown) => unknown) => f({})) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, f: () => unknown) => f()) };
    const metrics = { timing: jest.fn(), increment: jest.fn(), histogram: jest.fn(), observe: jest.fn(), counter: jest.fn() };
    const svc = new LoanService(uow as any, { write: jest.fn() } as any, idem as any, metrics as any, audit as any, wallet as any, loans as any, repayments as any);
    return { svc, repayments, wallet };
  };
  const dueOf = (insert: jest.Mock) => (insert.mock.calls[0] as any[])[1].toProps();
  beforeEach(() => { jest.useFakeTimers().setSystemTime(AT); });
  afterEach(() => { jest.useRealTimers(); });

  it('the repay route: due_date = 2026-11-05 (the IST day), paid at the frozen instant; the two legs unchanged', async () => {
    const { svc, repayments, wallet } = mk();
    await svc.repay('t', { userId: 'u-member', canBorrow: true, canManage: false }, 'l', 'k', { amountMinor: '100', channel: 'upi' } as any, null);
    const p = dueOf(repayments.insert);
    expect(p.dueDate).toBe('2026-11-05');
    expect(p.dueDate).not.toBe(AT.toISOString().slice(0, 10));
    expect((p.paidAt as Date).getTime()).toBe(AT.getTime());
    expect(((wallet.post.mock.calls[0] as any[])[1].legs as Array<{ amountMinor: bigint }>).map((x) => x.amountMinor)).toEqual([-100n, 100n]);
  });
  it('the milk-bill deduction: due_date = 2026-11-05 (the IST day); channel and the idempotency key unchanged', async () => {
    const { svc, repayments, wallet } = mk();
    await svc.applyMilkBillDeduction({} as any, 't', { loanId: 'l', borrowerUserId: 'u-member', amountMinor: 250n, billId: 'b', deductionId: 'd1', initiatedBy: 'u-desk' });
    const p = dueOf(repayments.insert);
    expect([p.dueDate, p.channel]).toEqual(['2026-11-05', 'milk_bill_deduction']);
    expect((wallet.post.mock.calls[0] as any[])[1].idempotencyKey).toBe('milkdeduct:d1');
  });
});
