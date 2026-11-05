// apps/web-partner/src/test-render/rtl-partner6b.render.test.tsx · PC-56 PARTNER-6b — the consents page, the regulatory page and their four
// chains render in en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow glyph (web-partner has no DirArrow —
// brief E7 draws none), no percentage, and the SAME `data-kv-*` skeleton in every language.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderConsentsView } from '../components/partner6/LenderConsentsView';
import { LenderRegulatoryView } from '../components/partner6/LenderRegulatoryView';
import { LenderChain6 } from '../components/partner6/LenderChain6';
import { PARTNER6_CHAINS } from '../features/partner6/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { MAILBOX_6B } from './partner6b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => [
  rtl(<LenderConsentsView t={tr(cat)} state="ok" />),
  rtl(<LenderConsentsView t={tr(cat)} state="error" />),
  rtl(<LenderConsentsView t={tr(cat)} state="off" />),
  rtl(<LenderRegulatoryView t={tr(cat)} state="ok" mailbox={MAILBOX_6B} />),
  rtl(<LenderRegulatoryView t={tr(cat)} state="ok" mailbox={{ kind: 'none' }} />),
  rtl(<LenderRegulatoryView t={tr(cat)} state="off" mailbox={MAILBOX_6B} />),
];

describe('PC-56 PARTNER-6b · the two lender pages and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: both pages, in every state, carry no physical direction, no arrow glyph and no percentage', (_lang, cat) => {
    for (const html of pages(cat)) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(ARROWS.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
      expect(html).toContain('dir="rtl"');
    }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('every 6b chain state renders in all three languages under rtl, with no physical direction, no arrow and no percentage', () => {
    for (const c of PARTNER6_CHAINS.filter((x) => x.wave === '6b')) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<LenderChain6 t={tr(cat)} chain={c.id} state={state} mailbox={c.mailbox ? MAILBOX_6B : undefined} />);
      expect([c.id, state, PHYSICAL.test(html), ARROWS.test(text(html)), percents(text(html))]).toEqual([c.id, state, false, false, 0]);
    }
  });
  it('the views and pages add no physical CSS and no arrow glyph in their source', () => {
    for (const rel of ['components/partner6/LenderConsentsView.tsx', 'components/partner6/LenderRegulatoryView.tsx', 'components/partner6/LenderChain6.tsx',
      'app/lender/consents/page.tsx', 'app/lender/reports/regulatory/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, /[←→⇐⇒⟵⟶➔➜]/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
