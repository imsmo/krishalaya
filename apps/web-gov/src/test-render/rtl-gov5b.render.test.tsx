// apps/web-gov/src/test-render/rtl-gov5b.render.test.tsx · PC-56 GOV-5b (E9) — /mgnrega's "Wages" and "Social audit" sections and every 5b chain
// state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME `data-kv-*`
// skeleton in every language; no GOV-5b source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov5Chain, MgnregaView } from '../components/gov5/MgnregaViews';
import { GOV5_CHAINS } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, text, tr } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="gu">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const sections = (html: string) => (html.match(/<section class="kv-card" data-kv-not-done="" data-kv-section="[a-z_]+"[\s\S]*?<\/section>\s*<\/section>/g) ?? []);
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<MgnregaView t={t} me={ME_OFFICER} />), rtl(<MgnregaView t={t} me={ME_HEAD} />), rtl(<MgnregaView t={t} me={null} />),
    ...GOV5_CHAINS.filter((c) => c.wave === '5b').flatMap((c) => c.states.map((s) => rtl(<Gov5Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_5B = ['components/gov5/MgnregaViews.tsx', 'app/mgnrega/page.tsx'];   // (refusals.ts quotes the canon's own arrows in its `canon` strings; none is printed)

describe('PC-56 GOV-5b · the Wages and Social audit sections and the 5b chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved; both sections present on every page state', (_l, cat) => {
    const all = pages(cat as Record<string, string>);
    expect(all.length).toBe(3 + 8);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov5\.|gov4\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
    for (const html of all.slice(0, 3)) expect(sections(html).map((s) => (s.match(/data-kv-section="([a-z_]+)"/) ?? [])[1])).toEqual(['wages', 'social_audit']);
  });
  it('the markup skeleton of each state (and of each section) is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c as Record<string, string>).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
    const secs = Object.values(CATS).map((c) => sections(pages(c as Record<string, string>)[0]).map(skeleton).join('#'));
    expect(new Set(secs).size).toBe(1);
  });
  it('no GOV-5b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_5B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
