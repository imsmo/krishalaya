// apps/web-tenant/src/test/tenant6c6-cycles.spec.ts · W169 (Dairy payout cycles) — PC-56 TENANT-6c-6.
//
// The view-model is where every sentence this screen can say is CHOSEN, so this suite's job is that each one exists in
// all three launch languages and that no branch can render a raw key in front of a dairy secretary. Plus the two
// claims this wave repaired: the dairy sub-nav's `cycles` entry is finally built, and W167's payday tile stops telling
// operators the platform cannot record a payday — it has recorded one since migration 0157.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DairyCycleAct, DairyCycleBillRow, DairyCycleConsole, DairyPayday } from '@krishalaya/sdk-js';
import {
  CYCLES_HREF, actCautionKey, actRefusalKey, actTone, billStatusKey, billStatusTone, bonusIgnoredKey, consentParts,
  cycleHref, cyclesState, cyclesStateKey, deductionParts, deductionsNoteKey, directionKey, disputesKey,
  flipDirection, memberLabel, nextHref, paceParts, pagingText, paydayNoteKey, registerNoteKey, rowWarningKey,
  stageKey, stageTone,
} from '../features/dairy/cycles';
import { DAIRY_NAV, currentDairyNavKey, dairyUnbuiltCount } from '../features/dairy/nav';
import { paydayKey } from '../features/dairy/counter';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const REFUSALS = ['FLAG_OFF', 'NO_MANAGE', 'NO_SETTLEMENT_CLOSE', 'WRONG_STAGE', 'NOTHING_LEFT', 'MAKER_IS_CHECKER'] as const;
const CAUTIONS = ['BILLS_NOT_BUILT', 'DISPUTES_OPEN'] as const;
const STAGES = ['accruing', 'closed_unbilled', 'billed', 'previewed', 'approved'] as const;
const BILL_STATUSES = ['draft', 'previewed', 'disputed', 'approved', 'paid', 'voided'] as const;

const row = (o: Partial<DairyCycleBillRow> = {}): DairyCycleBillRow => ({
  billId: 'b1', membershipId: 'm1', memberName: 'Savita Ben M.', memberCodeMasked: 'AND3••19',
  // [TENANT-6d-3] `mccCode` (the membership's CURRENT centre) became the centres the milk was POURED at.
  pouredCentres: [{ mccId: 'c3', code: 'MCC-AND-03', pours: 28 }], spansCentres: false, memberCodeIsCurrent: false,
  litres: '148.200', litresPerDay: '9.880', avg30d: '14.200', avg30dDays: 4,
  grossMinor: '786000', deductionsMinor: '124000', netMinor: '662000',
  deductions: [{ typeCode: 'loan_emi', typeName: 'Loan instalment', amountMinor: '124000', lines: 1, applied: 1, unsupportedReason: null }],
  status: 'draft', disputeWindowEnds: null, openDisputes: 0, needsFreshConsent: false, memberRefusedBelowLine: false, ...o,
});

const view = (o: Partial<DairyCycleConsole> = {}): DairyCycleConsole => ({
  currencyCode: 'INR', today: '2026-07-13',
  cycle: {
    id: 'c1', paymentCycle: 'fortnightly', periodStart: '2026-07-01', periodEnd: '2026-07-15',
    closesAt: '2026-07-15T18:29:00.000Z', payday: '2026-07-17', status: 'closed', stage: 'billed',
    previewedAt: null, previewedBy: null, approvedAt: null, approvedBy: null,
    billsGeneratedAt: '2026-07-15T18:31:00.000Z', billCounts: { draft: 312 }, billsTotal: 312,
  },
  cycles: [{ id: 'c1', paymentCycle: 'fortnightly', periodStart: '2026-07-01', periodEnd: '2026-07-15', status: 'closed', payday: '2026-07-17', billsTotal: 312 }],
  accrual: { amountMinor: '248820000', membersWithPours: 312, days: 15, billsExisting: 312, bonusRulesIgnored: false },
  deductions: { totalMinor: '18430000', byTypeCode: { feed_credit: '5000000' }, needingConsent: 0, assemblyOn: true },
  payday: { payday: '2026-07-17', batchBuilt: false, paid: 0, awaitingPayment: 0 },
  lastCycle: { id: 'c0', periodStart: '2026-06-16', periodEnd: '2026-06-30', disputes: { total: 2, open: 0, resolvedBeforePayday: 2, bills: 309, allResolvedBeforePayday: true } },
  totals: { bills: 312, grossMinor: '248820000', deductionsMinor: '18430000', netMinor: '230390000', litres: '4500.000' },
  page: { rows: [row()], nextCursor: null, totals: { grossMinor: '786000', deductionsMinor: '124000', netMinor: '662000', litres: '148.200', rows: 1 } },
  consent: { consentPct: 25, assemblyPct: 25, automaticPct: 25 },
  acts: { preview: { can: true, refusal: null, caution: null }, approve: { can: false, refusal: 'WRONG_STAGE', caution: null } },
  cadenceOn: true, openDisputes: 0, ...o,
});

const act = (o: Partial<DairyCycleAct> = {}): DairyCycleAct => ({ can: true, refusal: null, caution: null, ...o });

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-6c-6 · W169 the payout-cycle console', () => {
  it('names every stage a cycle can be in, in all three languages', () => {
    for (const s of STAGES) expect(hasKey(stageKey(s))).toBe(true);
    // `closed_unbilled` is amber: nothing is wrong, and nothing has happened yet either.
    expect(stageTone('closed_unbilled')).toBe('warn');
    expect(stageTone('approved')).toBe('ok');
    expect(stageTone('accruing')).toBe('muted');
  });

  it('names every refusal and caution the API can send — a raw key would reach an operator otherwise', () => {
    for (const r of REFUSALS) expect(hasKey(actRefusalKey(act({ can: false, refusal: r }))!)).toBe(true);
    for (const c of CAUTIONS) expect(hasKey(actCautionKey(act({ caution: c }))!)).toBe(true);
    expect(actRefusalKey(act())).toBeNull();
    expect(actCautionKey(act())).toBeNull();
    expect(hasKey('dairy.cycles.act.ready')).toBe(true);
  });

  it('does not colour "a colleague must sign this" like a broken switch', () => {
    // A working maker-checker cooperative is amber, not the grey of "ask the platform team".
    expect(actTone(act({ can: false, refusal: 'MAKER_IS_CHECKER' }))).toBe('warn');
    expect(actTone(act({ can: false, refusal: 'NOTHING_LEFT' }))).toBe('warn');
    expect(actTone(act({ can: false, refusal: 'FLAG_OFF' }))).toBe('muted');
    expect(actTone(act({ can: false, refusal: 'NO_MANAGE' }))).toBe('muted');
    expect(actTone(act())).toBe('ok');
    expect(actTone(act({ caution: 'DISPUTES_OPEN' }))).toBe('warn');
  });

  it('explains an empty register instead of letting it read as "nobody poured"', () => {
    expect(registerNoteKey(view({ cycle: { ...view().cycle, stage: 'accruing' } }))).toBe('dairy.cycles.note.accruing');
    // Closed and unbilled has TWO causes and they are different problems: the clock is off, or has not got here yet.
    expect(registerNoteKey(view({ cycle: { ...view().cycle, stage: 'closed_unbilled' }, cadenceOn: true }))).toBe('dairy.cycles.note.billsPending');
    expect(registerNoteKey(view({ cycle: { ...view().cycle, stage: 'closed_unbilled' }, cadenceOn: false }))).toBe('dairy.cycles.note.cadenceOff');
    expect(registerNoteKey(view())).toBeNull();
    for (const k of ['dairy.cycles.note.accruing', 'dairy.cycles.note.billsPending', 'dairy.cycles.note.cadenceOff']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('names every bill status the state machine allows', () => {
    for (const s of BILL_STATUSES) expect(hasKey(billStatusKey(s))).toBe(true);
    expect(billStatusTone('paid')).toBe('ok');
    expect(billStatusTone('disputed')).toBe('bad');
    expect(billStatusTone('voided')).toBe('muted');
    expect(billStatusTone('approved')).toBe('warn');
  });

  it('carries a member with no name on file on their masked code', () => {
    expect(memberLabel(row()).name).toBe('Savita Ben M.');
    expect(memberLabel(row({ memberName: null })).name).toBeNull();
    expect(memberLabel(row({ memberName: '   ' })).name).toBeNull();     // whitespace is not a name
    expect(memberLabel(row({ memberName: null })).code).toBe('AND3••19');
    expect(hasKey('dairy.cycles.col.noName')).toBe(true);
  });

  it('keeps the average\'s own day count beside it', () => {
    expect(paceParts(row())).toEqual({ perDay: '9.880', avg: '14.200', avgDays: 4 });
    expect(paceParts(row({ avg30d: null, avg30dDays: 0 })).avg).toBeNull();
    expect(hasKey('dairy.cycles.col.avgDays')).toBe(true);
  });

  it('itemises deductions from the DB vocabulary, and flags a line with nowhere to go', () => {
    const parts = deductionParts(row({
      deductions: [
        { typeCode: 'feed_credit', typeName: 'Feed credit', amountMinor: '50000', lines: 2, applied: 1, unsupportedReason: null },
        { typeCode: 'insurance_premium', typeName: 'Insurance', amountMinor: '74000', lines: 1, applied: 0, unsupportedReason: 'no wallet-settled premium exists' },
      ],
    }));
    expect(parts[0].label).toBe('Feed credit');       // the tenant's own name for it, never a hardcoded string
    expect(parts[0].partly).toBe(true);               // one of two lines applied
    expect(parts[1].partly).toBe(false);
    expect(parts[1].unsupportedReason).toBeTruthy();
    // A type the API could not map keeps its money and says so.
    expect(deductionParts(row({ deductions: [{ typeCode: null, typeName: null, amountMinor: '1', lines: 1, applied: 0, unsupportedReason: null }] }))[0].label).toBeNull();
    for (const k of ['dairy.cycles.col.unknownType', 'dairy.cycles.col.partlyApplied', 'dairy.cycles.col.unsupportedType']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('warns on the row that will refuse to pay, and puts the dispute first', () => {
    expect(rowWarningKey(row({ needsFreshConsent: true }))).toBe('dairy.cycles.row.needsConsent');
    expect(rowWarningKey(row({ openDisputes: 1 }))).toBe('dairy.cycles.row.disputed');
    // Both true: the objection is the more urgent sentence — a disputed bill is a member waiting for an answer.
    expect(rowWarningKey(row({ openDisputes: 1, needsFreshConsent: true }))).toBe('dairy.cycles.row.disputed');
    expect(rowWarningKey(row())).toBeNull();
    // 6c-4's hardest call, surfaced: below the line the bill pays and the objection is still owed an answer.
    expect(rowWarningKey(row({ memberRefusedBelowLine: true }))).toBe('dairy.cycles.row.refusedBelowLine');
    // ...and it never outranks a blocking reason.
    expect(rowWarningKey(row({ memberRefusedBelowLine: true, needsFreshConsent: true }))).toBe('dairy.cycles.row.needsConsent');
    for (const k of ['dairy.cycles.row.needsConsent', 'dairy.cycles.row.disputed', 'dairy.cycles.row.refusedBelowLine']) expect(hasKey(k)).toBe(true);
  });

  it('says the payday is a date this organisation set, not the canon\'s one bank trip', () => {
    expect(paydayNoteKey(view().payday)).toBe('dairy.cycles.payday.noBatch');
    expect(hasKey('dairy.cycles.payday.noBatch')).toBe(true);
    expect(hasKey('dairy.cycles.noBatch')).toBe(true);
  });

  it('claims "all resolved before payday" only when the API says every one was', () => {
    expect(disputesKey(view().lastCycle)).toBe('dairy.cycles.disputes.allBeforePayday');
    expect(disputesKey(null)).toBe('dairy.cycles.disputes.noPrevious');
    const d = view().lastCycle!;
    expect(disputesKey({ ...d, disputes: { ...d.disputes, total: 0, resolvedBeforePayday: 0, allResolvedBeforePayday: false } })).toBe('dairy.cycles.disputes.none');
    expect(disputesKey({ ...d, disputes: { ...d.disputes, open: 1, allResolvedBeforePayday: false } })).toBe('dairy.cycles.disputes.stillOpen');
    expect(disputesKey({ ...d, disputes: { ...d.disputes, open: 0, resolvedBeforePayday: 1, allResolvedBeforePayday: false } })).toBe('dairy.cycles.disputes.someAfterPayday');
    for (const k of ['noPrevious', 'none', 'allBeforePayday', 'stillOpen', 'someAfterPayday']) {
      expect(hasKey(`dairy.cycles.disputes.${k}`)).toBe(true);
    }
  });

  it('prints the tenant\'s consent line, and the tighter automatic cap when there is one', () => {
    expect(consentParts({ consentPct: 25, assemblyPct: 25, automaticPct: 25 }).tightened).toBe(false);
    const tight = consentParts({ consentPct: 25, assemblyPct: 10, automaticPct: 10 });
    expect(tight).toEqual({ consentPct: 25, automaticPct: 10, tightened: true });
    for (const k of ['dairy.cycles.consent.above', 'dairy.cycles.consent.automatic']) expect(hasKey(k)).toBe(true);
  });

  it('says a zero deduction total means "switched off" when it does', () => {
    expect(deductionsNoteKey({ totalMinor: '0', byTypeCode: {}, needingConsent: 0, assemblyOn: false })).toBe('dairy.cycles.deductions.assemblyOff');
    // Assembly ON and nothing withheld is a true zero and needs no excuse.
    expect(deductionsNoteKey({ totalMinor: '0', byTypeCode: {}, needingConsent: 0, assemblyOn: true })).toBeNull();
    expect(deductionsNoteKey({ totalMinor: '18430000', byTypeCode: {}, needingConsent: 41, assemblyOn: true })).toBe('dairy.cycles.deductions.needingConsent');
    for (const k of ['dairy.cycles.deductions.assemblyOff', 'dairy.cycles.deductions.needingConsent']) expect(hasKey(k)).toBe(true);
  });

  it('carries TENANT-6a\'s bonus caveat onto the screen where the money is agreed', () => {
    expect(bonusIgnoredKey(view().accrual)).toBeNull();
    expect(bonusIgnoredKey({ ...view().accrual, bonusRulesIgnored: true })).toBe('dairy.cycles.accrual.bonusIgnored');
    expect(hasKey('dairy.cycles.accrual.bonusIgnored')).toBe(true);
  });

  it('pages by cursor and says so, because the canon\'s numbered pages have no address', () => {
    expect(pagingText(view())).toEqual({ shown: 1, of: 312 });
    expect(nextHref('c1', view(), 'desc')).toBeNull();
    expect(nextHref('c1', view({ page: { ...view().page, nextCursor: 'Y3Vy' } }), 'desc')).toBe('/dairy/cycles?cycle=c1&cursor=Y3Vy');
    expect(flipDirection('desc')).toBe('asc');
    expect(flipDirection('asc')).toBe('desc');
    expect(hasKey(directionKey('asc'))).toBe(true);
    expect(hasKey(directionKey('desc'))).toBe(true);
    expect(hasKey('dairy.cycles.register.keyset')).toBe(true);
  });

  it('keeps the cycle in the URL so last fortnight is a bookmark', () => {
    expect(CYCLES_HREF).toBe('/dairy/cycles');
    expect(cycleHref('c1')).toBe('/dairy/cycles?cycle=c1');
    expect(cycleHref('c1', { direction: 'asc' })).toBe('/dairy/cycles?cycle=c1&direction=asc');
    // `desc` is the default, so it is not carried — a canonical URL for the same view.
    expect(cycleHref('c1', { direction: 'desc' })).toBe('/dairy/cycles?cycle=c1');
  });

  it('splits the states the same way every wave since TENANT-5c', () => {
    expect(cyclesState(null)).toBe('ok');
    expect(cyclesState('FORBIDDEN', 403)).toBe('restricted');
    expect(cyclesState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(cyclesState('BOOM', 500)).toBe('error');
    for (const s of ['ok', 'flaggedOff', 'restricted', 'error'] as const) expect(hasKey(cyclesStateKey(s))).toBe(true);
    for (const k of ['dairy.cycles.title', 'dairy.cycles.lead', 'dairy.cycles.empty.noCycles', 'dairy.cycles.empty.cadenceOn',
      'dairy.cycles.buildsServerSide', 'dairy.cycles.acts.heading', 'dairy.cycles.act.preview', 'dairy.cycles.act.approve',
      'dairy.cycles.register.heading', 'dairy.cycles.register.empty', 'dairy.cycles.register.next',
      'dairy.cycles.disputePausesOneBill', 'dairy.cycles.viewCollections', 'dairy.cycles.error.act',
      'dairy.cycles.ok.previewed', 'dairy.cycles.ok.approved', 'dairy.cycles.pass.remaining', 'dairy.cycles.pass.pressAgain',
      'dairy.cycles.pass.skippedDisputed', 'dairy.cycles.pass.failed', 'dairy.cycles.timeline.closes',
      'dairy.cycles.timeline.previewed', 'dairy.cycles.timeline.approved', 'dairy.cycles.timeline.paid',
      'dairy.cycles.tile.cycle', 'dairy.cycles.tile.pays', 'dairy.cycles.tile.deductions', 'dairy.cycles.tile.lastDisputes',
      'dairy.cycles.tile.accruedTo', 'dairy.cycles.tile.days', 'dairy.cycles.tile.bills', 'dairy.cycles.tile.pourers',
      'dairy.cycles.tile.billsExisting', 'dairy.cycles.tile.paid', 'dairy.cycles.tile.awaiting', 'dairy.cycles.tile.noDeductions',
      'dairy.cycles.col.member', 'dairy.cycles.col.litres', 'dairy.cycles.col.gross', 'dairy.cycles.col.deductions',
      'dairy.cycles.col.net', 'dairy.cycles.col.status', 'dairy.cycles.col.queues', 'dairy.cycles.col.windowEnds',
      'dairy.cycles.col.perDay', 'dairy.cycles.col.avg', 'dairy.cycles.register.shownOf', 'dairy.cycles.register.pageTotal',
      'dairy.cycles.register.cycleTotal', 'dairy.cycles.act.previewedAt', 'dairy.cycles.act.approvedAt']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE TWO CLAIMS THIS WAVE REPAIRED                                                                       */
  /* ------------------------------------------------------------------------------------------------------- */

  it('finally builds the sub-nav entry that has said "not built" since TENANT-6a', () => {
    const cycles = DAIRY_NAV.find((i) => i.key === 'cycles')!;
    expect(cycles.built).toBe(true);
    expect(cycles.href).toBe('/dairy/cycles');
    expect(currentDairyNavKey('/dairy/cycles')).toBe('cycles');
    // ...and `/dairy` must not light up when the operator is on the cycles screen.
    expect(currentDairyNavKey('/dairy')).toBe('collections');
    // The invariant the nav has kept every wave: `built` means "has an href", exactly.
    for (const i of DAIRY_NAV) expect(i.built).toBe(i.href !== null);
    expect(dairyUnbuiltCount()).toBe(0);      // [PC-56 TENANT-6e-1] W172 was the last one
  });

  it('stops W167 telling operators the platform cannot record a payday — it has since 0157', () => {
    const recorded: DairyPayday = { kind: 'recorded', closesOn: '2026-07-15', payday: '2026-07-17', cycleId: 'c1', cycleStatus: 'closed', batchBuilt: false };
    const missing: DairyPayday = { kind: 'not_recorded', closesOn: '2026-07-15', missing: ['dairy_cycle_row_for_window', 'dairy_cycle_close_flag'] };
    expect(paydayKey(recorded)).toBe('dairy.payday.recorded');
    expect(paydayKey(missing)).toBe('dairy.payday.notRecorded');
    expect(hasKey('dairy.payday.recorded')).toBe(true);
    // The old copy said "no payday is recorded on this platform" — a sentence five waves of work had falsified. The
    // repaired string must talk about THIS WINDOW's cycle row instead of about the platform.
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'dairy.payday.notRecorded':"))!;
      expect(line).not.toMatch(/this platform|इस मंच|આ મંચ/);
    }
    // And the derived-window copy said the platform keeps no cycle record. It keeps one.
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'dairy.window.derived':"))!;
      expect(line).not.toMatch(/no cycle record|चक्र का कोई रिकॉर्ड|ચક્રની કોઈ નોંધ/);
    }
  });
});
