// apps/web-tenant/src/test/swa-console.spec.ts · PC-56 TENANT-SW-a — the pure helpers behind W149 / W233 / W243 / W237 / W238.
// The walls are the API's and the database's; these tests pin what the pages SEND and how they read refusals.
import {
  bpsPercent, closeCarries, codeKey, isCodAct, isPincode, isPodAct, isZoneAct, istDateOf, overCap, pageState, parsePincodes,
  podFlagRefusal, podTimerLeftMinutes, proposalInput, proposalRefusals, readProposalDraft, readZoneDraft, zoneRefusals,
} from '../features/swa/console';
import { buildRemittance } from '../features/cod/recon';
import { en } from '../i18n/en';

const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const good = { source: 'direct', categoryId: '', rateBps: '250', fixedMinor: '', capMinor: '', chargedTo: 'buyer', priority: '100',
  effectiveFrom: '2026-10-11', effectiveTo: '', reason: 'Season-wide rate for the kharif mandi' };

describe('W149 · the commission proposal draft', () => {
  it('reads and trims the query; defaults chargedTo=seller and priority=100', () => {
    const d = readProposalDraft({ rateBps: ' 300 ', reason: 'x' });
    expect(d.rateBps).toBe('300'); expect(d.chargedTo).toBe('seller'); expect(d.priority).toBe('100');
  });
  it('a sound draft has no refusals; the 7-day notice is judged against the API’s own earliest date', () => {
    expect(proposalRefusals(good, '2026-10-11')).toEqual([]);
    expect(proposalRefusals({ ...good, effectiveFrom: '2026-10-10' }, '2026-10-11')).toEqual([{ field: 'effectiveFrom', code: 'notice' }]);
  });
  it('blames each bad field', () => {
    const r = proposalRefusals({ ...good, source: 'barter', categoryId: 'cat', rateBps: '10001', fixedMinor: '1.5', chargedTo: 'both', priority: '-1',
      effectiveTo: '2026-10-01', reason: 'short' }, '2026-10-11').map((x) => `${x.field}:${x.code}`);
    expect(r).toEqual(['source:source', 'categoryId:category', 'rateBps:rate', 'fixedMinor:minor', 'chargedTo:chargedTo', 'priority:priority', 'effectiveTo:window', 'reason:reason']);
  });
  it('the SDK input NEVER carries a platform share (the plan sets it — F-3)', () => {
    const i = proposalInput(good);
    expect('platformShareBps' in i).toBe(false);
    expect(i).toMatchObject({ source: 'direct', categoryId: null, rateBps: 250, fixedMinor: '0', capMinor: null, chargedTo: 'buyer', effectiveTo: null });
  });
  it('prints bps as a percentage', () => { expect(bpsPercent(350)).toBe('3.50%'); expect(bpsPercent(0)).toBe('0.00%'); });
});

describe('W233 · zones', () => {
  it('parses pincodes: dedupes, keeps the bad ones aside', () => {
    expect(parsePincodes('411001, 411002\n411001;011001 41100')).toEqual({ pins: ['411001', '411002'], bad: ['011001', '41100'] });
    expect(isPincode('560001')).toBe(true); expect(isPincode('060001')).toBe(false);
  });
  it('refuses a fee definition that W150 never approved, and an empty / bad pincode list', () => {
    const d = readZoneDraft({ defaultName: 'Anand taluka', pincodes: '388001', chargeDefinitionId: U, reason: 'Covers the dairy belt villages' });
    expect(zoneRefusals(d, [U])).toEqual([]);
    expect(zoneRefusals(d, [])).toEqual([{ field: 'chargeDefinitionId', code: 'fee' }]);
    expect(zoneRefusals({ ...d, pincodes: '' }, [U]).map((x) => x.code)).toEqual(['nopincode']);
    expect(zoneRefusals({ ...d, pincodes: '38800x' }, [U]).map((x) => x.code)).toEqual(['pincode', 'nopincode']);
  });
  it('knows its acts', () => { expect(isZoneAct('repoint')).toBe(true); expect(isZoneAct('delete')).toBe(false); });
});

describe('W243 · COD', () => {
  it('a cash-day close needs a carry reason of at least 10 characters for every open remittance', () => {
    const a = U, b = U.replace('5b', '5c');
    const r = closeCarries([a, b], { [`carry_${a}`]: 'Bank closed early today', [`carry_${b}`]: 'too short' });
    expect(r.carries).toEqual([{ remittanceId: a, reason: 'Bank closed early today' }]);
    expect(r.missing).toEqual([b]);
  });
  it('compares holdings to the cap as bigint minor units', () => {
    expect(overCap('1000001', '1000000')).toBe(true); expect(overCap('1000000', '1000000')).toBe(false); expect(overCap('x', '1')).toBe(false);
  });
  it('places a remittance on its IST cash day (microsecond instants included)', () => {
    expect(istDateOf('2026-10-03T18:29:59.999999Z')).toBe('2026-10-03');
    expect(istDateOf('2026-10-03T18:30:00.000001Z')).toBe('2026-10-04');
    expect(istDateOf('nope')).toBeNull();
  });
  it('remittance acts stay on the /cod worksheet; W243 owns only the cash day and shortfalls', () => {
    expect(['openDay', 'closeDay', 'collectShortfall'].every(isCodAct)).toBe(true);
    expect(isCodAct('reconcile')).toBe(false);
  });
  it('the worksheet now sends the reason the API audits (C2) and refuses a too-short one', () => {
    const base = { riderUserId: U, expectedAmountMinor: '5000', depositRef: '', depositMethod: '' };
    expect(buildRemittance({ ...base, reason: 'End of route' })).toEqual({ ok: true, value: { riderUserId: U, expectedAmountMinor: '5000', reason: 'End of route' } });
    expect(buildRemittance({ ...base, reason: 'no' })).toEqual({ ok: false, error: 'reason' });
  });
});

describe('W237 / W238 · POD', () => {
  it('the timer counts down in whole minutes and never goes negative', () => {
    const now = Date.parse('2026-10-03T10:00:00Z');
    expect(podTimerLeftMinutes('2026-10-03T11:30:00Z', now)).toBe(90);
    expect(podTimerLeftMinutes('2026-10-03T09:00:00Z', now)).toBe(0);
    expect(podTimerLeftMinutes('bad', now)).toBeNull();
  });
  it('a flag needs a coded reason; "other" needs a note; a variance is positive whole paise', () => {
    expect(podFlagRefusal('mismatch', '', '')).toBeNull();
    expect(podFlagRefusal('lost', '', '')).toBe('reason');
    expect(podFlagRefusal('other', 'x', '')).toBe('otherNote');
    expect(podFlagRefusal('weight_variance', '', '0')).toBe('variance');
    expect(podFlagRefusal('weight_variance', '', '1250')).toBeNull();
  });
  it('knows its acts', () => { expect(isPodAct('confirmReject')).toBe(true); expect(isPodAct('delete')).toBe(false); });
});

describe('refusals and page states', () => {
  it('maps a known API code to its sentence and an unknown one to the generic sentence — and every sentence exists', () => {
    expect(codeKey('POD_REVIEWER_IS_DRIVER')).toBe('swa.code.POD_REVIEWER_IS_DRIVER');
    expect(codeKey('SOMETHING_NEW')).toBe('swa.code.generic');
    for (const c of ['COMMISSION_NOTICE_7_DAYS', 'NEEDS_SECOND_ADMIN', 'ZONE_FEE_NOT_APPROVED', 'COD_RIDER_CAP', 'COD_DAY_CHECKER_IS_MAKER', 'POD_REJECT_NEEDS_CHECKER', 'UNSERVICEABLE_PINCODE', 'generic']) {
      expect((en as Record<string, string>)[codeKey(c)]).toBeTruthy();
    }
  });
  it('a 404 on a list is "switched off" (a flagged-off route is invisible); on a detail it is "not found"', () => {
    expect(pageState(404, true)).toBe('flaggedOff'); expect(pageState(404, false)).toBe('notFound');
    expect(pageState(403, true)).toBe('restricted'); expect(pageState(500, true)).toBe('error'); expect(pageState(undefined, false)).toBe('error');
  });
});
