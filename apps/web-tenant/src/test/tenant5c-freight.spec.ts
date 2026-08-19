// PC-56 TENANT-5c · W241's and W242's rules — what the freight desk may and may not say.
//
// The desk's whole value is telling one kind of number from another: a variance against an expected figure somebody
// recorded is leakage; the same number against a figure nobody recorded is noise. Most of what these tests hold is
// that distinction, plus the three sentences the console refuses to print as fact (a carrier payment, a signed
// evidence export, and a seven-day clock nothing keeps).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_FREIGHT_CURRENCY, EVIDENCE_CLAIMS, FREIGHT_ACTIONS, FREIGHT_OK, FREIGHT_REFUSALS, FREIGHT_TABS,
  MAX_FREIGHT_LINES, SETTLEMENT_STEPS, actionTitleKey, canDispute, canPay, checkerKey, deskHref, deskState,
  detailState, disputeBlockedKey, disputedFooting, documentNoticeKey, duplicateClaimMinor, duplicateKey,
  duplicatesFor, emptyKey, errorFor, evidenceClaimKey,
  evidenceFacts, expectedKey, freightErrorKey, freightOkKey, isFreightAction, isFreightTab, linesTotalMinor,
  matchedSummary, packKey, parseLines, paymentKey, reasonKey, reconBadgeKey, reconHref, reviewNoticeKey,
  rowActionKey, settlementBuilt, settlementKey, showsExpected, stateKey, statusKey, statusParam, tabOf,
  validateDraft, varianceIsPartial, variancePctText, verdictKey, verdictTone, type FreightDraft,
} from '../features/logistics/freight';
import { LOGISTICS_NAV, currentNavKey, unbuiltCount } from '../features/logistics/nav';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
/** Every key this module can produce must exist in all three catalogues — a missing Gujarati key renders as the key
 *  itself to the operator who needs it most (Law 7, Rule Zero: nothing ships that blocks a language). */
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));

const row = (o: Partial<Parameters<typeof reconBadgeKey>[0]> & Partial<Parameters<typeof showsExpected>[0]> = {}) => ({
  sourceKind: 'carrier_invoice' as const, reconStatus: 'variance_open' as const, varianceDirection: 'over' as const,
  disputedLines: 0, expectedApplies: true, ...o,
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · W241\'s list', () => {
  it('turns the four questions an operator asks into the API\'s own vocabulary', () => {
    expect(FREIGHT_TABS).toEqual(['all', 'open', 'disputed', 'closed']);
    expect(statusParam('all')).toBeUndefined();
    // `open` is variance_open, NOT pending: a bill nobody has reconciled and a bill with a real variance are two
    // different jobs, and only the second one costs money.
    expect(statusParam('open')).toBe('variance_open');
    expect(statusParam('disputed')).toBe('disputed_lines');
    expect(statusParam('closed')).toBe('reconciled');
    expect(tabOf('nonsense')).toBe('all');
    expect(tabOf(undefined)).toBe('all');
    expect(isFreightTab('open')).toBe(true);
    expect(isFreightTab('pending')).toBe(false);
    for (const t of FREIGHT_TABS) expect(hasKey(`freight.tab.${t}`)).toBe(true);
  });

  it('has a distinct sentence for each recon state, including "not a bill at all"', () => {
    expect(reconBadgeKey(row({ sourceKind: 'own_fleet_cost_note' }))).toBe('freight.recon.costCentre');
    expect(reconBadgeKey(row({ reconStatus: 'pending' }))).toBe('freight.recon.notYet');
    expect(reconBadgeKey(row({ disputedLines: 4 }))).toBe('freight.recon.disputed');
    expect(reconBadgeKey(row({ reconStatus: 'exact_match' }))).toBe('freight.recon.exact');
    expect(reconBadgeKey(row())).toBe('freight.recon.over');
    expect(reconBadgeKey(row({ varianceDirection: 'under' }))).toBe('freight.recon.under');
    expect(reconBadgeKey(row({ varianceDirection: 'level' }))).toBe('freight.recon.level');
    for (const k of ['costCentre', 'notYet', 'disputed', 'exact', 'over', 'under', 'level']) {
      expect(hasKey(`freight.recon.${k}`)).toBe(true);
    }
  });

  it('a cost note is a cost centre even when it is disputed-looking, because nobody billed it', () => {
    expect(reconBadgeKey(row({ sourceKind: 'own_fleet_cost_note', disputedLines: 9 }))).toBe('freight.recon.costCentre');
  });

  it('shows an expected figure only when there IS one', () => {
    expect(showsExpected(row())).toBe(true);
    // A cost note has no expected side, and an unreconciled invoice's expected side is unknown, not zero.
    expect(showsExpected(row({ expectedApplies: false }))).toBe(false);
    expect(showsExpected(row({ reconStatus: 'pending' }))).toBe(false);
  });

  it('offers the action the row\'s own state allows', () => {
    expect(rowActionKey(row({ reconStatus: 'pending' }))).toBe('reconcile');
    expect(rowActionKey(row({ sourceKind: 'own_fleet_cost_note', reconStatus: 'pending' }))).toBe('book');
    // A booked cost note is finished — offering "open recon" on it would promise a screen with nothing on it.
    expect(rowActionKey(row({ sourceKind: 'own_fleet_cost_note', reconStatus: 'booked_ops' }))).toBeNull();
    expect(rowActionKey(row({ reconStatus: 'reconciled' }))).toBe('open');
    expect(rowActionKey(row({ reconStatus: 'exact_match' }))).toBe('open');
    expect(rowActionKey(row({ reconStatus: 'disputed_lines' }))).toBe('open');
  });

  it('renders the variance percentage from basis points, and nothing when the API could not compute one', () => {
    expect(variancePctText(240)).toBe('2.40%');
    expect(variancePctText(0)).toBe('0.00%');
    expect(variancePctText(null)).toBeNull();
  });

  it('names all six of 0070\'s statuses', () => {
    for (const s of ['pending', 'exact_match', 'variance_open', 'disputed_lines', 'reconciled', 'booked_ops'] as const) {
      expect(statusKey(s)).toBe(`freight.status.${s}`);
      expect(hasKey(statusKey(s))).toBe(true);
    }
  });

  it('keeps "no invoices yet" and "none this cycle" as the two different sentences the canon draws', () => {
    expect(emptyKey(false)).toBe('freight.empty.none');
    expect(emptyKey(true)).toBe('freight.empty.cycle');
    expect(hasKey('freight.empty.none')).toBe(true);
    expect(hasKey('freight.empty.cycle')).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · the expected side, and the caveat that must travel with every variance', () => {
  it('says which of the three states the expected side is in', () => {
    expect(expectedKey({ kind: 'priced', totalMinor: '100', lines: 2 })).toBe('freight.expected.priced');
    expect(expectedKey({ kind: 'partly_priced', totalMinor: '100', pricedLines: 1, unpricedLines: 1 })).toBe('freight.expected.partly');
    expect(expectedKey({ kind: 'unpriced', unpricedLines: 3 })).toBe('freight.expected.none');
    for (const k of ['priced', 'partly', 'none']) expect(hasKey(`freight.expected.${k}`)).toBe(true);
  });

  it('marks the variance as partial unless every line is priced — the sentence that stops a false 100% leakage', () => {
    expect(varianceIsPartial({ kind: 'priced', totalMinor: '1', lines: 1 })).toBe(false);
    expect(varianceIsPartial({ kind: 'partly_priced', totalMinor: '1', pricedLines: 1, unpricedLines: 1 })).toBe(true);
    expect(varianceIsPartial({ kind: 'unpriced', unpricedLines: 1 })).toBe(true);
  });

  it('the unpriced sentence explains WHY, because "no expected cost" reads as our data-entry lapse otherwise', () => {
    // Nothing on this platform writes shipments.charge_minor; that is a platform fact, not an operator's omission.
    const en = dict('en');
    const i = en.indexOf("'freight.expected.none':");
    expect(en.slice(i, i + 400)).toMatch(/writes/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · W242\'s lines', () => {
  it('has one sentence per verdict, and the loudest one is the phantom', () => {
    expect(verdictKey({ kind: 'match', expectedMinor: '1' })).toBe('freight.line.match');
    expect(verdictKey({ kind: 'over', expectedMinor: '1', varianceMinor: '1' })).toBe('freight.line.over');
    expect(verdictKey({ kind: 'under', expectedMinor: '1', varianceMinor: '-1' })).toBe('freight.line.under');
    expect(verdictKey({ kind: 'unmatched' })).toBe('freight.line.unmatched');
    expect(verdictKey({ kind: 'unpriced' })).toBe('freight.line.unpriced');
    for (const k of ['match', 'over', 'under', 'unmatched', 'unpriced']) expect(hasKey(`freight.line.${k}`)).toBe(true);
  });

  it('reads an unmatched line louder than an over-bill, because one is an argument and the other is a phantom', () => {
    expect(verdictTone({ kind: 'unmatched' })).toBe('bad');
    expect(verdictTone({ kind: 'over', expectedMinor: '1', varianceMinor: '1' })).toBe('warn');
    expect(verdictTone({ kind: 'match', expectedMinor: '1' })).toBe('ok');
    // An under-bill is muted: it is usually a carrier error that arrives as a correction next cycle.
    expect(verdictTone({ kind: 'under', expectedMinor: '1', varianceMinor: '-1' })).toBe('muted');
    expect(verdictTone({ kind: 'unpriced' })).toBe('warn');
  });

  it('offers a dispute only where there is ground to stand on', () => {
    expect(canDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, 'none')).toBe(true);
    expect(canDispute({ kind: 'unmatched' }, 'none')).toBe(true);
    // Nothing to argue about, no ground to argue from, and the wrong direction:
    expect(canDispute({ kind: 'match', expectedMinor: '1' }, 'none')).toBe(false);
    expect(canDispute({ kind: 'unpriced' }, 'none')).toBe(false);
    expect(canDispute({ kind: 'under', expectedMinor: '1', varianceMinor: '-1' }, 'none')).toBe(false);
    // And never twice.
    expect(canDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, 'disputed')).toBe(false);
    expect(canDispute({ kind: 'over', expectedMinor: '1', varianceMinor: '1' }, 'resolved')).toBe(false);
  });

  it('says WHY a dispute is not offered, rather than showing a dead row', () => {
    expect(disputeBlockedKey({ kind: 'match', expectedMinor: '1' })).toBe('freight.dispute.nothingToArgue');
    expect(disputeBlockedKey({ kind: 'unpriced' })).toBe('freight.dispute.noExpected');
    expect(disputeBlockedKey({ kind: 'under', expectedMinor: '1', varianceMinor: '-1' })).toBe('freight.dispute.underBilled');
    expect(disputeBlockedKey({ kind: 'over', expectedMinor: '1', varianceMinor: '1' })).toBeNull();
    for (const k of ['nothingToArgue', 'noExpected', 'underBilled']) expect(hasKey(`freight.dispute.${k}`)).toBe(true);
  });

  it('names every coded reason the API can classify, and falls back rather than printing a raw code', () => {
    for (const c of ['extra_attempt_billed', 'cancelled_in_transit', 'not_shipped', 'unpriced_line', 'not_evidenced']) {
      expect(reasonKey(c)).toBe(`freight.reason.${c}`);
      expect(hasKey(`freight.reason.${c}`)).toBe(true);
    }
    expect(reasonKey('something_new')).toBe('freight.reason.other');
    expect(reasonKey(null)).toBeNull();
    expect(hasKey('freight.reason.other')).toBe(true);
  });

  it('renders the evidence that was STORED, and nothing it does not hold', () => {
    expect(evidenceFacts(null)).toEqual([]);
    expect(evidenceFacts({})).toEqual([]);
    expect(evidenceFacts({ billedAttempts: 2, ourAttempts: 1, status: 'delivered' })).toEqual([
      { key: 'freight.evi.attempts', value: '2 / 1' },
      { key: 'freight.evi.status', value: 'delivered' },
    ]);
    expect(evidenceFacts({ missing: ['carrier_rate_card', 'consignment_weight'] })).toEqual([
      { key: 'freight.evi.missing', value: 'carrier_rate_card, consignment_weight' },
    ]);
    expect(evidenceFacts({ resolvedOutcome: 'agreed' })).toEqual([{ key: 'freight.evi.resolved.agreed', value: null }]);
    for (const k of ['freight.evi.attempts', 'freight.evi.status', 'freight.evi.missing',
      'freight.evi.resolved.agreed', 'freight.evi.resolved.withdrawn']) expect(hasKey(k)).toBe(true);
  });

  it('does not print an attempt comparison when only one side of it is known', () => {
    // "2 / undefined" would read as a proven over-claim. Half a comparison is not evidence.
    expect(evidenceFacts({ billedAttempts: 2 })).toEqual([]);
    expect(evidenceFacts({ ourAttempts: 1 })).toEqual([]);
  });

  it('counts the matched lines rather than asserting the canon\'s "82"', () => {
    const lines = [
      { verdict: { kind: 'match' as const, expectedMinor: '100' }, billedMinor: '100' },
      { verdict: { kind: 'match' as const, expectedMinor: '200' }, billedMinor: '200' },
      { verdict: { kind: 'over' as const, expectedMinor: '1', varianceMinor: '9' }, billedMinor: '10' },
    ];
    expect(matchedSummary(lines)).toEqual({ lines: 2, billedMinor: '300' });
    expect(matchedSummary([])).toEqual({ lines: 0, billedMinor: '0' });
  });

  it('adds the matched money in BigInt, so a quarter of paise does not lose precision', () => {
    const big = { verdict: { kind: 'match' as const, expectedMinor: '9007199254740993' }, billedMinor: '9007199254740993' };
    expect(matchedSummary([big, big]).billedMinor).toBe('18014398509481986');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · W242\'s footing — the tick that is a check, not decoration', () => {
  const l = (billedMinor: string, expectedMinor: string | null, disputeStatus: 'none' | 'disputed' | 'resolved' = 'disputed') =>
    ({ billedMinor, expectedMinor, disputeStatus });

  it('foots the disputed lines and ticks only when every one of them was priced', () => {
    const f = disputedFooting([l('1680', '1140'), l('940', '340'), l('100', '100', 'none')]);
    expect(f).toEqual({ lines: 2, billedMinor: '2620', expectedMinor: '1480', varianceMinor: '1140', expectedKnown: 2, foots: true });
  });

  it('does NOT tick when a disputed line has no expected figure — which is the normal case here', () => {
    const f = disputedFooting([l('1680', '1140'), l('940', null)]);
    expect(f.foots).toBe(false);
    expect(f.expectedKnown).toBe(1);
    // and the partial expected side is still reported, rather than the row being dropped from the footing
    expect(f).toMatchObject({ lines: 2, billedMinor: '2620', expectedMinor: '1140' });
  });

  it('counts only disputed lines — a resolved argument is not an open claim', () => {
    expect(disputedFooting([l('100', '100', 'resolved'), l('50', '50', 'none')]))
      .toMatchObject({ lines: 0, billedMinor: '0', expectedMinor: '0', varianceMinor: '0', foots: true });
  });

  it('handles an under-billed dispute without flipping the sign', () => {
    expect(disputedFooting([l('40', '100')]).varianceMinor).toBe('-60');
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · the same consignment billed twice', () => {
  const dups = [
    { awbNo: 'DLV1', billedMinor: '168000' },
    { awbNo: 'DLV1', billedMinor: '168000' },
    { awbNo: 'DLV2', billedMinor: '32000' },
  ];

  it('counts the duplicates for a line by the carrier\'s own reference', () => {
    expect(duplicatesFor(dups, 'DLV1')).toBe(2);
    expect(duplicatesFor(dups, 'DLV2')).toBe(1);
    expect(duplicatesFor(dups, 'DLV9')).toBe(0);
    // A line with no carrier reference cannot be duplicate-matched at all, and must not borrow another line's count.
    expect(duplicatesFor(dups, null)).toBe(0);
    expect(duplicatesFor([], 'DLV1')).toBe(0);
  });

  it('totals the re-billed money in BigInt — the figure an operator quotes to the carrier', () => {
    expect(duplicateClaimMinor(dups)).toBe('368000');
    expect(duplicateClaimMinor([])).toBe('0');
    expect(duplicateClaimMinor([{ billedMinor: '9007199254740993' }, { billedMinor: '9007199254740993' }]))
      .toBe('18014398509481986');
  });

  it('has singular and plural sentences, and none at all when there is no duplicate', () => {
    expect(duplicateKey(0)).toBeNull();
    expect(duplicateKey(-1)).toBeNull();
    expect(duplicateKey(1)).toBe('freight.dup.one');
    expect(duplicateKey(2)).toBe('freight.dup.many');
    for (const k of ['freight.dup.one', 'freight.dup.many', 'freight.dup.heading', 'freight.dup.lead', 'freight.dup.how']) {
      expect(hasKey(k)).toBe(true);
    }
  });

  it('says the money went to a second bill, not to a wrong rate', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'freight.dup.how':"), en.indexOf("'freight.dup.how':") + 300)).toMatch(/second bill/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · the money that cannot move', () => {
  it('has one sentence per payment state', () => {
    expect(paymentKey({ kind: 'cost_note_booked' })).toBe('freight.pay.costNote');
    expect(paymentKey({ kind: 'held_recon_open', cleanMinor: '1', disputedMinor: '1' })).toBe('freight.pay.heldReconOpen');
    expect(paymentKey({ kind: 'ready_no_rail', cleanMinor: '1', needsChecker: null, missing: [] })).toBe('freight.pay.readyNoRail');
    expect(paymentKey({ kind: 'nothing_clean', disputedMinor: '1' })).toBe('freight.pay.nothingClean');
    for (const k of ['costNote', 'heldReconOpen', 'readyNoRail', 'nothingClean']) expect(hasKey(`freight.pay.${k}`)).toBe(true);
  });

  it('NEVER offers to pay — there is no payee for a carrier on these rails', () => {
    // Written as a function so the day a vendor-payment rail exists there is exactly one place to change, and so a
    // mutation that flips it is caught here rather than by an operator watching a 500 on a ₹92,000 payment.
    for (const p of [
      { kind: 'ready_no_rail' as const, cleanMinor: '9200000', needsChecker: false, missing: [] },
      { kind: 'ready_no_rail' as const, cleanMinor: '1', needsChecker: true, missing: [] },
      { kind: 'held_recon_open' as const, cleanMinor: '1', disputedMinor: '0' },
      { kind: 'cost_note_booked' as const },
      { kind: 'nothing_clean' as const, disputedMinor: '1' },
    ]) expect(canPay(p)).toBe(false);
  });

  it('names the missing rails in words an operator can escalate with', () => {
    for (const m of ['carrier_payee_bank_account', 'freight_payout_purpose']) {
      expect(hasKey(`freight.pay.missing.${m}`)).toBe(true);
    }
    expect(hasKey('freight.pay.missing')).toBe(true);
  });

  it('keeps "threshold not read" apart from "no checker needed"', () => {
    const ready = (needsChecker: boolean | null) => ({ kind: 'ready_no_rail' as const, cleanMinor: '1', needsChecker, missing: [] });
    expect(checkerKey(ready(null))).toBe('freight.pay.checkerUnknown');
    expect(checkerKey(ready(true))).toBe('freight.pay.checkerNeeded');
    expect(checkerKey(ready(false))).toBe('freight.pay.checkerNotNeeded');
    // A checker sentence on an invoice nothing can pay yet would be noise.
    expect(checkerKey({ kind: 'held_recon_open', cleanMinor: '1', disputedMinor: '1' })).toBeNull();
    for (const k of ['checkerUnknown', 'checkerNeeded', 'checkerNotNeeded']) expect(hasKey(`freight.pay.${k}`)).toBe(true);
  });

  it('states the response window AND that the platform keeps no such clock', () => {
    expect(packKey(false)).toBe('freight.pack.windowNotKept');
    expect(packKey(true)).toBe('freight.pack.window');
    expect(hasKey('freight.pack.windowNotKept')).toBe(true);
    expect(dict('en')).toMatch(/does not keep that clock/);
  });

  it('splits W242\'s evidence claim into the three claims it actually is', () => {
    expect(EVIDENCE_CLAIMS).toEqual(['timestamped', 'gpsWhereRecorded', 'noSignedExport']);
    for (const c of EVIDENCE_CLAIMS) expect(hasKey(evidenceClaimKey(c))).toBe(true);
    // The canon says "signed-exportable". There is no signer, no document and no media row for a shipment trail.
    expect(dict('en')).toMatch(/Signed export: no/);
  });

  it('marks the two settlement steps this platform does not perform', () => {
    expect(SETTLEMENT_STEPS).toEqual(['payClean', 'pack', 'nextCycle']);
    expect(settlementBuilt('pack')).toBe(true);
    expect(settlementBuilt('payClean')).toBe(false);
    expect(settlementBuilt('nextCycle')).toBe(false);
    for (const s of SETTLEMENT_STEPS) expect(hasKey(settlementKey(s))).toBe(true);
    expect(hasKey('freight.settle.notBuilt')).toBe(true);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · the upload form (W2612–W2615)', () => {
  const draft = (o: Partial<FreightDraft> = {}): FreightDraft => ({
    carrierId: 'car-1', invoiceNo: 'DLV-INV-0726-41', sourceKind: 'carrier_invoice',
    periodStart: '2026-06-01', periodEnd: '2026-06-30', billedMinor: '1000',
    currencyCode: 'INR', linesRaw: 'AWB1,600\nAWB2,400', ...o,
  });

  it('accepts a clean draft', () => {
    expect(validateDraft(draft())).toEqual([]);
  });

  it('parses pasted rows, with the attempts field optional', () => {
    const p = parseLines('AWB1,600,2\n AWB2 , 400 \n\n');
    expect(p.errors).toEqual([]);
    expect(p.lines).toEqual([
      { awbNo: 'AWB1', billedMinor: '600', billedAttempts: 2 },
      { awbNo: 'AWB2', billedMinor: '400', billedAttempts: undefined },
    ]);
  });

  it('reports the row NUMBER of anything it could not read, rather than dropping it silently', () => {
    // A dropped row becomes a variance the carrier gets blamed for. Every unreadable row is named.
    const p = parseLines('AWB1,600\nAWB2\nAWB3,12.50\nAWB4,400,x\nAWB5,400,0\nAWB6,400,1,2');
    expect(p.errors).toEqual([2, 3, 4, 5, 6]);
    expect(p.lines).toHaveLength(1);
  });

  it('refuses a decimal amount — money is never typed with a point on this platform', () => {
    expect(parseLines('AWB1,964.40').errors).toEqual([1]);
  });

  it('sums the lines in BigInt', () => {
    expect(linesTotalMinor([{ awbNo: 'A', billedMinor: '9007199254740993' }, { awbNo: 'B', billedMinor: '1' }]))
      .toBe('9007199254740994');
    expect(linesTotalMinor([])).toBe('0');
  });

  it('lists EVERY invalid field at once, each naming its own reason', () => {
    const errs = validateDraft(draft({ carrierId: '', invoiceNo: 'x', periodStart: 'nope', billedMinor: 'abc', currencyCode: '' }));
    expect(errs.map((e) => e.field).sort()).toEqual(['billedMinor', 'carrierId', 'currencyCode', 'invoiceNo', 'periodStart']);
    for (const e of errs) expect(hasKey(e.key)).toBe(true);
    expect(errorFor(errs, 'carrierId')).toBe('freight.form.err.carrier');
    expect(errorFor(errs, 'periodEnd')).toBeNull();
  });

  it('refuses a period that ends before it starts', () => {
    expect(validateDraft(draft({ periodStart: '2026-06-30', periodEnd: '2026-06-01' })))
      .toEqual([{ field: 'periodEnd', key: 'freight.form.err.periodOrder' }]);
  });

  it('refuses a header total the lines do not add up to — the desk\'s own transcription check', () => {
    expect(validateDraft(draft({ billedMinor: '1001' })))
      .toEqual([{ field: 'billedMinor', key: 'freight.form.err.sumMismatch' }]);
  });

  it('refuses a carrier invoice with no lines, and accepts a cost note with none', () => {
    expect(validateDraft(draft({ linesRaw: '' })))
      .toEqual([{ field: 'linesRaw', key: 'freight.form.err.noLines' }]);
    expect(validateDraft(draft({ linesRaw: '', sourceKind: 'own_fleet_cost_note' }))).toEqual([]);
  });

  it('reports the unreadable-row error before the sum error, so the operator fixes the cause', () => {
    const errs = validateDraft(draft({ linesRaw: 'AWB1,600\nrubbish' }));
    expect(errs).toEqual([{ field: 'linesRaw', key: 'freight.form.err.lineFormat' }]);
  });

  it('caps the lines one upload may carry, and says so', () => {
    const many = Array.from({ length: MAX_FREIGHT_LINES + 1 }, (_, i) => `AWB${i},1`).join('\n');
    expect(validateDraft(draft({ linesRaw: many, billedMinor: String(MAX_FREIGHT_LINES + 1) })))
      .toEqual([{ field: 'linesRaw', key: 'freight.form.err.tooManyLines' }]);
  });

  it('asks for the currency instead of assuming rupees', () => {
    // freight_invoices.currency_code has existed since 0070 and the DTO accepts any ISO code. A form that stamped
    // every bill INR would cap the desk to one country's carriers — silently, which is the worst kind.
    expect(DEFAULT_FREIGHT_CURRENCY).toBe('INR');
    expect(validateDraft(draft({ currencyCode: 'USD' }))).toEqual([]);
    expect(validateDraft(draft({ currencyCode: 'US' })))
      .toEqual([{ field: 'currencyCode', key: 'freight.form.err.currency' }]);
    expect(validateDraft(draft({ currencyCode: 'RUPEE' })))
      .toEqual([{ field: 'currencyCode', key: 'freight.form.err.currency' }]);
  });

  it('says what the review step does NOT do, and what the document is for', () => {
    expect(hasKey(reviewNoticeKey())).toBe(true);
    expect(hasKey(documentNoticeKey())).toBe(true);
    // Recording is not reconciling, and the PDF is stored rather than read.
    const en = dict('en');
    expect(en.slice(en.indexOf("'freight.form.reviewNotice':"), en.indexOf("'freight.form.reviewNotice':") + 200)).toMatch(/does not reconcile/);
    expect(en.slice(en.indexOf("'freight.form.documentNotice':"), en.indexOf("'freight.form.documentNotice':") + 300)).toMatch(/not read/);
  });
});

/* --------------------------------------------------------------------------------------------------------- */
describe('TENANT-5c · navigation, the chain and the refusals', () => {
  it('builds desk links that keep the tab and the cursor', () => {
    expect(deskHref('all')).toBe('/logistics/freight');
    expect(deskHref('open')).toBe('/logistics/freight?tab=open');
    expect(deskHref('open', 'CUR')).toBe('/logistics/freight?tab=open&cursor=CUR');
    expect(deskHref('all', null)).toBe('/logistics/freight');
  });

  it('encodes the invoice id and carries the action and the line', () => {
    expect(reconHref('inv 1')).toBe('/logistics/freight/inv%201');
    expect(reconHref('i1', 'dispute', 'l1')).toBe('/logistics/freight/i1?act=dispute&line=l1');
    expect(reconHref('i1', 'close')).toBe('/logistics/freight/i1?act=close');
  });

  it('accepts only the four actions the chain implements', () => {
    expect(FREIGHT_ACTIONS).toEqual(['reconcile', 'close', 'dispute', 'resolve']);
    for (const a of FREIGHT_ACTIONS) {
      expect(isFreightAction(a)).toBe(true);
      expect(hasKey(actionTitleKey(a))).toBe(true);
    }
    expect(isFreightAction('pay')).toBe(false);
    expect(isFreightAction(undefined)).toBe(false);
  });

  it('tells the flagged-off desk from the restricted one and from a real failure', () => {
    // The feature-flag guard throws a bare 404 on purpose ("invisible when disabled"), and the LIST cannot be
    // "not found" — a tenant's collection always exists — so a 404 there is the flag.
    expect(deskState(null)).toBe('ok');
    expect(deskState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(deskState('FORBIDDEN', 403)).toBe('restricted');
    expect(deskState('generic', 500)).toBe('error');
    // A DETAIL 404 is the flag too, unless it carries the freight module's own code.
    expect(detailState('FREIGHT_INVOICE_NOT_FOUND', 404)).toBe('gone');
    expect(detailState('FREIGHT_LINE_NOT_FOUND', 404)).toBe('gone');
    expect(detailState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(detailState('FORBIDDEN', 403)).toBe('restricted');
    expect(detailState('generic', 503)).toBe('error');
    for (const s of ['ok', 'flaggedOff', 'restricted', 'gone', 'error'] as const) expect(hasKey(stateKey(s))).toBe(true);
  });

  it('says "nothing is broken" for the flagged-off state and "nothing pays" for the failure', () => {
    const en = dict('en');
    expect(en.slice(en.indexOf("'freight.state.flaggedOff':"), en.indexOf("'freight.state.flaggedOff':") + 250)).toMatch(/Nothing is broken/);
    expect(en.slice(en.indexOf("'freight.state.error':"), en.indexOf("'freight.state.error':") + 250)).toMatch(/nothing pays/);
  });

  it('translates every refusal the API and the console can produce', () => {
    for (const code of Object.keys(FREIGHT_REFUSALS)) expect(hasKey(freightErrorKey(code))).toBe(true);
    expect(freightErrorKey('FREIGHT_INVOICE_EXISTS')).toBe('freight.err.duplicate');
    expect(freightErrorKey('FREIGHT_RECON_CLOSED')).toBe('freight.err.closed');
    expect(freightErrorKey('reasonTooShort')).toBe('freight.err.reasonTooShort');
    expect(freightErrorKey('agreedAmount')).toBe('freight.err.agreedAmount');
    expect(freightErrorKey('WHAT_IS_THIS')).toBe('freight.err.generic');
    expect(hasKey('freight.err.generic')).toBe(true);
  });

  it('translates every success, and nothing else', () => {
    for (const ok of FREIGHT_OK) expect(hasKey(freightOkKey(ok)!)).toBe(true);
    expect(freightOkKey('paid')).toBeNull();     // there is no "paid" — and there is no rail to make one
  });

  it('adds the freight desk to the sub-nav, because the canon gives it no way in', () => {
    // W241 is referenced only by its own chain screens' breadcrumbs; no operational screen in 1,955 links to it,
    // while W229 (Vehicles) is linked from six. A screen with no route in is a table with no writer, in UI form.
    const keys = LOGISTICS_NAV.map((i) => i.key);
    expect(keys).toEqual(['overview', 'shipments', 'carriers', 'vehicles', 'routes', 'freight', 'zones', 'coldChain']);
    expect(LOGISTICS_NAV.find((i) => i.key === 'freight')).toEqual({ key: 'freight', href: '/logistics/freight', built: true });
    expect(hasKey('logistics.nav.freight')).toBe(true);
    // and the count of unbuilt sections is unchanged — this wave added a way in, not a promise
    expect(unbuiltCount()).toBe(4);
  });

  it('lights the freight tab on the desk and on the recon detail, and not `/logistics`', () => {
    expect(currentNavKey('/logistics/freight')).toBe('freight');
    expect(currentNavKey('/logistics/freight/abc')).toBe('freight');
    expect(currentNavKey('/logistics')).toBe('shipments');
  });
});
