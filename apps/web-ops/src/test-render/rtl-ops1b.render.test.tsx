// apps/web-ops/src/test-render/rtl-ops1b.render.test.tsx · PC-56 OPS-1b — every 1b page and chain state renders in en, hi and gu under
// `dir="rtl"` with no physical direction, no arrow glyph, no percentage, and the SAME `data-kv-*` skeleton in every language; the 1b sources carry
// no physical CSS or arrow; the old money pages' "→" / "←" are gone with the pages.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AepsExceptionsView, AepsHomeView, AepsReceiptView, AepsRecordView } from '../components/ops1/AepsViews';
import { BiometricCanonView, FaceAttendanceView, FaceEnrollView } from '../components/ops1/FaceViews';
import { Ops1Chain } from '../components/ops1/Ops1Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { percents, text, tr } from './ops1a-fixtures';
import { EVENTS_1B } from './ops1b-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z-]+="[^"]*"/g) ?? []).join('|');
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<AepsHomeView t={t} />), rtl(<AepsRecordView t={t} mode="page" action="/aeps/withdrawal" />), rtl(<AepsRecordView t={t} mode="confirm" action="/aeps/withdrawal" />),
    ...(['mine', 'all'] as const).map((v) => rtl(<AepsExceptionsView t={t} lang="en" view={v} state="ok" rows={EVENTS_1B} />)),
    rtl(<AepsExceptionsView t={t} lang="en" view="mine" state="empty" rows={[]} />), rtl(<AepsReceiptView t={t} />),
    rtl(<Ops1Chain t={t} chain="aeps_act" state="success" />), rtl(<Ops1Chain t={t} chain="aeps_act" state="failure"><p data-kv-reason="dup">{t.t('ops1.aeps.reason.dup')}</p></Ops1Chain>),
    rtl(<FaceEnrollView t={t} />), rtl(<FaceAttendanceView t={t} />), rtl(<BiometricCanonView t={t} />),
  ];
};
const SRC_1B = ['components/ops1/AepsViews.tsx', 'components/ops1/FaceViews.tsx', 'app/aeps/home/page.tsx', 'app/aeps/withdrawal/page.tsx', 'app/aeps/exceptions/page.tsx',
  'app/aeps/receipt/page.tsx', 'app/attendance/face-enroll/page.tsx', 'app/attendance/face-attendance/page.tsx', 'app/canon/biometric/page.tsx'];

describe('PC-56 OPS-1b · AePS and biometric pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, no percentage', (_l, cat) => {
    for (const html of pages(cat)) {
      expect(PHYSICAL.test(html)).toBe(false);
      expect(ARROWS.test(text(html))).toBe(false);
      expect(percents(text(html))).toBe(0);
    }
  });
  it('the markup skeleton of each page state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 1b source carries physical CSS or an arrow glyph; the moved money pages (with their "→" / "←") are gone', () => {
    for (const rel of SRC_1B) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))]).toEqual([rel, false]);
    }
    for (const rel of ['app/money/page.tsx', 'app/money/oversight/page.tsx']) expect(fs.existsSync(path.join(__dirname, '..', rel))).toBe(false);
  });
});
