// apps/web-gov/src/test-render/rtl-gov4a.render.test.tsx · PC-56 GOV-4a (E9) — /verification and every 4a chain state render in en, hi and gu
// under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME `data-kv-*` skeleton in every language; no
// GOV-4a source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov4Chain, VerificationView } from '../components/gov4/VerificationViews';
import { GOV4_CHAINS } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, text, tr } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<VerificationView t={t} me={ME_OFFICER} />), rtl(<VerificationView t={t} me={ME_HEAD} />), rtl(<VerificationView t={t} me={null} />),
    ...GOV4_CHAINS.flatMap((c) => c.states.map((s) => rtl(<Gov4Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_4A = ['components/gov4/VerificationViews.tsx', 'app/verification/page.tsx'];   // (refusals.ts quotes the canon's own arrows in its `canon` strings; none is printed)

describe('PC-56 GOV-4a · /verification and its chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    const all = pages(cat as Record<string, string>);
    expect(all.length).toBe(3 + 9);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov4\.|gov3\.|gov2\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c as Record<string, string>).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-4a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_4A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
