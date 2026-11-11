// apps/web-gov/src/test-render/rtl1g-gov.render.test.tsx · PC-56 RTL-1g — the gov leftovers RTL-1f listed as owed: views that did not take
// `lang`, so their codes and instants were never isolated. Each now takes an optional `lang` (default 'en') from its page and isolates with the
// existing `ltrText` / `ltrOrNull` — under Arabic ONLY:
//   • ApplicationDetailView: the submitted and decided instants (and the scheme code beside the scheme's name, as the list already does);
//   • ActForm: the application number in gov2.form.application;
//   • SchemeDetailView: the published-at instants (identity tab, versions table) and the not-applied rule keys (rules tab and the diff);
//   • the access confirm forms (ApproveConfirm / RemoveForm → RowFacts): the end instant; AccessDoneNote: the approved-until instant;
//   • AccessView: the person label inside gov1.access.youRow (a name or a masked phone).
// Under en/hi/gu every view is proven BYTE-IDENTICAL to the same render with the isolate swapped for the identity (the 93aa6915 text), and the
// comparison can see a difference under Arabic.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GovScheme } from '@krishalaya/sdk-js';
import { AccessDoneNote, AccessView, ApproveConfirm, RemoveForm } from '../components/gov1/AccessViews';
import { ActForm, ApplicationDetailView } from '../components/gov2/ApplicationsViews';
import { SchemeDetailView } from '../components/gov2/SchemesViews';
import { shortId } from '../features/gov2/applications';
import * as spanModule from '../features/rtl/span';
import { ME_HEAD, ROWS, tr } from './gov1a-fixtures';
import { DIFF_A3, SCHEME_A, SCHEME_A_ID, VERSIONS_A } from './gov2b-fixtures';
import { APP_1, HEAD_2C, OPENED_DECIDED } from './gov2c-fixtures';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

const CAT: Record<string, Record<string, string>> = { en, hi, gu, ar };
const LRI = '⁦'; const PDI = '⁩';
const iso = (s: string) => `${LRI}${s}${PDI}`;
const noop = async () => undefined;
// a scheme whose rules are stored in shapes the evaluator does not read → the "not applied" sentence names two rule keys
const SCHEME_ODD: GovScheme = { ...SCHEME_A, published: { ...SCHEME_A.published!, rules: { roles: 'farmer', landholding_max_acres: '2' } } };
const DIFF_ODD = { ...DIFF_A3, changes: [{ field: 'rules', from: { gender: 7 }, to: { age_min: 'x' } }] };

type Mount = (lang: string) => React.ReactElement;
const SITES: Array<[string, Mount, string[]]> = [
  ['application detail: submitted and decided instants, the scheme code', (l) => <ApplicationDetailView t={tr(CAT[l])} lang={l} state="ok" me={HEAD_2C} id={OPENED_DECIDED.id} app={OPENED_DECIDED} />,
    ['2026-10-09 07:30 UTC', OPENED_DECIDED.scheme.code]],
  ['the act form: the application number', (l) => <ActForm t={tr(CAT[l])} lang={l} appId={APP_1} act="reject" idemKey="k" action={noop} />, [shortId(APP_1)]],
  ['scheme identity: the published-at instant', (l) => <SchemeDetailView t={tr(CAT[l])} lang={l} state="ok" id={SCHEME_A_ID} tab="identity" scheme={SCHEME_A} />, ['2026-10-01 05:00 UTC']],
  ['scheme versions: each published-at instant', (l) => <SchemeDetailView t={tr(CAT[l])} lang={l} state="ok" id={SCHEME_A_ID} tab="versions" scheme={SCHEME_A} versions={VERSIONS_A} diff={DIFF_A3} diffState="ok" />,
    ['2026-10-01 05:00 UTC', '2026-07-01 05:00 UTC']],
  ['scheme rules: the not-applied rule keys', (l) => <SchemeDetailView t={tr(CAT[l])} lang={l} state="ok" id={SCHEME_A_ID} tab="rules" scheme={SCHEME_ODD} />, ['roles, landholding_max_acres']],
  ['scheme diff: the not-applied rule keys on both sides', (l) => <SchemeDetailView t={tr(CAT[l])} lang={l} state="ok" id={SCHEME_A_ID} tab="versions" scheme={SCHEME_A} versions={VERSIONS_A} diff={DIFF_ODD as never} diffState="ok" />,
    ['gender', 'age_min']],
  ['access approve confirm (a requested row: no instant — the threading only)', (l) => <ApproveConfirm t={tr(CAT[l])} lang={l} row={ROWS[4]} rows={ROWS} me={ME_HEAD} idemKey="k" action={noop} />, []],
  ['access remove form: the end instant', (l) => <RemoveForm t={tr(CAT[l])} lang={l} row={ROWS[2]} rows={ROWS} me={ME_HEAD} idemKey="k" action={noop} />, ['2027-02-03 05:00 UTC']],
  ['access done note: the approved-until instant', (l) => <AccessDoneNote t={tr(CAT[l])} lang={l} done="approved" expiresAt="2027-11-10T06:30:00.000Z" />, ['2027-11-10 06:30 UTC']],
  ['access list: the person label inside "you"', (l) => <AccessView t={tr(CAT[l])} lang={l} state="ok" me={ME_HEAD} rows={ROWS} />, ['Test Head One']],
];
/** The view as built, and the same view with the isolate as the identity (the text it printed at 93aa6915). */
function nowAndBefore(mount: Mount, lang: string): [string, string] {
  const now = renderToStaticMarkup(mount(lang));
  const a = jest.spyOn(spanModule, 'ltrText').mockImplementation((s) => s);
  const b = jest.spyOn(spanModule, 'ltrOrNull').mockImplementation((s) => s);
  try { return [now, renderToStaticMarkup(mount(lang))]; } finally { a.mockRestore(); b.mockRestore(); }
}

describe('gov views that now take lang: codes and instants isolated under Arabic only (RTL-1g)', () => {
  it.each(SITES.filter(([, , runs]) => runs.length > 0))('%s — ar: each run is one LRI…PDI isolate', (_n, mount, runs) => {
    const html = renderToStaticMarkup(mount('ar'));
    for (const r of runs) expect({ r, isolated: html.includes(iso(r)) }).toEqual({ r, isolated: true });
  });
  it.each(SITES)('%s — en / hi / gu: byte-identical to the 93aa6915 text, no isolate mark', (_n, mount, runs) => {
    for (const lang of ['en', 'hi', 'gu']) {
      const [now, before] = nowAndBefore(mount, lang);
      expect({ lang, same: now === before }).toEqual({ lang, same: true });
      expect(now).not.toMatch(/[⁦-⁩]/);
      for (const r of runs) expect(now).toContain(r);
    }
  });
  it.each(SITES.filter(([, , runs]) => runs.length > 0))('%s — and under ar the comparison sees a difference', (_n, mount) => {
    const [arNow, arBefore] = nowAndBefore(mount, 'ar');
    expect(arNow).not.toBe(arBefore);
  });
  it('a requested row has no end instant: its confirm form says "ends N months after approval", unchanged under ar', () => {
    const html = renderToStaticMarkup(<ApproveConfirm t={tr(ar)} lang="ar" row={ROWS[4]} rows={ROWS} me={ME_HEAD} idemKey="k" action={noop} />);
    expect(html).toContain(ar['gov1.access.endsAfter'].replace('{n}', String(ROWS[4].termMonths)));
  });
  it('the "you" label: only the viewer\'s own row carries it, and only that label is isolated', () => {
    const html = renderToStaticMarkup(<AccessView t={tr(ar)} lang="ar" state="ok" me={ME_HEAD} rows={ROWS} />);
    expect(html).toContain(ar['gov1.access.youRow'].replace('{name}', iso('Test Head One')));
    expect(html).not.toContain(iso('Test Officer One'));   // another person's plain cell is a single run of its own — not isolated
  });
  it('every view rendered WITHOUT lang (every pre-RTL-1g caller) prints the en text, never an isolate', () => {
    const html = renderToStaticMarkup(<AccessDoneNote t={tr(en)} done="approved" expiresAt="2027-11-10T06:30:00.000Z" />);
    expect(html).toBe(renderToStaticMarkup(SITES[8][1]('en')));
    expect(html).not.toMatch(/[⁦-⁩]/);
  });
});
