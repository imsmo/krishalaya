// modules/dairy/__tests__/tenant6c4-deduction-destination.spec.ts · PC-56 TENANT-6c-4 · where a deduction's money goes.
//
// W169 deducts on three of its three visible bills, totals them in a header tile — *"₹1,84,300 · feed credit + loan
// EMI + insurance — each line itemised"* — promises the member *"sees every pour + every deduction"*, and sets one
// rule: *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
//
// FOUR THINGS WERE WRONG. A deduction was a free-typed string in a jsonb blob referencing nothing; the feed credit had
// no source record anywhere on this platform; the fintech module had promised `milk_bill_deduction` twice
// (`REPAYMENT_STYLES`, and `loan_repayments.channel`'s own comment) with nothing implementing it; and the consent rule
// had nowhere to live, because `consents` (0003) is a DPDP purpose table with no tenant, no amount and no reference.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MilkBill } from '../domain/milk-bill.entity';
import { MilkBillDeduction } from '../domain/milk-bill-deduction.entity';
import { DairyMemberCredit, DESCRIPTION_FLOOR } from '../domain/dairy-member-credit.entity';
import { consentMatchesBill, deductionConsentRequired, DEDUCTION_DESTINATIONS, isKnownDestination } from '../domain/dairy-deduction';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { MilkBillService } from '../services/milk-bill.service';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { MemberCreditNotRecoverableError, DeductionLinesNotLoadedError } from '../domain/dairy.errors';
import { REPAYMENT_STYLES } from '../../fintech/domain/fintech.events';
import { LoanService } from '../../fintech/services/loan.service';
import { Loan } from '../../fintech/domain/loan.entity';

const MIGRATION = '../../../../../../db/migrations/0160_dairy_deduction_destinations.sql';
const SEED_LOOKUPS = '../../../../../../db/seeds/core/0005_lookup_vocabularies.sql';
const SEED_NOTIFS = '../../../../../../db/seeds/core/0007_notification_events_templates.sql';
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const NOW = new Date('2026-07-16T04:00:00.000Z');
const WINDOW = new Date('2026-07-17T04:00:00.000Z');
const AFTER = new Date('2026-07-17T04:00:01.000Z');
const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };

const line = (over: Partial<{ id: string; type: string; amountMinor: bigint; sourceType: string; sourceId: string }> = {}) => ({
  id: over.id ?? 'ded1', type: over.type ?? 'feed_credit', amountMinor: over.amountMinor ?? 50_000n,
  sourceType: over.sourceType ?? 'dairy_member_credit', sourceId: over.sourceId ?? 'credit1', status: 'pending' as const,
});

const bill = (lines: ReturnType<typeof line>[] = [], grossMinor = 400_000n) => {
  const b = MilkBill.generate({ id: 'b1', tenantId: 'tA', membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
    totalLitresMilli: 204_526n, grossMinor, deductions: lines });
  b.pullEvents();
  return b;
};

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE VOCABULARY WAS A COMMENT', () => {
  it('0009 kept the deduction vocabulary in a SQL remark while the column accepted any 40 characters', () => {
    // The defect, held as a test. `milk_bills.deductions` carried `-- [{type:'feed_credit'|'loan_emi'|'insurance'|
    // 'share', amount_minor}]` — the vocabulary a cooperative's withholdings move by, in a comment — and the DTO
    // validated `z.string().min(1).max(40)`. Law 6 exactly inverted.
    const old = read('../../../../../../db/migrations/0009_livestock_dairy.sql');
    expect(old).toMatch(/feed_credit'\|'loan_emi'\|'insurance'\|'share'/);
    const dto = read('../dto/create-milk-bill.dto.ts');
    expect(dto).toMatch(/sourceId: z\.string\(\)\.uuid\(\)/);
  });

  it('is now `lookup_values` under `milk_deduction`, in BOTH the seed and the migration, identically', () => {
    // Not two mechanisms for one fact: 0160 backfills a FK against these rows and TENANT-6c-2 established that seeds
    // run AFTER migrations, so the migration cannot wait for the seed — and a fresh install must still get them from
    // the seed that states them. What matters is that neither may drift from the other, which is what this asserts.
    for (const src of [read(MIGRATION), read(SEED_LOOKUPS)]) {
      expect(src).toMatch(/'milk_deduction'\s*,\s*'Milk bill deduction type'\s*,\s*false/);
      for (const code of ['feed_credit', 'loan_emi', 'insurance', 'share']) expect(src).toContain(`'${code}'`);
      expect(src).toMatch(/"destination":"member_credit"/);
      expect(src).toMatch(/"destination":"loan"/);
    }
  });

  it('is NOT tenant-extendable, and that is the Rule-Zero call in the file', () => {
    // A tenant-invented deduction type would be a line whose money has nowhere to go: a family's cheque short by an
    // amount with no receivable to pay. A cooperative chooses which types it uses; it cannot invent a withholding.
    expect(read(SEED_LOOKUPS)).toMatch(/'milk_deduction','Milk bill deduction type',false/);
  });

  it('names a destination for every type, and a REASON for the two that have none', () => {
    const mig = read(MIGRATION);
    expect(mig).toMatch(/'insurance'[\s\S]{0,400}"destination":"none"[\s\S]{0,400}unsupported_reason/);
    expect(mig).toMatch(/'share'[\s\S]{0,400}"destination":"none"[\s\S]{0,400}unsupported_reason/);
    // The `insurance` reason names the real mechanism (a gateway intent, not a wallet movement) and the `share` reason
    // cites the registry wave's own ruling. A refusal that says "unsupported" teaches an operator nothing.
    expect(mig).toMatch(/gateway intent/);
    expect(mig).toMatch(/certificate are one money movement/);
  });

  it('the destinations this build knows are a CLOSED set in code, while the vocabulary is open in the database', () => {
    expect([...DEDUCTION_DESTINATIONS]).toEqual(['member_credit', 'loan', 'none']);
    expect(isKnownDestination('member_credit')).toBe(true);
    expect(isKnownDestination('insurance_premium')).toBe(false);   // a mechanism, not a row — it needs a wave
  });

  it('every destination the SEED names is one this build can actually move money to', () => {
    // The guard for a deployment that is ahead of its code: a seed row naming a mechanism nothing implements would
    // otherwise be discovered by a farmer on payday. Parsed out of the seed rather than restated here.
    const named = [...read(SEED_LOOKUPS).matchAll(/"destination":"([a-z_]+)"/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(4);
    for (const d of named) expect(isKnownDestination(d)).toBe(true);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE LINE POINTS AT WHAT IT PAYS', () => {
  it('carries the row it settles, and its ledger txn once applied', () => {
    const l = MilkBillDeduction.create({ id: 'ded1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1',
      typeId: 'lv1', typeCode: 'feed_credit', amountMinor: 50_000n, sourceType: 'dairy_member_credit', sourceId: 'credit1', createdBy: 'op1' });
    expect(l.status).toBe('pending');
    l.apply(NOW, 'txn-9');
    expect(l.toProps()).toMatchObject({ status: 'applied', appliedAt: NOW, walletTxnId: 'txn-9' });
    const [e] = l.pullEvents();
    expect(e.type).toBe('dairy.bill_deduction_applied');
    // The event is per LINE and names the source, because W169's promise is "each line itemised" and one bill can pay
    // a feed credit AND a loan in the same movement.
    expect(e.payload).toMatchObject({ typeCode: 'feed_credit', sourceType: 'dairy_member_credit', sourceId: 'credit1', walletTxnId: 'txn-9' });
  });

  it('a SECOND apply does not re-stamp — a resumed payment must not move `applied_at` to the retry', () => {
    const l = MilkBillDeduction.create({ id: 'ded1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1',
      typeId: 'lv1', typeCode: 'loan_emi', amountMinor: 1n, sourceType: 'loan', sourceId: 'loan1', createdBy: null });
    l.apply(NOW, 'txn-1');
    l.pullEvents();
    l.apply(AFTER, 'txn-2');
    expect(l.toProps()).toMatchObject({ appliedAt: NOW, walletTxnId: 'txn-1' });
    expect(l.pullEvents()).toHaveLength(0);          // and it does not publish the movement twice
  });

  it('the bill DERIVES its total from the lines and never accepts one', () => {
    const b = bill([line({ amountMinor: 50_000n }), line({ id: 'ded2', type: 'loan_emi', amountMinor: 74_000n, sourceType: 'loan', sourceId: 'loan1' })]);
    expect(b.deductionsMinor).toBe(124_000n);
    expect(b.netMinor).toBe(276_000n);
  });

  it('a bill read WITHOUT its lines refuses to answer for them instead of reporting zero', () => {
    // `[]` and "not loaded" are different facts and the difference is a member's money. List reads do not join 312
    // bills to their lines, so they carry `null` — and a silent zero there would report every deduction as absent.
    const b = MilkBill.rehydrate({ ...bill().toProps(), deductions: null });
    expect(b.hasLoadedDeductions).toBe(false);
    expect(() => b.deductionLines).toThrow(DeductionLinesNotLoadedError);
    expect(b.deductionsMinor).toBe(0n);              // the bill's own column is still readable
    expect(b.toJSON()).not.toHaveProperty('deductions');
  });

  it('the SQL writes the source and the stamp, and NOTHING the grant forbids', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const repo = new MilkBillDeductionRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const l = MilkBillDeduction.create({ id: 'ded1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1',
      typeId: 'lv1', typeCode: 'feed_credit', amountMinor: 50_000n, sourceType: 'dairy_member_credit', sourceId: 'credit1', createdBy: 'op1' });
    await repo.insert(tx as never, l);
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO milk_bill_deductions[\s\S]*source_type, source_id/);
    l.apply(NOW, 'txn-9');
    await repo.markApplied(tx as never, l);
    const sql = tx.query.mock.calls[1][0];
    expect(sql).toMatch(/SET status=\$3, applied_at=\$4, wallet_txn_id=\$5/);
    // The amount, the type and the source are append-only — 0160 grants UPDATE on the stamp columns only.
    for (const forbidden of ['amount_minor=', 'type_id=', 'source_id=']) expect(sql).not.toContain(forbidden);
    expect(read(MIGRATION)).toMatch(/GRANT UPDATE \(status, applied_at, wallet_txn_id, updated_at, updated_by\) ON milk_bill_deductions TO kv_app;/);
  });

  it('every line query is TENANT-BOUND and the cycle tile ignores VOIDED bills', async () => {
    const replicaQ = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repo = new MilkBillDeductionRepository({ forTenant: () => ({ query: replicaQ }) } as never);
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await repo.listForUpdate(tx as never, 'tA', 'b1');
    expect(tx.query.mock.calls[0][0]).toMatch(/WHERE d\.tenant_id=\$1 AND d\.bill_id=\$2/);
    expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE OF d/);
    await repo.cycleTotals('tA', 'cyc1');
    const tile = replicaQ.mock.calls[0][0];
    // A voided bill's lines are somebody's cancelled arithmetic; counting them would make W169's header tile
    // disagree with the rows underneath it.
    expect(tile).toMatch(/JOIN milk_bills b ON b\.id = d\.bill_id AND b\.deleted_at IS NULL/);
    expect(tile).toMatch(/WHERE d\.tenant_id=\$1 AND b\.cycle_id=\$2/);
  });

  it('the stamp FAILS CLOSED on a zero-row update', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const repo = new MilkBillDeductionRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const l = MilkBillDeduction.create({ id: 'ded1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1',
      typeId: 'lv1', typeCode: 'loan_emi', amountMinor: 1n, sourceType: 'loan', sourceId: 'loan1', createdBy: null });
    l.apply(NOW, 'txn-9');
    // This statement runs immediately after the ledger movement: a row that did not move means money left a member's
    // wallet with no line claiming it. The refusal rolls the payment back.
    await expect(repo.markApplied(tx as never, l)).rejects.toMatchObject({ code: 'MILK_BILL_DEDUCTION_NOT_FOUND' });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE FEED CREDIT — the receivable that did not exist', () => {
  const credit = (over: Partial<{ valueMinor: bigint; recoveredMinor: bigint }> = {}) => DairyMemberCredit.rehydrate({
    id: 'credit1', tenantId: 'tA', membershipId: 'mem1', mccId: 'mcc1', description: '2 bags cattle feed',
    valueMinor: over.valueMinor ?? 50_000n, recoveredMinor: over.recoveredMinor ?? 0n,
    issuedOn: '2026-07-02', issuedBy: 'op1', status: (over.recoveredMinor ?? 0n) === (over.valueMinor ?? 50_000n) ? 'recovered' : 'outstanding',
  });

  it('W169 shows "−₹500 feed credit" and this platform had no record of such a debt at all', () => {
    // `grep -rn "feed_credit" db/migrations` found ONE hit before this wave: 0009's comment. No table of feed sold on
    // credit, no outstanding, nothing for a deduction to recover.
    const mig = read(MIGRATION);
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS dairy_member_credits/);
    expect(mig).toMatch(/no wallet movement at issue|NO WALLET MOVEMENT AT ISSUE/);
  });

  it('issuing needs to say WHAT was sold', () => {
    expect(DESCRIPTION_FLOOR).toBe(3);
    expect(() => DairyMemberCredit.issue({ id: 'c', tenantId: 'tA', membershipId: 'mem1', mccId: null, description: ' x ', valueMinor: 100n, issuedOn: '2026-07-02', issuedBy: 'op1' }))
      .toThrow(MemberCreditNotRecoverableError);
    const c = DairyMemberCredit.issue({ id: 'c', tenantId: 'tA', membershipId: 'mem1', mccId: null, description: '  mineral mix  ', valueMinor: 100n, issuedOn: '2026-07-02', issuedBy: 'op1' });
    expect(c.toJSON().description).toBe('mineral mix');
    expect(c.pullEvents()[0].type).toBe('dairy.member_credit_issued');
  });

  it('recovers an EXACT amount and refuses a partial one — the line is a figure the member was shown', () => {
    // Deliberately NOT `InputAdvance.recover(upTo)`'s shape. That takes a ceiling and returns whatever it could take,
    // which is right for a settlement pass sweeping every advance and wrong here: if the line says ₹500 and only ₹300
    // is outstanding, silently taking ₹300 pays the member ₹200 less than the bill's own net says, and the difference
    // sits in the cooperative's wallet with nothing to reconcile it against.
    const c = credit({ valueMinor: 50_000n, recoveredMinor: 20_000n });
    expect(c.outstandingMinor).toBe(30_000n);
    expect(() => c.recover(50_000n, 'b1')).toThrow(MemberCreditNotRecoverableError);
    expect(c.recoveredMinor).toBe(20_000n);           // and nothing moved
    c.recover(30_000n, 'b1');
    expect(c.status).toBe('recovered');
    expect(c.outstandingMinor).toBe(0n);
    const [e] = c.pullEvents();
    expect(e.payload).toMatchObject({ billId: 'b1', amountMinor: '30000', outstandingMinor: '0', status: 'recovered' });
  });

  it('a recovered credit cannot be recovered again, and SAYS SO rather than reporting a shortfall', () => {
    const done = credit({ valueMinor: 10n, recoveredMinor: 10n });
    // The two refusals are different facts and an operator must be able to tell them apart: "this credit is already
    // recovered" means somebody else's bill got there first, while "only N is outstanding" means the LINE is wrong.
    // Asserting only the error TYPE let the status guard be deleted without a test noticing — the over-recovery guard
    // catches the same case with the wrong explanation. A mutation run found it.
    expect(() => done.recover(1n, 'b1')).toThrow(/already recovered/);
    expect(() => credit({ valueMinor: 50_000n, recoveredMinor: 20_000n }).recover(40_000n, 'b1')).toThrow(/only 30000 minor units/);
    expect(() => credit().recover(0n, 'b1')).toThrow(MemberCreditNotRecoverableError);
  });

  it('the recovery UPDATE is guarded on the value it READ, and fails closed', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    const repo = new DairyMemberCreditRepository({ forTenant: () => ({ query: jest.fn() }) } as never);
    const c = credit();
    c.recover(50_000n, 'b1');
    await expect(repo.updateRecovered(tx as never, c, 0n)).rejects.toMatchObject({ code: 'DAIRY_MEMBER_CREDIT_NOT_FOUND' });
    const sql = tx.query.mock.calls[0][0];
    expect(sql).toMatch(/SET recovered_minor=\$3, status=\$5/);
    expect(sql).toMatch(/AND recovered_minor=\$4/);   // no lost update on a stale read
    for (const forbidden of ['value_minor=', 'description=', 'membership_id=']) expect(sql).not.toContain(forbidden);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('W169\'s 25% RULE', () => {
  it('is STRICTLY above, in integer arithmetic, from a setting', () => {
    // "Deductions ABOVE 25% of gross" — a bill deducting exactly a quarter is at the line, not over it. One
    // comparison, and it decides whether 40 members are asked or 41.
    expect(deductionConsentRequired(400_000n, 100_000n, 25)).toBe(false);   // exactly 25%
    expect(deductionConsentRequired(400_000n, 100_001n, 25)).toBe(true);
    expect(deductionConsentRequired(400_000n, 60_000n, 15)).toBe(false);    // a stricter tenant, exactly at ITS line
    expect(deductionConsentRequired(400_000n, 60_001n, 15)).toBe(true);
    expect(deductionConsentRequired(400_000n, 0n, 25)).toBe(false);
    // No float anywhere: `deductions/gross` compared against a decimal would put one on the path that decides whether
    // a family is asked before a fifth of their fortnight is withheld.
    //
    // COMMENTS STRIPPED FIRST. The un-stripped version of this guard failed on this file's OWN prose explaining why
    // there is no float — and the mirror-image mistake (a guard satisfied by a comment) is the one TENANT-6c-3 found
    // in its migration assertions. A source-level guard has to look at what RUNS.
    const code = read('../domain/dairy-deduction.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/Number\(|parseFloat|\d\.\d/);
    expect(code).toMatch(/deductionsMinor \* 100n > grossMinor \* BigInt\(thresholdPct\)/);
  });

  it('a gross of zero is always a conversation', () => {
    expect(deductionConsentRequired(0n, 1n, 25)).toBe(true);
  });

  it('FRESH means these figures — not a standing instruction, and not a date range', () => {
    const b = { grossMinor: 400_000n, deductionsMinor: 150_000n };
    expect(consentMatchesBill({ grossMinor: 400_000n, deductionsMinor: 150_000n, granted: true }, b)).toBe(true);
    // TENANT-6c-2 made a bill voidable, rebuildable and re-previewable, so a member can be shown three different sets
    // of numbers for one fortnight. Consent to the first is not consent to the third.
    expect(consentMatchesBill({ grossMinor: 400_000n, deductionsMinor: 120_000n, granted: true }, b)).toBe(false);
    expect(consentMatchesBill({ grossMinor: 390_000n, deductionsMinor: 150_000n, granted: true }, b)).toBe(false);
    expect(consentMatchesBill({ grossMinor: 400_000n, deductionsMinor: 150_000n, granted: false }, b)).toBe(false);
    expect(consentMatchesBill(null, b)).toBe(false);
  });

  it('is a purpose-specific record and NOT the DPDP consents table', () => {
    // `consents` (0003) is (user, purpose_code, version, granted, channel) with no tenant, no amount and no reference:
    // it records permission to PROCESS data for a purpose. It cannot say that this member agreed to ₹2,400 out of
    // THIS fortnight's ₹9,000, and reusing it would make a money authorisation indistinguishable from a privacy notice.
    const mig = read(MIGRATION);
    expect(mig).toMatch(/CREATE TABLE IF NOT EXISTS milk_bill_deduction_consents/);
    expect(mig).toMatch(/gross_minor\s+bigint NOT NULL/);
    expect(mig).toMatch(/threshold_pct\s+integer NOT NULL/);
    // The threshold in force when the member was asked is COPIED onto the row, so a later change to the tenant
    // setting cannot rewrite what they were told.
    expect(mig).toMatch(/GRANT SELECT, INSERT ON milk_bill_deduction_consents TO kv_app;/);
    expect(mig).not.toMatch(/GRANT UPDATE[^;]*milk_bill_deduction_consents/);
    // 0003's own channel vocabulary, reused: a farmer with no smartphone consents through an ambassador or an IVR call.
    expect(mig).toMatch(/channel IN \('app','web','ambassador_assisted','ivr'\)/);
  });

  it('the threshold is a tenant SETTING with a money-path risk class, not a literal 25', () => {
    const mig = read(MIGRATION);
    expect(mig).toMatch(/'dairy\.deduction_consent_pct', 'int', 'tenant', 'money_path', '25'::jsonb/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE COMPOSITION — the member is paid the GROSS', () => {
  const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 'tA', farmerUserId: 'farmer1', mccId: 'mcc1', memberCode: 'C1', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo', isActive: true });

  function harness(lines: ReturnType<typeof line>[], opts: { consent?: unknown; recovery?: boolean } = {}) {
    const b = bill(lines);
    b.preview(NOW, WINDOW, 'farmer1'); b.approve(); b.pullEvents();
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const wallet = { post: jest.fn(async () => ({ txnId: 'txn-gross', alreadyApplied: false })) };
    const bills = { getForUpdate: jest.fn(async () => b), update: jest.fn(), insert: jest.fn() };
    const deductionLines = { linesForBill: jest.fn(async () => lines), insert: jest.fn() };
    const consents = { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => opts.consent ?? null) };
    const deductions = { applyAll: jest.fn(async () => lines.map((l) => ({ deductionId: l.id, typeCode: l.type, amountMinor: l.amountMinor.toString(), sourceType: l.sourceType, sourceId: l.sourceId, walletTxnId: 'txn-line' }))) };
    const audit = { write: jest.fn() };
    const svc = new MilkBillService(uow as never, { write: jest.fn() } as never,
      { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as never, metrics as never,
      wallet as never, audit as never, bills as never, { attachToBill: jest.fn() } as never,
      { getById: jest.fn(async () => membership) } as never, { disputeWindowHours: jest.fn(async () => 24) } as never,
      deductionLines as never, { byCode: jest.fn(), byIds: jest.fn() } as never, { getForUpdate: jest.fn() } as never,
      consents as never, deductions as never, { isEnabled: jest.fn(async () => opts.recovery !== false) } as never,
      // [PC-56 TENANT-6c-5] the assembler: what the CYCLE deducts when nobody typed a line.
      { assemble: jest.fn(async () => ({ lines: [], totalMinor: 0n, capMinor: 0n, deferred: [] })) } as never);
    return { svc, wallet, deductions, audit, b };
  }

  it('posts the GROSS and THEN each line — so every rupee is a movement both sides can see', async () => {
    const h = harness([line({ amountMinor: 50_000n })]);
    await h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER);
    const arg: any = (h.wallet.post.mock.calls as any[])[0][1];
    expect(arg.idempotencyKey).toBe('milkbill:b1');
    expect(arg.legs.find((l: any) => l.amountMinor > 0n)).toMatchObject({ amountMinor: 400_000n });   // THE GROSS
    expect(arg.legs.reduce((a: bigint, l: any) => a + l.amountMinor, 0n)).toBe(0n);
    expect(h.deductions.applyAll).toHaveBeenCalledTimes(1);
  });

  it('itemises what it moved in the audit entry — "paid ₹8,914" is not an answer to "what happened to my ₹500"', async () => {
    const h = harness([line({ amountMinor: 50_000n })]);
    await h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER);
    const entry: any = (h.audit.write.mock.calls as any[])[0][1];
    expect(entry.newValue).toMatchObject({ grossMinor: '400000', netMinor: '350000', deductionsMinor: '50000' });
    expect(entry.newValue.deductions).toEqual([expect.objectContaining({ typeCode: 'feed_credit', amountMinor: '50000', walletTxnId: 'txn-line' })]);
  });

  it('a bill with NO deductions posts exactly one movement, unchanged from before this wave', async () => {
    const h = harness([]);
    await h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER);
    expect(h.wallet.post).toHaveBeenCalledTimes(1);
    expect(h.deductions.applyAll).not.toHaveBeenCalled();
    expect((h.wallet.post.mock.calls as any[])[0][1].legs.find((l: any) => l.amountMinor > 0n).amountMinor).toBe(400_000n);
  });

  it('the kill-switch OFF refuses a deducted bill and moves nothing — where 0157 left this path', async () => {
    const h = harness([line({ amountMinor: 50_000n })], { recovery: false });
    await expect(h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER))
      .rejects.toMatchObject({ code: 'DEDUCTION_RECOVERY_DISABLED' });
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('above the threshold: asks, distinguishes STALE consent from none, and never retries a REFUSAL', async () => {
    const over = [line({ amountMinor: 150_000n })];        // 37.5% of 400,000
    await expect(harness(over).svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER))
      .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REQUIRED', details: { stale: false, thresholdPct: 25 } });

    const stale = { grossMinor: 400_000n, deductionsMinor: 120_000n, granted: true, recordedAt: NOW };
    await expect(harness(over, { consent: stale }).svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER))
      .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REQUIRED', details: { stale: true } });

    // A member who says NO is not a queue item a retry eventually satisfies.
    const refused = { grossMinor: 400_000n, deductionsMinor: 150_000n, granted: false, recordedAt: NOW };
    await expect(harness(over, { consent: refused }).svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER))
      .rejects.toMatchObject({ code: 'DEDUCTION_CONSENT_REFUSED' });

    const good = { grossMinor: 400_000n, deductionsMinor: 150_000n, granted: true, recordedAt: NOW };
    expect((await harness(over, { consent: good }).svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER)).status).toBe('paid');
  });

  it('BELOW the threshold a refusal does not block the payment — but it is never silent', async () => {
    // THE HARDEST CALL IN THIS WAVE, and the first draft got it wrong. Reading `granted` before the threshold let a
    // member refuse a ₹500 feed recovery on a ₹9,000 bill and thereby stop their OWN ₹8,914 from moving — a veto
    // whose only victim is the member, and a way to refuse a genuinely owed debt forever by tapping "no". W169's
    // sentence is deliberately narrow: above 25% needs fresh consent *"not just standing instructions"*, which says
    // that below it the standing arrangement governs. The member's remedy there is the DISPUTE route (6c-2), which
    // pauses the one bill and gets them an answer with a note.
    //
    // What the platform must not do is discard the objection quietly, so it lands in the payment's audit entry.
    const refused = { grossMinor: 400_000n, deductionsMinor: 50_000n, granted: false, recordedAt: NOW };
    const h = harness([line({ amountMinor: 50_000n })], { consent: refused });   // 12.5%
    expect((await h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER)).status).toBe('paid');
    expect((h.audit.write.mock.calls as any[])[0][1].newValue).toMatchObject({ memberRefusalOnFile: true });
  });

  it('and a bill with no refusal on file does not carry that flag at all', async () => {
    const h = harness([line({ amountMinor: 50_000n })]);
    await h.svc.pay('tA', { userId: 'op1', canManage: true }, 'b1', 'idem', null, AFTER);
    expect((h.audit.write.mock.calls as any[])[0][1].newValue).not.toHaveProperty('memberRefusalOnFile');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE APPLIER — each line to the thing it pays', () => {
  function harness(over: { lines?: MilkBillDeduction[]; types?: Map<string, any>; credit?: unknown } = {}) {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const wallet = { post: jest.fn(async () => ({ txnId: 'txn-line', alreadyApplied: false })) };
    const outbox = { write: jest.fn() };
    const lines = { listForUpdate: jest.fn(async () => over.lines ?? []), markApplied: jest.fn() };
    const credits = { getForUpdate: jest.fn(async () => over.credit ?? null), updateRecovered: jest.fn() };
    const types = { byIds: jest.fn(async () => over.types ?? new Map()) };
    const loans = { applyMilkBillDeduction: jest.fn(async () => ({ loanId: 'loan1', repaymentId: 'rep1', outstandingMinor: '0', walletTxnId: 'txn-loan' })) };
    const svc = new MilkBillDeductionService(wallet as never, outbox as never, lines as never, credits as never, types as never, loans as never);
    return { svc, tx, wallet, lines, credits, loans, outbox };
  }
  const l = (over: Partial<{ typeId: string; typeCode: string; sourceType: string; sourceId: string; amountMinor: bigint }> = {}) =>
    MilkBillDeduction.create({ id: 'ded1', tenantId: 'tA', billId: 'b1', membershipId: 'mem1',
      typeId: over.typeId ?? 'lv-feed', typeCode: over.typeCode ?? 'feed_credit', amountMinor: over.amountMinor ?? 50_000n,
      sourceType: over.sourceType ?? 'dairy_member_credit', sourceId: over.sourceId ?? 'credit1', createdBy: 'op1' });
  const feedType = { id: 'lv-feed', code: 'feed_credit', name: 'Feed', destination: 'member_credit', unsupportedReason: null, sourceType: 'dairy_member_credit' };
  const loanType = { id: 'lv-loan', code: 'loan_emi', name: 'Loan', destination: 'loan', unsupportedReason: null, sourceType: 'loan' };
  const credit = () => DairyMemberCredit.rehydrate({ id: 'credit1', tenantId: 'tA', membershipId: 'mem1', mccId: null,
    description: 'feed', valueMinor: 50_000n, recoveredMinor: 0n, issuedOn: '2026-07-02', issuedBy: 'op1', status: 'outstanding' });
  const ctx = { billId: 'b1', membershipId: 'mem1', memberUserId: 'farmer1', initiatedBy: 'op1', now: NOW };

  it('a FEED CREDIT line: the receivable falls and the member pays the cooperative', async () => {
    const h = harness({ lines: [l()], types: new Map([['lv-feed', feedType]]), credit: credit() });
    const out = await h.svc.applyAll(h.tx as never, 'tA', ctx);
    expect(out).toEqual([expect.objectContaining({ typeCode: 'feed_credit', amountMinor: '50000', walletTxnId: 'txn-line' })]);
    expect(h.credits.updateRecovered).toHaveBeenCalledTimes(1);
    const arg: any = (h.wallet.post.mock.calls as any[])[0][1];
    expect(arg.idempotencyKey).toBe('milkdeduct:ded1');          // keyed on the LINE, not the bill or the credit
    expect(arg.referenceType).toBe('dairy_member_credit');
    const debit = arg.legs.find((x: any) => x.amountMinor < 0n);
    expect(debit.account.userId).toBe('farmer1');                 // member → cooperative
    expect(arg.legs.reduce((a: bigint, x: any) => a + x.amountMinor, 0n)).toBe(0n);
    expect(h.lines.markApplied).toHaveBeenCalledTimes(1);
  });

  it('a LOAN line goes through the fintech module\'s public service, never its repositories', async () => {
    const h = harness({ lines: [l({ typeId: 'lv-loan', typeCode: 'loan_emi', sourceType: 'loan', sourceId: 'loan1' })], types: new Map([['lv-loan', loanType]]) });
    const out = await h.svc.applyAll(h.tx as never, 'tA', ctx);
    expect(out[0]).toMatchObject({ typeCode: 'loan_emi', walletTxnId: 'txn-loan' });
    expect(h.loans.applyMilkBillDeduction).toHaveBeenCalledWith(h.tx, 'tA', expect.objectContaining({
      loanId: 'loan1', borrowerUserId: 'farmer1', amountMinor: 50_000n, billId: 'b1', deductionId: 'ded1',
    }));
    // The dairy module posts NOTHING for a loan line: the movement belongs to the module that owns the loan.
    expect(h.wallet.post).not.toHaveBeenCalled();
    // And the source file never imports another module's repository (CLAUDE.md's module rule, asserted).
    const src = read('../services/milk-bill-deduction.service.ts');
    expect(src).toMatch(/from '\.\.\/\.\.\/fintech\/services\/loan\.service'/);
    expect(src).not.toMatch(/fintech\/repositories/);
  });

  it('refuses a type with NO destination, with the reason the seed wrote', async () => {
    const insurance = { id: 'lv-ins', code: 'insurance', name: 'Insurance', destination: 'none', unsupportedReason: 'a premium is a gateway intent', sourceType: null };
    const h = harness({ lines: [l({ typeId: 'lv-ins', typeCode: 'insurance' })], types: new Map([['lv-ins', insurance]]) });
    await expect(h.svc.applyAll(h.tx as never, 'tA', ctx)).rejects.toMatchObject({
      code: 'DEDUCTION_TYPE_UNSUPPORTED', details: { typeCode: 'insurance', reason: 'a premium is a gateway intent' },
    });
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('refuses a line whose type row has gone INACTIVE — the vocabulary is the authority', async () => {
    const h = harness({ lines: [l()], types: new Map() });
    await expect(h.svc.applyAll(h.tx as never, 'tA', ctx)).rejects.toMatchObject({ code: 'DEDUCTION_TYPE_UNSUPPORTED' });
  });

  it('refuses a line pointing at the WRONG KIND of source', async () => {
    const h = harness({ lines: [l({ sourceType: 'loan', sourceId: 'loan1' })], types: new Map([['lv-feed', feedType]]) });
    await expect(h.svc.applyAll(h.tx as never, 'tA', ctx)).rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
  });

  it('refuses ANOTHER MEMBER\'s credit — the worst thing this file could be made to do', async () => {
    const others = DairyMemberCredit.rehydrate({ id: 'credit1', tenantId: 'tA', membershipId: 'mem-OTHER', mccId: null,
      description: 'feed', valueMinor: 50_000n, recoveredMinor: 0n, issuedOn: '2026-07-02', issuedBy: 'op1', status: 'outstanding' });
    const h = harness({ lines: [l()], types: new Map([['lv-feed', feedType]]), credit: others });
    await expect(h.svc.applyAll(h.tx as never, 'tA', ctx))
      .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID', details: { why: 'this credit belongs to another member' } });
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('skips a line that is already APPLIED — a resumed payment must not move money twice', async () => {
    const already = l();
    already.apply(NOW, 'txn-earlier');
    already.pullEvents();
    const h = harness({ lines: [already], types: new Map([['lv-feed', feedType]]), credit: credit() });
    expect(await h.svc.applyAll(h.tx as never, 'tA', ctx)).toEqual([]);
    expect(h.wallet.post).not.toHaveBeenCalled();
    expect(h.credits.updateRecovered).not.toHaveBeenCalled();
  });

  it('does nothing at all when there are no lines', async () => {
    const h = harness();
    expect(await h.svc.applyAll(h.tx as never, 'tA', ctx)).toEqual([]);
    expect(h.wallet.post).not.toHaveBeenCalled();
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('GENERATION — the operator\'s typo is caught while they are still there', () => {
  // The lines are validated at GENERATION as well as at payment, and that ordering is the point: 0157's refusal came
  // at the money movement, which meant a cooperative could build 312 bills nobody could ever pay and find out on
  // payday. All three of these survived a mutation run until this harness existed.
  const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 'tA', farmerUserId: 'farmer1', mccId: 'mcc1', memberCode: 'C1', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo', isActive: true });
  const feedType = { id: 'lv-feed', code: 'feed_credit', name: 'Feed', destination: 'member_credit' as const, unsupportedReason: null, sourceType: 'dairy_member_credit' };
  const insuranceType = { id: 'lv-ins', code: 'insurance', name: 'Insurance', destination: 'none' as const, unsupportedReason: 'a premium is a gateway intent', sourceType: null };

  function harness(opts: { type?: unknown; credit?: unknown; typeMissing?: boolean } = {}) {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const bills = { insert: jest.fn(), getForUpdate: jest.fn(), update: jest.fn() };
    const deductionLines = { insert: jest.fn(), linesForBill: jest.fn(async () => []) };
    // `?? feedType` would swallow a deliberate null, so "no such type" is its own flag — the first draft used null
    // and silently tested the happy path instead.
    const types = { byCode: jest.fn(async () => (opts.typeMissing ? null : opts.type ?? feedType)) };
    const credits = { getForUpdate: jest.fn(async () => opts.credit ?? DairyMemberCredit.rehydrate({
      id: 'credit1', tenantId: 'tA', membershipId: 'mem1', mccId: null, description: 'feed', valueMinor: 50_000n,
      recoveredMinor: 0n, issuedOn: '2026-07-02', issuedBy: 'op1', status: 'outstanding' })) };
    const collections = { aggregateUnbilledForUpdate: jest.fn(async () => ({ count: 2, heldCount: 0, heldMinor: 0n, totalWeightMilliKg: 60_000n, grossMinor: 479_400n, ids: ['c1', 'c2'] })), attachToBill: jest.fn() };
    const svc = new MilkBillService(uow as never, { write: jest.fn() } as never,
      { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as never, metrics as never,
      { post: jest.fn() } as never, { write: jest.fn() } as never, bills as never, collections as never,
      { getById: jest.fn(async () => membership) } as never, { disputeWindowHours: jest.fn(async () => 24) } as never,
      deductionLines as never, types as never, credits as never,
      { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null) } as never,
      { applyAll: jest.fn(async () => []) } as never, { isEnabled: jest.fn(async () => true) } as never,
      // [PC-56 TENANT-6c-5] the assembler: what the CYCLE deducts when nobody typed a line.
      { assemble: jest.fn(async () => ({ lines: [], totalMinor: 0n, capMinor: 0n, deferred: [] })) } as never);
    return { svc, deductionLines, bills };
  }
  const dto = (over: Partial<{ type: string; amountMinor: string; sourceId: string }> = {}) => ({
    membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
    deductions: [{ type: over.type ?? 'feed_credit', amountMinor: over.amountMinor ?? '50000', sourceId: over.sourceId ?? 'credit1' }],
  });
  const actor = { userId: 'op1', canManage: true };

  it('writes ONE ROW per line, pointing at the source, and the bill\'s total is their sum', async () => {
    const h = harness();
    const out: any = await h.svc.generate('tA', actor, 'idem', dto() as never, null);
    expect(out.deductionsMinor).toBe('50000');
    expect(h.deductionLines.insert).toHaveBeenCalledTimes(1);
    const written = (h.deductionLines.insert.mock.calls as any[])[0][1].toProps();
    expect(written).toMatchObject({ typeId: 'lv-feed', typeCode: 'feed_credit', amountMinor: 50_000n, sourceType: 'dairy_member_credit', sourceId: 'credit1', status: 'pending' });
    // The line belongs to the bill that was just inserted — not to a new id nobody can join on.
    expect(written.billId).toBe(out.id);
  });

  it('REFUSES an unsupported type here, not on payday, with the vocabulary\'s own reason', async () => {
    const h = harness({ type: insuranceType });
    await expect(h.svc.generate('tA', actor, 'idem', dto({ type: 'insurance' }) as never, null))
      .rejects.toMatchObject({ code: 'DEDUCTION_TYPE_UNSUPPORTED', details: { reason: 'a premium is a gateway intent' } });
    expect(h.bills.insert).not.toHaveBeenCalled();
  });

  it('REFUSES a type outside the vocabulary — the free-typed 40-character string is gone', async () => {
    const h = harness({ typeMissing: true });
    await expect(h.svc.generate('tA', actor, 'idem', dto({ type: 'society_levy' }) as never, null))
      .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
  });

  it('REFUSES a line bigger than the credit\'s outstanding, and one on another member\'s credit', async () => {
    const h = harness();
    await expect(h.svc.generate('tA', actor, 'idem', dto({ amountMinor: '50001' }) as never, null))
      .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID' });
    const others = DairyMemberCredit.rehydrate({ id: 'credit1', tenantId: 'tA', membershipId: 'mem-OTHER', mccId: null,
      description: 'feed', valueMinor: 50_000n, recoveredMinor: 0n, issuedOn: '2026-07-02', issuedBy: 'op1', status: 'outstanding' });
    await expect(harness({ credit: others }).svc.generate('tA', actor, 'idem', dto() as never, null))
      .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID', details: { why: expect.stringContaining('another member') } });
  });

  it('REFUSES a line with NO SOURCE — the old jsonb payload, refused readably', async () => {
    // The route's zod schema requires `sourceId`, but the cycle path and any future assembler are not routes. Without
    // this guard the refusal came from a NOT NULL violation three statements later, which tells an operator nothing.
    const h = harness();
    await expect(h.svc.generate('tA', actor, 'idem', { membershipId: 'mem1', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      deductions: [{ type: 'feed_credit', amountMinor: '50000' }] } as never, null))
      .rejects.toMatchObject({ code: 'DEDUCTION_SOURCE_INVALID', details: { why: expect.stringContaining('must name the') } });
  });

  it('does NOT second-guess a LOAN — that aggregate\'s invariants belong to the fintech module', async () => {
    // Deliberate, and its consequence is stated: a bad loan id fails at payment rather than at generation, because
    // the alternative is this module holding a second opinion about somebody else's aggregate.
    const loanType = { id: 'lv-loan', code: 'loan_emi', name: 'Loan', destination: 'loan' as const, unsupportedReason: null, sourceType: 'loan' };
    const h = harness({ type: loanType });
    const out: any = await h.svc.generate('tA', actor, 'idem', dto({ type: 'loan_emi', sourceId: 'loan1' }) as never, null);
    expect(out.deductionsMinor).toBe('50000');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE ASK is published at PREVIEW, with a recipient', () => {
  const membership = DairyMembership.rehydrate({ id: 'mem1', tenantId: 'tA', farmerUserId: 'farmer1', mccId: 'mcc1', memberCode: 'C1', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo', isActive: true });

  function harness(lines: ReturnType<typeof line>[]) {
    const b = bill(lines);
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const outbox = { write: jest.fn() };
    const svc = new MilkBillService(uow as never, outbox as never,
      { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as never, metrics as never,
      { post: jest.fn() } as never, { write: jest.fn() } as never,
      { getForUpdate: jest.fn(async () => b), update: jest.fn() } as never, { attachToBill: jest.fn() } as never,
      { getById: jest.fn(async () => membership) } as never, { disputeWindowHours: jest.fn(async () => 24) } as never,
      { linesForBill: jest.fn(async () => lines) } as never, { byCode: jest.fn() } as never, { getForUpdate: jest.fn() } as never,
      { consentThresholdPct: jest.fn(async () => 25), latestForBill: jest.fn(async () => null) } as never,
      { applyAll: jest.fn(async () => []) } as never, { isEnabled: jest.fn(async () => true) } as never,
      // [PC-56 TENANT-6c-5] the assembler: what the CYCLE deducts when nobody typed a line.
      { assemble: jest.fn(async () => ({ lines: [], totalMinor: 0n, capMinor: 0n, deferred: [] })) } as never);
    return { svc, outbox };
  }

  it('names the MEMBER and the lines when the threshold is crossed', async () => {
    const h = harness([line({ amountMinor: 150_000n })]);        // 37.5% of 400,000
    await h.svc.preview('tA', { userId: 'op1', canManage: true }, 'b1', NOW);
    const ask = (h.outbox.write.mock.calls as any[]).map((c) => c[1]).find((e) => e.eventType === 'dairy.bill_deduction_consent_required');
    expect(ask).toBeDefined();
    // ADMIN-6b's finding, five waves running: a map row over a payload with no recipient sends nothing.
    expect(ask.payload.userId).toBe('farmer1');
    expect(ask.payload).toMatchObject({ thresholdPct: 25, grossMinor: '400000', deductionsMinor: '150000' });
    expect(ask.payload.lines).toEqual([{ type: 'feed_credit', amountMinor: '150000' }]);
  });

  it('and asks NOTHING when the deductions are at or below it', async () => {
    const h = harness([line({ amountMinor: 100_000n })]);        // exactly 25%
    await h.svc.preview('tA', { userId: 'op1', canManage: true }, 'b1', NOW);
    expect((h.outbox.write.mock.calls as any[]).map((c) => c[1].eventType)).not.toContain('dairy.bill_deduction_consent_required');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE PROMISE THE FINTECH MODULE MADE TWICE', () => {
  it('`milk_bill_deduction` has been a REPAYMENT STYLE all along, and nothing implemented it', () => {
    expect([...REPAYMENT_STYLES]).toContain('milk_bill_deduction');
    // 0011's own comment on `loan_repayments.channel` lists it too. So a loan could be sold to a dairy farmer on the
    // understanding that it comes out of her milk cheque, and the dairy module had never heard of it.
    expect(read('../../../../../../db/migrations/0011_fintech_schemes.sql')).toMatch(/upi\|milk_bill_deduction\|harvest_settlement\|cash_partner/);
  });

  it('MOVES THE MONEY THE RIGHT WAY: member → cooperative, and the outstanding falls', async () => {
    // Both halves of this survived a mutation run on the unit suite until this test existed: reversing the legs (the
    // cooperative paying the member's loan for them) and never persisting the reduced outstanding (the family pays and
    // still owes) both left every other test green.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const loan = Loan.rehydrate({ id: 'loan1', applicationId: 'app1', tenantId: 'tA', borrowerUserId: 'farmer1',
      partnerId: 'p1', principalMinor: 200_000n, interestAprBps: 700, disbursedAt: '2026-04-01', maturityDate: null,
      status: 'active', outstandingMinor: 200_000n, nextDueDate: null });
    const loans = { getForUpdate: jest.fn(async () => loan), update: jest.fn() };
    const repayments = { insert: jest.fn() };
    const wallet = { post: jest.fn(async () => ({ txnId: 'txn-loan', alreadyApplied: false })) };
    const svc = new LoanService({ run: jest.fn() } as never, { write: jest.fn() } as never,
      { remember: jest.fn() } as never, metrics as never, { write: jest.fn() } as never, wallet as never,
      loans as never, repayments as never);
    const out = await svc.applyMilkBillDeduction(tx as never, 'tA', {
      loanId: 'loan1', borrowerUserId: 'farmer1', amountMinor: 20_000n, billId: 'b1', deductionId: 'ded1', initiatedBy: 'op1',
    });
    expect(out).toMatchObject({ outstandingMinor: '180000', walletTxnId: 'txn-loan' });
    expect(loans.update).toHaveBeenCalledTimes(1);          // the reduced outstanding is PERSISTED
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    const debit = arg.legs.find((l: any) => l.amountMinor < 0n);
    const credit = arg.legs.find((l: any) => l.amountMinor > 0n);
    expect(debit.account.userId).toBe('farmer1');            // the BORROWER pays
    expect(credit.account.kind).toBe('tenant');              // the cooperative's lending pool receives
    expect(arg.legs.reduce((a: bigint, l: any) => a + l.amountMinor, 0n)).toBe(0n);
    expect((repayments.insert.mock.calls as any[])[0][1].toProps()).toMatchObject({ channel: 'milk_bill_deduction', amountPaidMinor: 20_000n });
  });

  it('refuses a loan that is not this member\'s, without confirming it exists', async () => {
    const tx = { query: jest.fn() };
    const loan = Loan.rehydrate({ id: 'loan1', applicationId: 'app1', tenantId: 'tA', borrowerUserId: 'somebody-else',
      partnerId: 'p1', principalMinor: 200_000n, interestAprBps: 700, disbursedAt: '2026-04-01', maturityDate: null,
      status: 'active', outstandingMinor: 200_000n, nextDueDate: null });
    const wallet = { post: jest.fn() };
    const svc = new LoanService({ run: jest.fn() } as never, { write: jest.fn() } as never, { remember: jest.fn() } as never,
      metrics as never, { write: jest.fn() } as never, wallet as never,
      { getForUpdate: jest.fn(async () => loan), update: jest.fn() } as never, { insert: jest.fn() } as never);
    await expect(svc.applyMilkBillDeduction(tx as never, 'tA', {
      loanId: 'loan1', borrowerUserId: 'farmer1', amountMinor: 1n, billId: 'b1', deductionId: 'ded1', initiatedBy: 'op1',
    })).rejects.toMatchObject({ code: 'LOAN_NOT_FOUND' });   // 404-shaped, so a loan id is not probeable
    expect(wallet.post).not.toHaveBeenCalled();
  });

  it('the repayment is written with that channel, keyed on the LINE, and takes the caller\'s transaction', () => {
    const src = read('../../fintech/services/loan.service.ts');
    expect(src).toMatch(/async applyMilkBillDeduction\(tx: TxContext/);
    expect(src).toMatch(/channel: 'milk_bill_deduction'/);
    expect(src).toMatch(/idempotencyKey: `milkdeduct:\$\{input\.deductionId\}`/);
    // 404 rather than 403 on a borrower mismatch: a loan id that is not this member's must not be confirmable by
    // probing the error, and a line naming somebody else's loan must never pay it.
    expect(src).toMatch(/if \(loan\.borrowerUserId !== input\.borrowerUserId\) throw new LoanNotFoundError/);
    // It does NOT open its own transaction — TENANT-6c-2's self-deadlock, avoided by design this time.
    expect(src).not.toMatch(/async applyMilkBillDeduction[\s\S]{0,600}this\.uow\.run/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('THE ASK — a gate the member is never told about is a bill that silently never pays', () => {
  it('the consent-required event is mapped to a notification with a RECIPIENT', () => {
    const map = read('../../communication/events/notification-event-map.ts');
    expect(map).toMatch(/outboxType: 'dairy\.bill_deduction_consent_required', eventCode: 'dairy\.bill_deduction_consent_required', recipientKeys: \['userId'\]/);
  });

  it('is seeded as CRITICAL, un-mutable, in all three languages on push and in-app', () => {
    const seed = read(SEED_NOTIFS);
    expect(seed).toMatch(/'dairy\.bill_deduction_consent_required', 'Milk bill deductions need your agreement', 'critical', '\["sms","push","inapp"\]', false, false/);
    for (const channel of ['push', 'inapp']) {
      for (const lang of ['en', 'hi', 'gu']) {
        expect(seed).toContain(`('dairy.bill_deduction_consent_required','${channel}','${lang}'`);
      }
    }
    // The copy names the FIGURES and the LINES, not a percentage — "Rs 2,400 of Rs 9,000, feed credit Rs 500" is a
    // sentence a member can check against their own memory of the fortnight.
    expect(seed).toMatch(/\{\{lines\}\}/);
    expect(seed).toMatch(/\{\{threshold_pct\}\}/);
  });

  it('the member\'s route carries NO permission and NO flag', () => {
    const src = read('../controllers/v1/milk-bills.controller.ts');
    // Requiring `dairy.manage` would mean the only people who can agree to a withholding are the people doing it —
    // 6c-2's ruling for the dispute route, and why 6c-3 could take that permission off the farmer role.
    expect(src).toMatch(/@Post\(':id\/deduction-consent'\)\n {2}recordConsent/);
    expect(src).not.toMatch(/@Post\(':id\/deduction-consent'\) @RequirePermissions/);
    expect(src).not.toMatch(/@Post\(':id\/deduction-consent'\) @FeatureFlag/);
  });

  it('and the consent row never takes its figures from the client', () => {
    const dto = read('../dto/deduction-consent.dto.ts');
    expect(dto).not.toMatch(/grossMinor|deductionsMinor/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('WHAT THE MIGRATION ITSELF MUST SAY', () => {
  // The live spec proves each of these against a real database. These assertions exist because the mutation harness
  // runs the UNIT suite, and a constraint that only a live run defends is a constraint nobody notices the removal of
  // until a build without Postgres ships it. Anchored at line starts — TENANT-6c-3's lesson, where an assertion was
  // satisfied by commented-out SQL.
  const mig = () => read(MIGRATION);

  it('drops the jsonb blob, and STOPS rather than discarding a line it cannot map', () => {
    // Two mechanisms over one fact is on this programme's defect list, so the column does not survive beside the table.
    expect(mig()).toMatch(/^ {4}ALTER TABLE milk_bills DROP COLUMN deductions;$/m);
    // A jsonb element saying {"type":"Feed","amount_minor":500} is Rs 5 of somebody's money. A migration that quietly
    // drops it is worse than one that refuses to run.
    expect(mig()).toMatch(/^ {6}RAISE EXCEPTION 'PC-56 TENANT-6c-4:/m);
  });

  it('keeps the receivable, the line and the consent append-only by GRANT', () => {
    expect(mig()).toMatch(/^GRANT UPDATE \(recovered_minor, status, updated_at, updated_by\) ON dairy_member_credits TO kv_app;$/m);
    expect(mig()).toMatch(/^GRANT UPDATE \(status, applied_at, wallet_txn_id, updated_at, updated_by\) ON milk_bill_deductions TO kv_app;$/m);
    expect(mig()).toMatch(/^GRANT SELECT, INSERT ON milk_bill_deduction_consents TO kv_app;$/m);
    // 0157's lesson: a column grant is decoration unless the table-level one is revoked first.
    for (const t of ['dairy_member_credits', 'milk_bill_deductions', 'milk_bill_deduction_consents']) {
      expect(mig()).toMatch(new RegExp(`^REVOKE UPDATE, DELETE ON ${t} FROM kv_app;$`, 'm'));
      expect(mig()).toMatch(new RegExp(`^REVOKE ALL ON ${t} FROM kv_relay;$`, 'm'));
    }
  });

  it('pairs the applied stamp with its ledger txn, in the database', () => {
    expect(mig()).toMatch(/^ {4}AND \(applied_at IS NULL\) = \(wallet_txn_id IS NULL\)\),$/m);
  });

  it('forbids an over-recovery and a status that disagrees with the arithmetic', () => {
    expect(mig()).toMatch(/^ {2}CONSTRAINT ck_dairy_member_credit_recovered CHECK \(recovered_minor <= value_minor\),$/m);
    expect(mig()).toMatch(/^ {4}CHECK \(\(status = 'recovered'\) = \(recovered_minor = value_minor\)\)$/m);
  });

  it('forbids the same source twice on one bill, and an unnamed assisted consent', () => {
    expect(mig()).toMatch(/^ {2}CONSTRAINT uq_milk_bill_deduction_source UNIQUE \(bill_id, type_id, source_id\)$/m);
    expect(mig()).toMatch(/^ {4}CHECK \(\(channel = 'ambassador_assisted'\) = \(assisted_by IS NOT NULL\)\),$/m);
  });

  it('ships BOTH flags OFF', () => {
    // Two, because they are two blast radii: killing the credit desk must not strand a bill whose line is recorded,
    // and killing recovery must not stop the MCC writing down what it sold.
    const flagBlock = mig().slice(mig().indexOf('160.7'));
    expect((flagBlock.match(/^ {3}false, 100, 'experiment'\)/gm) ?? []).length).toBe(2);
    expect(flagBlock).toMatch(/'dairy_member_credit'/);
    expect(flagBlock).toMatch(/'dairy_deduction_recovery'/);
  });

  it('and the vocabulary insert cannot be duplicated — `ON CONFLICT` would be decoration', () => {
    // THE PLATFORM-WIDE DEFECT THIS WAVE TRIPPED OVER. `lookup_values` has UNIQUE (type_code, tenant_id, code) and a
    // platform row has `tenant_id IS NULL`; Postgres treats NULLs as DISTINCT in a unique index unless declared
    // `NULLS NOT DISTINCT`, which 0001's is not. So every `ON CONFLICT (type_code,tenant_id,code) DO NOTHING` in
    // db/seeds/core/0005 is decoration, and a freshly built database carries 139 duplicated codes out of 311 —
    // `ledger_txn_type` and `boost_tier` (price in `meta`) among them. De-duplicating those means repointing FKs on
    // the LEDGER, so it is escalated rather than swept; what this wave guarantees is its OWN vocabulary.
    expect(read(SEED_LOOKUPS)).toMatch(/^ WHERE NOT EXISTS \(SELECT 1 FROM lookup_values x WHERE x\.type_code=v\.type_code AND x\.tenant_id IS NULL AND x\.code=v\.code\);$/m);
    expect(mig()).toMatch(/^CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_milk_deduction_platform$/m);
    // And the harness comment that asserted an idempotency the schema cannot deliver is corrected, because that claim
    // is why nobody looked.
    expect(read('../../../../test/integration-global-setup.js')).toMatch(/THAT IS FALSE, AND IT IS WHY NOBODY LOOKED/);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('what is deliberately NOT here', () => {
  it('NOTHING ASSEMBLES THE LINES YET — the cadence still builds bills with none', () => {
    // W169's *"₹1,84,300 this cycle"* is still zero on the automatic path, and that is stated rather than implied:
    // assembling lines from the outstanding source records is what the canon's *"not just standing instructions"* is
    // contrasted against, and it is TENANT-6c-5 together with the standing-instruction record and the recovery caps.
    expect(read('../services/dairy-bill-cycle.service.ts')).toMatch(/deductions: \[\]/);
    expect(read(MIGRATION)).toMatch(/Nothing ASSEMBLES the lines yet/);
  });

  it('there is still NO EMI SCHEDULE on this platform, so a loan line recovers toward the outstanding', () => {
    // 0011's own entity says so: *"a pre-generated EMI schedule is deferred (documented)"*. So this platform cannot
    // state what a given fortnight's instalment IS, and a screen must not claim it can.
    expect(read('../../fintech/domain/loan-repayment.entity.ts')).toMatch(/pre-generated EMI schedule is deferred/);
    expect(read(MIGRATION)).toMatch(/There is still no EMI schedule/);
  });

  it('`insurance` and `share` still refuse, each with its own reason in the DATA', () => {
    const seed = read(SEED_LOOKUPS);
    expect(seed).toMatch(/'insurance','Insurance premium','\{"destination":"none"/);
    expect(seed).toMatch(/'share','Cooperative share allotment','\{"destination":"none"/);
  });

  it('`paid` is STILL not a cycle status — there is no payout batch behind "one bank trip"', () => {
    expect(read('../domain/dairy-cycle.ts')).not.toMatch(/'paid'/);
  });
});
