// apps/web-ops/src/test-render/rtl-ops4c.render.test.tsx · PC-56 OPS-4c — every sensor page state and every 4c chain state renders in en, hi and gu
// under `dir="rtl"` with no physical direction, no arrow glyph, and the SAME `data-kv-*` skeleton in every language; the 4c sources carry no physical
// CSS or arrow (E9).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IotDashboardView, IotDeviceView, IotHealthView } from '../components/ops4/IotViews';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { DETAIL, LAST_BREACH, LOGGERS, OVERVIEW, READ_AT, REGISTRY, S_COOLER, SILENCES, SILENCE_MINUTES } from './ops4c-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<IotDashboardView t={t} state="ok" readAt={READ_AT} overview={OVERVIEW} lastBreach={LAST_BREACH} loggers={LOGGERS} registry={REGISTRY} />),
    ...(['off', 'forbidden', 'error'] as const).map((s) => rtl(<IotDashboardView t={t} state={s} readAt={READ_AT} overview={null} lastBreach={null} loggers={null} registry={null} />)),
    rtl(<IotDeviceView t={t} state="ok" readAt={READ_AT} hours={48} type="bmc_unit" id={S_COOLER} detail={DETAIL} />),
    ...(['notFound', 'off', 'error'] as const).map((s) => rtl(<IotDeviceView t={t} state={s} readAt={READ_AT} hours={48} type="bmc_unit" id={S_COOLER} detail={null} />)),
    rtl(<IotHealthView t={t} state="ok" silences={SILENCES} loggers={LOGGERS} silenceMinutes={SILENCE_MINUTES} />),
    ...(['off', 'error'] as const).map((s) => rtl(<IotHealthView t={t} state={s} silences={[]} loggers={[]} silenceMinutes={null} />)),
    ...(['confirm', 'success', 'failure'] as const).flatMap((s) => [
      rtl(<Ops4Chain t={t} chain="iot_act" state={s} page="/iot/dashboard" />),
      rtl(<Ops4Chain t={t} chain="device_act" state={s} page="/iot/device-health" />),
    ]),
  ];
};
const SRC_4C = ['components/ops4/IotViews.tsx', 'features/ops4/iot.ts', 'app/iot/dashboard/page.tsx', 'app/iot/device/page.tsx', 'app/iot/device-health/page.tsx'];

describe('PC-56 OPS-4c · the sensor pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 4c source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_4C) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
