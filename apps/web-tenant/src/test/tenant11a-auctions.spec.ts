// apps/web-tenant/src/test/tenant11a-auctions.spec.ts · PC-56 TENANT-11a — the console's auction logic (pure) and the page
// rules that must not drift: W137 / W138 / W139, the schedule form chain W2348–W2351, the decline chain W2341–W2344 and the
// mutate chain W2345–W2347 / W2352–W2354.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_CODES, AUCTION_ACTS, AUCTION_GROUPS, AUCTION_STATUSES, BUILT_KINDS, CONSENT_CHANNELS, FORM_FIELDS, FORM_REFUSALS, SETTLEMENT_OUTCOMES,
  actHref, auctionEntries, codeKey, consentFrom, consentRefusal, consoleState, createBody, failureCodesFrom, liveHref, lotPreviewMinor, monitorActs,
  qtyText, retryIsMutation, reviewAuction, rowHref, rupeesToMinor, settleHref, statusKey, timeLeft,
} from '../features/auctions/console';

const NOW = new Date('2026-07-13T09:00:00Z');
const L = '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const ok = { listingId: L, kind: 'english_open', startPrice: '610', reserve: '640', increment: '5', emd: '10000', starts: '2026-07-13T15:00', ends: '2026-07-13T16:00' };

describe('W137 · rows, tabs and states', () => {
  it('a running auction opens the monitor; an ended one the settlement', () => {
    expect(rowHref({ auctionId: 'a', status: 'live' })).toEqual({ href: liveHref('a'), key: 'auc.row.monitor' });
    expect(rowHref({ auctionId: 'a', status: 'awaiting_approval' })).toEqual({ href: settleHref('a'), key: 'auc.row.review' });
  });
  it('flagged off is the API\'s 404; a missing auction names its id; 403 is restricted, not an error', () => {
    expect(consoleState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(consoleState('NOT_FOUND', 404, true, { id: 'x' })).toBe('notFound');
    expect(consoleState('NOT_FOUND', 404, true, {})).toBe('flaggedOff');
    expect(consoleState('AUCTION_READ_FORBIDDEN', 403)).toBe('restricted');
    expect(consoleState('X', 500)).toBe('error');
  });
  it('quantities read as people type them; the clock counts the server\'s ends_at down', () => {
    expect(qtyText('200.000')).toBe('200'); expect(qtyText('12.500')).toBe('12.5');
    expect(timeLeft('2026-07-13T09:41:18Z', NOW)).toEqual({ ended: false, text: '0:41:18' });
    expect(timeLeft('2026-07-13T08:00:00Z', NOW).ended).toBe(true);
  });
  it('the monitor offers only what the API\'s viewerCan says; pause flips to resume', () => {
    expect(monitorActs('live', { cancel: true, pauseEntry: true }, false)).toEqual(['pause', 'cancel']);
    expect(monitorActs('live', { cancel: true, pauseEntry: true }, true)).toEqual(['resume', 'cancel']);
    expect(monitorActs('live', { cancel: false, pauseEntry: false }, false)).toEqual([]);
    expect(monitorActs('live', null, false)).toEqual([]);
    expect(actHref('a', 'cancel')).toBe('/marketplace/auctions/a/act?step=confirm&act=cancel');
    expect(retryIsMutation()).toBe(false);
  });
});

describe('W2348–W2351 · the schedule form — per-unit prices, the lot from the listing, consent on behalf', () => {
  it('rupees → paise on the digits, never a float', () => { expect(rupeesToMinor('610')).toBe('61000'); expect(rupeesToMinor('7,240.5')).toBe('724050'); expect(rupeesToMinor('x')).toBe('invalid'); });
  it('a complete form has no refusal; the body carries per-unit prices and no quantity (the server copies the lot)', () => {
    const e = auctionEntries(ok);
    expect(reviewAuction(e, NOW)).toEqual([]);
    const body = createBody(e, null);
    expect(body).toMatchObject({ listingId: L, startPriceMinor: '61000', reservePriceMinor: '64000', minIncrementMinor: '500', emdMinor: '1000000' });
    expect(body).not.toHaveProperty('quantity');
    expect(body).not.toHaveProperty('sellerUserId');
  });
  it('every refusal at once', () => {
    const r = reviewAuction(auctionEntries({ kind: 'dutch', startPrice: '0', reserve: '1', starts: '2026-07-13T16:00', ends: '2026-07-13T15:00', approval: 'on', decisionHours: '99', onBehalf: '1', consentChannel: 'voice' }), NOW);
    expect(r.map((x) => x.code).sort()).toEqual(['CONSENT_EVIDENCE_REQUIRED', 'DECISION_WINDOW_INVALID', 'KIND_UNKNOWN', 'LISTING_REQUIRED', 'START_INVALID', 'WINDOW_INVALID'].sort());
    expect(reviewAuction(auctionEntries({ ...ok, reserve: '600' }), NOW).map((x) => x.code)).toEqual(['RESERVE_BELOW_START']);
    expect(reviewAuction(auctionEntries({ ...ok, ends: '2026-07-13T10:00', starts: '2026-07-13T09:00' }), new Date('2026-07-13T03:00:00Z'))).toEqual([]);
  });
  it('on behalf: the seller is the listing\'s, the consent travels; an OTP needs no evidence', () => {
    const e = auctionEntries({ ...ok, onBehalf: '1', consentChannel: 'otp' });
    expect(reviewAuction(e, NOW)).toEqual([]);
    expect(createBody(e, 'seller-1')).toMatchObject({ sellerUserId: 'seller-1', consent: { channel: 'otp' } });
    expect(reviewAuction(auctionEntries({ ...ok, onBehalf: '1' }), NOW).map((x) => x.code)).toEqual(['CONSENT_CHANNEL_REQUIRED']);
  });
  it('the review\'s lot preview is the server\'s own integer floor', () => {
    expect(lotPreviewMinor('65500', '200')).toBe('13100000');
    expect(lotPreviewMinor('724000', '60')).toBe('43440000');
    expect(lotPreviewMinor('333', '0.5')).toBe('166');
    expect(lotPreviewMinor('x', '1')).toBeNull();
  });
});

describe('W2345 · staff decide only with the seller\'s consent', () => {
  it('consent refusals by name; a valid consent is read back', () => {
    expect(consentRefusal({})).toBe('CONSENT_CHANNEL_REQUIRED');
    expect(consentRefusal({ consentChannel: 'written' })).toBe('CONSENT_EVIDENCE_REQUIRED');
    expect(consentRefusal({ consentChannel: 'written', consentMediaId: L })).toBeNull();
    expect(consentFrom({ consentChannel: 'voice', consentMediaId: L, consentNote: 'called 10:02' })).toEqual({ channel: 'voice', mediaId: L, note: 'called 10:02' });
    expect(consentFrom({ consentChannel: 'fax' })).toBeNull();
  });
  it('failure codes: a bare 403 is FORBIDDEN, a named one keeps its name', () => {
    expect(failureCodesFrom(undefined, 403)).toEqual(['FORBIDDEN']);
    expect(failureCodesFrom('AUCTION_CANCEL_LIVE_FORBIDDEN', 403)).toEqual(['AUCTION_CANCEL_LIVE_FORBIDDEN']);
    expect(codeKey('AUCTION_ENDED')).toBe('auc.code.AUCTION_ENDED'); expect(codeKey('START_INVALID')).toBe('auc.refusal.START_INVALID'); expect(codeKey('zzz')).toBe('auc.code.unknown');
    expect(statusKey('defaulted')).toBe('auc.status.defaulted'); expect(statusKey('weird')).toBe('auc.status.unknown');
  });
});

describe('Law 7 · every dynamic family exists in en / hi / gu', () => {
  const fam = [
    ...AUCTION_STATUSES.map((s) => `auc.status.${s}`), 'auc.status.unknown', ...AUCTION_GROUPS.map((g) => `auc.tab.${g}`),
    ...BUILT_KINDS.map((k) => `auc.kind.${k}`), 'auc.kind.unknown', ...CONSENT_CHANNELS.map((c) => `auc.consent.${c}`),
    ...FORM_FIELDS.map((f) => `auc.field.${f}`), ...FORM_REFUSALS.map((c) => `auc.refusal.${c}`), ...ACT_CODES.map((c) => `auc.code.${c}`),
    ...SETTLEMENT_OUTCOMES.map((o) => `auc.settle.outcome.${o}`), 'auc.settle.outcome.none',
    ...AUCTION_ACTS.flatMap((a) => [`auc.act.${a}`, `auc.act.rule.${a}`, `auc.act.done.${a}`, `auc.act.foot.${a}`, `auc.act.notOffered.${a}`]), 'auc.act.notOffered.decline',
    ...['flaggedOff', 'notFound', 'restricted', 'error'].flatMap((s) => [`auc.live.state.${s}.title`, `auc.live.state.${s}.body`]),
    ...['flaggedOff', 'nothing', 'restricted', 'error'].flatMap((s) => [`auc.settle.state.${s}.title`, `auc.settle.state.${s}.body`]),
    ...['flaggedOff', 'restricted', 'error', 'notFound'].flatMap((s) => [`auc.state.${s}.title`, `auc.state.${s}.body`]),
    'lc.tab.reserved_auction', 'listingManage.status.reserved_auction',
  ];
  it.each(fam)('%s', (key) => { for (const cat of [en, hi, gu] as Array<Record<string, string>>) expect(cat[key]).toBeTruthy(); });
});

describe('the page rules that must not drift', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', 'app', 'marketplace', 'auctions', p), 'utf8');
  it('W138 says it refreshes every 5 s (no realtime client) and never prints another bidder\'s id', () => {
    const live = read('[id]/live/page.tsx');
    expect(live).toMatch(/httpEquiv="refresh" content="5"/);
    expect(live).toMatch(/auc\.live\.refreshes/);
    expect(live).not.toMatch(/bidderUserId/);
    expect(live).toMatch(/auc\.live\.integrity\.ip/);                  // same-IP: "not run", by name
  });
  it('W139 prints the server\'s settlement / preview, the default rule and "next bidder" as not built', () => {
    const settle = read('[id]/settle/page.tsx');
    expect(settle).toMatch(/settlementPreview/);
    expect(settle).toMatch(/auc\.settle\.nextBidderNotBuilt/);
    expect(settle).toMatch(/auc\.qualificationNotChecked/);
    expect(settle).not.toMatch(/BigInt\(/);                            // no money arithmetic in the page
  });
  it('the approve act mints its Idempotency-Key on the confirm page; cancel / pause need a reason', () => {
    const act = read('[id]/act/page.tsx');
    expect(act).toMatch(/act === 'approve' && <input type="hidden" name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(act).toMatch(/const needsReason = act !== 'approve'/);
  });
  it('/auctions redirects to /marketplace/auctions; the old actions file is gone', () => {
    const legacy = readFileSync(join(__dirname, '..', 'app', 'auctions', 'page.tsx'), 'utf8');
    expect(legacy).toMatch(/redirect\(AUCTIONS_HREF\)/);
    expect(() => readFileSync(join(__dirname, '..', 'app', 'auctions', 'actions.ts'), 'utf8')).toThrow();
  });
});
