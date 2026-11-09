// apps/web-ops/src/test-render/bmc.render.test.tsx · PC-56 OPS-3b · W366 · THE TANK — what a person at the centre SEES (founder Q12-A, Q13-A, Q10-A,
// Q14-A): the cooler at their custody centre — the latest reading with its age and the server's verdict, the band, the tank volume, the STATED level
// "stated by a person at" its time (never a "%"), the stated compressor, the server's 24-hour counts, the series as the server's points (one row
// each); another centre's cooler never shows; the manual reading labelled manual, one input, no photo field; "Request tanker dispatch" refused by
// name and never offered; band / level / compressor / retire NOT offered; the states (switched off ×2, forbidden, error with a re-read, no reading,
// no reading for N minutes).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BmcView } from '../components/ops3/BmcViews';
import { coolersFor, pickCooler } from '../features/ops3/bmc';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { C1, CENTRE, CENTRE_2, FALSE_3B, POINTS, T1, T_AWAY, T_NEVER, T_STALE, TILES, U1, U2 } from './ops3b-fixtures';

const NEG = /\b(not|no|never|nothing|none|cannot|nobody)\b|n't\b/i;
const affirmed = (html: string) => visible(html).split(/(?<=[.!?])\s+/).filter((s) => !NEG.test(s)).join(' ');
const inputs = (html: string) => (html.match(/<input\b[^>]*>/g) ?? []).filter((x) => !/type="hidden"/.test(x));
const page = (over: Partial<React.ComponentProps<typeof BmcView>> = {}, cat: Record<string, string> = en) => {
  const { scope, tiles } = coolersFor(TILES, [CENTRE]);
  return renderToStaticMarkup(<BmcView t={tr(cat)} state="ok" scope={scope} centres={[CENTRE]} tiles={tiles} cooler={pickCooler(tiles, null)} points={POINTS} {...over} />);
};

describe('PC-56 OPS-3b · bmc (W366) — the cooler, read', () => {
  const h = page();
  it('the latest reading, its age and the server\'s verdict; the band; the tank volume; the 24-hour counts as the server counted them', () => {
    expect(h).toContain(`data-kv-cooler="${U1}"`);
    expect(text(h)).toContain('3.9 °C, 12 minutes before this page was read');
    expect(h).toContain('data-kv-verdict="in_range"'); expect(text(h)).toContain('inside its band');
    expect(text(h)).toContain('2.0 °C to 4.5 °C');
    expect(text(h)).toContain('2000.00 L');
    expect(text(h)).toContain('41 readings, 3 of them outside the band (the server\'s counts)');
  });
  it('the STATED level "stated by a person at" its time — and no "%" anywhere, the fill ratio never printed', () => {
    expect(text(h)).toContain('1200.00 L, stated by a person at 2026-11-09 02:30 UTC');
    expect(/%/.test(visible(h))).toBe(false);
    expect(/\b60\b/.test(text(h))).toBe(false);
    expect(/SN-SECRET|u-op-secret/.test(h)).toBe(false);
  });
  it('the stated compressor, said to be stated; none stated → said so', () => {
    expect(text(h)).toContain('healthy, stated by a person at 2026-11-09 01:05 UTC');
    expect(text(page({ tiles: [T_STALE], cooler: T_STALE }))).toContain('Nobody has stated its condition.');
  });
  it('the series is the server\'s points, one row each, oldest first, with "outside the band" per row — nothing drawn between them', () => {
    expect((h.match(/data-kv-point="/g) ?? []).length).toBe(3);
    expect(h.indexOf('data-kv-point-temp="3.6"')).toBeLessThan(h.indexOf('data-kv-point-temp="5.1"'));
    expect(h).toContain('data-kv-point-out="yes"');
    expect(text(h)).toContain('Nothing is drawn or filled in between readings.');
    expect(/<svg|<canvas|<polyline|<path/i.test(h)).toBe(false);
    expect(text(page({ points: [] }))).toContain('No reading was recorded in the last 24 hours.');
  });
  it('only the custody centre\'s cooler: another centre\'s tank never shows', () => {
    expect(h).not.toContain(`data-kv-cooler="${U2}"`);
    expect(/777|9\.9|\b17 readings/.test(text(h))).toBe(false);
    expect(h).toContain('data-kv-scope="custody"');
  });
  it('a person who holds no centre: the organisation\'s coolers, said so (and each picked by a LINK)', () => {
    const { scope, tiles } = coolersFor(TILES, []);
    const o = renderToStaticMarkup(<BmcView t={tr(en)} state="ok" scope={scope} centres={[]} tiles={tiles} cooler={pickCooler(tiles, U2)} points={null} />);
    expect(o).toContain('data-kv-scope="organisation"');
    expect(text(o)).toContain('No centre is in your custody, so every cooler of your organisation is shown.');
    expect(o).toContain(`data-kv-cooler="${U2}"`); expect(o).toContain(`href="/bmc?unit=${U1}"`);
  });
  it('the manual reading: labelled MANUAL, the server\'s time, never a breach, the alert rule said, NO photo — and the only input on the page', () => {
    expect(h).toContain(`data-kv-form="manual-reading" data-kv-form-unit="${U1}"`);
    expect(text(h)).toContain('Log manual reading');
    expect(text(h)).toContain('A manual reading is typed by a person and recorded at the moment it is entered, by the server\'s clock.');
    expect(text(h)).toContain('It never opens a breach: a breach is opened only by two sensor readings in a row outside the band.');
    expect(text(h)).toContain('An alert rule your organisation set that counts readings outside the band counts it too.');
    expect(text(h)).toContain('No photo is taken or attached.');
    expect(inputs(h).length).toBe(1); expect(inputs(h)[0]).toContain('name="tempC"');
    expect(/type="file"|accept="image|capture=/i.test(h)).toBe(false);
    expect(/<select|<textarea/i.test(h)).toBe(false);
    expect((h.match(/<form/g) ?? []).length).toBe(1);
    expect(/name="recordedAt"/.test(h)).toBe(false);
  });
  it('"Request tanker dispatch" refused by name, never offered; band / level / compressor / retire NOT offered, said once', () => {
    expect(h).toContain('data-kv-refused-act="tanker_dispatch"');
    expect(text(h)).toContain('Request tanker dispatch: not available.');
    expect(h).toContain('data-kv-refusal="bmc_dispatch"');
    expect((h.match(/<button/g) ?? []).length).toBe(1);   // the form's "Check this reading", nothing else
    expect(/href="[^"]*(dispatch|tanker|band|level|compressor|retire)/i.test(h)).toBe(false);
    expect(text(h).match(/set on your organisation's dairy console, not here/g)?.length).toBe(1);
    expect(text(h)).toContain('This console reads the cooler and records manual readings only.');
  });
  it('no member, no name; "signed in as you"; nothing the canon claims is affirmed', () => {
    expect(h).toContain('data-kv-signed-in="you"');
    expect(FALSE_3B.test(affirmed(h))).toBe(false);
    expect(/member/i.test(affirmed(h))).toBe(false);
  });
  it('the states: never read; no reading for N minutes (true, of any source); switched off ×2; forbidden; error with a re-read', () => {
    expect(text(page({ tiles: [T_NEVER], cooler: T_NEVER }))).toContain('No temperature reading has been recorded for this cooler yet.');
    const st = page({ tiles: [T_STALE], cooler: T_STALE });
    expect(text(st)).toContain('No reading for 95 minutes, longer than your organisation\'s gap of 30 minutes.');
    expect(text(st)).toContain('The monitor does not say whether a reading came from a sensor or was typed by a person.');
    expect(/sensor (is )?silent/i.test(text(st))).toBe(false);
    for (const [s, want] of [['off', 'Dairy is switched off'], ['monitorOff', 'The cooler monitor is switched off'], ['forbidden', 'This page is not open to you'], ['error', 'The cooler could not be read']] as const) {
      const x = page({ state: s, tiles: [], cooler: null, points: null });
      expect([s, text(x).includes(want), /<form|<input/.test(x)]).toEqual([s, true, false]);
      expect([s, /plan settings|See .*settings/i.test(visible(x))]).toEqual([s, false]);
    }
    expect(page({ state: 'error', tiles: [], cooler: null, points: null })).toContain('href="/bmc?act=confirm"');
    expect(text(page({ tiles: [], cooler: null }))).toContain('No cooler is registered at these centres.');
  });
  it('the page renders in hi and gu with the same skeleton and every key present', () => {
    const sk = (x: string) => (x.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
    for (const cat of [hi, gu]) expect(sk(page({}, cat))).toBe(sk(h));
    for (const cat of [hi, gu]) expect(/ops3\.bmc\./.test(text(page({}, cat)))).toBe(false);
  });
  it('another centre named in ?mcc= (W365\'s link) opens that centre\'s cooler when it is shown', () => {
    expect(pickCooler([T1, T_AWAY], null, C1)?.unitId).toBe(U1);
    expect(pickCooler([T1, T_AWAY], null, CENTRE_2.id)?.unitId).toBe(U2);
    expect(pickCooler([T1], 'not-shown', null)?.unitId).toBe(U1);
  });
});
