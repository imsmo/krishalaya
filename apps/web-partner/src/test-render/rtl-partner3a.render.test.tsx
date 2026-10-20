// apps/web-partner/src/test-render/rtl-partner3a.render.test.tsx · PC-56 PARTNER-3a — the RTL spot-check of the new layouts (the 2a/2b precedent):
// rendered inside dir="rtl" in en, hi and gu, the claims queue, one claim, the insights and their chain pages carry no inline style, no bare
// directional arrow (none is drawn — so no DirArrow is needed) and no physical left/right class; the CSS this wave added uses logical properties only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimsView } from '../components/partner3/InsurerClaimsView';
import { InsurerClaimView } from '../components/partner3/InsurerClaimView';
import { InsurerClaimsInsightsView } from '../components/partner3/InsurerClaimsInsightsView';
import { InsurerClaimsChain } from '../components/partner3/InsurerClaimsChain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { CLAIM, CLAIMS, COUNTS } from './partner3a-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-3a · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<InsurerClaimsView t={tr(cat)} lang={lang} state="ok" items={CLAIMS} counts={COUNTS} nextCursor="Y3Vyc29y" computedAt={COUNTS.computedAt} />),
    rtl(<InsurerClaimView t={tr(cat)} lang={lang} c={CLAIM} failure={null} />),
    rtl(<InsurerClaimsInsightsView t={tr(cat)} lang={lang} state="ok" counts={COUNTS} />),
    rtl(<InsurerClaimsChain t={tr(cat)} chain="claims_act" state="confirm" />),
    rtl(<InsurerClaimsChain t={tr(cat)} chain="insights_export" state="queued" mailbox={{ kind: 'none' }} />),
  ]);
  it('no inline style, no bare arrow, no physical-side class in any new layout, in any of the three languages', () => {
    expect(pages.length).toBe(15);
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←⇒⇐➜➔]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('hi and gu render their own words (no English fallback for a new key)', () => {
    expect(pages[5]).toContain(hi['partner3.claims.title']); expect(pages[10]).toContain(gu['partner3.claims.lead']);
    expect(pages[6]).toContain(hi['partner3.claim.decideStatement']); expect(pages[11]).toContain(gu['partner3.claim.decideStatement']);
    expect(pages[7]).toContain(hi['partner3.insights.countsOnly']); expect(pages[13]).toContain(gu['partner3.chain.act.confirm.body']);
    for (const html of pages.slice(5)) expect(html).not.toContain(en['partner3.claims.lead']);
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-3a'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
