// apps/web-ops/src/test-render/kiosk-home.render.test.tsx · PC-56 OPS-1c · W380 /kiosk/home — A READ of her OWN profile and newest earnings.
// The two facts printed as two facts (never "flips"); earnings exactly as returned (the money formatter; no total, no rate, no %); the canon's
// event codes never printed; the honest "no ambassador profile here" and "switched off" states; zero controls; links to every step W381–W389.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { KioskHomeView } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { KIOSK_STEPS, kioskReadState } from '../features/ops1/kiosk';
import { text, tr, visible, percents } from './ops1a-fixtures';
import { NONE, controls } from './ops1b-fixtures';
import { EARNINGS_1C, FALSE_1C, PROFILE_1C, PROFILE_UNTRAINED, SUMS_1C } from './ops1c-fixtures';

const T = tr(en);
const ok = renderToStaticMarkup(<KioskHomeView t={T} lang="en" state="ok" profile={PROFILE_1C} earnings={EARNINGS_1C} />);
const untrained = renderToStaticMarkup(<KioskHomeView t={T} lang="en" state="ok" profile={PROFILE_UNTRAINED} earnings={[]} />);
const none = renderToStaticMarkup(<KioskHomeView t={T} lang="en" state="none" profile={null} earnings={[]} />);
const off = renderToStaticMarkup(<KioskHomeView t={T} lang="en" state="off" profile={null} earnings={[]} />);
const err = renderToStaticMarkup(<KioskHomeView t={T} lang="en" state="error" profile={null} earnings={[]} />);

describe('PC-56 OPS-1c · /kiosk/home reads her own profile and earnings', () => {
  it('the profile as two separate facts: kiosk mode on/off and training recorded/not — never "flips"', () => {
    expect(text(ok)).toContain('Kiosk mode is switched on for your profile.');
    expect(text(ok)).toMatch(/Your training is recorded as complete on 1 Oct 2026\./);
    expect(text(ok)).toContain(en['ops1.kiosk.home.tierSet']);
    expect(text(untrained)).toContain('Kiosk mode is not switched on for your profile.');
    expect(text(untrained)).toContain('Your training is not recorded as complete.');
    expect(text(untrained)).toContain(en['ops1.kiosk.home.tierNone']);
    for (const h of [ok, untrained]) expect(/\bflips\b/i.test(visible(h))).toBe(false);
  });
  it('earnings exactly as returned: each amount through the money formatter, paid / not yet paid; no total, no sum, no rate, no %', () => {
    for (const e of EARNINGS_1C) expect([e.id, text(ok).includes(formatMoneyMinor(e.amountMinor!, 'INR', 'en'))]).toEqual([e.id, true]);
    expect(text(ok)).toContain('In a pay run'); expect(text(ok)).toContain('Not yet paid');
    for (const s of SUMS_1C) expect([s, text(ok).includes(s)]).toEqual([s, false]);
    expect(percents(text(ok))).toBe(0);
    expect(text(ok)).toContain(en['ops1.kiosk.home.earningsLead']);
    expect(text(ok)).toContain("A farmer's referral was activated");
    expect(text(ok)).toContain('some_future_stream');                       // an unlabelled server code is printed as the code, never invented
  });
  it('the honest states: no ambassador profile here; switched off; could not read (with a re-read link) — none shows earnings', () => {
    expect(text(none)).toContain('This account has no ambassador profile here.');
    expect(text(off)).toContain('The ambassador programme is switched off for your organisation.');
    expect(text(err)).toContain(en['ops1.kiosk.state.error']);
    expect(err).toContain('data-kv-reread="/kiosk/home"');
    for (const h of [none, off, err]) expect(h).not.toContain('data-kv-earnings');
    expect([kioskReadState('ok'), kioskReadState({ status: 404, code: 'AMBASSADOR_NOT_FOUND' }), kioskReadState({ status: 404, code: 'NOT_FOUND' }), kioskReadState({ status: 500 }), kioskReadState('failed')])
      .toEqual(['ok', 'none', 'off', 'error', 'error']);
  });
  it('zero controls in every state; links to every step W381–W389; no canon false word in the visible text', () => {
    for (const h of [ok, untrained, none, off, err]) {
      expect(controls(h)).toEqual(NONE);
      for (const s of KIOSK_STEPS) expect([s.href, h.includes(`href="${s.href}"`)]).toEqual([s.href, true]);
      expect(FALSE_1C.test(visible(h))).toBe(false);
    }
    expect(text(ok)).toContain(en['ops1.kiosk.statement']);
  });
  it('every W380 refusal is listed by name', () => {
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('kiosk_home'))) expect([r.id, ok.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
