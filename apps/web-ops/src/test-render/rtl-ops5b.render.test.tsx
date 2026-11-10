// apps/web-ops/src/test-render/rtl-ops5b.render.test.tsx · PC-56 OPS-5b — every insights page state and every insights chain state renders in en,
// hi and gu under `dir="rtl"` with no physical direction, no arrow glyph (a range is "from … to …", never an arrow), every key resolved, and the
// SAME `data-kv-*` skeleton in every language; the 5b sources carry no physical CSS or arrow (E14).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportJobView, InsightsView } from '../components/ops5/InsightsViews';
import { Ops5Chain } from '../components/ops5/Ops5Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { JOB_EXPIRED, JOB_FAILED, JOB_QUEUED, JOB_QUEUED_ETA, JOB_READY, ME, NOT_ENABLED, NO_DATA, READY, READY_OTHER, READY_THIRD, SHORT, UNAVAILABLE } from './ops5b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›▲▼]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const act = async () => undefined;
const KEY = '0192d2c4-4e70-7000-8000-0000000000b5';
const BACK = '/insights?window=90';
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  const ins = (p: Partial<React.ComponentProps<typeof InsightsView>>) => rtl(<InsightsView t={t} lang="en" w={90} state="ok" data={READY} idemKey={KEY} exportAction={act} exportError={null} {...p} />);
  const job = (j: typeof JOB_READY | null, s: 'queued' | 'ready' | 'expired' | 'failed' | 'off' | 'forbidden' | 'notFound' | 'error') =>
    rtl(<Ops5Chain t={t} chain="insights_export" state={s} page={BACK}><ExportJobView t={t} w={90} state={s} job={j} meId={ME} downloadError={null} /></Ops5Chain>);
  return [
    ins({}), ins({ data: READY_OTHER }), ins({ data: READY_THIRD }), ins({ data: NO_DATA }), ins({ data: SHORT }), ins({ data: UNAVAILABLE }), ins({ data: NOT_ENABLED }),
    ins({ exportError: 'off' }), ...(['off', 'forbidden', 'error'] as const).map((s) => ins({ state: s, data: null })),
    job(JOB_QUEUED, 'queued'), job(JOB_QUEUED_ETA, 'queued'), job(JOB_READY, 'ready'), job(JOB_EXPIRED, 'expired'), job(JOB_FAILED, 'failed'),
    ...(['off', 'forbidden', 'notFound', 'error'] as const).map((s) => job(null, s)),
    ...(['confirm', 'success', 'failure'] as const).map((s) => rtl(<Ops5Chain t={t} chain="insights_act" state={s} page={BACK} />)),
  ];
};
const SRC_5B = ['components/ops5/InsightsViews.tsx', 'features/ops5/insights.ts', 'app/insights/page.tsx', 'app/insights/actions.ts', 'app/insights/exports/[id]/download/route.ts'];

describe('PC-56 OPS-5b · the insights pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/ops5\.|ops4\.|\{[a-z]+\}/.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 5b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_5B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
