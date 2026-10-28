// apps/web-partner/src/test/lender-figures.spec.ts · PC-56 PARTNER-2c · THE LENDER'S SHELF — the terms row model (features/partner2/figures.ts):
// rates are the lender's own stored INTEGER basis points printed as integers (never a percentage, never a float), the net is the server's integer
// difference, the amount range keeps the bigint minor-unit strings and the product's own currency, the tenure is a range / floor / ceiling / "not
// set", the kind is the registry code or "kind not registered", the documents are their codes only when every id resolves, the 30-day count is
// an integer, and the page state is OFF as OFF.
import { bpsInt, documentsText, lenderTermsRow, originationFee, shelfState, tenureText } from '../features/partner2/figures';

const P = {
  id: '0192d2c4-1111-7000-8000-000000000001', defaultName: 'Fixture seasonal credit', kind: { code: 'crop' }, currencyCode: 'INR', minAmountMinor: '5000000',
  maxAmountMinor: '9007199254740993', interestAprBps: 725, subventionBps: 300, netAprBps: 425, tenureMonthsMin: 6, tenureMonthsMax: 12, repaymentStyle: 'harvest_aligned',
  collateralKind: 'none', applications30d: 3, active: true,
};

describe('PC-56 PARTNER-2c · the lender\'s terms row model', () => {
  it('the APR, subvention and net are the stored integers as text — no percentage sign, no decimal point', () => {
    const r = lenderTermsRow(P);
    expect(r.apr).toEqual({ key: 'partner2.loanProducts.aprLine', vars: { apr: '725', subvention: '300', net: '425' } });
    for (const v of Object.values(r.apr.vars)) { expect(v).toMatch(/^-?\d+$/); expect(v).not.toMatch(/%|\./); }
    expect(lenderTermsRow({ ...P, interestAprBps: 200, subventionBps: 300, netAprBps: -100 }).apr.vars.net).toBe('-100');
    expect([bpsInt(1100), bpsInt(0), bpsInt(7.25), bpsInt(null), bpsInt(undefined)]).toEqual(['1100', '0', '0', '0', '0']);
  });
  it('the amount range keeps the bigint minor strings and the product\'s own currency; the link carries the id', () => {
    const r = lenderTermsRow({ ...P, currencyCode: 'USD' });
    expect(r.amount).toEqual({ min: '5000000', max: '9007199254740993', currency: 'USD' });
    expect(lenderTermsRow({ ...P, currencyCode: '' }).amount.currency).toBe('INR');
    expect(r.href).toBe(`/lender/products/${P.id}`);
    expect(r.name).toBe('Fixture seasonal credit');
  });
  it('the kind is the registry code, or "kind not registered"', () => {
    expect(lenderTermsRow(P).kind).toEqual({ code: 'crop' });
    expect(lenderTermsRow({ ...P, kind: { code: null } }).kind).toEqual({ key: 'partner2.loanProducts.kindNotRegistered' });
  });
  it('the tenure: a range, a floor, a ceiling or not set — whole months only', () => {
    expect(tenureText(6, 12)).toEqual({ key: 'partner2.loanProducts.tenureRange', vars: { min: '6', max: '12' } });
    expect(tenureText(6, null)).toEqual({ key: 'partner2.loanProducts.tenureFrom', vars: { min: '6' } });
    expect(tenureText(null, 12)).toEqual({ key: 'partner2.loanProducts.tenureUpTo', vars: { max: '12' } });
    expect(tenureText(null, null)).toEqual({ key: 'partner2.loanProducts.tenureNone', vars: {} });
    expect(tenureText(1.5, undefined)).toEqual({ key: 'partner2.loanProducts.tenureNone', vars: {} });
  });
  it('the documents: codes only when every stored id resolves, else the count; none → "none recorded"', () => {
    expect(documentsText({ count: 2, codes: ['aadhaar', 'land_record'] })).toEqual({ key: 'partner2.loanProducts.docsCodes', vars: { codes: 'aadhaar, land_record' } });
    expect(documentsText({ count: 2, codes: ['aadhaar'] })).toEqual({ key: 'partner2.loanProducts.docsCount', vars: { count: '2' } });
    expect(documentsText({ count: 0, codes: [] })).toEqual({ key: 'partner2.loanProducts.docsNone', vars: {} });
    expect(documentsText(null)).toEqual({ key: 'partner2.loanProducts.docsNone', vars: {} });
  });
  it('the origination fee is data: a minor string and integer bps in the product\'s currency (a malformed amount prints zero, never a float)', () => {
    expect(originationFee({ originationFeeMinor: '150000', originationFeeBps: 50, currencyCode: 'INR' })).toEqual({ minor: '150000', bps: '50', currency: 'INR' });
    expect(originationFee({ originationFeeMinor: '1.5', originationFeeBps: 0.5, currencyCode: '' })).toEqual({ minor: '0', bps: '0', currency: 'INR' });
  });
  it('the 30-day figure is an integer count; the page state is OFF as OFF, error, empty or ok', () => {
    expect(lenderTermsRow(P).applications30d).toBe(3);
    expect(lenderTermsRow({ ...P, applications30d: 2.5 }).applications30d).toBe(0);
    expect([shelfState([P], null), shelfState([], null), shelfState(null, null), shelfState([P], 'off'), shelfState([], 'error')]).toEqual(['ok', 'empty', 'error', 'off', 'error']);
  });
});

// ══ PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — features/partner4/figures.ts ═══════════════════════════════════════════════════════
// The server computes every figure; this block pins what the presentational layer may and may not do with them. The load-bearing assertion is
// the last one: a SOURCE SCAN proving no function in the file can emit a "%" — there is no rate, no ratio, no average and no
// portfolio-at-risk figure anywhere on a lending page (founder 4a-5 / 4a-7, survey E9). M8 plants one and this file plus the portfolio render
// test both turn red.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  APPLICATION_STATUSES, APPLICATION_STATUSES_VISIBLE, LOAN_KIND_CODES, LOAN_STATUSES, NOT_RECORDED, REFUSED_APPLICATION_STATUSES,
  aprLine, countsState, headlineFigures, isLoanStatus, kindLabel, kindRows, listState, loanRef, loanStatusKey, loanStatusTone,
  maturityText, netAprLine, nextDueText, portfolioHref, portfolioQuery, queueHref, queueQuery, statusRows, windowLabel,
  arrearsKey, arrearsReason, arrearsReasonKey, arrearsRows, batchHref, collectedFigures, lenderSwitchState, pipelineRows,
  pipelineState, servicingState, ARREARS_ROWS, PENDING_BATCH, PIPELINE_CHIPS,
} from '../features/partner4/figures';

const COUNTS = {
  from: '2026-04-01', to: '2027-04-01', fy: '2026-27', total: 7,
  byStatus: { active: 3, overdue: 1, restructured: 1, closed: 1, written_off: 1 },
  byKind: { crop: 4, dairy: 1, kcc: 1, [NOT_RECORDED]: 1 },
  outstandingByKindMinor: { crop: '400000', dairy: '100000', kcc: '10000', [NOT_RECORDED]: '0' },
  principalByKindMinor: { crop: '800000', dairy: '160000', kcc: '70000', [NOT_RECORDED]: '5000' },
  servicing: { count: 4, outstandingMinor: '450000' },
  restructured: 1, writtenOff: { count: 1, outstandingMinor: '10000' },
  computedAt: '2026-10-28T06:30:00.000Z',
};

describe('PC-56 PARTNER-4a · the lending vocabularies', () => {
  it('FIVE loan statuses and NINE kinds; `transferred`, `docs_pending` and `closed`-as-an-application-state are not offered', () => {
    expect(LOAN_STATUSES).toEqual(['active', 'overdue', 'restructured', 'closed', 'written_off']);
    expect(isLoanStatus('transferred')).toBe(false);
    expect(loanStatusKey('transferred')).toBe('partner4.status.unknown');
    expect(loanStatusKey('active')).toBe('partner4.status.active');
    expect([loanStatusTone('active'), loanStatusTone('overdue'), loanStatusTone('restructured'), loanStatusTone('closed'), loanStatusTone('transferred')]).toEqual(['ok', 'warn', 'info', 'muted', 'muted']);
    expect(LOAN_KIND_CODES.length).toBe(9);
    expect(APPLICATION_STATUSES.length).toBe(7);
    expect(APPLICATION_STATUSES_VISIBLE).toEqual(['submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'disbursed']);
    expect(REFUSED_APPLICATION_STATUSES).toEqual(['docs_pending', 'closed']);
    for (const r of REFUSED_APPLICATION_STATUSES) expect([r, (APPLICATION_STATUSES as readonly string[]).includes(r)]).toEqual([r, false]);
    expect(kindLabel(null)).toEqual({ key: 'partner4.kind.notRecorded' });
    expect(kindLabel('crop')).toEqual({ key: 'partner4.kind.crop' });
    expect(kindLabel('jlg')).toEqual({ raw: 'jlg' });           // named in a schema comment, never seeded — printed as stored, never invented
  });
  it('a reference is the id\'s head — there is no loan number on this platform', () => {
    expect(loanRef('0192d2c4-c001-7000-8000-000000000001')).toBe('0192d2c4…');
  });
});

describe('PC-56 PARTNER-4a · rates are INTEGER basis points, never a percentage', () => {
  it('the loan\'s stamped rate and the product\'s three-part line are integers; a negative subsidy difference prints as the negative integer it is', () => {
    expect(aprLine(1050)).toEqual({ key: 'partner4.loan.aprLine', vars: { apr: '1050' } });
    expect(aprLine(10.5)).toEqual({ key: 'partner4.loan.aprLine', vars: { apr: '0' } });       // a float is not a rate this platform holds
    expect(netAprLine(700, 300).vars).toEqual({ apr: '700', subvention: '300', net: '400' });
    expect(netAprLine(300, 700).vars).toEqual({ apr: '300', subvention: '700', net: '-400' }); // a product priced BELOW its own subsidy
    expect(netAprLine(0, 0).vars).toEqual({ apr: '0', subvention: '0', net: '0' });
    expect(netAprLine(7.25, 3).vars).toEqual({ apr: '0', subvention: '3', net: '-3' });
    for (const v of Object.values(netAprLine(700, 300).vars)) expect(/^-?\d+$/.test(v)).toBe(true);
  });
});

describe('PC-56 PARTNER-4a · the dates this platform does not hold', () => {
  it('a missing maturity and a missing next due date are SENTENCES, never a dash and never a guess', () => {
    expect(maturityText(null)).toEqual({ key: 'partner4.loan.noMaturity' });
    expect(maturityText(undefined)).toEqual({ key: 'partner4.loan.noMaturity' });
    expect(maturityText('2029-02-09')).toEqual({ key: 'partner4.loan.maturity', vars: { date: '2029-02-09' } });
    expect(nextDueText(null)).toEqual({ key: 'partner4.loan.noNextDue' });
    expect(nextDueText('2026-07-17')).toEqual({ key: 'partner4.loan.nextDue', vars: { date: '2026-07-17' } });
  });
  it('a date reaches this layer as the calendar day the API already read with pgDate — nothing here re-parses one into a Date', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'partner4', 'figures.ts'), 'utf8');
    for (const [name, re] of [['new Date', /new Date\(/], ['toISOString', /toISOString/], ['Date.parse', /Date\.parse/], ['getFullYear', /getFullYear/]] as const) {
      expect([name, re.test(src)]).toEqual([name, false]);
    }
  });
});

describe('PC-56 PARTNER-4a · the counts: integers and bigint strings, and the FY label the SERVER answered', () => {
  it('the window label is the server\'s FY or the two days — never the browser\'s clock', () => {
    expect(windowLabel(COUNTS)).toEqual({ key: 'partner4.portfolio.fy', vars: { fy: '2026-27' } });
    expect(windowLabel({ from: '2026-01-01', to: '2026-02-01', fy: null })).toEqual({ key: 'partner4.portfolio.window', vars: { from: '2026-01-01', to: '2026-02-01' } });
    expect(windowLabel(null)).toBeNull();
  });
  it('the four headline figures are a COUNT and, for two of them, a bigint minor-unit string — no average, no ratio', () => {
    expect(headlineFigures(COUNTS).map((f) => [f.id, f.count, f.minor])).toEqual([
      ['servicing', 4, '450000'], ['opened', 7, null], ['restructured', 1, null], ['written_off', 1, '10000']]);
    expect(headlineFigures(null).map((f) => [f.count, f.minor])).toEqual([[0, '0'], [0, null], [0, null], [0, '0']]);
    for (const f of headlineFigures(COUNTS)) {
      expect([f.id, Number.isInteger(f.count)]).toEqual([f.id, true]);
      if (f.minor !== null) expect([f.id, /^-?\d+$/.test(f.minor)]).toEqual([f.id, true]);
    }
  });
  it('bigint sums over 2,000 loans of ₹50,000 stay exact past Number.MAX_SAFE_INTEGER', () => {
    const big = (BigInt('5000000') * 2000n).toString();
    const rows = kindRows({ ...COUNTS, byKind: { crop: 2000 }, outstandingByKindMinor: { crop: big }, principalByKindMinor: { crop: '9007199254740993' } });
    const crop = rows.find((r) => r.code === 'crop');
    expect(crop?.outstandingMinor).toBe('10000000000');
    expect(crop?.principalMinor).toBe('9007199254740993');
    // the point of keeping it a STRING: the same value through a JS number comes back a paisa short
    expect(String(Number(crop?.principalMinor))).toBe('9007199254740992');
    expect(crop?.principalMinor).not.toBe(String(Number(crop?.principalMinor)));
  });
  it('the kind rows are the nine codes, then any extra the server answered, then "not recorded" LAST — no bucket, no share', () => {
    const rows = kindRows({ ...COUNTS, byKind: { ...COUNTS.byKind, jlg: 2 } });
    expect(rows.map((r) => r.code)).toEqual([...LOAN_KIND_CODES, 'jlg', NOT_RECORDED]);
    expect(rows[rows.length - 1].code).toBe(NOT_RECORDED);
    for (const r of rows) {
      expect([r.code, Number.isInteger(r.n)]).toEqual([r.code, true]);
      expect([r.code, /^-?\d+$/.test(r.outstandingMinor), /^-?\d+$/.test(r.principalMinor)]).toEqual([r.code, true, true]);
    }
    expect(kindRows(null).every((r) => r.n === 0 && r.outstandingMinor === '0')).toBe(true);
    // a malformed amount degrades to zero rather than to NaN or to a float
    expect(kindRows({ ...COUNTS, outstandingByKindMinor: { crop: '4.5' } }).find((r) => r.code === 'crop')?.outstandingMinor).toBe('0');
  });
  it('the status rows are the five the platform can produce, 0 when none; a count is never a float', () => {
    expect(statusRows(COUNTS.byStatus).map((r) => [r.status, r.n])).toEqual([['active', 3], ['overdue', 1], ['restructured', 1], ['closed', 1], ['written_off', 1]]);
    expect(statusRows({ active: 2.5, overdue: -1 }).map((r) => r.n)).toEqual([0, 0, 0, 0, 0]);
    expect(statusRows(undefined).map((r) => r.n)).toEqual([0, 0, 0, 0, 0]);
  });
  it('the page states: OFF as OFF, empty when nothing was opened in the window', () => {
    expect([countsState(COUNTS, null), countsState({ total: 0 }, null), countsState(null, null), countsState(COUNTS, 'off'), countsState(COUNTS, 'error')]).toEqual(['ok', 'empty', 'error', 'off', 'error']);
    expect([listState([1], null), listState([], null), listState(null, null), listState([1], 'off')]).toEqual(['ok', 'empty', 'error', 'off']);
  });
});

describe('PC-56 PARTNER-4a · only a whitelisted filter and an opaque cursor ever enter a URL', () => {
  it('the queue: a box, a status of the application machine, a URL-safe cursor — nothing else, and the default box is omitted', () => {
    expect(queueHref('review')).toBe('/lender/queue');
    expect(queueHref('all')).toBe('/lender/queue?box=all');
    expect(queueHref('review', 'under_review')).toBe('/lender/queue?status=under_review');
    expect(queueHref('all', 'approved', 'Y3Vyc29y')).toBe('/lender/queue?box=all&status=approved&cursor=Y3Vyc29y');
    expect(queueHref('review', 'docs_pending')).toBe('/lender/queue');            // a status the machine cannot reach never enters the URL
    expect(queueHref('review', undefined, 'not a cursor!')).toBe('/lender/queue'); // a malformed cursor is dropped, never echoed
    expect(queueQuery({ box: 'mine', status: 'nope', cursor: 'x'.repeat(201) })).toEqual({ box: 'review', status: undefined, cursor: undefined });
    expect(queueQuery({ box: ['all'], status: ['approved'], cursor: ['Y3Vyc29y'] })).toEqual({ box: 'all', status: 'approved', cursor: 'Y3Vyc29y' });
    expect(queueQuery(undefined)).toEqual({ box: 'review', status: undefined, cursor: undefined });
  });
  it('the portfolio: a loan status of the five, a URL-safe cursor — and never `transferred`', () => {
    expect(portfolioHref()).toBe('/lender/portfolio');
    expect(portfolioHref('overdue')).toBe('/lender/portfolio?status=overdue');
    expect(portfolioHref('transferred')).toBe('/lender/portfolio');
    expect(portfolioQuery({ status: 'transferred' })).toEqual({ status: undefined, cursor: undefined });
    expect(portfolioQuery({ status: 'written_off', cursor: 'Y3Vyc29y' })).toEqual({ status: 'written_off', cursor: 'Y3Vyc29y' });
  });
});

describe('PC-56 PARTNER-4a · NO function in features/partner4/figures.ts can emit a percentage', () => {
  it('the source carries no "%", no percent word and no division that would make a share (M8 kills here)', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'features', 'partner4', 'figures.ts'), 'utf8');
    // strip the comments: the file EXPLAINS why it prints no percentage, and the word may appear there
    const code = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const [name, re] of [['%', /%/], ['percent', /percent/i], ['toFixed', /toFixed/], ['/ 100', /\/\s*100\b/], ['ratio', /ratio/i], ['average', /average/i], ['Math.round', /Math\.round/]] as const) {
      expect([name, re.test(code)]).toEqual([name, false]);
    }
  });
  it('and no VALUE any of its functions returns carries one, over every shape this wave prints', () => {
    const emitted = JSON.stringify([
      aprLine(1050), netAprLine(700, 300), maturityText(null), maturityText('2029-02-09'), nextDueText(null),
      windowLabel(COUNTS), headlineFigures(COUNTS), statusRows(COUNTS.byStatus), kindRows(COUNTS),
      queueHref('all', 'approved', 'Y3Vyc29y'), portfolioHref('overdue', 'Y3Vyc29y'), loanRef('0192d2c4-c001-7000-8000-000000000001'),
    ]);
    expect(emitted).not.toContain('%');
  });
});

// ══ PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE — the pipeline counts, the collected window and the arrears buckets ══════════════════
const ARREARS = {
  buckets: {
    '1-30': { count: 0, outstandingMinor: '0' }, '31-60': { count: 0, outstandingMinor: '0' },
    '61-90': { count: 0, outstandingMinor: '0' }, '90+': { count: 0, outstandingMinor: '0' },
    not_due: { count: 0, outstandingMinor: '0' }, no_due_date: { count: 7, outstandingMinor: '9007199254740993' },
  },
  arrears: { count: 0, outstandingMinor: '0' },
  noDueDate: { count: 7, outstandingMinor: '9007199254740993' },
  servicing: { count: 7, outstandingMinor: '9007199254740993' },
  noScheduleOnPlatform: true,
  computedAt: '2026-10-28T06:00:00.000Z',
};
const COLLECTED = { from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', repayments: 3, amountPaidMinor: '150000', loans: 2, computedAt: '2026-10-28T06:00:00.000Z' };
const PIPE = { from: '2026-04-01', to: '2027-04-01', timeZone: 'Asia/Kolkata', fy: '2026-27', ready: 8, coolingOff: 6, disbursed: 61, approved: 14, pipeline: 75, computedAt: '2026-10-28T06:00:00.000Z' };

describe('PC-56 PARTNER-4b · the pipeline, the collected window and the arrears buckets', () => {
  it('the four pipeline chips are the server\'s own integers, in the canon\'s order, and a missing figure is 0 — never a share', () => {
    expect(PIPELINE_CHIPS).toEqual(['pipeline', 'ready', 'coolingOff', 'disbursed']);
    expect(pipelineRows(PIPE).map((r) => [r.id, r.key, r.n])).toEqual([
      ['pipeline', 'partner4.pipeline.pipeline', 75], ['ready', 'partner4.pipeline.ready', 8],
      ['coolingOff', 'partner4.pipeline.coolingOff', 6], ['disbursed', 'partner4.pipeline.disbursed', 61]]);
    expect(pipelineRows(null).map((r) => r.n)).toEqual([0, 0, 0, 0]);
    // a float, a negative or a string never reaches the page as itself
    expect(pipelineRows({ ...PIPE, ready: 1.5, coolingOff: -3, disbursed: '61' as unknown as number }).map((r) => r.n)).toEqual([75, 0, 0, 0]);
    expect([pipelineState(PIPE, null), pipelineState({ ...PIPE, pipeline: 0 }, null), pipelineState(null, null), pipelineState(PIPE, 'off'), pipelineState(null, 'error')])
      .toEqual(['ok', 'empty', 'error', 'off', 'error']);
  });
  it('the SIX arrears buckets are disjoint and in order, with bigint sums kept exact; `not_due` and `no_due_date` are NOT arrears', () => {
    expect(ARREARS_ROWS).toEqual(['1-30', '31-60', '61-90', '90+', 'not_due', 'no_due_date']);
    const rows = arrearsRows(ARREARS);
    expect(rows.map((r) => [r.bucket, r.key, r.arrears, r.n, r.outstandingMinor])).toEqual([
      ['1-30', 'partner4.arrears.bucket.1_30', true, 0, '0'],
      ['31-60', 'partner4.arrears.bucket.31_60', true, 0, '0'],
      ['61-90', 'partner4.arrears.bucket.61_90', true, 0, '0'],
      ['90+', 'partner4.arrears.bucket.90plus', true, 0, '0'],
      ['not_due', 'partner4.arrears.bucket.not_due', false, 0, '0'],
      ['no_due_date', 'partner4.arrears.bucket.no_due_date', false, 7, '9007199254740993'],
    ]);
    // the sum is a bigint STRING all the way to the view: beyond Number.MAX_SAFE_INTEGER it is still exact
    expect(rows[5].outstandingMinor).toBe('9007199254740993');
    expect(String(Number(rows[5].outstandingMinor))).not.toBe(rows[5].outstandingMinor);   // a float would lose the last rupee
    expect(arrearsRows(null).map((r) => [r.n, r.outstandingMinor])).toEqual(Array(6).fill([0, '0']));
    expect([arrearsKey('1-30'), arrearsKey('90+'), arrearsKey('no_due_date')])
      .toEqual(['partner4.arrears.bucket.1_30', 'partner4.arrears.bucket.90plus', 'partner4.arrears.bucket.no_due_date']);
  });
  it('THE ALL-ZERO TRUTH: when no loan has a due date the page says WHY, and it says something different in each of the four cases', () => {
    expect(arrearsReason(ARREARS)).toBe('noDates');
    expect(arrearsReason({ ...ARREARS, servicing: { count: 0, outstandingMinor: '0' }, noDueDate: { count: 0, outstandingMinor: '0' } })).toBe('none');
    expect(arrearsReason({ ...ARREARS, noDueDate: { count: 3, outstandingMinor: '0' } })).toBe('someDates');
    expect(arrearsReason({ ...ARREARS, noDueDate: { count: 0, outstandingMinor: '0' } })).toBe('dates');
    expect(arrearsReason(null)).toBe('none');
    expect(new Set((['none', 'noDates', 'someDates', 'dates'] as const).map(arrearsReasonKey)).size).toBe(4);
    for (const r of ['none', 'noDates', 'someDates', 'dates'] as const) expect(arrearsReasonKey(r)).toBe(`partner4.arrears.why.${r}`);
  });
  it('the collected window is a count, a bigint sum and a count of loans — never an average and never a rate', () => {
    expect(collectedFigures(COLLECTED).map((f) => [f.id, f.count, f.minor])).toEqual([
      ['collected', 3, '150000'], ['loans', 2, null]]);
    expect(collectedFigures({ ...COLLECTED, amountPaidMinor: '9007199254740993' })[0].minor).toBe('9007199254740993');
    expect(collectedFigures({ ...COLLECTED, amountPaidMinor: 'oops' as string })[0].minor).toBe('0');
    expect(collectedFigures(null).map((f) => [f.count, f.minor])).toEqual([[0, '0'], [0, null]]);
    // the window label is the server's FY or its two IST days — never computed here
    expect(windowLabel(COLLECTED)).toEqual({ key: 'partner4.portfolio.fy', vars: { fy: '2026-27' } });
    expect(windowLabel({ ...COLLECTED, fy: null })).toEqual({ key: 'partner4.portfolio.window', vars: { from: '2026-04-01', to: '2027-04-01' } });
    expect([servicingState(ARREARS, COLLECTED, null), servicingState({ ...ARREARS, servicing: { count: 0, outstandingMinor: '0' } }, { ...COLLECTED, repayments: 0 }, null),
      servicingState(null, COLLECTED, null), servicingState(ARREARS, COLLECTED, 'off')]).toEqual(['ok', 'empty', 'error', 'off']);
  });
  it('W218 has no read, so its state is the platform\'s flag map — and NEVER "lending is switched off"', () => {
    expect([lenderSwitchState({ partner_console: true }), lenderSwitchState({ partner_console: false }), lenderSwitchState({}), lenderSwitchState(null)])
      .toEqual(['ok', 'off', 'error', 'error']);
    // the `fintech` flag is a TENANT module switch this realm does not consult: it changes nothing here
    expect(lenderSwitchState({ partner_console: true, fintech: false })).toBe('ok');
    expect([PENDING_BATCH, batchHref(), batchHref('0192d2c4-c001-7000-8000-000000000001'), batchHref('a b/c')])
      .toEqual(['pending', '/lender/disbursements/pending', '/lender/disbursements/0192d2c4-c001-7000-8000-000000000001', '/lender/disbursements/a%20b%2Fc']);
  });
  it('and no 4b figure can emit a percentage, over every shape these three pages print', () => {
    const emitted = JSON.stringify([pipelineRows(PIPE), arrearsRows(ARREARS), collectedFigures(COLLECTED),
      arrearsReason(ARREARS), windowLabel(COLLECTED), batchHref()]);
    expect(emitted).not.toContain('%');
    expect(emitted).not.toMatch(/percent|ratio|average|onTime|dpd/i);
  });
});
