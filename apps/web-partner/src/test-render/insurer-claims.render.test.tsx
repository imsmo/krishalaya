// apps/web-partner/src/test-render/insurer-claims.render.test.tsx · PC-56 PARTNER-3a · W252 THE CLAIMS QUEUE (founder Q4): the counts by status in the
// FY window (approved incl. partially; paid or closed) with as-of; the queue rows — waiting days, the claim REFERENCE, the event code's label or
// "not recorded", the subject TYPE, the sum insured (exact past 2^53), "reported within 72 hours" as recorded, the status — oldest first as the
// server answered; the status filter (the machine's nine); "Take next" DECOR; NO name, phone, place or note; "approved", never "paying" (M5
// kills here); NO percentage; empty / error / OFF / kind states; the sub-navigation (Queue · Insights).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimsView } from '../components/partner3/InsurerClaimsView';
import { insurerFailureOf, wrongConsole } from '../features/partner2/figures';
import { listState } from '../features/partner3/figures';
import { partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { CLAIMS, COUNTS, FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';

const render = (state: Parameters<typeof InsurerClaimsView>[0]['state'], cat: Record<string, string> = en, items = CLAIMS, status?: string, nextCursor: string | null = 'Y3Vyc29y') =>
  renderToStaticMarkup(<InsurerClaimsView t={tr(cat)} lang="en" state={state} items={items} counts={COUNTS} status={status} nextCursor={nextCursor} computedAt="2026-10-20T06:30:00.000Z" />);

describe('PC-56 PARTNER-3a · W252 the claims queue (render)', () => {
  const html = render(listState(CLAIMS, null)); const w = text(html);
  it('the counts by status in the FY window, integers, with as-of — "approved" includes partially approved; paid or closed together', () => {
    expect(html).toContain('data-kv-counts="claims"');
    expect(w).toContain('Financial year 2026-27 (April to March, India time)');
    const n = (id: string) => new RegExp(`data-kv-count="${id}"><dt>[^<]+</dt><dd>(\\d+)</dd>`).exec(html)?.[1];
    expect(['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'rejected', 'paid_closed'].map(n)).toEqual(['2', '3', '1', '4', '2', '3', '60']);
    expect(w).toContain('Approved (incl. partially)'); expect(w).toContain('Paid or closed');
    expect(html).toContain('data-kv-asof="2026-10-20T06:30:00.000Z"');
  });
  it('the queue rows: waiting days, the reference, event, subject TYPE, sum insured (exact past 2^53), reported within 72 hours as recorded, status — in the server\'s order', () => {
    expect(html).toContain('data-kv-state="ok"');
    expect([...html.matchAll(/data-kv-claim="([^"]+)"/g)].map((m) => m[1])).toEqual(CLAIMS.map((c) => c.id));
    expect(w).toContain('9 days'); expect(w).toContain('4 days'); expect(w).toContain('Not open');
    expect(w).toContain('0192d2c4…'); expect(html).toContain(`href="/insurer/claims/${CLAIMS[0].id}"`);
    expect(w).toContain('Animal or livestock death'); expect(w).toContain('Not recorded'); expect(w).toContain('Flood');
    expect(w).toContain('An animal'); expect(w).toContain('A crop season');
    expect(w).toContain('₹1,10,000.00'); expect(w).toContain('₹9,00,71,99,25,47,409.93');
    expect(html).toContain('data-kv-reported="false"'); expect(html).toContain('data-kv-reported="true"');
    expect(w).toContain('A late report is recorded; nothing rejects a claim for it.');
    expect(w).toContain('Fixture Dairy Collective'); expect(w).toContain('an organisation');
    for (const h of ['Waiting', 'Claim reference', 'Event', 'Covers', 'Sum insured', 'Reported within 72 hours', 'Status']) expect(w).toContain(h);
  });
  it('NO name, phone, place or note; "approved", never "paying"; NO percentage on the queue; the refusals printed by name', () => {
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A);
    expect(html).not.toMatch(/claimantUserId|surveyorUserId|surveyReport|description|tenantId|payoutId|data-kv-damage/);
    expect(percents(w)).toBe(0);
    expect(w).toContain('Partially approved'); expect(w).not.toMatch(/paying/i);
    for (const k of partner3RefusalKeys('claims')) expect([k, w.includes(en[k])]).toEqual([k, true]);
  });
  it('the status filter is the machine\'s nine + all; "Take next" is DECOR (the W2857 chain, no <form>); the keyset link carries status + cursor only', () => {
    for (const s of ['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed']) expect(html).toContain(`data-kv-status-filter="${s}"`);
    expect(html).toContain('href="/insurer/claims?act=confirm"'); expect(html).toContain('data-kv-decor="take-next"'); expect(html).not.toContain('<form');
    expect(render('ok', en, CLAIMS, 'surveyed')).toContain('href="/insurer/claims?status=surveyed&amp;cursor=Y3Vyc29y"');
    expect(render('ok', en, CLAIMS, undefined, null)).not.toContain('data-kv-next');
  });
  it('the sub-navigation: Queue (current) · Insights — and none of 3b\'s pages yet', () => {
    expect(html).toContain('data-kv-subnav="claims"');
    expect(html).toContain('href="/insurer/claims/insights"'); expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/insurer\/claims"/);
    expect(html).not.toMatch(/\/insurer\/(claims\/evidence|surveyors|surveys|claims\/fraud)/);
  });
  it('empty: no claim is open on your products (+ a filtered empty); error: nothing is broken + Retry = the W2857 re-read; never "unavailable"', () => {
    const e = render('empty', en, []);
    expect(e).toContain('data-kv-state="empty"'); expect(text(e)).toContain('No claim is open on your products'); expect(e).toContain('href="/insurer/policies"');
    expect(text(render('empty', en, [], 'rejected'))).toContain('No claim has this status');
    const x = render(listState(null, insurerFailureOf(500, 'INTERNAL', 'on')), en, []);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side');
    expect(x).toContain('href="/insurer/claims?act=confirm"'); expect(text(withoutRefusals(x))).not.toMatch(/unavailable|server-side|clock/i); expect(x).not.toContain('data-kv-next');
  });
  it('switched off: the console and the platform\'s insurance — "nothing is broken" (en, hi, gu); a lender is sent away (the kind rule)', () => {
    const off = render(listState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')));
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain('Nothing is broken');
    const ins = render(listState(null, insurerFailureOf(404, 'PARTNER_INSURANCE_SWITCHED_OFF', 'unknown')));
    expect(ins).toContain('data-kv-state="insurance_off"'); expect(text(ins)).toContain(en['partner2.insuranceOff.title']);
    expect(text(render('insurance_off', hi))).toContain(hi['partner2.insuranceOff.body']); expect(text(render('insurance_off', gu))).toContain(gu['partner2.insuranceOff.body']);
    expect(text(withoutRefusals(off))).not.toMatch(/plan settings/i);
    expect([wrongConsole('bank', 'insurer'), wrongConsole('amc', 'insurer'), wrongConsole('insurer', 'insurer')]).toEqual([true, true, false]);
  });
});
