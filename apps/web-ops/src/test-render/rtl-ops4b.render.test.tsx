// apps/web-ops/src/test-render/rtl-ops4b.render.test.tsx · PC-56 OPS-4b — every upkeep and animal page state and every 4b chain state renders in en,
// hi and gu under `dir="rtl"` with no physical direction, no arrow glyph, and the SAME `data-kv-*` skeleton in every language; the 4b sources carry
// no physical CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MaintenanceView, MaintFailureNote, MaintForm, MaintFormError, MaintRecorded, MaintReview } from '../components/ops4/UpkeepViews';
import { AnimalHonestView } from '../components/ops4/AnimalViews';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { A1, CATEGORIES, MACHINES } from './ops4a-fixtures';
import { ALERTS, DRAFT, ENTRIES, RECORDED } from './ops4b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const BODY = { assetId: A1, logType: 'repair' as const, performedOn: '2026-11-09', costMinor: '73150', engineHoursAt: null };
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<MaintenanceView t={t} lang="en" state="ok" machines={MACHINES} machinesMore categories={CATEGORIES} entries={ENTRIES} alerts={ALERTS} />),
    ...(['off', 'error'] as const).map((s) => rtl(<MaintenanceView t={t} lang="en" state={s} machines={[]} machinesMore={false} categories={[]} entries={{}} alerts={[]} />)),
    rtl(<Ops4Chain t={t} chain="chc_form" state="error" page="/chc/maintenance"><MaintFormError t={t} error="cost" /><MaintForm t={t} machines={MACHINES} categories={CATEGORIES} values={DRAFT} /></Ops4Chain>),
    rtl(<Ops4Chain t={t} chain="chc_form" state="review" page="/chc/maintenance"><MaintReview t={t} lang="en" machine="x" body={BODY} idemKey="k" action="/x" draft={DRAFT} /></Ops4Chain>),
    rtl(<Ops4Chain t={t} chain="chc_form" state="success" page="/chc/maintenance"><MaintRecorded t={t} lang="en" entry={RECORDED} machine={null} /></Ops4Chain>),
    rtl(<Ops4Chain t={t} chain="chc_form" state="failure" page="/chc/maintenance"><MaintFailureNote t={t} reason="date_in_future" /></Ops4Chain>),
    ...(['eartag', 'animal_register', 'animal_transfer'] as const).map((s) => rtl(<AnimalHonestView t={t} surface={s} />)),
    ...(['confirm', 'success', 'failure'] as const).flatMap((s) => [
      rtl(<Ops4Chain t={t} chain="eartag_act" state={s} page="/animals/eartag-scan" />),
      rtl(<Ops4Chain t={t} chain="chc_act" state={s} page="/chc/maintenance" />),
    ]),
  ];
};
const SRC_4B = ['components/ops4/UpkeepViews.tsx', 'components/ops4/AnimalViews.tsx', 'components/ops4/AnimalLinks.tsx', 'features/ops4/upkeep.ts', 'app/chc/maintenance/page.tsx',
  'app/chc/maintenance/actions.ts', 'app/animals/eartag-scan/page.tsx', 'app/animals/register/page.tsx', 'app/animals/transfer/page.tsx'];

describe('PC-56 OPS-4b · the upkeep and animal pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 4b source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_4B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
