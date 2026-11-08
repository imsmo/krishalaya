// apps/web-ops/src/test-render/rtl-ops2a.render.test.tsx · PC-56 OPS-2a — every 2a page state and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, no percentage, and the SAME `data-kv-*` skeleton in every language; the 2a sources carry no
// physical CSS or arrow (E9 — the drill-in's bare "←" is gone).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StorageBooking } from '@krishalaya/sdk-js';
import { BookingDetailView, StackingView, WeighbridgeView, WhDashboardView } from '../components/ops2/IntakeViews';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { OPS2_CHAINS } from '../features/ops2/refusals';
import { readDashboard, type DashboardGroup } from '../features/ops2/intake';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { percents, text, tr } from './ops1a-fixtures';
import { WAREHOUSE_ROWS, WH_1, fakeIo } from './ops2a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
let groups: DashboardGroup[] = [];
beforeAll(async () => { groups = (await readDashboard(fakeIo({ nextCursor: 'MjAyNnx4' }), {})).groups; });
const booking = { ...WAREHOUSE_ROWS[WH_1][0], status: 'requested' } as StorageBooking;
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'none', 'off', 'forbidden', 'error'] as const).map((s) => rtl(<WhDashboardView t={t} lang="en" state={s} groups={s === 'ok' ? groups : []} />)),
    rtl(<WeighbridgeView t={t} />), rtl(<StackingView t={t} />),
    ...[true, false].map((op) => rtl(<BookingDetailView t={t} lang="en" booking={booking} commodity="Test commodity" warehouseName={op ? 'Test warehouse one' : null} isOperator={op} ok={null} error="reason" action="/x" />)),
    ...OPS2_CHAINS.filter((c) => c.wave === '2a').flatMap((c) => c.states.map((s) => rtl(<Ops2Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_2A = ['components/ops2/IntakeViews.tsx', 'features/ops2/intake.ts', 'app/warehouse/dashboard/page.tsx', 'app/warehouse/weighbridge/page.tsx', 'app/warehouse/stacking/page.tsx',
  'app/warehouse/[id]/page.tsx', 'app/warehouse/actions.ts'];

describe('PC-56 OPS-2a · the 2a pages under dir="rtl" (en / hi / gu)', () => {
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
  it('no 2a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_2A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
