// apps/web-ops/src/test-render/rtl-ops3b.render.test.tsx · PC-56 OPS-3b — every cooler page state and every state of its two chains renders in en, hi
// and gu under `dir="rtl"` with no physical direction, no arrow glyph, and the SAME `data-kv-*` skeleton in every language; the 3b sources carry no
// physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { BmcView, FormErrorReason, ManualReadingForm, ReadingFailure, ReadingRecorded, ReadingReview } from '../components/ops3/BmcViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { CENTRE, POINTS, RECORDED, T1, T_NEVER, T_STALE } from './ops3b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<BmcView t={t} state="ok" scope="custody" centres={[CENTRE]} tiles={[T1]} cooler={T1} points={POINTS} />),
    rtl(<BmcView t={t} state="ok" scope="organisation" centres={[]} tiles={[T1, T_STALE]} cooler={T_STALE} points={[]} />),
    rtl(<BmcView t={t} state="ok" scope="custody" centres={[CENTRE]} tiles={[T_NEVER]} cooler={T_NEVER} points={null} />),
    ...(['off', 'monitorOff', 'forbidden', 'error'] as const).map((s) => rtl(<BmcView t={t} state={s} scope="custody" centres={[]} tiles={[]} cooler={null} points={null} />)),
    rtl(<Ops3Chain t={t} chain="bmc_form" state="error" back="/bmc" backKey="ops3.bmc.back"><FormErrorReason t={t} error="temp" /><ManualReadingForm t={t} tile={T1} value="x" /></Ops3Chain>),
    rtl(<Ops3Chain t={t} chain="bmc_form" state="review" back="/bmc" backKey="ops3.bmc.back"><ReadingReview t={t} tile={T1} tempC="3.8" action={async () => undefined} /></Ops3Chain>),
    rtl(<Ops3Chain t={t} chain="bmc_form" state="success" back="/bmc" backKey="ops3.bmc.back"><ReadingRecorded t={t} reading={RECORDED} /></Ops3Chain>),
    rtl(<Ops3Chain t={t} chain="bmc_form" state="failure" back="/bmc" backKey="ops3.bmc.back"><ReadingFailure t={t} reason="custody" /></Ops3Chain>),
    ...(['confirm', 'success', 'failure'] as const).map((s) => rtl(<Ops3Chain t={t} chain="bmc_act" state={s} backKey="ops3.bmc.back" />)),
  ];
};
const SRC_3B = ['components/ops3/BmcViews.tsx', 'features/ops3/bmc.ts', 'app/bmc/page.tsx', 'app/bmc/actions.ts'];

describe('PC-56 OPS-3b · the cooler under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no cooler value in any language carries a bare arrow', () => {
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat))
      if (k.startsWith('ops3.bmc.') || k.startsWith('ops3.chain.bmc') || k.startsWith('ops3.refusal.bmc') || k === 'nav.bmc') expect([k, ARROWS.test(v)]).toEqual([k, false]);
  });
  it('no 3b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_3B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
