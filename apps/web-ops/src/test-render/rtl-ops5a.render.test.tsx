// apps/web-ops/src/test-render/rtl-ops5a.render.test.tsx · PC-56 OPS-5a — every alert page state and every alert chain state renders in en, hi and gu
// under `dir="rtl"` with no physical direction, no arrow glyph (the timeline is an ordered list, never arrows), and the SAME `data-kv-*` skeleton in
// every language; the 5a sources carry no physical CSS or arrow (E14).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AlertIncidentView, AlertRulesView, ChangeDoneNote, ChangeFailureNote, ChangeForm, NewRuleForm, ProposalReview } from '../components/ops5/AlertViews';
import { Ops5Chain } from '../components/ops5/Ops5Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { BREACH, BREACH_1, BREACH_OPEN, FIRED, RULES } from './ops5a-fixtures';

const CATS = { en, hi, gu } as const;
const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl" lang="hi">{node}</div>);
const PHYSICAL = /margin-left|margin-right|padding-left|padding-right|\bleft:\s|\bright:\s|text-align:\s*(left|right)|float:\s*(left|right)|style="/i;
const ARROWS = /[←→⇐⇒⟵⟶➔➜↩↪«»‹›]/;
const skeleton = (html: string) => (html.match(/data-kv-[a-z0-9-]+="[^"]*"/g) ?? []).join('|');
const act = async () => undefined;
const KEY = '0192d2c4-4e70-7000-8000-000000000001';
const W403 = `/iot/alert-incident?id=${BREACH_1}`;
const pages = (cat: Record<string, string>) => {
  const t = tr(cat);
  return [
    rtl(<AlertRulesView t={t} state="ok" rules={RULES} fired={FIRED} />),
    rtl(<AlertRulesView t={t} state="ok" rules={[]} fired={[]} />),
    ...(['off', 'forbidden', 'error'] as const).map((s) => rtl(<AlertRulesView t={t} state={s} rules={[]} fired={null} />)),
    rtl(<AlertIncidentView t={t} lang="en" state="ok" id={BREACH_1} breach={BREACH} />),
    rtl(<AlertIncidentView t={t} lang="en" state="ok" id={BREACH_1} breach={BREACH_OPEN} />),
    ...(['notFound', 'off', 'error'] as const).map((s) => rtl(<AlertIncidentView t={t} lang="en" state={s} id={BREACH_1} breach={null} />)),
    rtl(<Ops5Chain t={t} chain="alert_act" state="confirm" page="/iot/alert-rules"><ChangeForm t={t} rule={RULES[0]} idemKey={KEY} action={act} error="reason" /></Ops5Chain>),
    rtl(<Ops5Chain t={t} chain="alert_act" state="confirm" page="/iot/alert-rules"><NewRuleForm t={t} idemKey={KEY} action={act} error={null} /></Ops5Chain>),
    rtl(<Ops5Chain t={t} chain="alert_act" state="confirm" page="/iot/alert-rules"><ProposalReview t={t} rule={RULES[1]} idemKey={KEY} confirmAction={act} withdrawAction={act} /></Ops5Chain>),
    rtl(<Ops5Chain t={t} chain="alert_act" state="success" page="/iot/alert-rules"><ChangeDoneNote t={t} done="proposed" /></Ops5Chain>),
    rtl(<Ops5Chain t={t} chain="alert_act" state="failure" page="/iot/alert-rules"><ChangeFailureNote t={t} reason="changeAlreadyOpen" retryHref="/iot/alert-rules" /></Ops5Chain>),
    ...(['confirm', 'success', 'failure'] as const).map((s) => rtl(<Ops5Chain t={t} chain="incident_act" state={s} page={W403} />)),
  ];
};
const SRC_5A = ['components/ops5/AlertViews.tsx', 'components/ops5/Ops5Chain.tsx', 'features/ops5/alerts.ts', 'app/iot/alert-rules/page.tsx', 'app/iot/alert-rules/actions.ts', 'app/iot/alert-incident/page.tsx'];

describe('PC-56 OPS-5a · the alert pages under dir="rtl" (en / hi / gu)', () => {
  it.each(Object.entries(CATS))('%s: no physical direction, no arrow glyph, every key resolved', (_l, cat) => {
    for (const html of pages(cat)) { expect(PHYSICAL.test(html)).toBe(false); expect(ARROWS.test(text(html))).toBe(false); expect(/ops5\.|ops4\./.test(text(html))).toBe(false); }
  });
  it('the markup skeleton of each state is identical in all three languages', () => {
    const all = Object.values(CATS).map((c) => pages(c).map(skeleton));
    for (let i = 0; i < all[0].length; i++) expect([i, new Set(all.map((p) => p[i])).size]).toEqual([i, 1]);
  });
  it('no 5a source carries physical CSS or an arrow glyph', () => {
    for (const rel of SRC_5A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      expect([rel, /style=\{|margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/.test(src)]).toEqual([rel, false]);
      expect([rel, ARROWS.test(src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'))]).toEqual([rel, false]);
    }
  });
});
