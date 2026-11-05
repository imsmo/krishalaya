// apps/web-partner/src/test-render/rtl-partner5c.render.test.tsx · PC-56 PARTNER-5c — the SLA page and its two chains render in en, hi and
// gu under `dir="rtl"` with no hard-coded physical direction, no bare arrow glyph (web-partner has no DirArrow — E9 draws none), no
// percentage, and the SAME `data-kv-*` skeleton in every language. The PARTNER-1a dashboard, with its retired tiles, is checked too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderReportsView } from '../components/partner5/LenderReportsView';
import { LenderChain5 } from '../components/partner5/LenderChain5';
import { DashboardView } from '../components/partner1/DashboardView';
import { PARTNER5_CHAINS } from '../features/partner5/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { FIGURES, text, tr } from './partner1a-fixtures';
import { percents } from './partner4a-fixtures';
import { COMPUTED_AT, MAILBOX, SLA, SLA_EMPTY } from './partner5c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).filter((a) => !/data-kv-(statement|refusal|true)=/.test(a)).join('|');
const page = (cat: Record<string, string>, state: 'ok' | 'empty' | 'error' | 'off') =>
  rtl(<LenderReportsView t={tr(cat)} lang="en" state={state} sla={state === 'ok' ? SLA : state === 'empty' ? SLA_EMPTY : null} computedAt={COMPUTED_AT} orgName="Fixture Lending Partner" mailbox={MAILBOX} />);

describe('PC-56 PARTNER-5c · the SLA page and its chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: the page in every state carries no physical direction, no arrow glyph and no percentage', (_l, cat) => {
    for (const state of ['ok', 'empty', 'error', 'off'] as const) {
      const html = page(cat, state);
      expect([state, PHYSICAL.test(html)]).toEqual([state, false]);
      expect([state, ARROWS.test(text(html))]).toEqual([state, false]);
      expect([state, percents(text(html))]).toEqual([state, 0]);
    }
  });
  it('the skeleton is identical in all three languages, in every state', () => {
    for (const state of ['ok', 'empty', 'error', 'off'] as const) expect([state, new Set(Object.values(CATS).map((c) => skeleton(page(c, state)))).size]).toEqual([state, 1]);
  });
  it('both chains, every state, every language: no physical direction, no arrow, no percentage', () => {
    for (const c of PARTNER5_CHAINS.filter((x) => x.wave === '5c')) for (const state of c.states) for (const cat of Object.values(CATS)) {
      const html = rtl(<LenderChain5 t={tr(cat)} chain={c.id} state={state} mailbox={MAILBOX} />);
      expect([c.id, state, PHYSICAL.test(html), ARROWS.test(text(html)), percents(text(html))]).toEqual([c.id, state, false, false, 0]);
    }
  });
  it('the dashboard (retired tiles) carries no percentage and no arrow in any language under rtl', () => {
    for (const cat of Object.values(CATS)) {
      const html = rtl(<DashboardView t={tr(cat)} lang="en" state="ok" d={FIGURES} orgName="Fixture Lending Partner" />);
      expect([percents(text(html)), ARROWS.test(text(html)), PHYSICAL.test(html)]).toEqual([0, false, false]);
    }
  });
  it('the new view adds no physical CSS and no arrow glyph in its source', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    for (const rel of ['components/partner5/LenderReportsView.tsx', 'app/lender/reports/page.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src), ARROWS.test(src)]).toEqual([rel, false, false]);
    }
  });
});
