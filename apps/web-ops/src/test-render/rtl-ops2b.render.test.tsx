// apps/web-ops/src/test-render/rtl-ops2b.render.test.tsx · PC-56 OPS-2b — every 2b page state and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, no percentage, and the SAME `data-kv-*` skeleton in every language; the 2b sources carry no
// physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssayLabView, AssayRecordView, AssayForm } from '../components/ops2/AssayViews';
import { EnwrIssueView, EnwrRegistryView, EnwrReceiptView } from '../components/ops2/EnwrViews';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { OPS2_CHAINS } from '../features/ops2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { percents, text, tr } from './ops1a-fixtures';
import { ASSAYS_2B, BOOKING_ID, RECEIPTS_2B } from './ops2b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'pick', 'unavailable', 'error'] as const).map((s) => rtl(<AssayLabView t={t} lang="en" state={s} bookingId={s === 'pick' ? undefined : BOOKING_ID} bookingStatus="stored" isOperator assays={ASSAYS_2B} action="/x" />)),
    ...(['ok', 'missing', 'pick', 'unavailable', 'error'] as const).map((s) => rtl(<AssayRecordView t={t} lang="en" state={s} bookingId={BOOKING_ID} assay={s === 'ok' ? ASSAYS_2B[0] : null} />)),
    rtl(<EnwrIssueView t={t} />),
    ...(['ok', 'none', 'forbidden', 'off', 'error'] as const).map((s) => rtl(<EnwrRegistryView t={t} lang="en" state={s} receipts={s === 'ok' ? RECEIPTS_2B : []} size={25} nextCursor={null} />)),
    ...(['ok', 'unavailable', 'error'] as const).map((s) => rtl(<EnwrReceiptView t={t} lang="en" state={s} receipt={s === 'ok' ? RECEIPTS_2B[1] : null} unitCode="quintal" />)),
    ...OPS2_CHAINS.filter((c) => c.wave === '2b').flatMap((c) => c.states.map((s) => rtl(<Ops2Chain t={t} chain={c.id} state={s}>{c.id === 'assay_act' && s === 'confirm' ? <AssayForm t={t} bookingId={BOOKING_ID} action="/x" /> : null}</Ops2Chain>))),
  ];
};
const SRC_2B = ['components/ops2/AssayViews.tsx', 'components/ops2/EnwrViews.tsx', 'components/ops2/Ops2Chain.tsx', 'features/ops2/receipts.ts', 'app/warehouse/assay/page.tsx',
  'app/warehouse/assay/actions.ts', 'app/warehouse/assay/certificate/page.tsx', 'app/warehouse/enwr/issue/page.tsx', 'app/warehouse/enwr/registry/page.tsx', 'app/warehouse/enwr/[id]/page.tsx'];

describe('PC-56 OPS-2b · the 2b pages under dir="rtl" (en / hi / gu)', () => {
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
  it('no 2b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_2B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
