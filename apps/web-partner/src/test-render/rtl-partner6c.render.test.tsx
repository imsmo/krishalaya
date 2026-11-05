// apps/web-partner/src/test-render/rtl-partner6c.render.test.tsx · PC-56 PARTNER-6c — the notifications page, the preferences page (with its
// language radio group) and their three chains render in en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow
// glyph (web-partner has no DirArrow — brief E5 draws none), no percentage, and the SAME `data-kv-*` skeleton in every language; the language
// choice is laid out with LOGICAL CSS only (styles/globals.css `.kv-lang-choice*`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountNotificationsView } from '../components/partner6/AccountNotificationsView';
import { AccountNotificationPrefsView } from '../components/partner6/AccountNotificationPrefsView';
import { AccountChain6 } from '../components/partner6/AccountChain6';
import { PARTNER6_CHAINS } from '../features/partner6/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { ACT, CHOICES, CURRENT } from './partner6c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => [
  rtl(<AccountNotificationsView t={tr(cat)} state="on" />),
  rtl(<AccountNotificationsView t={tr(cat)} state="unknown" />),
  rtl(<AccountNotificationsView t={tr(cat)} state="off" />),
  rtl(<AccountNotificationPrefsView t={tr(cat)} state="on" current={CURRENT} choices={CHOICES} />),
  rtl(<AccountNotificationPrefsView t={tr(cat)} state="off" current={CURRENT} choices={CHOICES} />),
];

describe('PC-56 PARTNER-6c · the two account pages and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: both pages, in every state, carry no physical direction, no arrow glyph and no percentage', (_lang, cat) => {
    for (const html of pages(cat)) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(ARROWS.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
      expect(html).toContain('dir="rtl"');
    }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('every 6c chain state renders in all three languages under rtl, with no physical direction, no arrow and no percentage', () => {
    for (const c of PARTNER6_CHAINS.filter((x) => x.wave === '6c')) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<AccountChain6 t={tr(cat)} chain={c.id} state={state} chosen={CHOICES[0]} current={CURRENT} act={ACT} />);
      expect([c.id, state, PHYSICAL.test(html), ARROWS.test(text(html)), percents(text(html))]).toEqual([c.id, state, false, false, 0]);
    }
  });
  it('the views, pages and the language CSS add no physical CSS and no arrow glyph in their source; the radio group uses logical properties', () => {
    for (const rel of ['components/partner6/AccountNotificationsView.tsx', 'components/partner6/AccountNotificationPrefsView.tsx', 'components/partner6/AccountChain6.tsx',
      'app/account/notifications/page.tsx', 'app/account/notifications/preferences/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, /[←→⇐⇒⟵⟶➔➜]/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8').split('\n').filter((l) => /\.kv-lang-choice/.test(l));
    expect(css.length).toBeGreaterThanOrEqual(4);
    for (const l of css) expect([l, /\bleft\b|\bright\b|margin-left|margin-right|padding-left|padding-right/.test(l.replace(/\/\*.*\*\//, ''))]).toEqual([l, false]);
    expect(css.join('\n')).toMatch(/padding-inline|margin-block|inset-inline/);
  });
});
