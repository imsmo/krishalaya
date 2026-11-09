// apps/web-ops/src/test-render/chc-equipment.render.test.tsx · PC-56 OPS-4a · W406 — ONE of your machines: its facts; "engine hours as entered by the
// owner" (the typed value, labelled); its rate lines in words with their days, each amount through the money formatter; its maintenance entries
// as typed; no calendar, no next service, no GPS; another person's machine → the not-found state; zero inputs.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChcEquipmentView } from '../components/ops4/ChcViews';
import { en } from '../i18n/en';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, CATEGORIES, FALSE_4A, MATH_4A, affirmed, M1, M2, MAINT, RATES } from './ops4a-fixtures';

const page = (over: Partial<React.ComponentProps<typeof ChcEquipmentView>> = {}) => renderToStaticMarkup(
  <ChcEquipmentView t={tr(en)} lang="en" state="ok" asset={M1} categories={CATEGORIES} rates={RATES} maintenance={MAINT} {...over} />);

describe('PC-56 OPS-4a · chc-equipment (W406)', () => {
  const h = page();
  it('the machine\'s facts; engine hours labelled as the owner\'s typed value, never a meter', () => {
    expect(h).toContain(`data-kv-machine="${A1}"`);
    expect(text(h)).toContain('Test tractor class · TEST-REG-1');
    expect(text(h)).toContain('Engine hours as entered by the owner 1234.5');
    expect(text(h)).toContain('Engine hours are typed by the machine\'s owner; no meter on this platform reads them.');
    expect(text(h)).toContain('Year of manufacture 2019'); expect(text(h)).toContain('Power (hp) 41');
  });
  it('rate lines in words with their days, amounts through the formatter (server minor strings)', () => {
    expect(h).toContain('data-kv-minor="73100"'); expect(h).toContain('data-kv-minor="190700"');
    expect(text(h)).toMatch(/₹731\.00 per hour · with an operator · fuel not included · from 2026-10-01/);
    expect(text(h)).toMatch(/₹1,907\.00 per acre · without an operator · fuel included · from 2026-09-01 to 2026-09-30/);
    expect(text(h)).toContain('A hire takes the rate in force on its own day, and keeps it if the rate changes later.');
    expect(text(page({ rates: [] }))).toContain('This machine has no rate line. A hire cannot be requested for a day with no rate in force.');
    expect(page({ rates: null })).toContain('data-kv-error="rates"');
  });
  it('maintenance entries as typed; recording one does not take a machine off hire', () => {
    expect(text(h)).toContain('Service · 2026-10-20 · at 1200.0 engine hours, as typed · cost ₹4,111.00, as typed · note: oil changed');
    expect(text(h)).toContain('Breakdown · 2026-09-02');
    expect(text(h)).toContain('Maintenance entries are typed by a person. Recording one does not take a machine off hire.');
    expect(text(page({ maintenance: [] }))).toContain('No maintenance entry is recorded for this machine.');
  });
  it('no calendar, no next service, no GPS, no sum; zero inputs', () => {
    expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    expect(text(h)).toContain('No booking calendar or service schedule is kept for a machine on this platform.');
    expect(/<input|<select|<textarea|<form|<button/.test(h)).toBe(false);
  });
  it('a machine in maintenance says a hire cannot be requested for it', () => {
    expect(text(page({ asset: M2 }))).toContain('A hire cannot be requested for this machine while it is in maintenance.');
    expect(text(page({ asset: M2 }))).toContain('Engine hours as entered by the owner Not entered');
  });
  it('another person\'s machine (not in your own list) → the not-found state; off; error → re-read (W3318)', () => {
    const nf = page({ state: 'notFound', asset: null });
    expect(text(nf)).toContain('No machine of yours was found'); expect(nf).not.toContain('data-kv-machine=');
    expect(page({ state: 'off', asset: null })).toContain('data-kv-off="equipment"');
    expect(page({ state: 'error', asset: M1 })).toContain(`href="/chc/equipment-detail?id=${A1}&amp;act=confirm"`);
  });
});
