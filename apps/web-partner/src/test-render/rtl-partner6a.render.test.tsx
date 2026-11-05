// apps/web-partner/src/test-render/rtl-partner6a.render.test.tsx · PC-56 PARTNER-6a — the settlements page, a claim's settlement page and the
// settlement chain render in en, hi and gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow glyph (web-partner has no
// DirArrow — brief E9 draws none), no percentage, and the SAME `data-kv-*` skeleton in every language.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerSettlementsView } from '../components/partner6/InsurerSettlementsView';
import { InsurerSettlementView } from '../components/partner6/InsurerSettlementView';
import { InsurerChain6 } from '../components/partner6/InsurerChain6';
import { PARTNER6_CHAINS } from '../features/partner6/refusals';
import { settlementHref } from '../features/partner6/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { COUNTS_6A, COUNTS_6A_EMPTY, IDS_6A } from './partner6a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => [
  rtl(<InsurerSettlementsView t={tr(cat)} lang="en" state="ok" counts={COUNTS_6A} />),
  rtl(<InsurerSettlementsView t={tr(cat)} lang="en" state="empty" counts={COUNTS_6A_EMPTY} />),
  rtl(<InsurerSettlementsView t={tr(cat)} lang="en" state="error" counts={null} />),
  rtl(<InsurerSettlementsView t={tr(cat)} lang="en" state="off" counts={null} />),
  rtl(<InsurerSettlementView t={tr(cat)} state="ok" claimId={IDS_6A.claim} />),
  rtl(<InsurerSettlementView t={tr(cat)} state="error" claimId={IDS_6A.claim} />),
  rtl(<InsurerSettlementView t={tr(cat)} state="insurance_off" claimId={IDS_6A.claim} />),
];

describe('PC-56 PARTNER-6a · the two settlement pages and their chain under dir="rtl" (en / hi / gu)', () => {
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
  it('every chain state renders in all three languages under rtl, with no physical direction, no arrow and no percentage', () => {
    for (const c of PARTNER6_CHAINS) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<InsurerChain6 t={tr(cat)} chain={c.id} state={state} back={c.id === 'settlement_detail_act' ? settlementHref(IDS_6A.claim) : undefined} />);
      expect([c.id, state, PHYSICAL.test(html), ARROWS.test(text(html)), percents(text(html))]).toEqual([c.id, state, false, false, 0]);
    }
  });
  it('the views and pages add no physical CSS and no arrow glyph in their source; every partner6. value is arrow-free in all three languages', () => {
    for (const rel of ['components/partner6/InsurerSettlementsView.tsx', 'components/partner6/InsurerSettlementView.tsx', 'components/partner6/InsurerChain6.tsx',
      'app/insurer/settlements/page.tsx', 'app/insurer/settlements/[id]/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, /[←→⇐⇒⟵⟶➔➜]/.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    for (const cat of Object.values(CATS)) for (const k of Object.keys(en).filter((x) => x.startsWith('partner6.'))) expect([k, ARROWS.test(cat[k])]).toEqual([k, false]);
  });
});
