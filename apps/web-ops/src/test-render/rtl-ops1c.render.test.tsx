// apps/web-ops/src/test-render/rtl-ops1c.render.test.tsx · PC-56 OPS-1c — every kiosk page and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, no percentage, and the SAME `data-kv-*` skeleton in every language; the 1c sources
// carry no physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KIOSK_STEP_PAGES, KioskEarningsView, KioskFailureView, KioskHomeView, KioskStartView, KioskStepView, KioskSuccessView, KioskSummaryView, type KioskStepSurface } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { percents, text, tr } from './ops1a-fixtures';
import { EARNINGS_1C, LANGS_1C, PROFILE_1C } from './ops1c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<KioskHomeView t={t} lang="en" state="ok" profile={PROFILE_1C} earnings={EARNINGS_1C} />), rtl(<KioskHomeView t={t} lang="en" state="none" profile={null} earnings={[]} />),
    rtl(<KioskStartView t={t} mode="page" action="/kiosk/session-start" languages={LANGS_1C} />), rtl(<KioskStartView t={t} mode="confirm" action="/kiosk/session-start" languages={LANGS_1C} />),
    rtl(<KioskSuccessView t={t} />), rtl(<KioskFailureView t={t} searchParams={{ act: 'failure', reason: 'exists' }} />),
    ...(Object.keys(KIOSK_STEP_PAGES) as KioskStepSurface[]).map((s) => rtl(<KioskStepView t={t} surface={s} />)),
    rtl(<KioskSummaryView t={t} />), rtl(<KioskEarningsView t={t} lang="en" state="ok" rows={EARNINGS_1C} />), rtl(<KioskEarningsView t={t} lang="en" state="off" rows={[]} />),
  ];
};
const SRC_1C = ['components/ops1/KioskViews.tsx', 'app/kiosk/home/page.tsx', 'app/kiosk/session-start/page.tsx', 'app/kiosk/profile/page.tsx', 'app/kiosk/land-crops/page.tsx',
  'app/kiosk/kyc/page.tsx', 'app/kiosk/bank/page.tsx', 'app/kiosk/first-listing/page.tsx', 'app/kiosk/schemes/page.tsx', 'app/kiosk/summary/page.tsx', 'app/kiosk/ambassador/page.tsx'];

describe('PC-56 OPS-1c · the kiosk pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, no percentage', (_l, cat) => {
    for (const html of pages(cat)) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(ARROWS.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
    }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 1c source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_1C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
