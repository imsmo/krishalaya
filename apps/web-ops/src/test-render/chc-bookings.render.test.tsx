// apps/web-ops/src/test-render/chc-bookings.render.test.tsx · PC-56 OPS-4a · W407 — THE HIRES ON YOUR MACHINES (MONEY · WALL): per hire the booking
// number, the machine, the status, the rate basis, the server's figures (quantities as sent, money through the formatter), whether the renter
// confirmed the hours, the dates; the fixture carries a renter NAME and id — neither prints; no "×", "=", "%", "of N"; the founder's Q1/Q2/Q3
// sentences and the no-renter-app fact exact ×3; NO money button (one form: the GET status filter); keyset "Next page".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChcBookingsView } from '../components/ops4/ChcViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, CATEGORIES, FALSE_4A, MATH_4A, affirmed, HIRES, H_DONE, H_SETTLED, MACHINES, RENTER_ID, RENTER_NAME } from './ops4a-fixtures';

const page = (over: Partial<React.ComponentProps<typeof ChcBookingsView>> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <ChcBookingsView t={tr(cat)} lang="en" state="ok" hires={HIRES} nextCursor={null} status={undefined} machines={MACHINES} categories={CATEGORIES} {...over} />);
const unesc = (s: string) => s.replace(/&#x27;/g, '\'');

describe('PC-56 OPS-4a · chc-bookings (W407)', () => {
  const h = page();
  it('each hire by its booking number, machine (linked to W406), status and the server\'s figures', () => {
    expect((h.match(/data-kv-hire="/g) ?? []).length).toBe(5);
    expect(text(h)).toContain('Hire EQ-TEST-H3');
    expect(h).toContain(`href="/chc/equipment-detail?id=${A1}"`);
    const done = h.slice(h.indexOf(`data-kv-hire="${H_DONE.id}"`), h.indexOf(`data-kv-hire="${H_SETTLED.id}"`));
    expect(text(done)).toContain('Rate ₹731.00 per hour'); expect(text(done)).toContain('Estimated 6.00 hours'); expect(text(done)).toContain('Recorded by the owner 5.50 hours');
    expect(text(done)).toContain('Deposit ₹299.00'); expect(text(done)).toContain('Bill ₹4,020.50');
    expect(text(done)).toContain('Hours confirmed by the renter Not confirmed by the renter');
    expect(text(done)).toContain('Scheduled for 2027-03-10 19:00 UTC'); expect(text(done)).toContain('Finished 2027-03-11 01:00 UTC');
  });
  it('whether the renter confirmed the hours (usageConfirmedAt); a requested hire has no deposit quoted and no bill', () => {
    expect(h).toMatch(new RegExp(`data-kv-hire="${H_SETTLED.id}"[\\s\\S]*?data-kv-usage-confirmed="yes"`));
    expect(text(h)).toContain('Hours confirmed by the renter Yes, at 2027-03-11 03:15 UTC');
    expect(text(h)).toContain('Deposit Not quoted yet'); expect(text(h)).toContain('Bill Not billed yet'); expect(text(h)).toContain('No hours recorded yet');
    expect(text(h)).toContain('A machine not in your list');   // a hire whose machine is not in the person's list is never named
  });
  it('WALL: the renter\'s name and id never print (the fixture carries both)', () => {
    expect(h).not.toContain(RENTER_NAME); expect(h).not.toContain(RENTER_ID); expect(h).not.toContain('private task words');
  });
  it('no ×, =, %, "of N", sum or canon claim in the visible text; every figure is the server\'s', () => {
    expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    for (const sum of ['₹4,319.40', '₹5,482.50', '₹598.00', '₹1,462.00 + ']) expect(text(h)).not.toContain(sum);   // 4020.50+299 · 4020.50+1462 · 299+299
    expect(text(h)).toContain('Every figure below is the server\'s: nothing is worked out on this page.');
  });
  it('the founder\'s words and the no-renter-app fact, exact ×3', () => {
    for (const cat of [en, hi, gu]) {
      const v = unesc(text(page({}, cat)));
      for (const k of ['ops4.q1.words', 'ops4.q1.noRenterApp', 'ops4.q2.words', 'ops4.q3.words']) expect([k, v.includes(cat[k])]).toEqual([k, true]);
    }
    expect(unesc(text(h))).toContain('No app for renters to confirm hours exists on this platform yet, so a hire billed above its deposit cannot be settled.');
  });
  it('E7: one form — the GET status filter (a select, a submit); no money button, no hidden act, no other input', () => {
    expect((h.match(/<form\b[^>]*>/g) ?? [])).toEqual([expect.stringContaining('method="get"')]);
    expect((h.match(/<select\b/g) ?? []).length).toBe(1);
    expect((h.match(/<input\b/g) ?? []).length).toBe(0);
    expect((h.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).map((b) => text(b).trim())).toEqual(['Show']);
    // no link or button is an act: every anchor goes to a hire page or the next page; no anchor or button says settle / quote / start / finish / cancel
    const controls = (h.match(/<(a|button)\b[^>]*>[\s\S]*?<\/\1>/g) ?? []).map((x) => text(x).trim());
    for (const c of controls) expect([c, /^(settle|send quote|quote|start|finish|record usage|cancel)/i.test(c)]).toEqual([c, false]);
    for (const href of Array.from(h.matchAll(/href="([^"]+)"/g)).map((m) => m[1])) expect([href, /^\/chc\/(equipment-detail\?id=|bookings)/.test(href)]).toEqual([href, true]);
    expect((h.match(/<option\b/g) ?? []).length).toBe(8);   // all + the seven statuses; never "disputed"
  });
  it('keyset: "Next page" keeps the filter; no total count; empty with a filter says so; off; error re-read (W3304)', () => {
    const p = page({ nextCursor: 'Y3Vy', status: 'settled' });
    expect(p).toContain('href="/chc/bookings?status=settled&amp;cursor=Y3Vy"');
    expect(text(page({ hires: [], status: 'settled' }))).toContain('No hire on your machines has this status.');
    expect(page({ state: 'off' })).toContain('data-kv-off="equipment"');
    expect(page({ state: 'error' })).toContain('href="/chc/bookings?act=confirm"');
  });
});
