// apps/web-tenant/src/test/tenant11c-group-lots.spec.ts · PC-56 TENANT-11c — the console's group-lot logic (pure) and the page rules
// that must not drift: W135 / W136, the new-lot and pledge form chains W2629–W2632, the mutate chain W2633–W2635.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_REFUSALS, API_CODES, AUDIT_ACTION, CONSENT_CHANNELS, FORM_REFUSALS, GROUP_LOT_STATUSES, KYC_STATUSES, LOT_ACTS, LOT_TABS, actHref, bpsPct, codeKey, collapse,
  consoleState, createBody, failureCodesFrom, kycKey, localToIso, lotEntries, offered, pctToBps, pledgeHref, progressPct, qtyText, reasonRule, retryIsMutation,
  reviewAct, reviewLot, reviewPledge, rowRally, rupeesToMinor, statusKey, tabHref,
} from '../features/group-lots/console';

const U = '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const cats = { en, hi, gu } as Record<string, Record<string, string>>;
const all = (key: string) => { for (const [l, c] of Object.entries(cats)) expect([l, key, typeof c[key]]).toEqual([l, key, 'string']); };
const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const NOW = new Date('2026-07-12T00:00:00Z');

describe('W135 · tabs, rows, states', () => {
  it('six real status tabs (all reachable now) + All; deadline sort is a real query', () => {
    expect([...LOT_TABS]).toEqual(['all', 'pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled']);
    expect(tabHref('ready', 'deadline')).toBe('/marketplace/group-lots?tab=ready&sort=deadline');
    expect(tabHref('all', 'recent')).toBe('/marketplace/group-lots');
  });
  it('flagged off is the API\'s 404; a missing lot names itself; 403 / not-coordinator is restricted', () => {
    expect(consoleState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(consoleState('GROUP_LOT_NOT_FOUND', 404, true, { id: U })).toBe('notFound');
    expect(consoleState('GROUP_LOT_NOT_COORDINATOR', 403)).toBe('restricted');
    expect(consoleState('X', 500)).toBe('error');
  });
  it('quantities as people type them; fee bps as a percent by integer arithmetic; progress floor', () => {
    expect(qtyText('86.000')).toBe('86'); expect(qtyText('12.500')).toBe('12.5');
    expect(bpsPct(50)).toBe('0.50'); expect(bpsPct(2000)).toBe('20.00'); expect(bpsPct(7)).toBe('0.07');
    expect(progressPct(8650)).toBe('86');
  });
  it('Rally is the nudge, offered on a pledging lot the viewer coordinates', () => {
    expect(rowRally({ status: 'pledging', viewerIsCoordinator: true })).toBe(true);
    expect(rowRally({ status: 'pledging', viewerIsCoordinator: false })).toBe(false);
    expect(rowRally({ status: 'listed', viewerIsCoordinator: true })).toBe(false);
    expect(actHref(U, 'nudge')).toBe(`/marketplace/group-lots/${U}/act?step=confirm&act=nudge`);
  });
});

describe('W136 · the pledge table collapse and KYC words', () => {
  it('three rows, then "+ N more members · Q · all verified" only from real KYC values', () => {
    const rows = [['18', 'verified'], ['12', 'verified'], ['12', 'verified'], ['10.5', 'verified'], ['8', 'pending']].map(([quantity, kycStatus]) => ({ quantity, kycStatus }));
    const c = collapse(rows);
    expect(c.head).toHaveLength(3);
    expect(c.rest).toEqual({ count: 2, quantity: '18.500', allVerified: false });
    expect(collapse(rows.slice(0, 3)).rest).toBeNull();
    expect(kycKey('verified')).toBe('gl.kyc.verified');
    expect(kycKey(null)).toBe('gl.kyc.noProducerRole');
  });
});

describe('W2629–W2632 · the new-lot form and the pledge form', () => {
  const ok = { productId: U, targetQuantity: '100', unitCode: 'quintal', deadline: '2026-07-13T12:00', feePct: '0.5' };
  it('every refusal at once, against its field; rupees / percent / India time on the digits', () => {
    expect(reviewLot(lotEntries(ok), NOW)).toEqual([]);
    expect(reviewLot(lotEntries({ targetQuantity: '1.2345', deadline: '2026-07-11T12:00', feePct: '20.5', appoint: '1', consentChannel: 'voice' }), NOW).map((r) => r.code)).toEqual(
      ['PRODUCT_REQUIRED', 'TARGET_INVALID', 'UNIT_REQUIRED', 'DEADLINE_PAST', 'FEE_INVALID', 'COORDINATOR_INVALID', 'CONSENT_EVIDENCE_REQUIRED']);
    expect(pctToBps('0.5')).toBe(50); expect(pctToBps('20')).toBe(2000); expect(pctToBps('1.234')).toBe('invalid');
    expect(localToIso('2026-07-13T12:00')).toBe('2026-07-13T06:30:00.000Z');
    expect(rupeesToMinor('12,500.01')).toBe('1250001');
  });
  it('the create body: bps, ISO deadline; an appointment carries the coordinator and the consent', () => {
    expect(createBody(lotEntries(ok))).toEqual({ productId: U, targetQuantity: '100', unitCode: 'quintal', pledgeDeadline: '2026-07-13T06:30:00.000Z', coordinationFeeBps: 50 });
    const ap = createBody(lotEntries({ ...ok, appoint: '1', coordinatorUserId: U, consentChannel: 'otp' }));
    expect(ap).toMatchObject({ coordinatorUserId: U, consent: { channel: 'otp' } });
  });
  it('a pledge quantity is a decimal string; on behalf needs a picked member (never a typed id)', () => {
    expect(reviewPledge({ quantity: '12.5' })).toEqual([]);
    expect(reviewPledge({ quantity: '0' }).map((r) => r.code)).toEqual(['QUANTITY_INVALID']);
    expect(reviewPledge({ quantity: '5', onBehalf: '1' }).map((r) => r.code)).toEqual(['MEMBER_REQUIRED']);
    expect(pledgeHref(U, true)).toBe(`/marketplace/group-lots/${U}/pledge?step=edit&onBehalf=1`);
  });
});

describe('W2633–W2635 · the acts', () => {
  const ctx = { belowTarget: true, textRequired: (c: string) => c === 'other' };
  it('extend + refuse need a reason; ready needs one only below target; list a price; cancel a lookup reason (+ text for other)', () => {
    expect(reasonRule('extend', false)).toBe('required'); expect(reasonRule('ready', true)).toBe('required'); expect(reasonRule('ready', false)).toBe('optional');
    expect(reviewAct('extend', { reason: '', deadline: '' }, ctx)).toEqual(['REASON_REQUIRED', 'DEADLINE_REQUIRED']);
    expect(reviewAct('list', { reason: '', price: '0' }, ctx)).toEqual(['PRICE_INVALID']);
    expect(reviewAct('list', { reason: '', price: '12500' }, ctx)).toEqual([]);
    expect(reviewAct('cancel', { reason: '', reasonCode: '' }, ctx)).toEqual(['CANCEL_REASON_REQUIRED']);
    expect(reviewAct('cancel', { reason: '', reasonCode: 'other', reasonText: 'no' }, ctx)).toEqual(['CANCEL_TEXT_REQUIRED']);
    expect(reviewAct('cancel', { reason: '', reasonCode: 'target_missed' }, ctx)).toEqual([]);
    expect(reviewAct('nudge', { reason: '' }, ctx)).toEqual([]);
    expect(reviewAct('refuse', { reason: 'ok' }, ctx)).toEqual(['REASON_REQUIRED']);
  });
  it('an act is offered only when the API\'s viewerCan says so; Retry is a page load; each act names its audit row', () => {
    expect(offered('confirm', { confirm: false, refuse: true })).toBe(false);
    expect(offered('refuse', { confirm: false, refuse: true })).toBe(true);
    expect(offered('nudge', null)).toBe(false);
    expect(retryIsMutation()).toBe(false);
    expect(AUDIT_ACTION.confirm).toBe('group_lot.settled');
    expect(Object.keys(AUDIT_ACTION).sort()).toEqual([...LOT_ACTS].sort());
  });
  it('codes → sentences; HTTP shapes → codes', () => {
    expect(codeKey('GROUP_LOT_CHECKER_IS_MAKER')).toBe('gl.code.GROUP_LOT_CHECKER_IS_MAKER');
    expect(codeKey('PRICE_INVALID')).toBe('gl.refusal.PRICE_INVALID');
    expect(codeKey('whatever')).toBe('gl.code.unknown');
    expect(failureCodesFrom(undefined, 403)).toEqual(['FORBIDDEN']);
    expect(failureCodesFrom('GROUP_LOT_HOLD_SHORT', 409)).toEqual(['GROUP_LOT_HOLD_SHORT']);
  });
});

describe('every word in three languages (Law 7)', () => {
  it('every family the pages build dynamically exists in en / hi / gu', () => {
    for (const s of GROUP_LOT_STATUSES) { all(statusKey(s)); all(`gl.tab.${s}`); }
    all('gl.tab.all'); all('gl.status.unknown');
    for (const a of LOT_ACTS) for (const p of ['gl.act.', 'gl.actFoot.', 'gl.actRule.', 'gl.notOffered.', 'gl.done.']) all(p + a);
    for (const c of FORM_REFUSALS) all(`gl.refusal.${c}`);
    for (const c of ACT_REFUSALS) all(`gl.refusal.${c}`);
    for (const c of API_CODES) all(`gl.code.${c}`);
    for (const c of CONSENT_CHANNELS) all(`gl.consent.${c}`);
    for (const c of KYC_STATUSES) all(`gl.kyc.${c}`);
    for (const c of ['target_missed', 'coordinator_withdrew', 'quality', 'other', 'none']) all(`gl.cancelReason.${c}`);
    for (const st of ['flaggedOff', 'restricted', 'error']) { all(`gl.state.${st}.title`); all(`gl.state.${st}.body`); }
    for (const st of ['notFound', 'restricted', 'error', 'flaggedOff']) { all(`gl.detailState.${st}.title`); all(`gl.detailState.${st}.body`); }
    for (const s of ['active', 'withdrawn', 'released']) all(`gl.mine.${s}`);
    for (const s of ['prepared', 'confirmed', 'refused']) all(`gl.settle.status.${s}`);
    for (const s of ['maker', 'coordinator']) all(`gl.settle.blocked.${s}`);
    all('notif.module.group_lot');
  });
  it('the refused-by-name sentences are present and honest', () => {
    expect(en['gl.pooled.none']).toBe('No pooled sales of this crop yet — no estimate.');
    expect(en['gl.nudge.voiceRefused']).toMatch(/VOICE nudge is not built/);
    expect(en['gl.pooled.soloRefused']).toMatch(/not computed/);
    expect(gu['gl.pooled.none']).not.toBe(en['gl.pooled.none']);
  });
});

describe('the pages · as text (the rules that must not drift)', () => {
  it('the canon slugs exist; the old route redirects; the old actions file and typed-gross form are gone', () => {
    for (const p of ['app/marketplace/group-lots/page.tsx', 'app/marketplace/group-lots/new/page.tsx', 'app/marketplace/group-lots/[id]/page.tsx',
      'app/marketplace/group-lots/[id]/pledge/page.tsx', 'app/marketplace/group-lots/[id]/act/page.tsx']) expect(existsSync(join(__dirname, '..', p))).toBe(true);
    expect(existsSync(join(__dirname, '..', 'app/group-lots/actions.ts'))).toBe(false);
    expect(src('app/group-lots/page.tsx')).toMatch(/redirect\(id \? `\/marketplace\/group-lots\/\$\{encodeURIComponent\(id\)\}` : '\/marketplace\/group-lots'\)/);
    expect(src('components/Sidebar.tsx')).toContain("href: '/marketplace/group-lots'");
    for (const p of ['app/marketplace/group-lots/[id]/page.tsx', 'app/marketplace/group-lots/[id]/act/page.tsx', 'app/marketplace/group-lots/[id]/act/actions.ts'])
      expect(src(p)).not.toMatch(/grossProceedsMinor"|name="grossProceedsMinor"/);
  });
  it('the pledge form picks a member from the roster (never a typed UUID); the list and the confirm mint their Idempotency-Key', () => {
    const pledge = src('app/marketplace/group-lots/[id]/pledge/page.tsx');
    expect(pledge).toContain('members.roster(');
    expect(pledge).not.toMatch(/name="farmerUserId" className="kv-input"/);
    const act = src('app/marketplace/group-lots/[id]/act/page.tsx');
    expect(act).toMatch(/\(act === 'list' \|\| act === 'confirm'\) && <input type="hidden" name="idempotencyKey" value=\{randomUUID\(\)\} \/>/);
  });
});
