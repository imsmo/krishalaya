// apps/web-gov/src/test-render/rtl-gov2b.render.test.tsx · PC-56 GOV-2b (E10) — the scheme list, every tab of a scheme, every page state and
// every 2b chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME
// `data-kv-*` skeleton in every language; no GOV-2b source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchemeDetailView, SchemesListView } from '../components/gov2/SchemesViews';
import { Gov2Chain } from '../components/gov2/Gov2Chain';
import { chain2Back, GOV2_CHAINS } from '../features/gov2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr } from './gov1a-fixtures';
import { DIFF_A3, DIFF_B4, SCHEMES, SCHEME_A, SCHEME_B, VERSIONS_A, VERSIONS_B } from './gov2b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'empty', 'off', 'forbidden', 'error'] as const).map((s) => rtl(<SchemesListView t={t} state={s} me={ME_OFFICER} schemes={s === 'empty' ? [] : SCHEMES} />)),
    ...[SCHEME_A, SCHEME_B].flatMap((s) => (['identity', 'rules', 'versions'] as const).map((tab) => rtl(
      <SchemeDetailView t={t} state="ok" id={s.id} tab={tab} scheme={s} versions={s === SCHEME_A ? VERSIONS_A : VERSIONS_B} diff={s === SCHEME_A ? DIFF_A3 : DIFF_B4} diffState="ok" />))),
    ...(['not_found', 'off', 'forbidden', 'error'] as const).map((st) => rtl(<SchemeDetailView t={t} state={st} id={SCHEME_A.id} tab="identity" scheme={null} />)),
    ...GOV2_CHAINS.filter((c) => c.wave === '2b').flatMap((c) => c.states.map((s) => rtl(<Gov2Chain t={t} chain={c.id} state={s} back={chain2Back(c.id, SCHEME_A.id)} />))),
  ];
};
// (features/gov2/refusals.ts quotes the canon — its arrows sit inside the anonymised canon quotes — and is held to the claims guard instead)
const SRC_2B = ['components/gov2/SchemesViews.tsx', 'components/gov2/Gov2Chain.tsx', 'features/gov2/schemes.ts', 'features/gov2/rules-format.ts',
  'app/schemes/page.tsx', 'app/schemes/[id]/page.tsx', 'components/gov1/GovShell.tsx'];

describe('PC-56 GOV-2b · the schemes, their tabs and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    const all = pages(cat);
    expect(all.length).toBe(5 + 6 + 4 + 20);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov2\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-2b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_2B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
