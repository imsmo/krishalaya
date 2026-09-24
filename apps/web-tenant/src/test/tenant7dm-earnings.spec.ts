// apps/web-tenant/src/test/tenant7dm-earnings.spec.ts · PC-56 TENANT-7d-money · W418's console helpers, and the catalogue
// promise that every key a page can ask for exists ×3 — every state, tile, line state, payout status and stage, agreement
// status and act, rule status and act, every refusal code the API's earnings service can emit, and the four refusals by name.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EarningsTile, EarningsView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  AGREEMENT_ACTS, AGREEMENT_PATH, EARNINGS_PATH, EARNINGS_REFUSED_BY_NAME, EARNINGS_TILES, LINE_STATES, PAYOUT_PATH, RULE_ACTS, RULE_PATH,
  agreementChainAct, agreementStatusKey, availableState, earningsHref, earningsRefusedKey, earningsState, earningsStateKey, exportDownloadHref, exportHref,
  lineStateKey, majorToMinorText, payoutRefusalKey, payoutStageKey, payoutStatusKey, percentToBps, ruleChainAct, shareText, tileLabelKey, tileMinor,
} from '../features/studio/earnings';
import { REFUSED_BY_NAME, STUDIO_TILES, tileMeasured } from '../features/studio/instructor';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/education', rel), 'utf8');

const figure = (o: Partial<EarningsTile['lifetime']> = {}): EarningsTile['lifetime'] => ({ currencyCode: 'INR', minorUnits: 2, gross: '29800', instructor: '22350', tenant: '6854', platform: '596', held: '0', heldLines: 0, released: '22350', purchases: 2, ...o });
const tile = (o: Partial<EarningsTile> = {}): EarningsTile => ({ currencyCode: 'INR', minorUnits: 2, lifetime: figure(), mtd: figure({ gross: '14900', purchases: 1 }), paidOut: '10000', pending: '10000', available: '12350', ...o });
const view = (o: Partial<EarningsView> = {}): EarningsView => ({
  instructor: { id: 'i1', userId: 'u1', name: 'Dr K', royaltyBps: 7500, isSelf: true }, privileged: false, timezone: 'Asia/Kolkata', today: '2026-09-24', monthStart: '2026-09-01', splitFlagOn: true,
  agreement: { current: null, offered: null, history: [] }, rule: null, tiles: [tile()], courses: [], payouts: [], bankAccounts: [], payoutRefusals: [], refusedByName: ['monthlyLaneClock', 'refunds', 'cachedFigures', 'retry'], ...o,
});

describe('PC-56 TENANT-7d-money · routes', () => {
  it('W418 and its chains have hrefs; the desk reaches an instructor by id; the statement pages by cursor', () => {
    expect(earningsHref()).toBe('/studio/earnings'); expect(EARNINGS_PATH).toBe('/studio/earnings');
    expect(earningsHref({ instructor: 'i 1' })).toBe('/studio/earnings?instructor=i+1');
    expect(earningsHref({ cursor: 'abc' })).toBe('/studio/earnings?cursor=abc');
    expect(earningsHref({ instructor: 'i1', cursor: 'c' })).toBe('/studio/earnings?instructor=i1&cursor=c');
    expect(PAYOUT_PATH).toBe('/studio/earnings/payout'); expect(AGREEMENT_PATH).toBe('/studio/earnings/agreement'); expect(RULE_PATH).toBe('/studio/earnings/rule');
    expect(exportHref('j/1')).toBe('/studio/earnings/exports/j%2F1'); expect(exportDownloadHref('j1', 't k')).toBe('/studio/earnings/exports/j1/download?token=t%20k');
  });
  it('W410 no longer refuses earnings by name — the tile links to W418 and stays unmeasured ON W410', () => {
    expect(REFUSED_BY_NAME).not.toContain('earnings');
    expect(STUDIO_TILES).toContain('earnings'); expect(tileMeasured('earnings')).toBe(false);
    three('studio.tile.earnings.link'); three('nav.earnings');
    expect((en as Record<string, string>)['studio.refused.earnings']).toBeUndefined();
  });
});

describe('the six states', () => {
  it('from the transport and the view', () => {
    expect(earningsState(null, undefined, view())).toBe('ready');
    expect(earningsState(null, undefined, view({ tiles: [] }))).toBe('empty');
    expect(earningsState('EARNINGS_DISABLED', 404, null)).toBe('notEnabled');
    expect(earningsState('EARNINGS_DISABLED', undefined, null)).toBe('notEnabled');   // the CODE alone decides, not the 404 beside it (a first-run survivor)
    expect(earningsState('INSTRUCTOR_NOT_FOUND', 404, null)).toBe('noProfile');
    expect(earningsState('EDUCATION_FORBIDDEN', 403, null)).toBe('restricted');
    expect(earningsState('FORBIDDEN', 403, null)).toBe('restricted');
    expect(earningsState(null, 403, null)).toBe('restricted');
    expect(earningsState('NOT_FOUND', 404, null)).toBe('notEnabled');
    expect(earningsState('FEATURE_DISABLED', 404, null)).toBe('notEnabled');
    expect(earningsState('SOMETHING', 500, null)).toBe('error');
    expect(earningsState(null, undefined, null)).toBe('error');
  });
  it('every state has a sentence ×3, and the loading state is a file', () => {
    for (const s of ['ready', 'empty', 'noProfile', 'restricted', 'notEnabled', 'error'] as const) three(earningsStateKey(s));
    three('earnings.state.emptyHint'); three('earnings.state.notEnabledHint');
    expect(fs.existsSync(path.join(__dirname, '../app/studio/earnings/loading.tsx'))).toBe(true);
  });
});

describe('tiles — strings the API sent, never a computed figure', () => {
  it('seven tiles, each labelled ×3; the money-out tiles have no month', () => {
    expect(EARNINGS_TILES).toEqual(['gross', 'instructor', 'tenant', 'platform', 'held', 'paidOut', 'available']);
    for (const n of EARNINGS_TILES) three(tileLabelKey(n));
    const t = tile();
    expect(tileMinor(t, 'gross', 'lifetime')).toBe('29800'); expect(tileMinor(t, 'gross', 'mtd')).toBe('14900');
    expect(tileMinor(t, 'instructor', 'lifetime')).toBe('22350'); expect(tileMinor(t, 'tenant', 'lifetime')).toBe('6854'); expect(tileMinor(t, 'platform', 'lifetime')).toBe('596'); expect(tileMinor(t, 'held', 'lifetime')).toBe('0');
    expect(tileMinor(t, 'paidOut', 'lifetime')).toBe('10000'); expect(tileMinor(t, 'paidOut', 'mtd')).toBeNull();
    expect(tileMinor(t, 'available', 'lifetime')).toBe('12350'); expect(tileMinor(t, 'available', 'mtd')).toBeNull();
    expect(tileMinor(tile({ mtd: null }), 'gross', 'mtd')).toBe('0');   // no purchase this month reads 0, not a crash
  });
  it('shares are basis points as text — integer arithmetic, never a float', () => {
    expect(shareText(8000)).toBe('80'); expect(shareText(7500)).toBe('75'); expect(shareText(7550)).toBe('75.5'); expect(shareText(7555)).toBe('75.55'); expect(shareText(200)).toBe('2'); expect(shareText(0)).toBe('0'); expect(shareText(10000)).toBe('100');
    expect(shareText(-1)).toBe('?'); expect(shareText(1.5)).toBe('?');
  });
  it('a negative available is a DEFECT, never clamped', () => {
    expect(availableState('12350')).toBe('positive'); expect(availableState('0')).toBe('zero'); expect(availableState('-5')).toBe('negative');
    three('earnings.availableNegative');
  });
});

describe('the statement, the payouts, the agreement, the rule — every word ×3', () => {
  it('line states', () => { expect(LINE_STATES).toEqual(['paid_to_wallet', 'held_pending_agreement', 'released']); for (const s of LINE_STATES) three(lineStateKey(s)); });
  it('payout statuses and the stage on the batch', () => {
    for (const s of ['queued', 'processing', 'success', 'failed', 'reversed', 'cancelled']) three(payoutStatusKey(s));
    expect(payoutStatusKey('weird')).toBe('earnings.payout.status.unknown'); three('earnings.payout.status.unknown');
    expect(payoutStageKey({ status: 'queued', batchId: null, batchStatus: null })).toBe('earnings.payout.stage.awaitingBatch');
    expect(payoutStageKey({ status: 'queued', batchId: 'b', batchStatus: 'pending_approval' })).toBe('earnings.payout.stage.awaitingChecker');
    expect(payoutStageKey({ status: 'queued', batchId: 'b', batchStatus: 'approved' })).toBe('earnings.payout.stage.approved');
    expect(payoutStageKey({ status: 'queued', batchId: 'b', batchStatus: 'executing' })).toBe('earnings.payout.stage.approved');
    expect(payoutStageKey({ status: 'queued', batchId: 'b', batchStatus: 'rejected' })).toBe('earnings.payout.stage.batched');
    expect(payoutStageKey({ status: 'success', batchId: 'b', batchStatus: 'executed' })).toBe('earnings.payout.status.success');
    for (const k of ['awaitingBatch', 'awaitingChecker', 'approved', 'batched']) three(`earnings.payout.stage.${k}`);
  });
  it('every payout refusal the API can emit has a sentence ×3', () => {
    const src = api('domain/royalty-split.ts');
    const i = src.indexOf('export type PayoutRefusal =');
    const codes = [...src.slice(i, src.indexOf(';', i)).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual(['AGREEMENT_NOT_ACCEPTED', 'AMOUNT_INVALID', 'CURRENCY_UNKNOWN', 'ROYALTY_INSUFFICIENT', 'NOT_INSTRUCTOR']);
    for (const c of codes) three(payoutRefusalKey(c));
  });
  it('agreement statuses, acts, notes, done sentences and every refusal the service emits', () => {
    for (const s of ['offered', 'accepted', 'declined', 'superseded'] as const) three(agreementStatusKey(s));
    expect(AGREEMENT_ACTS).toEqual(['accept', 'decline', 'offer', 'supersede']);
    for (const a of AGREEMENT_ACTS) { three(`earnings.agreement.act.${a}`); three(`earnings.agreement.note.${a}`); three(`earnings.agreement.done.${a}`); }
    expect(agreementChainAct('accept')).toBe('accept'); expect(agreementChainAct('steal')).toBeNull(); expect(agreementChainAct(undefined)).toBeNull();
    const svc = api('services/instructor-earnings.service.ts');
    const codes = new Set([...svc.matchAll(/AgreementActRefusedError\('[a-z]+', \['([A-Z_]+)'\]\)/g)].map((m) => m[1]));
    for (const c of ["'NOT_DESK'", "'NOT_INSTRUCTOR'"]) void c;
    codes.add('NOT_DESK'); codes.add('NOT_INSTRUCTOR'); codes.add('ILLEGAL_FROM_STATUS');
    expect([...codes].sort()).toEqual(['ILLEGAL_FROM_STATUS', 'MAKER_IS_CHECKER', 'NOT_DESK', 'NOT_INSTRUCTOR', 'NO_RULE', 'OFFER_ALREADY_OPEN']);
    for (const c of codes) three(`earnings.agreement.refusal.${c}`);
    three('earnings.agreement.refusal.NOT_FOUND');
  });
  it('rule statuses, acts, done sentences and every refusal the domain and the service emit', () => {
    for (const s of ['proposed', 'active', 'rejected', 'superseded']) three(`earnings.rule.status.${s}`);
    expect(RULE_ACTS).toEqual(['propose', 'approve', 'reject']);
    for (const a of RULE_ACTS) { three(`earnings.rule.act.${a}`); three(`earnings.rule.done.${a}`); }
    expect(ruleChainAct('approve')).toBe('approve'); expect(ruleChainAct('supersede')).toBeNull();
    const domain = api('domain/royalty-split.ts'); const svc = api('services/instructor-earnings.service.ts');
    const codes = new Set<string>();
    for (const m of domain.slice(domain.indexOf('export function ruleDecisionRefusals')).matchAll(/out\.push\('([A-Z_]+)'\)/g)) codes.add(m[1]);
    for (const m of svc.matchAll(/RoyaltyRuleRefusedError\('[a-z]+', \['([A-Z_]+)'\]\)/g)) codes.add(m[1]);
    expect([...codes].sort()).toEqual(['ILLEGAL_FROM_STATUS', 'MAKER_IS_CHECKER', 'NOT_DESK', 'NOT_FINANCE', 'NO_PLATFORM_DEFAULT', 'PROPOSAL_ALREADY_OPEN', 'REASON_REQUIRED']);
    for (const c of codes) three(`earnings.rule.refusal.${c}`);
    for (const c of ['SHARE_INVALID', 'SHARE_TOO_HIGH', 'NOT_FOUND']) three(`earnings.rule.refusal.${c}`);
  });
  it('the four refusals by name match the API\'s list, each a sentence ×3', () => {
    const src = api('services/instructor-earnings.service.ts');
    const i = src.indexOf('EARNINGS_REFUSED_BY_NAME = [');
    const apiList = [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect([...EARNINGS_REFUSED_BY_NAME]).toEqual(apiList);
    for (const n of EARNINGS_REFUSED_BY_NAME) three(earningsRefusedKey(n));
  });
  it('the page\'s other sentences exist ×3 and carry their placeholders', () => {
    for (const k of ['earnings.title', 'earnings.lead', 'earnings.privacy', 'earnings.deskViewing', 'earnings.share', 'earnings.agreement.current', 'earnings.agreement.none', 'earnings.agreement.offered', 'earnings.rule.tenant', 'earnings.rule.platform', 'earnings.rule.none', 'earnings.splitOff', 'earnings.currency', 'earnings.zone', 'earnings.tileNote', 'earnings.heldNote', 'earnings.freeNote', 'earnings.payout.rides', 'earnings.payout.amountHint', 'earnings.export', 'earnings.exportNote', 'earnings.export.restricted', 'earnings.rule.twoPeople', 'earnings.rule.proposeHint', 'earnings.rule.willWrite']) three(k);
    expect(en['earnings.share']).toContain('{share}'); expect(en['earnings.zone']).toContain('{zone}'); expect(en['earnings.zone']).toContain('{from}');
    expect(en['earnings.agreement.offered']).toContain('{tenant}'); expect(en['earnings.rule.tenant']).toContain('{platform}'); expect(en['earnings.heldNote']).toContain('{n}'); expect(en['earnings.payout.amountHint']).toContain('{scale}');
    for (const cat of [hi, gu]) { expect(cat['earnings.share']).toContain('{share}'); expect(cat['earnings.zone']).toContain('{zone}'); expect(cat['earnings.tileNote']).toContain('{purchases}'); }
  });
});

describe('the amount a person types → the minor units the API takes (digit moving, not arithmetic)', () => {
  it('re-scales at the currency\'s own scale and refuses what is not an amount in it', () => {
    expect(majorToMinorText('149', 2)).toBe('14900'); expect(majorToMinorText('149.5', 2)).toBe('14950'); expect(majorToMinorText('149.50', 2)).toBe('14950'); expect(majorToMinorText('0.05', 2)).toBe('5');
    expect(majorToMinorText('5160', 0)).toBe('5160'); expect(majorToMinorText('5160.0', 0)).toBeNull();
    expect(majorToMinorText('1.005', 2)).toBeNull(); expect(majorToMinorText('0', 2)).toBeNull(); expect(majorToMinorText('0.00', 2)).toBeNull();
    expect(majorToMinorText('', 2)).toBeNull(); expect(majorToMinorText('abc', 2)).toBeNull(); expect(majorToMinorText('-5', 2)).toBeNull(); expect(majorToMinorText('1,000', 2)).toBeNull();
    expect(majorToMinorText('1', 7)).toBeNull(); expect(majorToMinorText('1', -1)).toBeNull();
    expect(majorToMinorText('007.10', 2)).toBe('710');
  });
  it('a percent a finance person types → basis points, refused outside [0, 100]', () => {
    expect(percentToBps('75')).toBe(7500); expect(percentToBps('75.5')).toBe(7550); expect(percentToBps('75.55')).toBe(7555); expect(percentToBps('0')).toBe(0); expect(percentToBps('100')).toBe(10000);
    expect(percentToBps('100.01')).toBeNull(); expect(percentToBps('101')).toBeNull(); expect(percentToBps('75.555')).toBeNull(); expect(percentToBps('-1')).toBeNull(); expect(percentToBps('')).toBeNull(); expect(percentToBps(undefined)).toBeNull();
  });
});
