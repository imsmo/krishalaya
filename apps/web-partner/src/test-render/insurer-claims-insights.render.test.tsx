// apps/web-partner/src/test-render/insurer-claims-insights.render.test.tsx · PC-56 PARTNER-3a · W264 CLAIMS INSIGHTS — COUNTS (founder E10): the FY
// window label from the server; counts by status, by the eight event codes + not recorded, and the decided counts — no rupee figure, no ratio,
// no rate, no "%" anywhere on the page; "Export" DECOR (the W2855 chain) and "View claims" real; empty / error / OFF states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimsInsightsView } from '../components/partner3/InsurerClaimsInsightsView';
import { countsState } from '../features/partner3/figures';
import { insurerFailureOf } from '../features/partner2/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { COUNTS, COUNTS_EMPTY, FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';

const render = (state: Parameters<typeof InsurerClaimsInsightsView>[0]['state'], counts = COUNTS, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<InsurerClaimsInsightsView t={tr(cat)} lang="en" state={state} counts={counts} />);
const cell = (html: string, table: string, row: string) => new RegExp(`data-kv-insights="${table}"[\\s\\S]*?data-kv-row="${row}"><th scope="row">[^<]+</th><td>(\\d+)</td>`).exec(html)?.[1];

describe('PC-56 PARTNER-3a · W264 claims insights (render)', () => {
  const html = render(countsState(COUNTS, null)); const w = text(html);
  it('the FY window (from the server), the total, the decided counts, by status, by the eight codes + not recorded — integers', () => {
    expect(html).toContain('data-kv-state="ok"'); expect(w).toContain('Financial year 2026-27 (April to March, India time)');
    expect(w).toContain('75 claims filed in this window');
    expect(['approved', 'partially_approved', 'rejected'].map((r) => cell(html, 'decided', r))).toEqual(['1', '1', '3']);
    expect(['intimated', 'surveyed', 'closed'].map((r) => cell(html, 'status', r))).toEqual(['2', '4', '56']);
    expect(['drought', 'flood', 'hail', 'pest', 'death', 'theft', 'fire', 'accident', 'not_recorded'].map((r) => cell(html, 'event', r))).toEqual(['0', '5', '20', '10', '30', '0', '5', '0', '5']);
    expect(w).not.toMatch(/\bother\b/i);
    expect(html).toContain('data-kv-asof="2026-10-20T06:30:00.000Z"');
  });
  it('NO rupee figure, NO "%", NO ratio, rate, median or headline — counts only; the refusals printed by name', () => {
    expect(text(withoutRefusals(html))).not.toMatch(MONEY); expect(percents(w)).toBe(0);
    expect(text(withoutRefusals(html))).not.toMatch(/ratio\b(?! or)|loss|median|approval rate|\bpaid \/|earned premium|ombudsman|industry/i);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A);
    for (const k of partner3RefusalKeys('claims_insights')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('"Export" is DECOR (the W2855 chain); "View claims" is real; the sub-navigation marks Insights', () => {
    expect(html).toContain('href="/insurer/claims/insights?export=queued"'); expect(html).toContain('data-kv-decor="export"'); expect(html).not.toContain('<form');
    expect(html).toContain('href="/insurer/claims"'); expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/claims\/insights"/);
  });
  it('empty: "the book is young"; error: nothing broken, the queue unaffected, Retry = the re-read; OFF states', () => {
    const e = text(render(countsState(COUNTS_EMPTY, null), COUNTS_EMPTY));
    expect(e).toContain('No claim filed in this window yet'); expect(e).toContain('The book is young'); expect(e).not.toMatch(/full season/i);
    const x = render(countsState(null, insurerFailureOf(500, 'X', 'on')), null as never);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('the claims queue is unaffected'); expect(x).toContain('href="/insurer/claims/insights?act=confirm"');
    expect(render('insurance_off', null as never)).toContain('data-kv-state="insurance_off"');
    expect(render('off', null as never)).toContain('data-kv-state="off"');
  });
  it('hi and gu print their own words', () => {
    expect(text(render('ok', COUNTS, hi))).toContain(hi['partner3.insights.title']);
    expect(text(render('ok', COUNTS, gu))).toContain(gu['partner3.insights.countsOnly']);
  });
});
