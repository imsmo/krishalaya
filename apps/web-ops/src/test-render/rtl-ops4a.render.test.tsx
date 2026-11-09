// apps/web-ops/src/test-render/rtl-ops4a.render.test.tsx · PC-56 OPS-4a — every hire page state and every chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph (W407's "→" between statuses is not copied), and the SAME `data-kv-*` skeleton in every
// language; the 4a sources carry no physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChcBookingsView, ChcDashboardView, ChcEquipmentView, ChcInsightsView } from '../components/ops4/ChcViews';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { CATEGORIES, HIRES, M1, M2, MACHINES, MAINT, RATES } from './ops4a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<ChcDashboardView t={t} lang="en" state="ok" machines={MACHINES} machinesMore categories={CATEGORIES} hires={HIRES} hiresMore />),
    ...(['off', 'error'] as const).map((s) => rtl(<ChcDashboardView t={t} lang="en" state={s} machines={[]} machinesMore={false} categories={[]} hires={[]} hiresMore={false} />)),
    rtl(<ChcEquipmentView t={t} lang="en" state="ok" asset={M1} categories={CATEGORIES} rates={RATES} maintenance={MAINT} />),
    rtl(<ChcEquipmentView t={t} lang="en" state="ok" asset={M2} categories={CATEGORIES} rates={[]} maintenance={null} />),
    rtl(<ChcEquipmentView t={t} lang="en" state="notFound" asset={null} categories={[]} rates={null} maintenance={null} />),
    rtl(<ChcBookingsView t={t} lang="en" state="ok" hires={HIRES} nextCursor="Y3Vy" status="completed" machines={MACHINES} categories={CATEGORIES} />),
    rtl(<ChcBookingsView t={t} lang="en" state="error" hires={[]} nextCursor={null} status={undefined} machines={[]} categories={[]} />),
    rtl(<ChcInsightsView t={t} />),
    ...(['confirm', 'success', 'failure'] as const).flatMap((s) => [
      rtl(<Ops4Chain t={t} chain="chc_act" state={s} page="/chc/bookings" />),
      rtl(<Ops4Chain t={t} chain="chc_act" state={s} page="/chc/insights" reads={false} />),
      rtl(<Ops4Chain t={t} chain="equipment_act" state={s} page={`/chc/equipment-detail?id=${M1.id}`} />),
    ]),
  ];
};
const SRC_4A = ['components/ops4/ChcViews.tsx', 'components/ops4/Ops4Chain.tsx', 'features/ops4/chc.ts', 'app/chc/dashboard/page.tsx', 'app/chc/equipment-detail/page.tsx',
  'app/chc/bookings/page.tsx', 'app/chc/insights/page.tsx'];

describe('PC-56 OPS-4a · the hire pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no hire value in any language carries a bare arrow', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat))
      if (k.startsWith('ops4.') || ['nav.chcGroup', 'nav.chcDashboard', 'nav.chcBookings', 'nav.chcInsights'].includes(k)) expect([k, ARROWS.test(v)]).toEqual([k, false]);
  });
  it('no 4a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_4A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
