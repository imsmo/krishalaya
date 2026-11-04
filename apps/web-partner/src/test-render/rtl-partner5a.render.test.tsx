// apps/web-partner/src/test-render/rtl-partner5a.render.test.tsx · PC-56 PARTNER-5a — the two arrears pages and the four chains render in
// en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow glyph (web-partner has no DirArrow — E9 draws none),
// no percentage, and the SAME `data-kv-*` skeleton in every language (a translation may change the words, never the page's shape).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderAgingView } from '../components/partner5/LenderAgingView';
import { LenderWriteoffsView } from '../components/partner5/LenderWriteoffsView';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { PARTNER5_CHAINS } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { COUNTS_5A, DPD, DPD_MIXED, WRITTEN_OFF } from './partner5a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).filter((a) => !/data-kv-(statement|refusal|true)=/.test(a)).join('|');
const aging = (cat: Record<string, string>, state: 'ok' | 'empty' | 'error' | 'off' = 'ok') =>
  rtl(<LenderAgingView t={tr(cat)} lang="en" state={state} dpd={state === 'ok' ? DPD : null} counts={state === 'ok' ? COUNTS_5A : null} />);
const writeoffs = (cat: Record<string, string>, state: 'ok' | 'empty' | 'error' | 'off' = 'ok') =>
  rtl(<LenderWriteoffsView t={tr(cat)} lang="en" state={state} counts={state === 'ok' ? COUNTS_5A : null} items={state === 'ok' ? WRITTEN_OFF : []} nextCursor="Y3Vyc29y" computedAt="2026-11-04T06:30:00.000Z" />);

describe('PC-56 PARTNER-5a · the two arrears pages and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: both pages, in every state, carry no physical direction, no arrow glyph and no percentage', (_lang, cat) => {
    for (const state of ['ok', 'empty', 'error', 'off'] as const) {
      for (const html of [aging(cat, state), writeoffs(cat, state), rtl(<LenderAgingView t={tr(cat)} lang="en" state="ok" dpd={DPD_MIXED} counts={COUNTS_5A} />)]) {
        expect([state, PHYSICAL.test(html)]).toEqual([state, false]);
        expect([state, ARROWS.test(text(html))]).toEqual([state, false]);
        expect([state, percents(text(html))]).toEqual([state, 0]);
        expect(html).toContain('dir="rtl"');
      }
    }
  });
  it('the markup skeleton of each page is identical in all three languages, in every state', () => {
    const shapes = (make: (cat: Record<string, string>) => string) => new Set(Object.values(CATS).map((c) => skeleton(make(c))));
    for (const state of ['ok', 'empty', 'error', 'off'] as const) {
      expect([state, shapes((c) => aging(c, state)).size]).toEqual([state, 1]);
      expect([state, shapes((c) => writeoffs(c, state)).size]).toEqual([state, 1]);
    }
  });
  it('every chain state renders in all three languages under rtl, with no physical direction, no arrow and no percentage', () => {
    for (const c of PARTNER5_CHAINS) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<LenderChain5 t={tr(cat)} chain={c.id} state={state} />);
      expect([c.id, state, PHYSICAL.test(html)]).toEqual([c.id, state, false]);
      expect([c.id, state, ARROWS.test(text(html))]).toEqual([c.id, state, false]);
      expect([c.id, state, percents(text(html))]).toEqual([c.id, state, 0]);
    }
  });
  it('the arrears pages add no physical CSS to the stylesheet (logical properties only)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    for (const rel of ['components/partner5/LenderAgingView.tsx', 'components/partner5/LenderWriteoffsView.tsx', 'components/partner5/LenderChain5.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src)]).toEqual([rel, false]);
    }
  });
});
