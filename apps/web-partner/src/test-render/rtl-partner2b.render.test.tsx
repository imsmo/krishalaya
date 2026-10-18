// apps/web-partner/src/test-render/rtl-partner2b.render.test.tsx · PC-56 PARTNER-2b — the RTL spot-check of the new layouts (the 2a precedent):
// rendered inside dir="rtl" in en, hi and gu, the issuance queue, premiums, reports, parametric and their chain pages carry no inline style, no
// bare directional arrow (none is drawn — so no DirArrow is needed) and no physical left/right class; the CSS this wave added uses logical
// properties only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerIssuanceView } from '../components/partner2/InsurerIssuanceView';
import { InsurerPremiumsView } from '../components/partner2/InsurerPremiumsView';
import { InsurerReportsView } from '../components/partner2/InsurerReportsView';
import { InsurerParametricView } from '../components/partner2/InsurerParametricView';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { PARAMETRIC, PREMIUMS, QUEUE } from './partner2b-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-2b · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<InsurerIssuanceView t={tr(cat)} lang={lang} state="ok" items={QUEUE} nextCursor="Y3Vyc29y" computedAt={PREMIUMS.computedAt} />),
    rtl(<InsurerPremiumsView t={tr(cat)} lang={lang} state="ok" counts={PREMIUMS} />),
    rtl(<InsurerReportsView t={tr(cat)} state="ok" />),
    rtl(<InsurerParametricView t={tr(cat)} lang={lang} state="ok" counts={PARAMETRIC} />),
    rtl(<InsurerChain t={tr(cat)} chain="issuance_form" state="review" />),
    rtl(<InsurerChain t={tr(cat)} chain="premiums_export" state="queued" mailbox={{ kind: 'none' }} />),
    rtl(<InsurerChain t={tr(cat)} chain="parametric_act" state="confirm" />),
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
    expect(pages[7]).toContain(hi['partner2.issuance.statement']); expect(pages[14]).toContain(gu['partner2.issuance.statement']);
    expect(pages[8]).toContain(hi['partner2.premiums.statement']); expect(pages[15]).toContain(gu['partner2.premiums.statement']);
    expect(pages[10]).toContain(hi['partner2.parametric.statement']); expect(pages[17]).toContain(gu['partner2.parametric.statement']);
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-2b'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
