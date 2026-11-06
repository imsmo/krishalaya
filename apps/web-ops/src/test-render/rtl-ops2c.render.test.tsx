// apps/web-ops/src/test-render/rtl-ops2c.render.test.tsx · PC-56 OPS-2c — every 2c page state and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, no percentage, and the SAME `data-kv-*` skeleton in every language; the 2c sources carry
// no physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingView } from '../components/ops2/BillingView';
import { InsightsView } from '../components/ops2/InsightsView';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { OPS2_CHAINS } from '../features/ops2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { percents, text, tr } from './ops1a-fixtures';
import { WAREHOUSES_2C } from './ops2c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'none', 'error', 'off'] as const).map((s) => rtl(<BillingView t={t} lang="en" state={s} warehouses={s === 'ok' ? WAREHOUSES_2C : []} nextCursor={null} />)),
    rtl(<InsightsView t={t} />),
    ...OPS2_CHAINS.flatMap((c) => c.states.map((s) => rtl(<Ops2Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_2C = ['components/ops2/BillingView.tsx', 'components/ops2/InsightsView.tsx', 'components/ops2/Ops2Chain.tsx', 'app/warehouse/billing/page.tsx', 'app/warehouse/insights/page.tsx', 'features/ops2/billing.ts'];

describe('PC-56 OPS-2c · the 2c pages under dir="rtl" (en / hi / gu)', () => {
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
  it('no ops2. value in any language carries a bare arrow', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat)) if (k.startsWith('ops2.')) expect([k, ARROWS.test(v)]).toEqual([k, false]);
  });
  it('no 2c source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_2C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
