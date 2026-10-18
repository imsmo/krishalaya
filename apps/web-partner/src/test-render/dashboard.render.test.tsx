// apps/web-partner/src/test-render/dashboard.render.test.tsx · PC-56 PARTNER-1a · founder D1 (canon W205) — the dashboard renders what the SERVER
// computed: the six tiles with their "as of", the published promise beside the actual latency, the organisations by PUBLIC name (a non-live
// one is "an organisation"), "needs you today" by reference — no applicant name, no LA-number, no comparison with other lenders. The states:
// empty → the loan queue; error → "computed on the server; nothing is affected" + Reload; flagged-off → "switched off … nothing is broken" (never
// "unavailable" — M2 kills here); scope → PARTNER-0's persona gate before any of this renders (pinned in partner-session.spec / login.render).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../components/partner1/DashboardView';
import { dashboardState, failureOf } from '../features/partner1/dashboard';
import { partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { EMPTY, FIGURES, text, tr } from './partner1a-fixtures';

const render = (state: Parameters<typeof DashboardView>[0]['state'], d = FIGURES, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<DashboardView t={tr(cat)} lang="en" state={state} d={d} orgName="Fixture Lending Partner" />);

describe('PC-56 PARTNER-1a · W205 the dashboard (render)', () => {
  it('the six figures as the server computed them, with the as-of time; money from bigint strings; rates in one-decimal percent', () => {
    const html = render(dashboardState(FIGURES, null)); const w = text(html);
    expect(html).toContain('data-kv-dash="ok"');
    for (const id of ['awaiting', 'decided', 'rate', 'outstanding', 'ontime']) expect(html).toContain(`data-kv-tile="${id}"`);
    expect(w).toContain('104');                                  // awaiting — the full count, past a page of 100
    expect(w).toContain('71.4%');                                // 7142 bps
    expect(w).toContain('75.0%');                                // on-time 7500 bps
    expect(w).toContain('₹9,00,71,99,25,47,409.93');            // 9007199254740993 paise — exact past 2^53, never rounded through a float
    expect(w).toContain('3 active or overdue loans');
    expect(w).toContain('5 approved · 2 rejected');
    expect(w).toContain('Computed on the server · as of');
    expect(w).toContain('Published promise: a decision within 48 hours');
    expect(w).toContain('median 31.0 hours · 90th percentile 50.0 hours, over 7 decisions');
    expect(w).toContain('Decided within the promise: 6 of 7');
    expect(w).toContain(en['partner1.dash.onTimeHint'].replace('{onTime}', '3').replace('{due}', '4'));
  });
  it('the organisations by their PUBLIC name; a non-live one is the neutral word; needs-you-today by reference, product, amount, organisation, age', () => {
    const html = render('ok'); const w = text(html);
    expect(html).toContain('data-kv-fpos="2"');
    expect(w).toContain('Fixture Growers Collective'); expect(w).toContain('an organisation');
    expect(html).toContain('href="/loan-queue/0192d2c4-1111-7000-8000-000000000001"');
    expect(w).toContain('0192d2c4…'); expect(w).toContain('72 h'); expect(w).toContain('6 h');
    expect(html).not.toMatch(/\bLA-\d/);
    expect(w).not.toMatch(/repay better|Ramesh|applicant name/i);
    for (const k of partner1RefusalKeys('dashboard')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('no promise and nothing decided: "not published yet", "nothing decided" — never NaN, never a float', () => {
    const d = { ...FIGURES, decidedThisMonth: { ...FIGURES.decidedThisMonth, decided: 0, approved: 0, rejected: 0, approvalRateBps: null },
      onTime: { ...FIGURES.onTime, due: 0, onTime: 0, shareBps: null }, sla: { ...FIGURES.sla, decisionPromiseHours: null, decided: 0, medianSec: null, p90Sec: null, withinPromise: null } };
    const w = text(render('ok', d));
    expect(w).toContain(en['partner1.dash.slaNone']); expect(w).toContain(en['partner1.dash.rateNone']); expect(w).toContain(en['partner1.dash.onTimeNone']);
    expect(w).toContain('No decision in the last 30 days.');
    expect(w).not.toMatch(/NaN|Infinity|undefined/);
  });
  it('empty: "No applications yet" → the loan queue (no "view products")', () => {
    const html = render(dashboardState(EMPTY, null), EMPTY);
    expect(html).toContain('data-kv-dash="empty"'); expect(text(html)).toContain(en['partner1.dash.empty.title']);
    expect(html).toContain('href="/loan-queue"'); expect(html).not.toContain('href="/products"');
  });
  it('error: computed on the server, nothing is affected, Reload = the re-read chain', () => {
    const html = render(dashboardState(null, failureOf(500, 'on')), FIGURES);
    expect(html).toContain('data-kv-dash="error"'); expect(text(html)).toContain(en['partner1.dash.error.body']);
    expect(html).toContain('href="/dashboard?retry=confirm"');
  });
  it('flagged-off (a 404 while the flag map says OFF): "switched off … nothing is broken" — never "unavailable" (en and gu)', () => {
    const state = dashboardState(null, failureOf(404, 'off'));
    const html = render(state, FIGURES);
    expect(html).toContain('data-kv-dash="off"');
    expect(text(html)).toContain(en['partner.off.title']); expect(text(html)).toContain('Nothing is broken');
    expect(html).not.toMatch(/unavailable|temporarily/i);
    expect(text(render(state, FIGURES, gu))).toContain(gu['partner.off.body']);
  });
});
