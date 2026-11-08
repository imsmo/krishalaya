// apps/web-ops/src/test-render/rates.render.test.tsx · PC-56 OPS-3c · W368 /rates — A READ OF THE APPROVED MILK RATE CARDS (founder Q1-A via
// HOTFIX-12, Q8-A, Q10-A, Q14-A, Q15-A). Every approved, active card per milk type; a card awaiting a second person or inactive NEVER shown as one
// that prices; two approved cards of one milk type covering one day raised as an ERROR; every rate the server's string through the money
// formatter, "per kg of fat / SNF / milk" (Q8-A); the slabs and whether they are paid; the rule in words — no grid, no "×", no worked example;
// no "versioned"; the change sentence exactly as built, in en, hi and gu; zero inputs; the states; the DECOR poster act.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DairyRateCard } from '@krishalaya/sdk-js';
import { RatesView } from '../components/ops3/RatesView';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS3_REFUSALS } from '../features/ops3/refusals';
import type { RatesState, SlabsPaid } from '../features/ops3/rates';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { AWAITING, BUFFALO, CARDS_3C, COW_BEFORE, COW_CLASH, COW_NOW, FALSE_3C, INACTIVE, RATES_PRINTED_3C } from './ops3c-fixtures';

const render = (cat: Record<string, string>, state: RatesState, cards: readonly DairyRateCard[] = CARDS_3C, slabs: SlabsPaid = 'off') =>
  renderToStaticMarkup(<RatesView t={tr(cat)} lang="en" state={state} cards={cards} slabs={slabs} />);
const html = render(en, 'ok');
const CHANGE = ['ops3.rates.notHere', 'ops3.rates.secondPerson', 'ops3.rates.tomorrow', 'ops3.rates.recorded', 'ops3.rates.oneInForce', 'ops3.rates.told'];

describe('PC-56 OPS-3c · /rates prints every approved card in force — never a sum, never a card that prices nothing', () => {
  it('every approved, active card is shown, grouped by milk type in the server\'s order; the awaiting and the inactive card are NOT', () => {
    for (const c of [COW_NOW, COW_BEFORE, BUFFALO]) expect([c.id, html.includes(`data-kv-card="${c.id}"`)]).toEqual([c.id, true]);
    for (const c of [AWAITING, INACTIVE]) {
      expect([c.id, html.includes(c.id)]).toEqual([c.id, false]);
      expect([c.defaultName, text(html).includes(c.defaultName)]).toEqual([c.defaultName, false]);
    }
    expect(Array.from(html.matchAll(/data-kv-milk-type="(\w+)"/g)).map((m) => m[1])).toEqual(['buffalo', 'cow']);
    expect(html).not.toContain('data-kv-approval="awaiting_second_person"');
    expect(text(html)).toContain('Approved by a second person'); expect(text(html)).toContain('On record before the second-person rule; it keeps pricing');
  });
  it('a list of ONLY a card awaiting a second person is the "No active card" state, with the true NO_ACTIVE_RATE_CARD sentence', () => {
    const h = render(en, 'ok', [AWAITING]);
    expect(h).toContain('data-kv-empty="rates"'); expect(h.includes(AWAITING.id)).toBe(false);
    expect(text(h)).toContain('No active card');
    expect(en['ops3.rates.noActive']).toBe('The counter refuses to record a pour when no approved card for its milk type is in force on that day.');
    expect(text(h)).toContain(en['ops3.rates.noActive']);
  });
  it('two approved cards of one milk type covering one day are raised as an error, naming both; none when the days only touch', () => {
    const h = render(en, 'ok', [COW_NOW, COW_CLASH, BUFFALO]);
    expect((h.match(/data-kv-error="overlap"/g) ?? []).length).toBe(1);
    expect(h).toMatch(/role="alert" data-kv-error="overlap"/);
    expect(text(h)).toContain('Two approved cards for Cow milk, "Test cow card" and "Clashing cow card", cover at least one same day.');
    expect(/data-kv-error="overlap"/.test(html)).toBe(false);   // COW_BEFORE ends the day before COW_NOW starts — no clash
  });
  it('every rate is the server string through the money formatter, labelled per kg of fat / SNF / milk (Q8-A); nothing else is an amount', () => {
    for (const r of RATES_PRINTED_3C) expect([r, text(html).includes(r)]).toEqual([r, true]);
    const amounts = visible(html).match(/₹\s?[\d,]+(\.\d+)?/g) ?? [];
    expect([...new Set(amounts)].sort()).toEqual([...RATES_PRINTED_3C].sort());
    expect(html).toContain('data-kv-rate="fat" data-kv-minor="68100"'); expect(html).toContain('data-kv-rate="base" data-kv-minor="125"');
    expect(text(html)).toContain('₹681.00 per kg of fat'); expect(text(html)).toContain('₹233.00 per kg of SNF'); expect(text(html)).toContain('₹1.25 per kg of milk');
    expect(text(html)).toContain('No base rate on this card');
    expect(html).not.toContain('data-kv-rate-row="snf"><dt>SNF rate</dt><dd><span data-kv-rate="snf" data-kv-minor="none"');   // fat_pooled shows no SNF line at all
    expect((html.match(/data-kv-rate-row="snf"/g) ?? []).length).toBe(2);
  });
  it('no grid, no worked example, no "×", "=", "+" or "÷" on the page; no "versioned"; no litre; no canon person or figure', () => {
    expect(/[×=+÷]/.test(visible(html))).toBe(false);
    expect(FALSE_3C.test(visible(html))).toBe(false);
    expect(/<table/.test(html)).toBe(false);
    expect(/versioned/i.test(text(html))).toBe(false);
    expect(/per kg of milk/.test(text(html))).toBe(true);
  });
  it('% appears only as a slab reading\'s own unit (a measurement, E3), never as a ratio', () => {
    const outsideSlabs = visible(html.replace(/<li [^>]*data-kv-slab="[^"]*"[\s\S]*?<\/li>/g, ''));
    expect(/%/.test(outsideSlabs)).toBe(false);
    expect(text(html)).toContain('fat reading at or above 6.50%: ₹0.47 per kg of milk');
  });
  it.each([['off', 'Premium slabs are switched off, so nobody is being paid a premium.'],
    ['on_platform', 'Premium slabs are switched on for the platform; whether they are paid for your organisation is not shown on this page.'],
    ['unknown', 'Whether premium slabs are being paid could not be read.']] as const)('slabs %s: the sentence is printed as built', (s, sentence) => {
    const h = render(en, 'ok', CARDS_3C, s);
    expect(h).toContain(`data-kv-slabs-paid="${s}"`); expect(text(h)).toContain(sentence);
  });
  it('with no card promising a slab, the page says so and claims nothing about payment', () => {
    const h = render(en, 'ok', [BUFFALO]);
    expect(h).toContain('data-kv-slabs-paid="no_slabs"'); expect(text(h)).toContain('These cards promise no premium slab.');
  });
  it('the rule in WORDS for each model present, the base and slab lines only as they apply, and the priced-once sentence', () => {
    for (const k of ['ops3.rates.rule.two_axis', 'ops3.rates.rule.fat_pooled', 'ops3.rates.rule.base', 'ops3.rates.rule.slabs', 'ops3.rates.pricedBy', 'ops3.rates.neverRepriced'])
      expect([k, text(html).includes(en[k])]).toEqual([k, true]);
    expect(text(html).includes(en['ops3.rates.rule.snf_pooled'])).toBe(false);
    expect(en['ops3.rates.rule.two_axis']).toBe('Fat and SNF: the kilograms of fat in the milk times the fat rate, plus the kilograms of SNF times the SNF rate, each rounded to the paisa.');
    const b = render(en, 'ok', [BUFFALO]);
    expect([text(b).includes(en['ops3.rates.rule.base']), text(b).includes(en['ops3.rates.rule.slabs'])]).toEqual([false, false]);
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the change sentence exactly as built, in ok / none / error; no change button', (_l, cat) => {
    for (const s of ['ok', 'none', 'error'] as const) {
      const h = render(cat, s, s === 'ok' ? CARDS_3C : []);
      for (const k of CHANGE) expect([s, k, h.includes(`data-kv-statement="${k}"`), text(h).includes(cat[k])]).toEqual([s, k, true, true]);
    }
    expect(/createRateCard|approveRateCard|data-kv-act=/.test(render(cat, 'ok'))).toBe(false);
  });
  it('the change sentence in English, verbatim', () => {
    expect(en['ops3.rates.notHere']).toBe('Rates are changed on your organisation\'s dairy console, not here.');
    expect(en['ops3.rates.secondPerson']).toBe('A new card prices nothing until a second person approves it, and the person who created it cannot approve it.');
    expect(en['ops3.rates.tomorrow']).toBe('A new card starts tomorrow at the earliest.');
    expect(en['ops3.rates.recorded']).toBe('Every new card and every approval is recorded.');
    expect(en['ops3.rates.oneInForce']).toBe('Only one approved card is in force for each milk type on any day.');
    expect(en['ops3.rates.told']).toBe('When a new card is approved, the members whose milk it prices are sent a notice in their own language.');
  });
  it('zero inputs in every state (no input, select, textarea, form or button)', () => {
    for (const s of ['ok', 'none', 'error', 'off'] as const) expect([s, CONTROLS.test(render(en, s))]).toEqual([s, false]);
  });
  it('the switched-off state says so and nothing else of substance: no card, no sentence about money, no act', () => {
    const off = render(en, 'off');
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain(en['ops3.rates.off.body']);
    expect(/data-kv-card=|data-kv-decor=|data-kv-statement=/.test(off)).toBe(false);
  });
  it('the error state offers Retry → the PARITY-DECOR chain (?act=confirm) and shows no card', () => {
    const err = render(en, 'error', []);
    expect(err).toMatch(/<a [^>]*href="\/rates\?act=confirm"[^>]*data-kv-chain-link="retry"|<a [^>]*data-kv-chain-link="retry"[^>]*href="\/rates\?act=confirm"/);
    expect(/data-kv-card=/.test(err)).toBe(false);
  });
  it('"Print counter poster" is DECOR (to its chain, labelled not available); every W368 refusal is listed by name', () => {
    expect(html).toContain('href="/rates?export=queued"'); expect(text(html)).toContain('Print counter poster: not available');
    for (const r of OPS3_REFUSALS.filter((x) => x.surfaces.includes('rates'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it('no person: no id of a creator or approver, no member (Q10-A), no role claim (Q14-A)', () => {
    expect(/createdBy|approvedBy|member code|witness|supervisor|PIN\b/i.test(visible(html))).toBe(false);
  });
});
