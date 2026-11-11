// apps/web-gov/src/test-render/rtl-gov4b.render.test.tsx · PC-56 GOV-4b — /access with its "Sign-ins" section (W356) and every 4b chain state
// render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME `data-kv-*` skeleton in
// every language; no GOV-4b source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessView } from '../components/gov1/AccessViews';
import { Gov4Chain } from '../components/gov4/VerificationViews';
import { SignInsSection } from '../components/gov4/SignInsViews';
import { GOV4_CHAINS } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, ROWS, text, tr } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<SignInsSection t={t} />),
    rtl(<AccessView t={t} state="ok" me={ME_HEAD} rows={ROWS} />), rtl(<AccessView t={t} state="ok" me={ME_OFFICER} rows={ROWS} />), rtl(<AccessView t={t} state="error" me={ME_HEAD} rows={[]} />),
    ...GOV4_CHAINS.filter((c) => c.wave === '4b').flatMap((c) => c.states.map((s) => rtl(<Gov4Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_4B = ['components/gov4/SignInsViews.tsx', 'components/gov4/VerificationViews.tsx', 'components/gov1/AccessViews.tsx', 'app/access/page.tsx'];

describe('PC-56 GOV-4b · the Sign-ins section and its chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    const all = pages(cat as Record<string, string>);
    expect(all.length).toBe(4 + 5);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov4\.|gov3\.|gov2\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c as Record<string, string>).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-4b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_4B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
