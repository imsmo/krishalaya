// apps/web-partner/src/test-render/rtl-partner4a.render.test.tsx · PC-56 PARTNER-4a — the four lending screens and the chains render in en, hi
// and gu under `dir="rtl"` with no hard-coded physical direction: no `margin-left` / `right:` / `text-align: left` inline style, no `←` / `→`
// glyph outside the i18n catalogues' own back-links, and the same `data-kv-*` structure in every language (a translation can change the words,
// never the page's shape). The stylesheet is logical-property only; this test pins the markup.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderQueueView } from '../components/partner4/LenderQueueView';
import { LenderApplicationView } from '../components/partner4/LenderApplicationView';
import { LenderPortfolioView } from '../components/partner4/LenderPortfolioView';
import { LenderLoanView } from '../components/partner4/LenderLoanView';
import { LenderChain } from '../components/partner4/LenderChain';
import { PARTNER4_CHAINS } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { tr } from './partner1a-fixtures';
import { APPLICATION, COUNTS, LOAN, LOANS, REPAYMENTS, percents } from './partner4a-fixtures';

const NOOP = async () => undefined;
const ACTIONS = { review: NOOP, approve: NOOP, reject: NOOP };
const CATS = { en, hi, gu } as const;
/** The whole page inside an RTL document, as the shell would render it. */
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
/** Physical direction, hard-coded — the thing that breaks an RTL page. */
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)/i;
/** The `data-kv-*` skeleton of a page: it must be identical in every language. */
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).filter((a) => !/data-kv-(statement|refusal)=/.test(a)).join('|');

describe('PC-56 PARTNER-4a · the lending screens under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: the queue, the application, the portfolio and the loan carry no physical direction and no stray arrow', (lang, cat) => {
    const pages = [
      rtl(<LenderQueueView t={tr(cat)} lang={lang} state="ok" items={[APPLICATION]} counts={COUNTS} box="review" status={undefined} nextCursor="Y3Vyc29y" computedAt="2026-10-28T06:30:00.000Z" />),
      rtl(<LenderApplicationView t={tr(cat)} lang={lang} a={APPLICATION} failure={null} notFound={false} perms={['partner.applications.read']} idemKey="k" actions={ACTIONS} />),
      rtl(<LenderPortfolioView t={tr(cat)} lang={lang} state="ok" counts={COUNTS} items={LOANS} status={undefined} nextCursor={null} computedAt="2026-10-28T06:30:00.000Z" />),
      rtl(<LenderLoanView t={tr(cat)} lang={lang} l={LOAN} repayments={REPAYMENTS} failure={null} notFound={false} computedAt="2026-10-28T06:30:00.000Z" />),
    ];
    for (const html of pages) {
      expect([lang, PHYSICAL.test(html)]).toEqual([lang, false]);
      expect([lang, /style="/.test(html)]).toEqual([lang, false]);   // no inline style at all on a lending page
      expect([lang, html.includes('dir="rtl"')]).toEqual([lang, true]);
      expect([lang, percents(html)]).toEqual([lang, 0]);
      // the only arrows allowed are the ones the catalogue itself puts in a back-link
      const arrows = (html.match(/[←→]/g) ?? []).length;
      const catalogueArrows = [cat['partner4.application.back'], cat['partner4.loan.back']].join('').match(/[←→]/g)?.length ?? 0;
      expect([lang, arrows <= catalogueArrows]).toEqual([lang, true]);
    }
  });
  it('the page SKELETON is identical in all three languages — a translation changes the words, never the structure', () => {
    const of = (cat: Record<string, string>, lang: string) => [
      skeleton(rtl(<LenderQueueView t={tr(cat)} lang={lang} state="ok" items={[APPLICATION]} counts={COUNTS} box="review" status={undefined} nextCursor="Y3Vyc29y" computedAt="2026-10-28T06:30:00.000Z" />)),
      skeleton(rtl(<LenderPortfolioView t={tr(cat)} lang={lang} state="ok" counts={COUNTS} items={LOANS} status={undefined} nextCursor={null} computedAt="2026-10-28T06:30:00.000Z" />)),
      skeleton(rtl(<LenderLoanView t={tr(cat)} lang={lang} l={LOAN} repayments={REPAYMENTS} failure={null} notFound={false} computedAt="2026-10-28T06:30:00.000Z" />)),
    ];
    expect(of(hi, 'hi')).toEqual(of(en, 'en'));
    expect(of(gu, 'gu')).toEqual(of(en, 'en'));
  });
  it.each(Object.entries(CATS))('%s: every chain state renders under rtl with its own sentence and no physical direction', (_lang, cat) => {
    for (const c of PARTNER4_CHAINS) for (const s of c.states) {
      const html = rtl(<LenderChain t={tr(cat)} chain={c.id} state={s} />);
      expect([c.id, s, PHYSICAL.test(html)]).toEqual([c.id, s, false]);
      expect([c.id, s, html.includes(cat[`${c.key(s)}.title`])]).toEqual([c.id, s, true]);
      expect([c.id, s, percents(html)]).toEqual([c.id, s, 0]);
    }
  });
});
