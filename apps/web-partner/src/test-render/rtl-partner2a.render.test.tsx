// apps/web-partner/src/test-render/rtl-partner2a.render.test.tsx · PC-56 PARTNER-2a — the RTL spot-check of the new layouts (the PARTNER-1b
// precedent): rendered inside dir="rtl" in en, hi and gu, the insurer dashboard, products, product, policies, policy and the chain pages carry
// no inline style, no bare directional arrow (none is drawn — so no DirArrow is needed) and no physical left/right class; the CSS this wave
// added uses logical properties only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerDashboardView } from '../components/partner2/InsurerDashboardView';
import { InsurerProductsView } from '../components/partner2/InsurerProductsView';
import { InsurerProductView } from '../components/partner2/InsurerProductView';
import { InsurerPoliciesView } from '../components/partner2/InsurerPoliciesView';
import { InsurerPolicyView } from '../components/partner2/InsurerPolicyView';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { DASH, POLICIES, POLICY, PRODUCTS } from './partner2a-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-2a · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<InsurerDashboardView t={tr(cat)} lang={lang} state="ok" d={DASH} orgName="Fixture Insurer A" />),
    rtl(<InsurerProductsView t={tr(cat)} lang={lang} state="ok" items={PRODUCTS} computedAt={DASH.computedAt} />),
    rtl(<InsurerProductView t={tr(cat)} lang={lang} p={PRODUCTS[0]} failure={null} />),
    rtl(<InsurerPoliciesView t={tr(cat)} lang={lang} state="ok" items={POLICIES} nextCursor="Y3Vyc29y" computedAt={DASH.computedAt} />),
    rtl(<InsurerPolicyView t={tr(cat)} lang={lang} p={POLICY} failure={null} />),
    rtl(<InsurerChain t={tr(cat)} chain="ins_form" state="review" />),
    rtl(<InsurerChain t={tr(cat)} chain="policy_act" state="confirm" back="/insurer/policies/x" />),
  ]);
  it('no inline style, no bare arrow, no physical-side class in any new layout, in any of the three languages', () => {
    expect(pages.length).toBe(21);
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←⇒⇐➜➔]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('hi and gu render their own words (no English fallback for a new key)', () => {
    expect(pages[7]).toContain(hi['partner2.dash.title']); expect(pages[14]).toContain(gu['partner2.dash.title']);
    expect(pages[10]).toContain(hi['partner2.policies.noNumber']); expect(pages[17]).toContain(gu['partner2.policies.noNumber']);
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-2a'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
