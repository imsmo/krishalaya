// apps/web-gov/src/test-render/rtl-gov1b.render.test.tsx · PC-56 GOV-1b (E10) — every dashboard state, the chrome canon in its shell, and every
// 1b chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every key resolved, and the SAME
// `data-kv-*` skeleton in every language; no GOV-1b source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChromeCanonView, DashboardView } from '../components/gov1/DashboardViews';
import { Gov1Chain } from '../components/gov1/Gov1Chain';
import { GovFooter, GovShell, GovSidebar } from '../components/gov1/GovShell';
import { GOV1_CHAINS } from '../features/gov1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, text, tr } from './gov1a-fixtures';
import { OVERVIEW, OVERVIEW_EMPTY, OVERVIEW_NO_SCHEME } from './gov1b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<DashboardView t={t} state="ok" me={ME_OFFICER} overview={OVERVIEW} />),
    rtl(<DashboardView t={t} state="ok" me={ME_OFFICER} overview={OVERVIEW_EMPTY} />),
    rtl(<DashboardView t={t} state="no_scheme" me={ME_OFFICER} overview={OVERVIEW_NO_SCHEME} />),
    ...(['off', 'forbidden', 'error'] as const).map((s) => rtl(<DashboardView t={t} state={s} me={ME_OFFICER} overview={null} />)),
    rtl(<GovShell me={ME_HEAD} sidebar={<GovSidebar t={t} me={ME_HEAD} />} footer={<GovFooter t={t} />} skipLabel={t.t('common.skipToContent')}><ChromeCanonView t={t} me={ME_HEAD} /></GovShell>),
    ...GOV1_CHAINS.filter((c) => c.wave === '1b').flatMap((c) => c.states.map((s) => rtl(<Gov1Chain t={t} chain={c.id} state={s} />))),
  ];
};
const SRC_1B = ['components/gov1/DashboardViews.tsx', 'components/gov1/GovShell.tsx', 'components/gov1/Gov1Chain.tsx', 'features/gov1/dashboard.ts',
  'app/dashboard/page.tsx', 'app/canon/chrome/page.tsx', 'app/layout.tsx'];

describe('PC-56 GOV-1b · the dashboard, the chrome canon and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    const all = pages(cat);
    expect(all.length).toBe(17);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-1b source carries physical CSS or an arrow glyph; the 1b CSS uses logical properties only', () => {
    for (const rel of SRC_1B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 GOV-1b'));
    expect(/margin-left|margin-right|padding-left|padding-right|border-top|border-left|border-right|\bleft:|\bright:/.test(ours)).toBe(false);
  });
});
