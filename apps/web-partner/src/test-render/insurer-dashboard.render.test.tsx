// apps/web-partner/src/test-render/insurer-dashboard.render.test.tsx · PC-56 PARTNER-2a · W245 the insurer dashboard renders what the SERVER
// computed: in force (count + Σ sum insured from a bigint string, exact past 2^53), proposed (awaiting the farmer's payment — not cover), the
// organisations, the products, under ONE "as of". No claims figure, no money set aside, no payout line, no run (founder Q2), no premium total
// called the insurer's (Q1) — those are printed as refusals. States: empty → products; error → Reload (the re-read chain); off and
// insurance_off → "switched off … nothing is broken" (never "unavailable"). M5 kills here and in the claims guard.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerDashboardView } from '../components/partner2/InsurerDashboardView';
import { insurerDashboardState, insurerFailureOf } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { DASH, DASH_EMPTY, FALSE_2A } from './partner2a-fixtures';

const render = (state: Parameters<typeof InsurerDashboardView>[0]['state'], d = DASH, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<InsurerDashboardView t={tr(cat)} lang="en" state={state} d={d} orgName="Fixture Insurer A" regulatorRefMasked="••••2A01" />);

describe('PC-56 PARTNER-2a · W245 the insurer dashboard (render)', () => {
  it('the four figures as the server computed them, with ONE as-of; money from a bigint string, never through a float', () => {
    const html = render(insurerDashboardState(DASH, null)); const w = text(html);
    expect(html).toContain('data-kv-state="ok"');
    for (const id of ['in_force', 'proposed', 'fpos', 'products']) expect(html).toContain(`data-kv-tile="${id}"`);
    expect(w).toContain('₹9,00,71,99,25,47,409.93');
    expect(w).toContain(en['partner2.dash.proposedHint']);
    expect(w).toContain('Computed on the server · as of');
    expect((html.match(/data-kv-asof=/g) ?? []).length).toBe(1);
    expect(w).toContain('Fixture Insurer A · regulator reference ••••2A01');
    expect(html).toContain('href="/insurer/policies"'); expect(html).toContain('href="/insurer/products"');
  });
  it('no claims, reserve, payout, run or "yours" line — only their refusals, by name', () => {
    const w = text(render('ok'));
    for (const k of partner2RefusalKeys('ins_dashboard')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    const withoutRefusals = partner2RefusalKeys('ins_dashboard').reduce((acc, k) => acc.replace(en[k], ''), w).replace(en['partner2.refused.title'], '');
    expect(withoutRefusals).not.toMatch(/claim|payout|reserve|run\b|settle|receivable|collected for you/i);
    expect(w).not.toMatch(FALSE_2A);
  });
  it('empty: "No book yet" → the products page', () => {
    const html = render(insurerDashboardState(DASH_EMPTY, null), DASH_EMPTY);
    expect(html).toContain('data-kv-state="empty"'); expect(text(html)).toContain(en['partner2.dash.empty.title']);
    expect(html).toContain('href="/insurer/products"');
  });
  it('error: nothing is affected; Reload = the W2873 re-read chain', () => {
    const html = render(insurerDashboardState(null, insurerFailureOf(500, 'INTERNAL', 'on')), DASH);
    expect(html).toContain('data-kv-state="error"'); expect(text(html)).toContain(en['partner2.dash.error.body']);
    expect(html).toContain('href="/insurer/dashboard?retry=confirm"');
  });
  it('switched off: the console (404 + the flag map OFF) and the platform\'s insurance (the API\'s named 404) — "nothing is broken", never "unavailable" (en, hi, gu)', () => {
    const off = render(insurerDashboardState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')));
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain('Nothing is broken');
    const ins = insurerDashboardState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown'));
    expect(ins).toBe('insurance_off');
    const html = render(ins);
    expect(html).toContain('data-kv-state="insurance_off"'); expect(text(html)).toContain(en['partner2.insuranceOff.title']); expect(text(html)).toContain('Nothing is broken');
    for (const h of [off, html]) expect(h).not.toMatch(/unavailable|temporarily/i);
    expect(text(render(ins, DASH, hi))).toContain(hi['partner2.insuranceOff.body']);
    expect(text(render(ins, DASH, gu))).toContain(gu['partner2.insuranceOff.body']);
  });
});
