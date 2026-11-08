// apps/web-ops/src/test-render/rtl-ops3c.render.test.tsx · PC-56 OPS-3c — every 3c page state and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, and the SAME `data-kv-*` skeleton in every language; "%" only as a slab reading's unit;
// the 3c sources carry no physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RatesView } from '../components/ops3/RatesView';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { OPS3_CHAINS } from '../features/ops3/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { CARDS_3C, COW_CLASH } from './ops3c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const noSlabs = (html: string) => html.replace(/<li [^>]*data-kv-slab="[^"]*"[\s\S]*?<\/li>/g, '');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'none', 'error', 'off'] as const).map((s) => rtl(<RatesView t={t} lang="en" state={s} cards={s === 'ok' ? CARDS_3C : []} slabs="off" />)),
    rtl(<RatesView t={t} lang="en" state="ok" cards={[...CARDS_3C, COW_CLASH]} slabs="unknown" />),
    ...OPS3_CHAINS.flatMap((c) => c.states.map((s) => rtl(<Ops3Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_3C = ['components/ops3/RatesView.tsx', 'components/ops3/Ops3Chain.tsx', 'app/rates/page.tsx', 'features/ops3/rates.ts'];   // the registry cites the canon (with its arrows) and is not rendered

describe('PC-56 OPS-3c · the 3c pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, "%" only inside a slab line', (_l, cat) => {
    for (const html of pages(cat)) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(ARROWS.test(text(html))).toBe(false);
      expect(/%/.test(text(noSlabs(html)))).toBe(false);
    }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no ops3. value in any language carries a bare arrow', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat)) if (k.startsWith('ops3.')) expect([k, ARROWS.test(v)]).toEqual([k, false]);
  });
  it('no 3c source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_3C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
