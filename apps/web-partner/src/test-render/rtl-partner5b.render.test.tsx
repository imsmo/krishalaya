// apps/web-partner/src/test-render/rtl-partner5b.render.test.tsx · PC-56 PARTNER-5b — the three honest collections pages and their four
// chains render in en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow glyph (web-partner has no DirArrow —
// E7 / E9 draws none), no percentage, and the SAME `data-kv-*` skeleton in every language.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderCollectionsView } from '../components/partner5/LenderCollectionsView';
import { LenderCollectionsCaseView } from '../components/partner5/LenderCollectionsCaseView';
import { LenderRestructureView } from '../components/partner5/LenderRestructureView';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { PARTNER5_CHAINS } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { IDS } from './partner5b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>, state: 'ok' | 'error' | 'off') => [
  rtl(<LenderCollectionsView t={tr(cat)} state={state} />),
  rtl(<LenderCollectionsCaseView t={tr(cat)} state={state} loanId={IDS.loan} />),
  rtl(<LenderRestructureView t={tr(cat)} state={state} loanId={IDS.loan} />),
];

describe('PC-56 PARTNER-5b · the three honest pages and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: all three pages, in every state, carry no physical direction, no arrow glyph and no percentage', (_lang, cat) => {
    for (const state of ['ok', 'error', 'off'] as const) for (const html of pages(cat, state)) {
      expect([state, PHYSICAL.test(html)]).toEqual([state, false]);
      expect([state, ARROWS.test(text(html))]).toEqual([state, false]);
      expect([state, percents(text(html))]).toEqual([state, 0]);
      expect(html).toContain('dir="rtl"');
    }
  });
  it('the markup skeleton of each page is identical in all three languages, in every state', () => {
    for (const state of ['ok', 'error', 'off'] as const) for (const i of [0, 1, 2]) {
      expect([state, i, new Set(Object.values(CATS).map((c) => skeleton(pages(c, state)[i]))).size]).toEqual([state, i, 1]);
    }
  });
  it('every 5b chain state renders in all three languages under rtl, with no physical direction, no arrow and no percentage', () => {
    for (const c of PARTNER5_CHAINS.filter((x) => x.wave === '5b')) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<LenderChain5 t={tr(cat)} chain={c.id} state={state} back="/lender/collections" />);
      expect([c.id, state, PHYSICAL.test(html)]).toEqual([c.id, state, false]);
      expect([c.id, state, ARROWS.test(text(html))]).toEqual([c.id, state, false]);
      expect([c.id, state, percents(text(html))]).toEqual([c.id, state, 0]);
    }
  });
  it('the three views and three pages add no physical CSS and no arrow glyph in their source; every 5b value is arrow-free in all three languages', () => {
    for (const rel of ['components/partner5/LenderCollectionsView.tsx', 'components/partner5/LenderCollectionsCaseView.tsx', 'components/partner5/LenderRestructureView.tsx',
      'components/partner5/LenderChain5.tsx', 'app/lender/collections/page.tsx', 'app/lender/collections/[id]/page.tsx', 'app/lender/collections/[id]/restructure/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, /[←→⇐⇒⟵⟶➔➜]/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    for (const cat of Object.values(CATS)) for (const k of Object.keys(en).filter((x) => /^partner5\.(collections|case|restructure|chain\.(collectionsForm|collectionsAct|caseAct|restructureAct))\./.test(x))) {
      expect([k, ARROWS.test(cat[k])]).toEqual([k, false]);
    }
  });
});
