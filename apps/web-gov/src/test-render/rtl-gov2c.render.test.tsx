// apps/web-gov/src/test-render/rtl-gov2c.render.test.tsx · PC-56 GOV-2c (E10) — the applications list, one application, every page state, the
// act forms and answers, and every 2c chain state render in en, hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, every
// key resolved, and the SAME `data-kv-*` skeleton in every language; no GOV-2c source carries physical CSS or an arrow.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActDoneNote, ActFailureNote, ActForm, ApplicationDetailView, ApplicationsListView } from '../components/gov2/ApplicationsViews';
import { Gov2Chain } from '../components/gov2/Gov2Chain';
import { GOV2_CHAINS } from '../features/gov2/refusals';
import { appChainBack } from '../features/gov2/applications';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr } from './gov1a-fixtures';
import { SCHEMES } from './gov2b-fixtures';
import { APP_1, HEAD_2C, LIST, OPENED, OPENED_UNDECLARED } from './gov2c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const noop = '/applications/act';   // a string action: renderToStaticMarkup cannot print a Server Action
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    ...(['ok', 'empty', 'off', 'forbidden', 'error'] as const).map((s) => rtl(<ApplicationsListView t={t} state={s} me={ME_OFFICER} items={s === 'empty' ? [] : LIST} schemes={SCHEMES} nextCursor="c2" cursor="c1" />)),
    rtl(<ApplicationDetailView t={t} state="ok" me={HEAD_2C} id={APP_1} app={OPENED} facts={null} decision="alone" />),
    rtl(<ApplicationDetailView t={t} state="ok" me={HEAD_2C} id={APP_1} app={OPENED_UNDECLARED} />),
    ...(['not_found', 'off', 'forbidden', 'error'] as const).map((s) => rtl(<ApplicationDetailView t={t} state={s} me={HEAD_2C} id={APP_1} app={null} />)),
    ...(['verify', 'clarify', 'approve', 'reject'] as const).map((a) => rtl(<ActForm t={t} appId={APP_1} act={a} idemKey="k" action={noop} />)),
    rtl(<ActDoneNote t={t} status="approved" />), rtl(<ActFailureNote t={t} error="GOV_DECIDER_IS_VERIFIER" />),
    ...GOV2_CHAINS.filter((c) => c.wave === '2c').flatMap((c) => c.states.map((s) => rtl(<Gov2Chain t={t} chain={c.id} state={s} back={appChainBack(c.id.startsWith('application_') ? APP_1 : null)} />))),
  ];
};
const SRC_2C = ['components/gov2/ApplicationsViews.tsx', 'features/gov2/applications.ts', 'app/applications/page.tsx', 'app/applications/[id]/page.tsx', 'app/applications/[id]/actions.ts'];

describe('PC-56 GOV-2c · the applications, one application and their chains under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    const all = pages(cat);
    expect(all.length).toBe(5 + 2 + 4 + 4 + 2 + 11);
    for (const html of all) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/gov2\.|gov1\.|common\.|nav\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no GOV-2c source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_2C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
