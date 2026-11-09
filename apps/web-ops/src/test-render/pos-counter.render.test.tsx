// apps/web-ops/src/test-render/pos-counter.render.test.tsx · PC-56 OPS-3a · THE COUNTER — what a person at the counter SEES:
//   pos-home (W360)    the centre's day sheet per shift, the priced sum with its held/rejected caveat AND the server's split, the shift hours; no input;
//   pos-collect (W361) the roll by member code only (the fixture's names and phones never print), the date today by default and never after it,
//                      "typed here by you"; the four states before a centre (no custody → no form);
//   pos-quality (W362) the numbers as typed with their units, "typed … not read from a scale or an analyser", "Record this pour" — no "accept", no
//                      per-kg rate, no retest act, no price before recording;
//   pos-slip (W363)    "What was recorded": member code, readings, the server's price, the card's name and start date, the hold; no slip number, QR,
//                      print, SMS; her milk diary and her bill's window;
//   pos-exceptions (W364) reads nothing, zero controls, the three cannot-statements;
//   pos-shift (W365)   the server totals labelled, the cooler's stated level and latest reading with their times (no fill %), close refused, no
//                      variance, no /bmc link.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PosCollectView, PosExceptionsView, PosHomeView, PosQualityView, PosShiftView, PosSlipView } from '../components/ops3/CounterViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { C1, CARD, CENTRE, CENTRE_2, FALSE_3A, POUR, RECORDED, ROLL, ROWS, ROW_AMOUNTS, TILES, TODAY } from './ops3a-fixtures';

const NEG = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b/i;
/** Visible text with every NEGATED sentence dropped — what the page affirms. */
const affirmed = (html: string) => visible(html).split(/(?<=[.!?])\s+/).filter((s) => !NEG.test(s)).join(' ');
const amounts = (html: string) => [...new Set(visible(html).match(/₹\s?[\d,]+(\.\d+)?/g) ?? [])].sort();
const noop = async () => undefined;
const t = tr(en);

const home = (over: Partial<React.ComponentProps<typeof PosHomeView>> = {}) =>
  renderToStaticMarkup(<PosHomeView t={t} lang="en" state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} {...over} />);
const collect = (over: Partial<React.ComponentProps<typeof PosCollectView>> = {}) =>
  renderToStaticMarkup(<PosCollectView t={t} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} roll={ROLL} code={null} nextCursor={null} error={null} {...over} />);
const quality = (cat: Record<string, string> = en) =>
  renderToStaticMarkup(<PosQualityView t={tr(cat)} centre={CENTRE} pour={POUR} memberCode="TC-001" milkType="cow" idemKey="0192d2c4-1d1d-7000-8000-000000000001" action={noop} back={`/pos/collect?mcc=${C1}`} />);
const slip = (cat: Record<string, string> = en) =>
  renderToStaticMarkup(<PosSlipView t={tr(cat)} lang="en" state="ok" pour={RECORDED} card={CARD} cardRead={true} centre={CENTRE} />);
const shift = (over: Partial<React.ComponentProps<typeof PosShiftView>> = {}) =>
  renderToStaticMarkup(<PosShiftView t={t} lang="en" state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} cooler="ok" tiles={TILES} {...over} />);

describe('PC-56 OPS-3a · pos-home (W360) — the centre\'s day, read', () => {
  const h = home();
  it('per shift: pours, kg, the priced sum WITH its caveat, the server\'s split, the flagged count; an empty shift says so', () => {
    expect(h).toContain('data-kv-totals="morning"'); expect(h).toContain('data-kv-empty="shift-evening"');
    expect(text(h)).toContain('Held or rejected pours are inside this figure.');
    expect(h).toContain('data-kv-amount="all" data-kv-minor="120000"');
    for (const k of ['payable', 'held', 'rejected']) expect(h).toContain(`data-kv-split-row="${k}"`);
    expect(amounts(h)).toEqual([...ROW_AMOUNTS].sort());
    expect(h).toContain('data-kv-kg="31.500"'); expect(text(h)).toContain('31.500 kg');
    expect(h).toMatch(/data-kv-count="flagged">2</);
  });
  it('the recorded hours, or "not recorded"; signed in as you; the links to record, the shift totals and the problems', () => {
    expect(text(h)).toContain('hours 06:00 to 09:30'); expect(text(h)).toContain('hours not recorded for this centre');
    expect(h).toContain('data-kv-signed-in="you"'); expect(text(h)).toContain('Signed in as you.');
    expect(h).toContain(`href="/pos/collect?mcc=${C1}"`); expect(h).toContain(`href="/pos/shift-close?mcc=${C1}"`); expect(h).toContain('href="/pos/exceptions"');
  });
  it('no input, no "of N", no "%", no average; nothing the canon claims is affirmed', () => {
    expect(CONTROLS.test(h)).toBe(false);
    expect(/%|\bof ~?\d|average|avg/i.test(visible(h))).toBe(false);
    expect(FALSE_3A.test(affirmed(h))).toBe(false);
  });
  it('the states: no custody, switched off, forbidden, error — and several centres are picked by a LINK', () => {
    for (const s of ['noCustody', 'off', 'forbidden', 'error'] as const) {
      const x = home({ state: s, centre: null, centres: [], rows: null });
      expect([s, x.includes(`data-kv-state="${s}"`), CONTROLS.test(x)]).toEqual([s, true, false]);
    }
    expect(text(home({ state: 'noCustody', centre: null, centres: [] }))).toContain('No centre is in your custody, so this counter lists no members and records no pour.');
    const pick = home({ centre: null, centres: [CENTRE, CENTRE_2] });
    expect(pick).toContain(`href="/pos/home?mcc=${C1}"`); expect(CONTROLS.test(pick)).toBe(false);
  });
});

describe('PC-56 OPS-3a · pos-collect (W361) — the record form', () => {
  const h = collect();
  it('the roll is member codes only — the fixture\'s names and phones never print', () => {
    for (const m of ROLL) expect(text(h)).toContain(m.memberCode);
    expect(/Name Of|\+91/.test(h)).toBe(false);
    expect(text(h)).toContain('Members are shown by member code only. Search is by member code.');
  });
  it('the date is the organisation\'s today by default and never after it; "typed here by you"', () => {
    expect(h).toMatch(/name="collectedOn" type="date"[^>]*max="2026-11-09"/); expect(h).toMatch(/name="collectedOn"[^>]*value="2026-11-09"/);
    expect(text(h)).toContain('Weight, fat and SNF are typed here by you. Nothing is read from a scale or an analyser, and her pay is computed from what you type.');
    expect(text(h)).toContain('Only one pour can be recorded for a member in each shift.');
  });
  it('inputs (E7): the code search and the record form only — the form is a GET to the check step; nothing records here', () => {
    expect((h.match(/<form/g) ?? []).length).toBe(2);
    expect(h).toMatch(/<form method="get" action="\/pos\/quality"/);
    expect((h.match(/<select/g) ?? []).length).toBe(1);
    expect(/<form [^>]*method="post"|formAction/i.test(h)).toBe(false);
  });
  it('no custody → no roll, no form; an error reason is named', () => {
    const none = collect({ state: 'noCustody', centre: null, centres: [], roll: null });
    expect(/<form|<select/.test(none)).toBe(false);
    expect(text(collect({ error: 'future' }))).toContain('A pour cannot be recorded for a day after today.');
    expect(text(collect({ roll: [], code: 'ZZ' }))).toContain('No member of your centre has a code starting like that.');
  });
  it('nothing the canon claims is affirmed (no card scan, photo, accept, machine reading)', () => {
    expect(FALSE_3A.test(affirmed(h))).toBe(false);
    expect(/photo/i.test(affirmed(h))).toBe(false);
  });
});

describe('PC-56 OPS-3a · pos-quality (W362) — the check step', () => {
  const h = quality();
  it('the numbers as typed, with their units; the typed label; "Record this pour"', () => {
    expect(h).toContain('data-kv-member-code="TC-001"');
    expect(text(h)).toContain('10.500 kg'); expect(text(h)).toContain('4.10%'); expect(text(h)).toContain('8.50%');
    expect(text(h)).toContain('These numbers were typed by the person at this counter — not read from a scale or an analyser.');
    expect(text(h)).toContain('Her pay is computed from them, and they cannot be changed afterwards.');
    expect(text(h)).toContain('A recorded pour cannot be corrected here.');
    expect(text(h)).toContain('She can check this pour in her milk diary and object to her bill in its window.');
    expect(h).toMatch(/<button type="submit" class="kv-btn" data-kv-real="record">Record this pour<\/button>/);
  });
  it('no "accept", no derived per-kg rate, no price at all before recording, no retest act', () => {
    expect(/accept/i.test(affirmed(h))).toBe(false);
    expect(/₹/.test(visible(h))).toBe(false);
    expect(/per kg of milk|\/kg|per kilo/i.test(visible(h))).toBe(false);
    expect(/retest/i.test(visible(h))).toBe(false);
    expect((h.match(/<button/g) ?? []).length).toBe(1);
    expect(h.match(/<input [^>]*>/g)!.every((i) => /type="hidden"/.test(i))).toBe(true);
    expect(FALSE_3A.test(affirmed(h))).toBe(false);
  });
  it('the flags are named, and that a flag holds this pour\'s payment only', () => {
    expect(h).toContain('data-kv-flags="waterSuspected,urea"');
    expect(text(h)).toContain('A flag holds this pour\'s payment only; her other pours are not held.');
  });
  it('the record button reads "Record this pour" in every language (never W362\'s "मंजूर" / "મંજૂર")', () => {
    for (const cat of [hi, gu]) {
      const x = quality(cat);
      expect(x).toContain(`data-kv-real="record">${cat['ops3.pos.recordBtn']}</button>`);
      expect(/मंजूर|મંજૂર/.test(cat['ops3.pos.recordBtn'])).toBe(false);
    }
  });
});

describe('PC-56 OPS-3a · pos-slip (W363) — what was recorded', () => {
  const h = slip();
  it('member code, the readings, the server\'s price, the card\'s name and start date, the hold, the server time', () => {
    expect(text(h)).toContain('What was recorded');
    expect(h).toContain('data-kv-member-code="TC-001"');
    expect(amounts(h)).toEqual(['₹430.50']);
    expect(text(h)).toContain(`"${CARD.defaultName}", starting ${CARD.effectiveFrom}`);
    expect(h).toContain('data-kv-hold="held"'); expect(text(h)).toContain('held until a decision is recorded');
    expect(text(h)).toContain('2026-11-09 01:12 UTC');
    expect(text(h)).toContain('She can check this pour in her milk diary and object to her bill in its window.');
    expect(text(h)).toContain('This pour is recorded on the platform, not on paper.');
  });
  it('no slip number, QR, print, reprint, SMS or 10-day bill; no name; no derived rate', () => {
    expect(/slip no|slip number|\bQR\b|reprint|\bSMS\b|10-day|printed/i.test(affirmed(h))).toBe(false);
    // "slip no." carries the word "no" itself, so the negation filter above cannot see it: checked PLAIN on the visible text (found by mutant M9)
    expect(/slip no\.|slip #|slip number \S*\d/i.test(visible(h))).toBe(false);
    expect(h.includes(RECORDED.id) && /data-kv-recorded=/.test(h)).toBe(true);   // the id is an attribute only, never text
    expect(text(h).includes(RECORDED.id)).toBe(false);
    expect(/\/kg|per kg of milk/i.test(visible(h))).toBe(false);
    expect(CONTROLS.test(h)).toBe(false);
  });
  it('nothing recorded from this browser → the empty state; the card unread → "not read" + Retry (a re-read)', () => {
    const none = renderToStaticMarkup(<PosSlipView t={t} lang="en" state="none" pour={null} card={null} cardRead={false} centre={null} />);
    expect(none).toContain('data-kv-state="none"'); expect(/₹/.test(none)).toBe(false);
    const unread = renderToStaticMarkup(<PosSlipView t={t} lang="en" state="ok" pour={RECORDED} card={null} cardRead={false} centre={CENTRE} />);
    expect(unread).toMatch(/<a [^>]*href="\/pos\/slip"[^>]*data-kv-retry="reread"|<a [^>]*data-kv-retry="reread"[^>]*href="\/pos\/slip"/);
  });
});

describe('PC-56 OPS-3a · pos-exceptions (W364) — honest, reads nothing', () => {
  const h = renderToStaticMarkup(<PosExceptionsView t={t} />);
  it('zero controls; the correction, second-pour and one-typer statements; what she can do', () => {
    expect(CONTROLS.test(h)).toBe(false);
    for (const k of ['ops3.pos.cannotCorrect', 'ops3.pos.onePour', 'ops3.pos.ex.oneTyper', 'ops3.pos.ex.noSlip', 'ops3.pos.diary', 'ops3.pos.flagHolds'])
      expect([k, text(h).includes(en[k])]).toEqual([k, true]);
    expect(/data-kv-retry/.test(h)).toBe(false);   // W364's canon Retry is DECOR: nothing to read again
    expect(FALSE_3A.test(affirmed(h))).toBe(false);
    expect(/₹|%/.test(visible(h))).toBe(false);
  });
});

describe('PC-56 OPS-3a · pos-shift (W365) — the shift\'s totals, read', () => {
  const h = shift();
  it('the server totals labelled and split; this centre\'s cooler only, its stated level and latest reading with their times', () => {
    expect(amounts(h)).toEqual([...ROW_AMOUNTS].sort());
    expect(text(h)).toContain('Held or rejected pours are inside this figure.');
    expect(text(h)).toContain('1200 L of a 2000 L tank, stated at 2026-11-09 02:30 UTC');
    expect(text(h)).toContain('3.9 °C, 12 minutes before this page was read');
    expect(/777|9\.9/.test(text(h))).toBe(false);                 // the other centre's cooler is not shown
    expect(text(h)).toContain('A cooler\'s level is stated by a person, not measured by a sensor.');
  });
  it('no fill %, no variance, no difference worked out; "Close shift" refused by name; no /bmc link; no input', () => {
    expect(/%/.test(visible(h))).toBe(false); expect(/\b60\b/.test(text(h))).toBe(false);
    expect(/SN-SECRET/.test(h)).toBe(false);
    expect(h).toContain('data-kv-refused-act="close_shift"');
    expect(text(h)).toContain('Close shift: not available.');
    expect(/href="\/bmc/.test(h)).toBe(false); expect(text(h)).toContain('There is no cooler page on this console.');
    expect(CONTROLS.test(h)).toBe(false);
    expect(FALSE_3A.test(affirmed(h))).toBe(false);
    expect(/close (this |the )?shift/i.test(affirmed(h))).toBe(false);
  });
  it('the cooler switched off, unread (with a Retry that re-reads) or absent', () => {
    expect(text(shift({ cooler: 'off' }))).toContain('The cooler monitor is switched off for this organisation.');
    const err = shift({ cooler: 'error' });
    expect(text(err)).toContain('The cooler could not be read.'); expect(err).toContain(`href="/pos/shift-close?mcc=${C1}"`);
    expect(text(shift({ cooler: 'none', tiles: [] }))).toContain('No cooler is registered at this centre.');
  });
});
