// apps/web-ops/src/test-render/rtl-ops3a.render.test.tsx · PC-56 OPS-3a — every counter page state and pos chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, and the SAME `data-kv-*` skeleton in every language; the 3a sources carry no physical CSS
// or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { PosCollectView, PosExceptionsView, PosHomeView, PosQualityView, PosShiftView, PosSlipView, PourFailure, WhatWasRecorded } from '../components/ops3/CounterViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { CARD, CENTRE, POUR, RECORDED, ROLL, ROWS, TILES, TODAY } from './ops3a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<PosHomeView t={t} lang="en" state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} />),
    ...(['noCustody', 'off', 'forbidden', 'error'] as const).map((s) => rtl(<PosHomeView t={t} lang="en" state={s} centre={null} centres={[]} today={null} rows={null} />)),
    rtl(<PosCollectView t={t} state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} roll={ROLL} code={null} nextCursor="abc" error="billed" />),
    rtl(<PosQualityView t={t} centre={CENTRE} pour={POUR} memberCode="TC-001" milkType="cow" idemKey="k" action={async () => undefined} back="/pos/collect" />),
    rtl(<PosSlipView t={t} lang="en" state="ok" pour={RECORDED} card={CARD} cardRead={true} centre={CENTRE} />),
    rtl(<PosSlipView t={t} lang="en" state="none" pour={null} card={null} cardRead={false} centre={null} />),
    rtl(<PosExceptionsView t={t} />),
    rtl(<PosShiftView t={t} lang="en" state="ok" centre={CENTRE} centres={[CENTRE]} today={TODAY} rows={ROWS} cooler="ok" tiles={TILES} />),
    rtl(<Ops3Chain t={t} chain="pos_act" state="success" back="/pos/collect"><WhatWasRecorded t={t} lang="en" pour={RECORDED} card={CARD} cardRead={true} /></Ops3Chain>),
    rtl(<Ops3Chain t={t} chain="pos_act" state="failure" back="/pos/quality"><PourFailure t={t} reason="duplicate" /></Ops3Chain>),
  ];
};
const SRC_3A = ['components/ops3/CounterViews.tsx', 'features/ops3/counter.ts', 'app/pos/actions.ts', 'app/pos/home/page.tsx', 'app/pos/collect/page.tsx',
  'app/pos/quality/page.tsx', 'app/pos/slip/page.tsx', 'app/pos/exceptions/page.tsx', 'app/pos/shift-close/page.tsx'];

describe('PC-56 OPS-3a · the counter under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no counter value in any language carries a bare arrow', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat)) if (k.startsWith('ops3.pos.') || k.startsWith('nav.pos')) expect([k, ARROWS.test(v)]).toEqual([k, false]);
  });
  it('no 3a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_3A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
