// apps/web-partner/src/test-render/insurer-parametric.render.test.tsx · PC-56 PARTNER-2b · W262 the parametric run — AN HONEST PAGE (founder Q3):
// the statement verbatim ("There is no parametric run … nothing is armed, evaluated or paid"); two COUNTS (own products marked parametric, the
// policies in force on them); NO "automatic" anywhere outside the statement (which says no to it); "Trigger audit trail" DECOR (W2977–W2979
// `?act=`); the whole run refused by name. Reached from the insurer dashboard and the products page — NOT the nav (pinned in nav-model.spec).
// M5 kills here and in the claims guard.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerParametricView } from '../components/partner2/InsurerParametricView';
import { InsurerDashboardView } from '../components/partner2/InsurerDashboardView';
import { InsurerProductsView } from '../components/partner2/InsurerProductsView';
import { honestState, insurerFailureOf, parametricCounts } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { DASH, FALSE_2A, PRODUCTS } from './partner2a-fixtures';
import { FALSE_2B, MONEY, PARAMETRIC } from './partner2b-fixtures';

const render = (state: Parameters<typeof InsurerParametricView>[0]['state'], cat: Record<string, string> = en, counts = PARAMETRIC) =>
  renderToStaticMarkup(<InsurerParametricView t={tr(cat)} lang="en" state={state} counts={counts} />);

describe('PC-56 PARTNER-2b · W262 the parametric run — an honest page (render)', () => {
  const html = render('ok'); const w = text(html);
  const outside = w.replace(en['partner2.parametric.statement'], '');
  it('the statement, verbatim from the catalogue', () => {
    expect(w).toContain('There is no parametric run, index feed, trigger evaluation or automatic payout on the platform. A parametric product is a label on a product today; nothing is armed, evaluated or paid.');
    expect(html).toContain('data-kv-statement="partner2.parametric.statement"');
  });
  it('NO "automatic" (nor any run word) outside the statement; no money; the whole run refused by name (M5)', () => {
    expect(outside).not.toMatch(/automatic/i);
    expect(outside).not.toMatch(FALSE_2A); expect(outside).not.toMatch(FALSE_2B);
    expect(w).not.toMatch(MONEY);
    for (const k of partner2RefusalKeys('ins_parametric')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const k of ['seasonArmed', 'indexFeed', 'runFigures', 'setAside', 'noHuman', 'replay', 'payoutPromise', 'runStates', 'triggerTrail', 'farmerGauge']) expect(w).toContain(en[`partner2.refusal.${k}`]);
    for (const cat of [hi, gu]) expect(text(render('ok', cat)).replace(cat['partner2.parametric.statement'], '')).not.toMatch(/automatic/i);
  });
  it('the two COUNTS from the products read (own products marked parametric, the policies in force on them) with as-of', () => {
    expect(html).toContain('data-kv-count="products"'); expect(html).toContain('data-kv-count="active"');
    expect(parametricCounts(PRODUCTS, DASH.computedAt)).toEqual({ products: 1, active: 0, computedAt: DASH.computedAt });
    expect(w).toContain('Your products marked parametric (count)'); expect((html.match(/data-kv-asof=/g) ?? []).length).toBe(1);
  });
  it('"Trigger audit trail" is DECOR (the W2977 chain, no form); error → Reload; OFF states', () => {
    expect(html).toContain('href="/insurer/parametric?act=confirm"'); expect(html).toContain('data-kv-decor="trail"'); expect(html).not.toContain('<form');
    const x = render(honestState(null, insurerFailureOf(500, 'X', 'on')), en, null as never);
    expect(x).toContain('data-kv-state="error"'); expect(text(x)).toContain('Nothing is broken on the platform\'s side'); expect(x).not.toMatch(/evaluation continues|server-side/i);
    expect(render(honestState(null, insurerFailureOf(404, 'NOT_FOUND', 'off')))).toContain('data-kv-state="off"');
    expect(text(render('insurance_off', gu))).toContain(gu['partner2.insuranceOff.body']);
  });
  it('founder 2b-4: reached from the insurer dashboard and the products page (the nav never carries it — nav-model.spec)', () => {
    const dash = renderToStaticMarkup(<InsurerDashboardView t={tr(en)} lang="en" state="ok" d={DASH} orgName="Fixture Insurer A" />);
    expect(dash).toContain('href="/insurer/parametric"'); expect(dash).toContain('data-kv-parametric-link="dashboard"');
    for (const h of ['/insurer/issuance', '/insurer/premiums', '/insurer/reports']) expect(dash).toContain(`href="${h}"`);
    const prods = renderToStaticMarkup(<InsurerProductsView t={tr(en)} lang="en" state="ok" items={PRODUCTS} computedAt={DASH.computedAt} />);
    expect(prods).toContain('href="/insurer/parametric"'); expect(prods).toContain('data-kv-parametric-link="products"');
  });
});
