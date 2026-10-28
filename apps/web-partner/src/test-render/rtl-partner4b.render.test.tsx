// apps/web-partner/src/test-render/rtl-partner4b.render.test.tsx · PC-56 PARTNER-4b — the three new lending screens and the four new chains
// render in en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no stray arrow glyph, and the SAME `data-kv-*` skeleton in
// every language (a translation may change the words, never the page's shape). No percentage in any language, in any state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderPayoutsView } from '../components/partner4/LenderPayoutsView';
import { LenderRepaymentsView } from '../components/partner4/LenderRepaymentsView';
import { LenderBatchView } from '../components/partner4/LenderBatchView';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { ARREARS, COLLECTED, PIPELINE } from './partner4b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)/i;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).filter((a) => !/data-kv-(statement|refusal|true)=/.test(a)).join('|');

describe('PC-56 PARTNER-4b · the three new lending screens under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: the pay-outs page, the repayments page and the batch page carry no physical direction and no stray arrow', (_lang, cat) => {
    const pages = [
      rtl(<LenderPayoutsView t={tr(cat)} lang="en" state="ok" pipeline={PIPELINE} />),
      rtl(<LenderRepaymentsView t={tr(cat)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />),
      rtl(<LenderBatchView t={tr(cat)} state="ok" />),
    ];
    for (const html of pages) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(/[←→]/.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
      expect(html).toContain('dir="rtl"');
    }
  });
  it('the markup skeleton of each page is identical in all three languages', () => {
    const shapes = (make: (cat: Record<string, string>) => string) => new Set(Object.values(CATS).map((c) => skeleton(make(c))));
    expect(shapes((c) => rtl(<LenderPayoutsView t={tr(c)} lang="en" state="ok" pipeline={PIPELINE} />)).size).toBe(1);
    expect(shapes((c) => rtl(<LenderRepaymentsView t={tr(c)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />)).size).toBe(1);
    expect(shapes((c) => rtl(<LenderBatchView t={tr(c)} state="ok" />)).size).toBe(1);
    // and in every failure state too
    for (const state of ['empty', 'error', 'off'] as const) {
      expect(shapes((c) => rtl(<LenderPayoutsView t={tr(c)} lang="en" state={state} pipeline={null} />)).size).toBe(1);
      expect(shapes((c) => rtl(<LenderRepaymentsView t={tr(c)} lang="en" state={state} collected={null} arrears={null} />)).size).toBe(1);
    }
  });
  it('every 4b chain state renders in all three languages under rtl, with no physical direction and no arrow', () => {
    for (const c of PARTNER4_CHAINS.filter((x) => x.wave === '4b')) {
      for (const state of c.states) {
        for (const cat of Object.values(CATS)) {
          const html = rtl(<LenderChain t={tr(cat)} chain={c.id} state={state} />);
          expect([c.id, state, PHYSICAL.test(html)]).toEqual([c.id, state, false]);
          expect([c.id, state, /[←→]/.test(text(html))]).toEqual([c.id, state, false]);
          expect([c.id, state, percents(text(html))]).toEqual([c.id, state, 0]);
        }
      }
    }
  });
});
