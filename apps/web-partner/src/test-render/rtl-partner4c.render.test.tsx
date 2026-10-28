// apps/web-partner/src/test-render/rtl-partner4c.render.test.tsx · PC-56 PARTNER-4c — the two KCC screens and the three KCC chains render in
// en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no stray arrow glyph, and the SAME `data-kv-*` skeleton in every
// language (a translation may change the words, never the page's shape). No percentage and no figure of the ledger, in any language, in any
// state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderKccView } from '../components/partner4/LenderKccView';
import { LenderKccDrawlsView } from '../components/partner4/LenderKccDrawlsView';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { KCC_LOAN, figuresBesideLedgerWords } from './partner4c-fixtures';

const CATS = { en, hi, gu } as const;
const ID = KCC_LOAN.id;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)/i;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).filter((a) => !/data-kv-(statement|refusal|true|drawls-note|kcc-note|asof)=/.test(a)).join('|');

describe('PC-56 PARTNER-4c · the two KCC screens under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: the KCC page and the drawls page carry no physical direction and no stray arrow', (_lang, cat) => {
    const pages = [
      rtl(<LenderKccView t={tr(cat)} lang="en" loanId={ID} l={KCC_LOAN} failure={null} notFound={false} computedAt={KCC_LOAN.computedAt} />),
      rtl(<LenderKccDrawlsView t={tr(cat)} state="ok" loanId={ID} />),
    ];
    for (const html of pages) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(/[←→]/.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
      expect(html).toContain('dir="rtl"');
    }
    // and the drawls page carries no figure of the ledger in any language
    expect(figuresBesideLedgerWords(text(pages[1]))).toEqual([]);
  });
  it('the markup skeleton of each page is identical in all three languages, in every state', () => {
    const shapes = (make: (cat: Record<string, string>) => string) => new Set(Object.values(CATS).map((c) => skeleton(make(c))));
    expect(shapes((c) => rtl(<LenderKccView t={tr(c)} lang="en" loanId={ID} l={KCC_LOAN} failure={null} notFound={false} computedAt={KCC_LOAN.computedAt} />)).size).toBe(1);
    expect(shapes((c) => rtl(<LenderKccView t={tr(c)} lang="en" loanId={ID} l={null} failure={null} notFound={true} computedAt={null} />)).size).toBe(1);
    expect(shapes((c) => rtl(<LenderKccView t={tr(c)} lang="en" loanId={ID} l={null} failure="error" notFound={false} computedAt={null} />)).size).toBe(1);
    for (const state of ['ok', 'error', 'off'] as const) {
      expect(shapes((c) => rtl(<LenderKccDrawlsView t={tr(c)} state={state} loanId={ID} />)).size).toBe(1);
    }
  });
  it('every 4c chain state renders in all three languages under rtl, with no physical direction, no arrow and no ledger figure', () => {
    for (const c of PARTNER4_CHAINS.filter((x) => x.wave === '4c')) {
      for (const state of c.states) {
        for (const cat of Object.values(CATS)) {
          const html = rtl(<LenderChain t={tr(cat)} chain={c.id} state={state} />);
          expect([c.id, state, PHYSICAL.test(html)]).toEqual([c.id, state, false]);
          expect([c.id, state, /[←→]/.test(text(html))]).toEqual([c.id, state, false]);
          expect([c.id, state, percents(text(html))]).toEqual([c.id, state, 0]);
          expect([c.id, state, figuresBesideLedgerWords(text(html))]).toEqual([c.id, state, []]);
        }
      }
    }
  });
});
