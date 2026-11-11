// apps/web-gov/src/test-render/rtl-gov6a.render.test.tsx · PC-56 GOV-6a (E9) — /dashboard's "Analytics" and "Reports" sections (in every page
// state) and every 6a chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved,
// and the SAME `data-kv-*` skeleton in every language; no GOV-6a source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../components/gov1/DashboardViews';
import { Gov6Chain, Gov6DashboardSections } from '../components/gov6/DashboardSections';
import { GOV6_CHAINS } from '../features/gov6/refusals';
import type { DashState } from '../features/gov1/dashboard';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr } from './gov1a-fixtures';
import { OVERVIEW } from './gov1b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="gu">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const sections = (html: string) => (html.match(/<section class="kv-card" data-kv-section="[a-z_]+"[\s\S]*?<\/section>\s*<\/section>/g) ?? []);
const STATES: DashState[] = ['ok', 'no_scheme', 'error', 'off', 'forbidden'];
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...STATES.map((st) => rtl(<DashboardView t={t} state={st} me={ME_OFFICER} overview={OVERVIEW} />)),
    rtl(<Gov6DashboardSections t={t} />),
    ...GOV6_CHAINS.filter((c) => c.wave === '6a').flatMap((c) => c.states.map((s) => rtl(<Gov6Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_6A = ['components/gov6/DashboardSections.tsx', 'app/dashboard/page.tsx', 'components/gov1/DashboardViews.tsx'];   // (refusals.ts quotes the canon's own arrows; none is printed)

describe('PC-56 GOV-6a · the Analytics and Reports sections and the 6a chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved; both sections on every page state', (_l, cat) => {
    const all = pages(cat as Record<string, string>);
    expect(all.length).toBe(5 + 1 + 14);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov6\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
    for (const html of all.slice(0, 6)) expect(sections(html).map((s) => (s.match(/data-kv-section="([a-z_]+)"/) ?? [])[1])).toEqual(['analytics', 'reports']);
  });
  it('the markup skeleton of each state (and of each section) is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c as Record<string, string>).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
    const secs = Object.values(CATS).map((c) => sections(pages(c as Record<string, string>)[0]).map(skeleton).join('#'));
    expect(new Set(secs).size).toBe(1);
  });
  it('no GOV-6a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_6A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
