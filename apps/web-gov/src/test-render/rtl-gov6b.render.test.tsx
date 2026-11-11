// apps/web-gov/src/test-render/rtl-gov6b.render.test.tsx · PC-56 GOV-6b (E9) — /access's "The record" and "Outside bodies" sections (in every
// page state) and every 6b chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key
// resolved, and the SAME `data-kv-*` skeleton in every language; no GOV-6b source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessView } from '../components/gov1/AccessViews';
import { Gov6AccessSections } from '../components/gov6/AccessSections';
import { Gov6Chain } from '../components/gov6/DashboardSections';
import { GOV6_CHAINS } from '../features/gov6/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ROWS, text, tr } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="gu">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const sections = (html: string) => (html.match(/<section class="kv-card" data-kv-section="[a-z_]+"[\s\S]*?<\/section>\s*<\/section>/g) ?? []);
const STATES = ['ok', 'forbidden', 'error', 'off'] as const;
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...STATES.map((st) => rtl(<AccessView t={t} state={st} me={ME_HEAD} rows={st === 'ok' ? ROWS : []} />)),
    rtl(<Gov6AccessSections t={t} />),
    ...GOV6_CHAINS.filter((c) => c.wave === '6b').flatMap((c) => c.states.map((s) => rtl(<Gov6Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_6B = ['components/gov6/AccessSections.tsx', 'app/access/page.tsx', 'components/gov1/AccessViews.tsx'];

describe('PC-56 GOV-6b · the record and outside-body sections and the 6b chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved; both sections on every page state', (_l, cat) => {
    const all = pages(cat as Record<string, string>);
    expect(all.length).toBe(4 + 1 + 14);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov6\.|gov4\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
    for (const html of all.slice(0, 5)) expect(sections(html).map((s) => (s.match(/data-kv-section="([a-z_]+)"/) ?? [])[1])).toEqual(['record', 'outside']);
  });
  it('the markup skeleton of each state (and of each section) is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c as Record<string, string>).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
    const secs = Object.values(CATS).map((c) => sections(pages(c as Record<string, string>)[0]).map(skeleton).join('#'));
    expect(new Set(secs).size).toBe(1);
  });
  it('no GOV-6b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_6B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
