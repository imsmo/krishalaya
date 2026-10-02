// apps/web-tenant/src/test/tenant10b-offers.spec.ts · PC-56 TENANT-10b · OFFERS & PROMOTIONS + COUPONS, in the console.
// The helpers; the pages' own promises read from their source (no client JS, the key minted on the review page, the chains
// imported rather than copied, flagged-off as words never a 404, restricted distinct from a load error, the money note in
// the brief's words, the label types never offered); every list mirrored from the API's OWN source (a second copy would
// agree exactly once); and every key a page can ask for exists ×3 with the same {vars} — literal and every dynamic family.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_CODES, COUPONS_HREF, COUPON_FIELDS, COUPON_OUTCOMES, COUPON_REFUSALS, COUPON_STATUSES, DISCOUNT_TYPES, ENGINE_TYPES, MONEY_STATES, NEW_COUPON_HREF, NEW_PROMOTION_HREF,
  NO_ENGINE_TYPES, OFFERS_HREF, PROMOTION_FIELDS, PROMOTION_REFUSALS, PROMOTION_STATUSES, PROMO_ACTS, actHref, actsFor, codeKey, consoleState, couponCreateBody, couponEntries,
  couponPanelHref, couponStatusKey, cursorFrom, deleteHref, failureCodesFrom, isMoneyField, localToIso, moneyStateKey, outcomeKey, promoStatusKey, promotionCreateBody,
  promotionEntries, retryIsMutation, rupeesToMinor, typeLabel, usesKey,
} from '../features/promos/offers';
import { holdNoteKey } from '../features/wallet/org-console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/promotions', rel), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]); };
const PAGES = [
  'app/marketplace/offers/page.tsx', 'app/marketplace/offers/loading.tsx', 'app/marketplace/offers/ReviewTable.tsx',
  'app/marketplace/offers/new/page.tsx', 'app/marketplace/offers/new/actions.ts',
  'app/marketplace/offers/[id]/act/page.tsx', 'app/marketplace/offers/[id]/act/actions.ts',
  'app/marketplace/offers/coupons/page.tsx', 'app/marketplace/offers/coupons/loading.tsx',
  'app/marketplace/offers/coupons/new/page.tsx', 'app/marketplace/offers/coupons/new/actions.ts',
  'app/marketplace/offers/coupons/[id]/delete/page.tsx', 'app/marketplace/offers/coupons/[id]/delete/actions.ts',
  'app/promotions/page.tsx', 'app/promotions/actions.ts',
];

describe('routes (W129, W2720–W2726, W130, W2539–W2545) · B9 / F-20', () => {
  it('every canon screen has a route; /promotions redirects to /marketplace/offers; /offers (listing offers) is untouched', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect(src('app/promotions/page.tsx')).toMatch(/redirect\(OFFERS_HREF\)/);
    expect(OFFERS_HREF).toBe('/marketplace/offers'); expect(COUPONS_HREF).toBe('/marketplace/offers/coupons');
    expect(src('app/offers/page.tsx')).not.toMatch(/promotions/);
  });
  it('the sidebar: promotions → /marketplace/offers labelled "Offers & promotions"; the listing-offers entry keeps its own label', () => {
    const side = src('components/Sidebar.tsx');
    expect(side).toMatch(/key: 'promotions', href: '\/marketplace\/offers', label: t\.t\('nav\.promotions'\)/);
    expect(side).toMatch(/key: 'offers', href: '\/offers', label: t\.t\('nav\.offers'\)/);
    expect(en['nav.promotions']).toBe('Offers & promotions'); expect(en['nav.offers']).toBe('Offers');
  });
  it('the old inline actions write nothing — they forward to the chains', () => {
    const a = src('app/promotions/actions.ts');
    expect(a).not.toMatch(/tenantClient/);
    expect(a).toMatch(/redirect\(`\$\{NEW_PROMOTION_HREF\}\?step=edit`\)/);
  });
});

describe('the pages keep the chain promises', () => {
  it('no client JS; keys minted on the review page; the shared chains imported', () => {
    for (const p of PAGES.filter((x) => x.endsWith('.tsx'))) expect(src(p)).not.toMatch(/^'use client'/m);
    expect(src('app/marketplace/offers/new/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(src('app/marketplace/offers/coupons/new/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    for (const p of ['app/marketplace/offers/new/page.tsx', 'app/marketplace/offers/coupons/new/page.tsx']) expect(src(p)).toMatch(/features\/forms\/chain/);
    for (const p of ['app/marketplace/offers/[id]/act/page.tsx', 'app/marketplace/offers/coupons/[id]/delete/page.tsx']) expect(src(p)).toMatch(/features\/mutate\/chain/);
  });
  it('B8 / F-19 · flagged off prints the canon words (never notFound()); restricted is its own state; Retry on a load error', () => {
    for (const p of ['app/marketplace/offers/page.tsx', 'app/marketplace/offers/coupons/page.tsx']) {
      const s = src(p);
      expect(s).not.toMatch(/notFound\(\)/);
      expect(s).toMatch(/env\.featurePromotions/);
      expect(s).toMatch(/state === 'error' && <p><Link/);
    }
    expect(src('app/marketplace/offers/coupons/page.tsx')).toMatch(/cpn\.state\.flaggedOff\.ridesPromotions/);
    expect(consoleState(undefined, 404)).toBe('flaggedOff');
    expect(consoleState(undefined, 403)).toBe('restricted');
    expect(consoleState('AUDITOR_READ_ONLY', 403)).toBe('restricted');
    expect(consoleState(undefined, 500)).toBe('error');
    expect(en['promo.state.flaggedOff.body']).toBe('This module is switched off for this tenant/plan (feature flag). Nothing is broken — it is not enabled. See plan settings.');
  });
  it('A6 / F-2 · the money note is the brief\'s sentence, on W129 and both form chains', () => {
    expect(en['promo.moneyNote']).toBe('Promotion money is reserved from your organisation wallet when a coupon is applied and released to the seller at settlement.');
    for (const p of ['app/marketplace/offers/page.tsx', 'app/marketplace/offers/new/page.tsx', 'app/marketplace/offers/coupons/new/page.tsx']) expect(src(p)).toMatch(/promo\.moneyNote/);
  });
  it('the KPI is "GMV of coupon orders (30d)", never "Attributed"', () => {
    expect(en['promo.kpi.gmv']).toBe('GMV of coupon orders (30d)');
    expect(Object.values(en).join(' ')).not.toMatch(/Attributed GMV/);
  });
  it('B7 / F-24 · the form offers ONLY the engine types; a label type reads "no engine — label only"', () => {
    expect([...ENGINE_TYPES]).toEqual(listOf(api('domain/promotions.events.ts'), 'export const ENGINE_PROMO_TYPES', 'as const'));
    expect([...NO_ENGINE_TYPES]).toEqual(listOf(api('domain/promotions.events.ts'), 'export const NO_ENGINE_PROMO_TYPES', 'as const'));
    expect(src('app/marketplace/offers/new/page.tsx')).toMatch(/ENGINE_TYPES\.map/);
    expect(typeLabel({ promoType: 'cashback', hasEngine: false, rules: { discountType: 'percent' } })).toEqual({ key: 'promo.type.cashback', noEngine: true });
    expect(typeLabel({ promoType: 'festival', hasEngine: true, rules: { discountType: 'flat' } })).toEqual({ key: 'promo.type.festival.flat', noEngine: false });
    expect(en['promo.type.noEngine']).toBe('no engine — label only');
    expect(en['promo.status.exhausted']).toBe('ended (budget cap)');
  });
});

describe('every list is the API\'s own', () => {
  it('statuses, outcomes, refusals, fields', () => {
    expect([...PROMOTION_STATUSES].sort()).toEqual(listOf(api('domain/promotion.state.ts'), 'PROMOTION_STATUSES', 'as const').sort());
    expect([...COUPON_OUTCOMES]).toEqual(listOf(api('domain/coupon-outcome.ts'), 'export const COUPON_OUTCOMES', 'as const'));
    expect([...PROMOTION_REFUSALS]).toEqual(listOf(api('domain/promotion.rules.ts'), 'export const PROMOTION_REFUSALS', 'as const'));
    expect([...COUPON_REFUSALS]).toEqual(listOf(api('domain/promotion.rules.ts'), 'export const COUPON_REFUSALS', 'as const'));
    expect([...PROMOTION_FIELDS]).toEqual(listOf(api('domain/promotion.rules.ts'), 'export const PROMOTION_FIELDS', 'as const'));
    expect([...COUPON_FIELDS]).toEqual(listOf(api('domain/promotion.rules.ts'), 'export const COUPON_FIELDS', 'as const'));
    expect([...DISCOUNT_TYPES]).toEqual(listOf(api('domain/promotions.events.ts'), 'export const DISCOUNT_TYPES', 'as const'));
    const status = listOf(api('read-models/offers.read-model.ts'), "export type CouponStatus", ';');
    expect([...COUPON_STATUSES].filter((s) => !(PROMOTION_STATUSES as readonly string[]).includes(s))).toEqual(status);
    expect([...MONEY_STATES]).toEqual(listOf(api('read-models/offers.read-model.ts'), 'export type RedemptionMoneyState', ';'));
  });
});

describe('helpers', () => {
  it('acts: pause a running one, resume a paused one, nothing on a spent or ended one', () => {
    expect(actsFor('active')).toEqual(['pause']); expect(actsFor('scheduled')).toEqual(['pause']); expect(actsFor('paused')).toEqual(['resume']);
    expect(actsFor('exhausted')).toEqual([]); expect(actsFor('expired')).toEqual([]);
    expect(actHref('p 1', 'pause')).toBe('/marketplace/offers/p%201/act?step=confirm&act=pause');
    expect(deleteHref('c1')).toBe('/marketplace/offers/coupons/c1/delete?step=confirm');
    expect(couponPanelHref('c1', 'k')).toBe('/marketplace/offers/coupons?coupon=c1&cursor=k');
    expect(retryIsMutation()).toBe(false);
    expect(cursorFrom('abc_-1')).toBe('abc_-1'); expect(cursorFrom('a b')).toBeUndefined();
  });
  it('rupees → paise on the digits; India time → an instant', () => {
    expect(rupeesToMinor('1,250.5')).toBe('125050'); expect(rupeesToMinor('')).toBeUndefined(); expect(rupeesToMinor('12.345')).toBe('invalid');
    expect(localToIso('2026-07-01T00:00')).toBe('2026-06-30T18:30:00.000Z'); expect(localToIso('tomorrow')).toBe('invalid'); expect(localToIso('')).toBeUndefined();
    expect(isMoneyField('budgetMinor')).toBe(true); expect(isMoneyField('percentOff')).toBe(false);
  });
  it('the review entries and the create body', () => {
    const e = promotionEntries({ name: 'Kharif 5%', promoType: 'discount', discountType: 'percent', percentOff: '5', maxDiscount: '200', budget: '40000', starts: '2026-07-01T00:00', ends: '2026-07-31T23:59' });
    expect(e).toMatchObject({ defaultName: 'Kharif 5%', percentOff: '5', maxDiscountMinor: '20000', budgetMinor: '4000000', amountOffMinor: undefined });
    expect(promotionCreateBody(e)).toEqual({ promoType: 'discount', defaultName: 'Kharif 5%', rules: { discountType: 'percent', percentOff: 5, maxDiscountMinor: '20000' }, budgetMinor: '4000000', startsAt: e.startsAt, endsAt: e.endsAt });
    expect(couponCreateBody(couponEntries({ promotionId: 'p1', code: 'KHARIF5', perUserLimit: '2' }))).toEqual({ promotionId: 'p1', code: 'KHARIF5', perUserLimit: 2 });
  });
  it('codes → sentences; failures list every refusal', () => {
    expect(codeKey('BUDGET_REQUIRED')).toBe('promo.code.BUDGET_REQUIRED'); expect(codeKey('CODE_TAKEN')).toBe('cpn.code.CODE_TAKEN');
    expect(codeKey('REASON_REQUIRED')).toBe('promo.act.code.REASON_REQUIRED'); expect(codeKey('???')).toBe('promo.act.code.unknown');
    expect(failureCodesFrom({ refusals: [{ code: 'BUDGET_REQUIRED' }, { code: 'NAME_INVALID' }] }, 'PROMOTION_REFUSED')).toEqual(['BUDGET_REQUIRED', 'NAME_INVALID']);
    expect(failureCodesFrom(null, 'PROMOTION_NOT_PAUSABLE')).toEqual(['PROMOTION_NOT_PAUSABLE']);
  });
  it('the W143 hold card now names the promotion reservation (the hold account has a writer)', () => {
    expect(holdNoteKey('nothing_reserved')).toBe('wal.holdNothingReserved'); expect(holdNoteKey('promotion_reservations')).toBe('wal.holdPromotionReservations');
  });
});

describe('i18n ×3 — literal keys and every dynamic family', () => {
  const PAGE_SRC = PAGES.map(src).join('\n');
  const literal = [...new Set([...PAGE_SRC.matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]))];
  it('every literal key exists in en, hi and gu with the same {vars}', () => {
    expect(literal.length).toBeGreaterThan(100);
    for (const k of literal) { three(k); expect(vars(hi[k as keyof typeof hi] as string)).toEqual(vars(en[k as keyof typeof en] as string)); expect(vars(gu[k as keyof typeof gu] as string)).toEqual(vars(en[k as keyof typeof en] as string)); }
  });
  it('every dynamic family exists ×3', () => {
    const dyn = [
      ...PROMOTION_STATUSES.map(promoStatusKey), promoStatusKey('?'), ...COUPON_STATUSES.map(couponStatusKey), couponStatusKey('?'),
      ...COUPON_OUTCOMES.map(outcomeKey), outcomeKey('?'), ...MONEY_STATES.map(moneyStateKey), moneyStateKey(null),
      ...PROMOTION_REFUSALS.map(codeKey), ...COUPON_REFUSALS.map(codeKey), ...ACT_CODES.map(codeKey),
      ...PROMOTION_FIELDS.map((f) => `promo.field.${f}`), ...COUPON_FIELDS.map((f) => `cpn.field.${f}`),
      ...ENGINE_TYPES.flatMap((t) => [`promo.type.${t}.name`, `promo.type.${t}.percent`, `promo.type.${t}.flat`]), ...NO_ENGINE_TYPES.flatMap((t) => [`promo.type.${t}`, `promo.type.${t}.name`]), 'promo.type.unknown',
      ...DISCOUNT_TYPES.map((d) => `promo.discount.${d}`), usesKey(null), usesKey(5),
      ...PROMO_ACTS.flatMap((a) => [`promo.act.${a}`, `promo.act.rule.${a}`, `promo.act.notOffered.${a}`, `promo.act.done.${a}`]),
      ...['flaggedOff', 'restricted', 'error', 'notFound'].flatMap((s) => [`promo.state.${s}.title`, `promo.state.${s}.body`, `cpn.state.${s}.title`, `cpn.state.${s}.body`]),
      'cpn.panel.buyer', 'cpn.panel.buyerPlace', 'wal.holdNothingReserved', 'wal.holdPromotionReservations',
    ];
    for (const k of dyn) { three(k); expect(vars(hi[k as keyof typeof hi] as string)).toEqual(vars(en[k as keyof typeof en] as string)); expect(vars(gu[k as keyof typeof gu] as string)).toEqual(vars(en[k as keyof typeof en] as string)); }
  });
  it('the 10b catalogue is in each language\'s own script (hi Devanagari, gu Gujarati)', () => {
    expect(hi['promo.moneyNote' as keyof typeof hi]).toMatch(/[ऀ-ॿ]/);
    expect(gu['promo.moneyNote' as keyof typeof gu]).toMatch(/[઀-૿]/);
  });
});
