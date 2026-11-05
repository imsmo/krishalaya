// apps/web-ops/src/test-render/rtl-ops1a.render.test.tsx · PC-56 OPS-1a — /payout (every state), the bill read, /warehouse/withdrawal and both
// chains render in en, hi and gu under `dir="rtl"` with no physical direction, no bare arrow glyph, no percentage, and the SAME `data-kv-*`
// skeleton in every language; every `ops1.` value is arrow-free in all three catalogues.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PayoutView } from '../components/ops1/PayoutView';
import { PayoutBillView } from '../components/ops1/PayoutBillView';
import { WithdrawalView } from '../components/ops1/WithdrawalView';
import { Ops1Chain } from '../components/ops1/Ops1Chain';
import { OPS1_CHAINS } from '../features/ops1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { BILLS_1A, CODES_1A, percents, text, tr } from './ops1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => [
  ...(['ok', 'empty', 'no_cycle', 'error', 'off'] as const).map((s) => rtl(<PayoutView t={tr(cat)} lang="en" state={s} bills={s === 'ok' ? BILLS_1A : []} memberCodes={CODES_1A} size={25} nextCursor={s === 'ok' ? 'Y3Vyc29y' : null} />)),
  rtl(<PayoutBillView t={tr(cat)} lang="en" bill={BILLS_1A[0]} memberCode="TC-01" state="ok" />),
  rtl(<WithdrawalView t={tr(cat)} />),
  ...OPS1_CHAINS.flatMap((c) => c.states.map((s) => rtl(<Ops1Chain t={tr(cat)} chain={c.id} state={s} />))),
];

describe('PC-56 OPS-1a · the money desks under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: every page and chain state carries no physical direction, no arrow glyph, no percentage', (_l, cat) => {
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
  it('no ops1 component or page carries physical CSS or an arrow glyph in its source; every ops1. value is arrow-free ×3', () => {
    for (const rel of ['components/ops1/PayoutView.tsx', 'components/ops1/PayoutBillView.tsx', 'components/ops1/WithdrawalView.tsx', 'components/ops1/Ops1Chain.tsx',
      'app/payout/page.tsx', 'app/payout/[id]/page.tsx', 'app/warehouse/withdrawal/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    for (const [lang, cat] of Object.entries(CATS)) for (const [k, v] of Object.entries(cat)) if (k.startsWith('ops1.') || k.startsWith('nav.payout') || k.startsWith('nav.withdrawal')) expect([lang, k, ARROWS.test(v)]).toEqual([lang, k, false]);
  });
});
