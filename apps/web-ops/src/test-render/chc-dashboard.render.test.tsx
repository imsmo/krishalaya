// apps/web-ops/src/test-render/chc-dashboard.render.test.tsx · PC-56 OPS-4a · W405 — what the field desk SEES on the hire dashboard: the machines
// the signed-in person listed (category + registration number, never a person), each linked to W406; the hires on them counted by the SERVER's
// status, with how many were counted ("the latest N" when paged); NO revenue, NO %, NO utilisation, NO sum; the Q2 words; zero inputs; the states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChcDashboardView } from '../components/ops4/ChcViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, A2, CATEGORIES, FALSE_4A, MATH_4A, affirmed, HIRES, MACHINES, RENTER_ID, RENTER_NAME } from './ops4a-fixtures';

const page = (over: Partial<React.ComponentProps<typeof ChcDashboardView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <ChcDashboardView t={tr(cat)} lang="en" state="ok" machines={MACHINES} machinesMore={false} categories={CATEGORIES} hires={HIRES} hiresMore={false} {...over} />);

describe('PC-56 OPS-4a · chc-dashboard (W405)', () => {
  const h = page();
  it('your machines by category and registration number, each linked to W406; a machine without one says so', () => {
    expect(text(h)).toContain('Test tractor class · TEST-REG-1');
    expect(text(h)).toContain('Test tractor class · no registration number');
    expect(h).toContain(`href="/chc/equipment-detail?id=${A1}"`); expect(h).toContain(`href="/chc/equipment-detail?id=${A2}"`);
    expect(text(h)).toContain('Open for hire'); expect(text(h)).toContain('In maintenance');
  });
  it('the hires counted by the server\'s status, all seven, and how many were counted; paged → "the latest N", older ones not counted', () => {
    expect(h).toContain('data-kv-counted="5"'); expect(text(h)).toContain('Counted over all 5 hires on your machines.');
    expect((h.match(/data-kv-status-count="/g) ?? []).length).toBe(7);
    expect(h).toMatch(/data-kv-status-count="requested"><dt>Requested<\/dt><dd>1<\/dd>/);
    expect(text(page({ hiresMore: true }))).toContain('Counted over the latest 5 hires on your machines. Older hires are not counted here.');
    expect(text(page({ machinesMore: true }))).toContain('The first 2 of your machines are shown.');
  });
  it('no revenue, no %, no utilisation, no sum, no ×/=, no "of N"; no money figure at all; no renter', () => {
    expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    expect(/₹/.test(visible(h))).toBe(false);
    expect(h).not.toContain(RENTER_NAME); expect(h).not.toContain(RENTER_ID);
  });
  it('the Q2 words, signed in as you; zero inputs; links to the hires', () => {
    expect(text(h)).toContain('Hire charges are paid into the wallet of the person who listed this machine — not into the organisation\'s account.');
    expect(text(h)).toContain('Signed in as you.');
    expect(/<input|<select|<textarea|<form|<button/.test(h)).toBe(false);
    expect(h).toContain('href="/chc/bookings"');
  });
  it('the states: off (the flag), error with a re-read (W3304), nothing listed', () => {
    const off = page({ state: 'off' }); expect(off).toContain('data-kv-off="equipment"'); expect(text(off)).toContain('Machine hire is not switched on for your organisation');
    const err = page({ state: 'error' }); expect(err).toContain('href="/chc/dashboard?act=confirm"'); expect(text(err)).toContain('Nothing was changed.');
    const none = page({ machines: [], hires: [] }); expect(text(none)).toContain('You have not listed a machine.'); expect(text(none)).toContain('There are no hires on your machines.');
  });
  it('the Q2 words in hi / gu', () => {
    for (const cat of [hi, gu]) expect(text(page({}, cat))).toContain(cat['ops4.q2.words'].replace(/'/g, '\''));
  });
});
