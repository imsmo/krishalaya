// modules/dairy/__tests__/tenant6c6-cycle-console.spec.ts · PC-56 TENANT-6c-6 · W169, the screen.
//
// What is asserted here, and why each one is a defect if it breaks:
//
//   • **THE REFUSAL ORDER.** `nobody can → you cannot → not yet → not you` is the whole informational value of an act
//     verdict. A cooperative told "you lack a permission" when the flag is off goes and grants a permission.
//   • **MAKER-CHECKER BEFORE "NOTHING LEFT".** An operator who previewed the cycle must be told a colleague signs it,
//     not that there is nothing to sign (6c-3's rule, which the database also enforces).
//   • **THE TENANT'S OWN NUMBERS.** The consent line comes from the settings reader; nothing in this file may contain
//     the canon's 25 as a constant the code depends on.
//   • **THE LITRE STRING NEVER TOUCHES A FLOAT.** `milliFromLitres` round-trips, because `Number("172.800") * 1000` is
//     how a fortnight ends up a millilitre short of its own pours.
//   • **THE REGISTER IS ONE QUERY PER PAGE, not one per row** — the 30-day average is asked once, for the page's
//     memberships. 312 families would otherwise be 312 round trips per draw.
//   • **`@Get('console')` IS DECLARED BEFORE `@Get(':id')`.** Nest matches in declaration order, so the parameterised
//     route would swallow `/console` and answer 404 for the id "console". Invisible in a diff; asserted here.
import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  ACT_REFUSALS, approveAct, billVerdict, consentLine, cycleStage, disputeVerdict, elapsedDays, litresFromMilli,
  milliFromLitres, pageTotals, paydayVerdict, periodDays, previewAct,
} from '../domain/dairy-cycle-console';
import { DairyCycleConsoleReadModel, CYCLE_APPROVE_FLAG, CYCLE_PREVIEW_FLAG } from '../read-models/dairy-cycle-console.read-model';
import { DairyCycleConsoleRepository } from '../repositories/dairy-cycle-console.repository';
import { BillCyclesController } from '../controllers/v1/bill-cycles.controller';
import { CycleConsoleSchema, decodeGrossCursor } from '../dto/query-cycle-console.dto';
import { DEDUCTION_ASSEMBLY_FLAG } from '../services/dairy-deduction-assembler.service';
import { BillCycleNotFoundError } from '../domain/dairy.errors';
import { CYCLE_CLOSE_FLAG } from '../jobs/dairy-cycle-close.cadence-job';

const ACT = {
  stage: 'billed' as const, flagOn: true, canManage: true, canCloseSettlement: true,
  pending: 3, billsBuilt: true, openDisputes: 0, previewedBy: null as string | null, userId: 'u1',
};

describe('PC-56 TENANT-6c-6 · W169 the cycle console', () => {
  /* ------------------------------------------------------------------------------------------------------- */
  /* THE CYCLE'S STAGE                                                                                       */
  /* ------------------------------------------------------------------------------------------------------- */

  it('distinguishes a closed cycle whose bills exist from one whose bills do not', () => {
    expect(cycleStage('open', 0)).toBe('accruing');
    expect(cycleStage('open', 312)).toBe('accruing');       // a stray bill does not make an open cycle billed
    expect(cycleStage('closed', 0)).toBe('closed_unbilled');
    expect(cycleStage('closed', 312)).toBe('billed');
    expect(cycleStage('previewed', 312)).toBe('previewed');
    expect(cycleStage('approved', 312)).toBe('approved');
  });

  it('reports an unknown status as the earliest stage instead of crashing the register', () => {
    // A deployment ahead of this code must not take the screen down for the cycles it does understand.
    expect(cycleStage('settled_by_a_future_wave', 12)).toBe('accruing');
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE ACTS                                                                                                */
  /* ------------------------------------------------------------------------------------------------------- */

  it('refuses preview in the order nobody-can → you-cannot → not-yet', () => {
    // Every earlier reason WINS over every later one, asserted pairwise rather than by one happy example.
    expect(previewAct({ ...ACT, flagOn: false, canManage: false, canCloseSettlement: false, pending: 0 }).refusal).toBe('FLAG_OFF');
    expect(previewAct({ ...ACT, canManage: false, canCloseSettlement: false, pending: 0 }).refusal).toBe('NO_MANAGE');
    expect(previewAct({ ...ACT, canCloseSettlement: false, pending: 0 }).refusal).toBe('NO_SETTLEMENT_CLOSE');
    expect(previewAct({ ...ACT, stage: 'accruing', pending: 0 }).refusal).toBe('WRONG_STAGE');
    expect(previewAct({ ...ACT, pending: 0 }).refusal).toBe('NOTHING_LEFT');
  });

  it('needs BOTH keys to preview — the second signature is on preview too (W169, 6c-3)', () => {
    expect(previewAct({ ...ACT, canCloseSettlement: false }).can).toBe(false);
    expect(previewAct({ ...ACT, canCloseSettlement: false }).refusal).toBe('NO_SETTLEMENT_CLOSE');
    expect(previewAct(ACT).can).toBe(true);
  });

  it('lets a partly-previewed cycle be previewed again — that is how a bounded pass finishes', () => {
    expect(previewAct({ ...ACT, stage: 'previewed', pending: 108 }).can).toBe(true);
    expect(previewAct({ ...ACT, stage: 'previewed', pending: 0 }).refusal).toBe('NOTHING_LEFT');
  });

  it('will not preview an approved cycle', () => {
    expect(previewAct({ ...ACT, stage: 'approved', pending: 3 }).refusal).toBe('WRONG_STAGE');
  });

  it('cautions rather than refuses when the cadence has not built the bills', () => {
    const v = previewAct({ ...ACT, stage: 'closed_unbilled', billsBuilt: false, pending: 1 });
    expect(v.can).toBe(true);
    expect(v.caution).toBe('BILLS_NOT_BUILT');
    // A cooperative generating bills by hand must not be locked out of its own preview.
    expect(v.refusal).toBeNull();
  });

  it('tells the maker that a colleague approves, in preference to every other true thing', () => {
    const v = approveAct({ ...ACT, stage: 'previewed', previewedBy: 'u1', userId: 'u1', pending: 0 });
    expect(v.refusal).toBe('MAKER_IS_CHECKER');       // NOT 'NOTHING_LEFT', which is also true here
    expect(approveAct({ ...ACT, stage: 'previewed', previewedBy: 'u2', userId: 'u1' }).can).toBe(true);
  });

  it('does not approve a cycle nobody has previewed (the database says so too)', () => {
    expect(approveAct({ ...ACT, stage: 'billed' }).refusal).toBe('WRONG_STAGE');
    expect(approveAct({ ...ACT, stage: 'closed_unbilled' }).refusal).toBe('WRONG_STAGE');
    expect(approveAct({ ...ACT, stage: 'accruing' }).refusal).toBe('WRONG_STAGE');
  });

  it('warns about open disputes without blocking the cycle — one bill pauses, never the cycle', () => {
    const v = approveAct({ ...ACT, stage: 'previewed', previewedBy: 'u2', openDisputes: 2 });
    expect(v.can).toBe(true);
    expect(v.caution).toBe('DISPUTES_OPEN');
  });

  it('keeps its refusal vocabulary closed', () => {
    // A refusal the screen has no sentence for would render as a raw key in front of a dairy secretary.
    const seen = new Set<string>();
    for (const input of [
      { ...ACT, flagOn: false }, { ...ACT, canManage: false }, { ...ACT, canCloseSettlement: false },
      { ...ACT, stage: 'accruing' as const }, { ...ACT, pending: 0 },
      { ...ACT, stage: 'previewed' as const, previewedBy: 'u1' },
    ]) {
      const r = previewAct(input).refusal ?? approveAct(input).refusal;
      if (r) seen.add(r);
    }
    for (const r of seen) expect(ACT_REFUSALS).toContain(r as never);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE TILES                                                                                               */
  /* ------------------------------------------------------------------------------------------------------- */

  it('records the payday and refuses the batch', () => {
    const v = paydayVerdict('2026-07-17', { approved: 40, paid: 2, draft: 270 });
    expect(v.payday).toBe('2026-07-17');
    expect(v.batchBuilt).toBe(false);          // the canon's "one bank trip" exists nowhere on this platform
    expect(v.paid).toBe(2);
    expect(v.awaitingPayment).toBe(40);        // approved, not draft: a draft is not awaiting a bank, it is awaiting a human
  });

  it('prints the tenant\'s two numbers, and the lower one is what software may take', () => {
    expect(consentLine(25, 25)).toEqual({ consentPct: 25, assemblyPct: 25, automaticPct: 25 });
    expect(consentLine(25, 10)).toEqual({ consentPct: 25, assemblyPct: 10, automaticPct: 10 });
    // A cooperative that RAISED its assembly cap above the consent line still cannot cross the line.
    expect(consentLine(15, 40).automaticPct).toBe(15);
  });

  it('claims "all resolved before payday" only when every dispute was', () => {
    expect(disputeVerdict({ total: 2, byStatus: { resolved: 2 }, resolvedBeforePayday: 2 }, 309).allResolvedBeforePayday).toBe(true);
    // Resolved, but on the Saturday after a Friday payday: the family was paid the disputed figure.
    expect(disputeVerdict({ total: 2, byStatus: { resolved: 2 }, resolvedBeforePayday: 1 }, 309).allResolvedBeforePayday).toBe(false);
    expect(disputeVerdict({ total: 0, byStatus: {}, resolvedBeforePayday: 0 }, 309).allResolvedBeforePayday).toBe(false);
    expect(disputeVerdict({ total: 3, byStatus: { open: 1, resolved: 2 }, resolvedBeforePayday: 2 }, 309).open).toBe(1);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE ROW                                                                                                 */
  /* ------------------------------------------------------------------------------------------------------- */

  const verdict = (o: Partial<Parameters<typeof billVerdict>[0]> = {}) => billVerdict({
    grossMinor: 100000n, deductionsMinor: 25000n, consentPct: 25, consentOnFile: null,
    totalLitresMilli: 0n, days: 0, litres30dMilli: null, days30d: 0, ...o,
  });

  it('flags a bill above the tenant\'s consent line, at the boundary the money path uses', () => {
    expect(verdict().needsFreshConsent).toBe(false);                                 // STRICTLY above, as `pay()` compares
    expect(verdict({ deductionsMinor: 25001n }).needsFreshConsent).toBe(true);
  });

  it('stops warning once the member has consented to THESE figures', () => {
    // [found live] The first version asked only "is it above the line?", so a consented bill kept its warning while the
    // tile's count — which does read the consents — said zero. One screen, two answers about whose money is stuck.
    expect(verdict({ deductionsMinor: 30000n, consentOnFile: 'granted_current' }).needsFreshConsent).toBe(false);
    // A consent to figures that have since changed is not a consent: 6c-2 made a bill rebuildable, so a member can be
    // shown three different sets of numbers for one fortnight.
    expect(verdict({ deductionsMinor: 30000n, consentOnFile: 'granted_stale' }).needsFreshConsent).toBe(true);
    expect(verdict({ deductionsMinor: 30000n, consentOnFile: 'refused' }).needsFreshConsent).toBe(true);
  });

  it('shows a refusal BELOW the line without pretending it blocks the payment', () => {
    // 6c-4's hardest call, on the screen: the bill pays, and the objection is still owed an answer.
    const below = verdict({ deductionsMinor: 1000n, consentOnFile: 'refused' });
    expect(below.needsFreshConsent).toBe(false);
    expect(below.memberRefusedBelowLine).toBe(true);
    // Above the line a refusal is a REFUSAL, not a note — it belongs in the blocking flag, not beside it.
    const above = verdict({ deductionsMinor: 30000n, consentOnFile: 'refused' });
    expect(above.needsFreshConsent).toBe(true);
    expect(above.memberRefusedBelowLine).toBe(false);
    expect(verdict({ deductionsMinor: 1000n, consentOnFile: 'granted_current' }).memberRefusedBelowLine).toBe(false);
  });

  it('averages a member\'s milk over the days they poured, not over thirty', () => {
    const v = verdict({ deductionsMinor: 0n, totalLitresMilli: 172800n, days: 15, litres30dMilli: 56800n, days30d: 4 });
    expect(litresFromMilli(v.litresPerDayMilli!)).toBe('11.520');
    // 56.8 L over four days is 14.2 L/day — over thirty it would print 1.893 and make every other row look wrong.
    expect(litresFromMilli(v.avg30dMilli!)).toBe('14.200');
  });

  it('reports "not enough history" as null, never as zero', () => {
    const v = verdict({ deductionsMinor: 0n, totalLitresMilli: 100n, days: 0, litres30dMilli: 0n, days30d: 0 });
    expect(v.litresPerDayMilli).toBeNull();
    expect(v.avg30dMilli).toBeNull();
  });

  it('counts a fortnight inclusively, and an open cycle only as far as today', () => {
    expect(periodDays('2026-07-01', '2026-07-15')).toBe(15);   // 01–15 is fifteen days of milk, not fourteen
    expect(periodDays('2026-07-01', '2026-07-01')).toBe(1);
    expect(periodDays('2026-07-15', '2026-07-01')).toBe(0);    // nonsense in, zero out — never a negative divisor
    expect(elapsedDays('2026-07-01', '2026-07-15', '2026-07-13')).toBe(13);
    expect(elapsedDays('2026-07-01', '2026-07-15', '2026-08-02')).toBe(15);   // never more than the window
  });

  it('parses and prints litres by string, never through a float', () => {
    expect(milliFromLitres('172.800')).toBe(172800n);
    expect(milliFromLitres('0.001')).toBe(1n);
    expect(milliFromLitres('9')).toBe(9000n);
    expect(milliFromLitres('-1.5')).toBe(-1500n);
    // A float ROUNDS the fourth decimal into the third; the string TRUNCATES, which is the rule the numeric mapper
    // states and the only one that leaves the remainder where it was.
    expect(milliFromLitres('1.9999')).toBe(1999n);
    // ...and beyond 2^53 a float cannot hold the integer at all: a cooperative's lifetime litres are not a double.
    expect(milliFromLitres('12345678901234.567')).toBe(12345678901234567n);
    expect(litresFromMilli(172800n)).toBe('172.800');
    expect(litresFromMilli(1n)).toBe('0.001');
    // The round trip a float breaks: 0.1 + 0.2 arithmetic on litres would drift a millilitre per row, 312 rows a day.
    const sum = ['0.1', '0.2', '0.3'].reduce((a, s) => a + milliFromLitres(s), 0n);
    expect(litresFromMilli(sum)).toBe('0.600');
  });

  it('sums a page from the rows it actually has', () => {
    const t = pageTotals([
      { grossMinor: '941400', deductionsMinor: '50000', netMinor: '891400', totalLitres: '172.800' },
      { grossMinor: '912000', deductionsMinor: '0', netMinor: '912000', totalLitres: '176.400' },
    ]);
    expect(t).toEqual({ grossMinor: '1853400', deductionsMinor: '50000', netMinor: '1803400', litres: '349.200', rows: 2 });
    expect(pageTotals([])).toEqual({ grossMinor: '0', deductionsMinor: '0', netMinor: '0', litres: '0.000', rows: 0 });
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE ROUTE, THE QUERY                                                                                    */
  /* ------------------------------------------------------------------------------------------------------- */

  it('declares /console BEFORE /:id, so the parameterised route cannot swallow it', () => {
    const proto = BillCyclesController.prototype as unknown as Record<string, unknown>;
    const order = Object.getOwnPropertyNames(proto)
      .filter((m) => m !== 'constructor' && typeof Reflect.getMetadata(PATH_METADATA, proto[m] as never) === 'string')
      .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string);
    expect(order).toContain('console');
    expect(order).toContain(':id');
    expect(order.indexOf('console')).toBeLessThan(order.indexOf(':id'));
  });

  it('defaults the register to the largest bills first, 25 to a page', () => {
    const q = CycleConsoleSchema.parse({});
    expect(q.direction).toBe('desc');    // the canon draws the Gross arrow descending
    expect(q.limit).toBe(25);
    expect(() => CycleConsoleSchema.parse({ sort: 'member' })).toThrow();   // .strict(): no invented sorts
    expect(() => CycleConsoleSchema.parse({ cycleId: 'not-a-uuid' })).toThrow();
  });

  it('treats a broken cursor as the first page rather than as an error', () => {
    expect(decodeGrossCursor(undefined)).toBeNull();
    expect(decodeGrossCursor('!!!not base64!!!')).toBeNull();
    expect(decodeGrossCursor(Buffer.from('941400|nope').toString('base64'))).toBeNull();
    expect(decodeGrossCursor(Buffer.from('941400|3f2504e0-4f89-41d3-9a0c-0305e82c3301').toString('base64')))
      .toEqual({ gross: '941400', id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE REGISTER'S SQL                                                                                      */
  /* ------------------------------------------------------------------------------------------------------- */

  const repoHarness = () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: readonly unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; });
    return { repo: new DairyCycleConsoleRepository({ forTenant: () => ({ query }) } as never), calls };
  };

  it('orders the register by gross and pages it by keyset, not by offset', async () => {
    const h = repoHarness();
    await h.repo.bills('t1', 'c1', { limit: 25 });
    const sql = h.calls[0].sql;
    expect(sql).toMatch(/ORDER BY b\.gross_minor DESC, b\.id DESC/);
    expect(sql).not.toMatch(/OFFSET/);
    // limit + 1, so "there is another page" is measured rather than guessed from a full page.
    expect(h.calls[0].params).toContain(26);
  });

  it('compares the keyset as a TUPLE, in the direction it is reading', async () => {
    const desc = repoHarness();
    await desc.repo.bills('t1', 'c1', { limit: 10, cursor: { gross: '941400', id: 'bill-1' } });
    expect(desc.calls[0].sql).toMatch(/\(b\.gross_minor, b\.id\) < \(\$4::bigint, \$5::uuid\)/);
    const asc = repoHarness();
    await asc.repo.bills('t1', 'c1', { limit: 10, cursor: { gross: '1', id: 'bill-1' }, direction: 'asc' });
    expect(asc.calls[0].sql).toMatch(/\(b\.gross_minor, b\.id\) > \(\$4::bigint, \$5::uuid\)/);
    expect(asc.calls[0].sql).toMatch(/ORDER BY b\.gross_minor ASC, b\.id ASC/);
  });

  it('reads the member\'s LATEST word on the row, the same way the payment path does', async () => {
    const h = repoHarness();
    await h.repo.bills('t1', 'c1', { limit: 5 });
    const sql = h.calls[0].sql;
    // The row's warning and the tile's count must come from the same consent row, or one screen gives two answers.
    expect(sql).toMatch(/FROM milk_bill_deduction_consents c[\s\S]*ORDER BY c\.recorded_at DESC, c\.id DESC LIMIT 1\) latest/);
    expect(sql).toMatch(/latest\.gross_minor = b\.gross_minor AND latest\.deductions_minor = b\.deductions_minor/);
  });

  it('scopes the register to the tenant AND the cycle, and skips deleted rows', async () => {
    const h = repoHarness();
    await h.repo.bills('t1', 'c1', { limit: 5 });
    expect(h.calls[0].sql).toMatch(/b\.tenant_id = \$1 AND b\.cycle_id = \$2 AND b\.deleted_at IS NULL/);
    // The member join is tenant-bound too: a membership row is not global.
    expect(h.calls[0].sql).toMatch(/JOIN dairy_memberships m ON m\.id = b\.membership_id AND m\.tenant_id = b\.tenant_id/);
  });

  it('asks for the 30-day average ONCE for the page, and not at all for an empty page', async () => {
    const h = repoHarness();
    await h.repo.avg30d('t1', ['m1', 'm2', 'm3'], '2026-07-15');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].sql).toMatch(/membership_id = ANY\(\$2::uuid\[\]\)/);
    expect(h.calls[0].sql).toMatch(/count\(DISTINCT c\.collected_on\)/);   // the day count, beside the litres
    // THIRTY days, bounded at both ends: an unbounded window would call a year of history a 30-day average.
    expect(h.calls[0].sql).toMatch(/collected_on > \(\$3::date - INTERVAL '30 days'\)/);
    expect(h.calls[0].sql).toMatch(/collected_on <= \$3::date/);
    await h.repo.avg30d('t1', [], '2026-07-15');
    expect(h.calls).toHaveLength(1);
  });

  it('counts consent-blocked bills from the LATEST consent row, exactly as pay() decides', async () => {
    const h = repoHarness();
    await h.repo.totals('t1', 'c1');
    const blocked = h.calls.find((c) => c.sql.includes('milk_bill_deduction_consents'))!;
    // The threshold comes from the setting, never from a literal 25 in this codebase.
    expect(blocked.sql).toMatch(/dairy\.deduction_consent_pct/);
    // ...and the COMPARISON uses that value. A `* 25` here would be the canon's number pretending to be the tenant's.
    expect(blocked.sql).toMatch(/b\.deductions_minor \* 100 > b\.gross_minor \* pct\.v/);
    expect(blocked.sql).not.toMatch(/gross_minor \* 25/);
    expect(blocked.sql).toMatch(/ORDER BY c\.recorded_at DESC, c\.id DESC LIMIT 1/);
    // A granted row followed by a refusal must count as BLOCKED — an EXISTS(granted) would not.
    expect(blocked.sql).toMatch(/latest\.granted = false/);
    expect(blocked.sql).not.toMatch(/EXISTS \(\s*SELECT 1 FROM milk_bill_deduction_consents/);
    expect(blocked.sql).toMatch(/b\.status NOT IN \('paid', 'voided'\)/);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE COMPOSITION                                                                                         */
  /* ------------------------------------------------------------------------------------------------------- */

  const cycleRow = (o: Partial<Record<string, unknown>> = {}) => {
    const props = {
      id: 'cycle-now', tenantId: 't1', paymentCycle: 'fortnightly', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      closesAt: new Date('2026-07-15T18:29:00Z'), payday: '2026-07-17', status: 'billed_status_placeholder',
      closedAt: null, billsGeneratedAt: new Date('2026-07-15T18:31:00Z'), billsGenerated: 312, billsSkipped: 0,
      billsFailed: 0, previewedAt: null, previewedBy: null, billsPreviewed: null, approvedAt: null, approvedBy: null,
      billsApproved: null, createdAt: new Date('2026-07-01T00:00:00Z'), ...o,
    };
    return { id: props.id as string, toProps: () => props, toJSON: () => props };
  };

  const rmHarness = (over: Record<string, unknown> = {}) => {
    const flags = { isEnabled: jest.fn(async (key: string) => key !== CYCLE_APPROVE_FLAG) };
    const deps = {
      replica: { forTenant: () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })) }) },
      cycles: {
        listFor: jest.fn(async () => [cycleRow({ status: 'closed' }), cycleRow({ id: 'cycle-prev', status: 'approved', periodStart: '2026-06-16', periodEnd: '2026-06-30' })]),
        byId: jest.fn(async () => cycleRow({ status: 'closed' })),
        today: jest.fn(async () => '2026-07-13'),
      },
      bills: { statusCountsForCycle: jest.fn(async () => ({ draft: 300, previewed: 10, disputed: 2 })) },
      console_: {
        bills: jest.fn(async () => ({
          rows: [{
            id: 'b1', membershipId: 'm1', memberUserId: 'u9', memberName: 'Savita Ben M.', memberCode: 'AND3-0019',
            mccCode: 'MCC-AND-03', totalLitres: '148.200', grossMinor: '786000', deductionsMinor: '124000',
            netMinor: '662000', status: 'draft', disputeWindowEnds: null, previewedAt: null, openDisputes: 0,
            byTypeId: [{ typeId: 'type-loan', amountMinor: '100000', lines: 1, applied: 0 }, { typeId: 'type-unknown', amountMinor: '24000', lines: 2, applied: 1 }],
            consentGranted: null, consentMatchesFigures: false,
            createdAt: new Date('2026-07-15T18:31:00Z'),
          }],
          nextCursor: { gross: '786000', id: 'b1' },
        })),
        totals: jest.fn(async () => ({ bills: 312, grossMinor: '248820000', deductionsMinor: '18430000', netMinor: '230390000', litresMilli: 4_500_000n, needingConsent: 41 })),
        avg30d: jest.fn(async () => new Map([['m1', { litresMilli: 56800n, days: 4 }]])),
      },
      deductions: { cycleTotals: jest.fn(async () => ({ totalMinor: 18_430_000n, byType: { feed_credit: '5000000', loan_emi: '13430000' } })) },
      disputes: { countsForCycle: jest.fn(async () => ({ total: 2, byStatus: { resolved: 2 }, resolvedBeforePayday: 2 })) },
      instructions: { assemblyPct: jest.fn(async () => ({ assemblyPct: 20, consentPct: 30 })) },
      types: { list: jest.fn(async () => [{ id: 'type-loan', code: 'loan_emi', name: 'Loan instalment', destination: 'loan', unsupportedReason: null, sourceType: 'loan' }]) },
      counter: {
        currencyCode: jest.fn(async () => 'INR'),
        accrual: jest.fn(async () => ({ amountMinor: 24_882_00n, membersWithPours: 312, cardsWithBonusRules: 1 })),
        billsInWindow: jest.fn(async () => 312),
      },
      flags,
      metrics: { inc: jest.fn(), observe: jest.fn() },
      ...over,
    };
    const rm = new DairyCycleConsoleReadModel(
      deps.replica as never, deps.cycles as never, deps.bills as never, deps.console_ as never,
      deps.deductions as never, deps.disputes as never, deps.instructions as never, deps.types as never,
      deps.counter as never, deps.flags as never, deps.metrics as never,
    );
    return { rm, deps };
  };

  const actor = { userId: 'u1', canManage: true, canCloseSettlement: true };

  it('composes W169: the stage, the four tiles, the register and the acts', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(v.cycle.stage).toBe('billed');
    expect(v.cycle.billsTotal).toBe(312);
    expect(v.today).toBe('2026-07-13');
    expect(v.totals.litres).toBe('4500.000');
    expect(v.deductions.totalMinor).toBe('18430000');
    expect(v.deductions.needingConsent).toBe(41);
    expect(v.payday.payday).toBe('2026-07-17');
    expect(v.payday.batchBuilt).toBe(false);
    expect(v.lastCycle?.id).toBe('cycle-prev');
    expect(v.lastCycle?.disputes.allResolvedBeforePayday).toBe(true);
    expect(v.openDisputes).toBe(2);
  });

  it('takes the consent line from the settings reader — never a hardcoded 25', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(h.deps.instructions.assemblyPct).toHaveBeenCalled();
    expect(v.consent).toEqual({ consentPct: 30, assemblyPct: 20, automaticPct: 20 });
    // And the row's warning uses THAT threshold: 124000/786000 is 15.8% — under 30, so no fresh consent is needed.
    expect(v.page.rows[0].needsFreshConsent).toBe(false);
  });

  it('resolves every act against the tenant\'s own flags, and reports the one that is down', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(h.deps.flags.isEnabled).toHaveBeenCalledWith(CYCLE_PREVIEW_FLAG, { tenantId: 't1' });
    expect(h.deps.flags.isEnabled).toHaveBeenCalledWith(CYCLE_APPROVE_FLAG, { tenantId: 't1' });
    expect(h.deps.flags.isEnabled).toHaveBeenCalledWith(CYCLE_CLOSE_FLAG, { tenantId: 't1' });
    expect(h.deps.flags.isEnabled).toHaveBeenCalledWith(DEDUCTION_ASSEMBLY_FLAG, { tenantId: 't1' });
    expect(v.acts.preview.can).toBe(true);
    expect(v.acts.approve.refusal).toBe('FLAG_OFF');    // the harness has approve switched off
    expect(v.cadenceOn).toBe(true);
  });

  it('itemises a deduction line whose type is not in the vocabulary rather than dropping it', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    const [known, unknown] = v.page.rows[0].deductions;
    expect(known.typeCode).toBe('loan_emi');
    expect(known.typeName).toBe('Loan instalment');
    // Money the member cannot see is the whole thing 6c-4 closed — an unmapped type keeps its amount.
    expect(unknown.typeCode).toBeNull();
    expect(unknown.amountMinor).toBe('24000');
    expect(unknown.applied).toBe(1);
  });

  it('treats a consent to OTHER figures as no consent at all', async () => {
    // 6c-2 made a bill voidable and rebuildable, so a member can be shown three sets of numbers for one fortnight.
    // `consentMatchesFigures` is what makes the third one a fresh question rather than a settled one.
    const rows = (over: Record<string, unknown>) => rmHarness({
      console_: {
        bills: jest.fn(async () => ({
          rows: [{
            id: 'b9', membershipId: 'm1', memberUserId: 'u9', memberName: 'X', memberCode: 'AND6-0009', mccCode: null,
            totalLitres: '10.000', grossMinor: '100000', deductionsMinor: '90000', netMinor: '10000', status: 'draft',
            disputeWindowEnds: null, previewedAt: null, openDisputes: 0, byTypeId: [], createdAt: new Date('2026-07-15T00:00:00Z'),
            consentGranted: null, consentMatchesFigures: false, ...over,
          }],
          nextCursor: null,
        })),
        totals: jest.fn(async () => ({ bills: 1, grossMinor: '100000', deductionsMinor: '90000', netMinor: '10000', litresMilli: 10_000n, needingConsent: 1 })),
        avg30d: jest.fn(async () => new Map()),
      },
    });
    const none = await rows({}).rm.view('t1', actor, {});
    expect(none.page.rows[0].needsFreshConsent).toBe(true);
    const stale = await rows({ consentGranted: true, consentMatchesFigures: false }).rm.view('t1', actor, {});
    expect(stale.page.rows[0].needsFreshConsent).toBe(true);
    const current = await rows({ consentGranted: true, consentMatchesFigures: true }).rm.view('t1', actor, {});
    expect(current.page.rows[0].needsFreshConsent).toBe(false);
    const refused = await rows({ consentGranted: false, consentMatchesFigures: true }).rm.view('t1', actor, {});
    expect(refused.page.rows[0].needsFreshConsent).toBe(true);
  });

  it('masks the member code and keeps the name as recorded', async () => {
    const h = rmHarness();
    const v = await h.rm.view('t1', actor, {});
    expect(v.page.rows[0].memberCodeMasked).toBe('AND3••19');
    expect(v.page.rows[0].memberName).toBe('Savita Ben M.');
  });

  it('divides a closed cycle by its whole window and an open one by the days that have happened', async () => {
    const closed = await rmHarness().rm.view('t1', actor, {});
    expect(closed.page.rows[0].litresPerDay).toBe('9.880');     // 148.2 L over 15 days

    const open = rmHarness({
      cycles: {
        listFor: jest.fn(async () => [cycleRow({ status: 'open', billsGeneratedAt: null })]),
        byId: jest.fn(async () => cycleRow({ status: 'open', billsGeneratedAt: null })),
        today: jest.fn(async () => '2026-07-13'),
      },
    });
    const v = await open.rm.view('t1', actor, {});
    expect(v.cycle.stage).toBe('accruing');
    expect(v.accrual.days).toBe(13);                            // "accrued to 13 Jul", not to the 15th
    expect(v.page.rows[0].litresPerDay).toBe('11.400');         // 148.2 / 13
    expect(v.lastCycle).toBeNull();                             // no earlier fortnight in this harness
  });

  it('encodes the next page as a keyset cursor over gross and id', async () => {
    const v = await rmHarness().rm.view('t1', actor, {});
    expect(Buffer.from(v.page.nextCursor!, 'base64').toString('utf8')).toBe('786000|b1');
  });

  it('asks the 30-day average for the page\'s memberships in ONE call', async () => {
    const h = rmHarness();
    await h.rm.view('t1', actor, {});
    expect(h.deps.console_.avg30d).toHaveBeenCalledTimes(1);
    expect(h.deps.console_.avg30d).toHaveBeenCalledWith('t1', ['m1'], '2026-07-15');
  });

  it('carries the bonus the pricing engine still ignores onto the screen where money is agreed', async () => {
    const v = await rmHarness().rm.view('t1', actor, {});
    expect(v.accrual.bonusRulesIgnored).toBe(true);
    const none = rmHarness({ counter: { currencyCode: jest.fn(async () => 'INR'), accrual: jest.fn(async () => ({ amountMinor: 1n, membersWithPours: 1, cardsWithBonusRules: 0 })), billsInWindow: jest.fn(async () => 0) } });
    expect((await none.rm.view('t1', actor, {})).accrual.bonusRulesIgnored).toBe(false);
  });

  it('answers a cooperative with no cycle at all without pretending it is empty of milk', async () => {
    const h = rmHarness({ cycles: { listFor: jest.fn(async () => []), byId: jest.fn(async () => null), today: jest.fn(async () => '2026-07-13') } });
    const v = await h.rm.view('t1', actor, {});
    expect(v.cycles).toEqual([]);
    expect(v.cycle.status).toBe('none');
    expect(v.acts.preview.refusal).toBe('WRONG_STAGE');   // the flag is on in the harness; there is nothing to preview
    expect(v.consent.consentPct).toBe(30);                // the tenant's settings are still read and still stated
    // And no register query was run for a cycle that does not exist.
    expect(h.deps.console_.bills).not.toHaveBeenCalled();
  });

  it('opens the fortnight with work to do, not the one that opened this morning', async () => {
    // [found live] `ensureCycles` keeps the window that just ended AND the one now running, so "newest" is an empty
    // cycle with every act refused, while the fortnight the operator came to preview is one row down.
    const h = rmHarness({
      cycles: {
        listFor: jest.fn(async () => [
          cycleRow({ id: 'cycle-open', status: 'open', periodStart: '2026-07-16', periodEnd: '2026-07-31', billsGeneratedAt: null }),
          cycleRow({ id: 'cycle-work', status: 'closed' }),
        ]),
        byId: jest.fn(async () => cycleRow({ status: 'closed' })),
        today: jest.fn(async () => '2026-07-17'),
      },
    });
    const v = await h.rm.view('t1', actor, {});
    expect(v.cycle.id).toBe('cycle-work');
    expect(v.acts.preview.can).toBe(true);
    // The picker still lists both, newest first, so the accruing fortnight is one click away.
    expect(v.cycles.map((c) => c.id)).toEqual(['cycle-open', 'cycle-work']);
  });

  it('falls back to the newest cycle when every fortnight is settled', async () => {
    const h = rmHarness({
      cycles: {
        listFor: jest.fn(async () => [
          cycleRow({ id: 'cycle-open', status: 'open', billsGeneratedAt: null }),
          cycleRow({ id: 'cycle-done', status: 'approved' }),
        ]),
        byId: jest.fn(async () => cycleRow({ status: 'open' })),
        today: jest.fn(async () => '2026-07-17'),
      },
    });
    expect((await h.rm.view('t1', actor, {})).cycle.id).toBe('cycle-open');
  });

  it('refuses the whole console without the dairy desk, the same way every other read in this module does', async () => {
    const h = rmHarness();
    await expect(h.rm.view('t1', { userId: 'u1', canManage: false, canCloseSettlement: true }, {})).rejects.toBeDefined();
    // ...and nothing was read on the way to the refusal.
    expect(h.deps.console_.bills).not.toHaveBeenCalled();
  });

  it('opens the cycle it was asked for, and refuses one that is not this tenant\'s', async () => {
    const h = rmHarness();
    await h.rm.view('t1', actor, { cycleId: 'cycle-prev' });
    expect(h.deps.cycles.byId).toHaveBeenCalled();
    const missing = rmHarness({ cycles: { listFor: jest.fn(async () => [cycleRow()]), byId: jest.fn(async () => null), today: jest.fn(async () => '2026-07-13') } });
    // A 404, not an empty register: an id that is not this tenant's must not silently show them somebody else's
    // fortnight — and must not leak whether it exists either, which is why the message carries no id.
    await expect(missing.rm.view('t1', actor, { cycleId: 'cycle-elsewhere' })).rejects.toBeInstanceOf(BillCycleNotFoundError);
  });

  it('finds the PREVIOUS cycle by window, not by list position', async () => {
    const h = rmHarness({
      cycles: {
        // Deliberately out of order, and with a different cadence in the middle: a "second row" heuristic breaks here.
        listFor: jest.fn(async () => [
          cycleRow({ status: 'closed' }),
          cycleRow({ id: 'cycle-weekly', paymentCycle: 'weekly', periodStart: '2026-07-06', periodEnd: '2026-07-12' }),
          cycleRow({ id: 'cycle-prev', periodStart: '2026-06-16', periodEnd: '2026-06-30' }),
        ]),
        byId: jest.fn(async () => cycleRow({ status: 'closed' })),
        today: jest.fn(async () => '2026-07-13'),
      },
    });
    const v = await h.rm.view('t1', actor, {});
    expect(v.lastCycle?.id).toBe('cycle-prev');
    expect(h.deps.disputes.countsForCycle).toHaveBeenCalledWith('t1', 'cycle-prev');
  });
});
