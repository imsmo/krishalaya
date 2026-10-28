// modules/partner-console/__tests__/partner-loans.rules.spec.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — the PURE pieces.
//
// The point of this file is the THIRD WALL (the first is 0231's column grant, the second its definers' column lists): `projectLoan` and
// `projectRepayment` BUILD each output field by field from an allow-list, so an identity column that somehow reached a row — a definer
// widened by mistake, a hand-written query, a future wave's careless join — still cannot reach a response. A POISONED row carrying
// `borrower_user_id`, `channel`, `narrative`, `created_by`, `purpose_text`, `phone` and `name`, plus 200 generated rows carrying every
// banned spelling, must leave NOTHING behind. Mutants M3 (the definer regains `borrower_user_id`) and M7 (the channel comes back) kill here.
import {
  LOAN_KIND_CODES, LOAN_PERSON_FIELDS, NOT_RECORDED, PARTNER_LOAN_STATUSES, REFUSED_LOAN_STATUS, SERVICING_LOAN_STATUSES,
  fyLabel, fyWindow, isPartnerLoanStatus, mergeLoanCounts, projectLoan, projectRepayment, validWindow, type LoanCountRow,
} from '../domain/partner-loans.rules';

/** Every key of an object, at any depth, including array elements. */
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  }
  return out;
}

const LOAN_ROW = {
  id: '0192d2c4-l001-7000-8000-000000000001',
  application_id: '0192d2c4-a001-7000-8000-000000000001',
  tenant_id: '0192d2c4-7001-7000-8000-000000000001',
  product_id: '0192d2c4-p001-7000-8000-00000000000a',
  product_name: 'Fixture crop loan',
  kind_code: 'crop',
  principal_minor: '16000000',
  interest_apr_bps: 1050,
  disbursed_at: new Date(2026, 1, 9),          // local midnight, as node-pg hands a `date` back
  maturity_date: null,
  status: 'active',
  outstanding_minor: '13841000',
  next_due_date: null,
  created_at: '2026-02-09T04:00:00.000Z',
  created_us: '2026-02-09T04:00:00.123456Z',
  updated_at: '2026-07-01T04:00:00.000Z',
};

describe('PC-56 PARTNER-4a · the loan statuses and the kinds', () => {
  it('FIVE statuses the platform can produce; `transferred` is refused by name and is not one of them', () => {
    expect(PARTNER_LOAN_STATUSES).toEqual(['active', 'overdue', 'restructured', 'closed', 'written_off']);
    expect(REFUSED_LOAN_STATUS).toBe('transferred');
    expect(isPartnerLoanStatus('transferred')).toBe(false);
    expect(isPartnerLoanStatus('active')).toBe(true);
    expect(isPartnerLoanStatus('nope')).toBe(false);
    expect(SERVICING_LOAN_STATUSES).toEqual(['active', 'overdue']);
  });
  it('NINE platform `loan_kind` codes — not the canon\'s thirteen and not the chart\'s five', () => {
    expect(LOAN_KIND_CODES).toEqual(['kcc', 'crop', 'tractor', 'dairy', 'whr', 'gold', 'bnpl', 'shg', 'tenant_wc']);
    expect(LOAN_KIND_CODES.length).toBe(9);
    for (const absent of ['jlg', 'modular', 'solar', 'invoice_discount']) expect([absent, (LOAN_KIND_CODES as readonly string[]).includes(absent)]).toEqual([absent, false]);
  });
});

describe('PC-56 PARTNER-4a · projectLoan — the allow-list is the wall', () => {
  it('the honest row projects every fact, with money as a bigint string and the rate as an INTEGER in basis points', () => {
    const v = projectLoan(LOAN_ROW, { fpoName: 'Fixture Dairy Collective' });
    expect(v.id).toBe(LOAN_ROW.id);
    expect(v.applicationId).toBe(LOAN_ROW.application_id);
    expect(v.productName).toBe('Fixture crop loan');
    expect(v.kindCode).toBe('crop');
    expect(v.fpoName).toBe('Fixture Dairy Collective');
    expect(v.principalMinor).toBe('16000000');
    expect(typeof v.principalMinor).toBe('string');
    expect(v.interestAprBps).toBe(1050);
    expect(Number.isInteger(v.interestAprBps)).toBe(true);
    expect(v.disbursedAt).toBe('2026-02-09');     // the calendar day PostgreSQL holds, not a day early (pgDate)
    expect(v.maturityDate).toBeNull();            // NULL on every loan the platform opens
    expect(v.nextDueDate).toBeNull();
    expect(v.outstandingMinor).toBe('13841000');
    expect(v.openedAt).toBe('2026-02-09T04:00:00.123456Z');
  });
  it('a POISONED row leaves nothing behind: no borrower, channel, narrative, author, purpose, phone or name at any depth', () => {
    const poison = {
      ...LOAN_ROW,
      borrower_user_id: '0192d2c4-u001-7000-8000-000000000001', borrowerUserId: 'u1',
      channel: 'milk_bill_deduction', repayment_channel: 'harvest_settlement',
      narrative: 'seed + fertiliser (kharif kit)',
      created_by: 'u2', createdBy: 'u2', updated_by: 'u3', updatedBy: 'u3',
      origination_fee_txn_id: 'LTX-71205', originationFeeTxnId: 'LTX-71205',
      purpose_text: 'kharif inputs + drip top-up', purposeText: 'kharif inputs',
      decision_note: 'approved on the strength of the dairy cycle', decisionNote: 'x',
      applicant_user_id: 'u4', applicantUserId: 'u4',
      phone: '+91 94••• ••229', name: 'a borrower', ledger_txn_id: 'LTX-71204',
      bank_account: 'xxxx7726', destination_kind: 'supplier_direct', credit_score_id: 'cs1',
    };
    const v = projectLoan(poison, { fpoName: null });
    const keys = new Set(deepKeys(v));
    for (const banned of LOAN_PERSON_FIELDS) expect([banned, keys.has(banned)]).toEqual([banned, false]);
    // and no VALUE of the poison survives either (a field could be smuggled under an allowed key name)
    const json = JSON.stringify(v);
    for (const secret of ['0192d2c4-u001-7000-8000-000000000001', 'milk_bill_deduction', 'harvest_settlement', 'kharif', 'LTX-', '94•••', 'supplier_direct', 'cs1', 'u2', 'u3', 'u4']) {
      expect([secret, json.includes(secret)]).toEqual([secret, false]);
    }
    expect(v.fpoName).toBeNull();                  // and never the tenant id, under any name
    expect(json).not.toContain(LOAN_ROW.tenant_id);
  });
  it('200 generated rows, each poisoned with every banned spelling — none survives, and the view\'s key set never changes', () => {
    const shape = Object.keys(projectLoan(LOAN_ROW, { fpoName: null })).sort();
    for (let i = 0; i < 200; i++) {
      const row: Record<string, unknown> = { ...LOAN_ROW, id: `0192d2c4-l${String(i).padStart(3, '0')}-7000-8000-00000000000${i % 10}` };
      for (const banned of LOAN_PERSON_FIELDS) row[banned] = `poison-${banned}-${i}`;
      const v = projectLoan(row, { fpoName: `fpo-${i}` });
      expect([i, Object.keys(v).sort()]).toEqual([i, shape]);
      const json = JSON.stringify(v);
      expect([i, json.includes('poison-')]).toEqual([i, false]);
    }
  });
  it('all FOUR date columns go through pgDate, so none is a day early in a +05:30 timezone (loan.repository.ts:10-11\'s bug)', () => {
    // node-pg parses a `date` into a JS Date at LOCAL midnight; `v.toISOString().slice(0,10)` would print the day BEFORE
    // under Asia/Kolkata, which is how a cooperative's pours got paid twice. The jest run pins TZ=Asia/Kolkata.
    expect(new Date(2026, 1, 9).toISOString().slice(0, 10)).toBe('2026-02-08');   // the wrong reading, for the record
    const v = projectLoan({ ...LOAN_ROW, disbursed_at: new Date(2026, 1, 9), maturity_date: new Date(2029, 1, 9), next_due_date: new Date(2026, 6, 17) }, { fpoName: null });
    expect([v.disbursedAt, v.maturityDate, v.nextDueDate]).toEqual(['2026-02-09', '2029-02-09', '2026-07-17']);
    expect(projectRepayment({ id: 'r', loan_id: 'l', due_date: new Date(2026, 6, 17) }).dueDate).toBe('2026-07-17');
  });
  it('a missing or malformed figure degrades honestly, never to a guess', () => {
    const v = projectLoan({ id: 'x', status: 'active' }, { fpoName: null });
    expect([v.principalMinor, v.outstandingMinor, v.interestAprBps]).toEqual(['0', '0', 0]);
    expect([v.kindCode, v.productName, v.disbursedAt, v.maturityDate, v.nextDueDate]).toEqual([null, null, null, null, null]);
    expect(projectLoan({ id: 'x', principal_minor: '12.5', interest_apr_bps: 10.5 }, { fpoName: null }).principalMinor).toBe('0');
    expect(projectLoan({ id: 'x', interest_apr_bps: 10.5 }, { fpoName: null }).interestAprBps).toBe(0);
    // a bigint beyond Number.MAX_SAFE_INTEGER survives exactly (Law 2)
    expect(projectLoan({ id: 'x', outstanding_minor: '9007199254740993' }, { fpoName: null }).outstandingMinor).toBe('9007199254740993');
  });
});

describe('PC-56 PARTNER-4a · projectRepayment — the channel is not built, at any depth', () => {
  it('the honest row projects the due date, both amounts and the date paid — and nothing else', () => {
    const v = projectRepayment({ id: 'r1', loan_id: 'l1', due_date: new Date(2026, 6, 3), amount_due_minor: '418000', amount_paid_minor: '418000', paid_at: '2026-07-03T04:00:00.000Z', created_us: '2026-07-03T04:00:00.123456Z' });
    expect(v).toEqual({ id: 'r1', loanId: 'l1', dueDate: '2026-07-03', amountDueMinor: '418000', amountPaidMinor: '418000', paidAt: '2026-07-03T04:00:00.000Z', recordedAt: '2026-07-03T04:00:00.123456Z' });
  });
  it('a POISONED repayment row leaves no channel, narrative, borrower, author or ledger anchor behind — 200 rows over', () => {
    const shape = Object.keys(projectRepayment({ id: 'r', loan_id: 'l' })).sort();
    for (let i = 0; i < 200; i++) {
      const row: Record<string, unknown> = { id: `r${i}`, loan_id: 'l1', amount_due_minor: '100', amount_paid_minor: '100' };
      for (const banned of LOAN_PERSON_FIELDS) row[banned] = `poison-${banned}-${i}`;
      row.channel = 'milk_bill_deduction'; row.narrative = 'drip top-up';
      const v = projectRepayment(row);
      expect([i, Object.keys(v).sort()]).toEqual([i, shape]);
      const keys = new Set(deepKeys(v));
      for (const banned of LOAN_PERSON_FIELDS) expect([i, banned, keys.has(banned)]).toEqual([i, banned, false]);
      const json = JSON.stringify(v);
      expect([i, json.includes('poison-') || json.includes('milk_bill_deduction') || json.includes('drip')]).toEqual([i, false]);
    }
  });
});

describe('PC-56 PARTNER-4a · the counts merge — integers and bigint sums, never a ratio', () => {
  const W = { from: '2026-04-01', to: '2027-04-01' };
  it('the shards add; every producible status is present at 0; an unresolved kind counts as "not recorded"', () => {
    const rows: LoanCountRow[] = [
      { kind_code: 'crop', status: 'active', n: '3', outstanding_minor: '300', principal_minor: '600' },
      { kind_code: 'crop', status: 'active', n: 2, outstanding_minor: 200, principal_minor: 400 },     // the second shard
      { kind_code: null, status: 'overdue', n: '1', outstanding_minor: '50', principal_minor: '100' },
      { kind_code: 'kcc', status: 'written_off', n: '1', outstanding_minor: '10', principal_minor: '70' },
      { kind_code: 'dairy', status: 'restructured', n: '2', outstanding_minor: '20', principal_minor: '90' },
      { kind_code: 'NOT A CODE', status: 'closed', n: '1', outstanding_minor: '0', principal_minor: '5' },
      { kind_code: 'crop', status: 'transferred', n: '4', outstanding_minor: '9', principal_minor: '9' },  // refused: counted in the total and the kind, never in byStatus
    ];
    const out = mergeLoanCounts(rows, W, '2026-10-28T06:30:00.000Z');
    expect(out.total).toBe(14);
    expect(out.byStatus).toEqual({ active: 5, overdue: 1, restructured: 2, closed: 1, written_off: 1 });
    expect('transferred' in out.byStatus).toBe(false);
    expect(out.byKind.crop).toBe(9);
    expect(out.byKind[NOT_RECORDED]).toBe(2);        // the NULL kind and the malformed code
    expect(out.outstandingByKindMinor.crop).toBe('509');
    expect(out.principalByKindMinor.crop).toBe('1009');
    expect(out.servicing).toEqual({ count: 6, outstandingMinor: '550' });
    expect(out.restructured).toBe(2);
    expect(out.writtenOff).toEqual({ count: 1, outstandingMinor: '10' });
    expect(out.fy).toBe('2026-27');
    expect(out.timeZone).toBe('Asia/Kolkata');
    for (const k of LOAN_KIND_CODES) expect([k, typeof out.byKind[k]]).toEqual([k, 'number']);
    for (const n of [...Object.values(out.byStatus), ...Object.values(out.byKind), out.total, out.restructured]) expect(Number.isInteger(n)).toBe(true);
  });
  it('bigint sums over 2,000 loans of ₹50,000 stay EXACT past Number.MAX_SAFE_INTEGER', () => {
    const big = '9007199254740993';   // 2^53 + 1
    const out = mergeLoanCounts(
      Array.from({ length: 2000 }, () => ({ kind_code: 'crop', status: 'active', n: 1, outstanding_minor: '5000000', principal_minor: big })),
      W, 'now');
    expect(out.outstandingByKindMinor.crop).toBe('10000000000');                 // 2,000 × ₹50,000 in paise
    expect(out.principalByKindMinor.crop).toBe((BigInt(big) * 2000n).toString());
    expect(out.servicing.outstandingMinor).toBe('10000000000');
    expect(out.servicing.count).toBe(2000);
  });
  it('a negative, fractional or absurd count is ignored rather than guessed', () => {
    const out = mergeLoanCounts([
      { kind_code: 'crop', status: 'active', n: '-3', outstanding_minor: '1', principal_minor: '1' },
      { kind_code: 'crop', status: 'active', n: '1.5', outstanding_minor: '1', principal_minor: '1' },
      { kind_code: 'crop', status: 'active', n: 'x', outstanding_minor: '1', principal_minor: '1' },
      { kind_code: 'crop', status: 'active', n: '2', outstanding_minor: 'not a number', principal_minor: '7' },
    ], W, 'now');
    expect(out.total).toBe(2);
    expect(out.outstandingByKindMinor.crop).toBe('0');     // the unreadable amount contributes nothing
    expect(out.principalByKindMinor.crop).toBe('7');
  });
  it('NO value anywhere in the merged counts is a float, a ratio or a percentage', () => {
    const out = mergeLoanCounts([{ kind_code: 'crop', status: 'active', n: '3', outstanding_minor: '1000', principal_minor: '3000' }], W, 'now');
    const json = JSON.stringify(out);
    expect(json).not.toContain('%');
    for (const v of Object.values(out.byKind)) expect(Number.isInteger(v)).toBe(true);
    for (const v of Object.values(out.outstandingByKindMinor)) expect(/^-?\d+$/.test(v)).toBe(true);
    for (const v of Object.values(out.principalByKindMinor)) expect(/^-?\d+$/.test(v)).toBe(true);
    expect(/^-?\d+$/.test(out.servicing.outstandingMinor)).toBe(true);
  });
  it('the FY window is April–March in IST, and a window that is not an FY has no label', () => {
    expect(fyWindow(new Date('2026-03-31T18:29:59.000Z'))).toMatchObject({ from: '2025-04-01', to: '2026-04-01' });   // 23:59:59 IST on 31 Mar
    expect(fyWindow(new Date('2026-03-31T18:30:00.000Z'))).toMatchObject({ from: '2026-04-01', to: '2027-04-01' });   // 00:00:00 IST on 1 Apr
    expect(fyLabel('2026-04-01', '2027-04-01')).toBe('2026-27');
    expect(fyLabel('2026-04-02', '2027-04-02')).toBeNull();
    expect(validWindow('2026-04-01', '2027-04-01')).toBe(true);
    expect(validWindow('2026-04-01', '2026-04-01')).toBe(false);
    expect(validWindow('2026-02-30', '2026-04-01')).toBe(false);
  });
});
