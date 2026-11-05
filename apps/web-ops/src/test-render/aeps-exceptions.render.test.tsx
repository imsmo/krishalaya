// apps/web-ops/src/test-render/aeps-exceptions.render.test.tsx · PC-56 OPS-1b · W392 /aeps/exceptions — A READ (own; ?view=all the audited
// supervisor read). Only the events that did not go straight through; NO customer, farmer, bank or account column — and a row that still
// carries the refused keys prints neither; no row drill-in; amounts through the money formatter; the audited note on the supervisor view only;
// zero inputs (the two views are links); every state says what it is.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { AepsExceptionsView } from '../components/ops1/AepsViews';
import { en } from '../i18n/en';
import { exceptionsState, exceptionsView, isException } from '../features/ops1/aeps';
import { text, tr, visible } from './ops1a-fixtures';
import { EVENTS_1B, FALSE_1B, NONE, controls } from './ops1b-fixtures';

const T = tr(en);
const render = (view: 'mine' | 'all', state: Parameters<typeof AepsExceptionsView>[0]['state'] = 'ok') =>
  renderToStaticMarkup(<AepsExceptionsView t={T} lang="en" view={view} state={state} rows={EVENTS_1B} />);

describe('PC-56 OPS-1b · /aeps/exceptions reads what did not go straight through', () => {
  it('lists the failed, blocked and declined events — never the success — newest as given; amounts via the formatter', () => {
    const html = render('mine');
    expect(html).not.toContain('data-kv-event="9001"');
    for (const id of ['9002', '9003', '9004']) expect([id, html.includes(`data-kv-event="${id}"`)]).toEqual([id, true]);
    expect(text(html)).toContain(formatMoneyMinor('120000', 'INR', 'en'));
    expect(text(html)).toContain('Sent to a bank branch or mitra');
    expect(text(html)).toContain('3 of 3');
  });
  it('no customer, farmer, bank or account column; the refused keys of a legacy row are never printed; no row links anywhere', () => {
    for (const v of ['mine', 'all'] as const) {
      const html = render(v);
      const heads = (html.match(/<th>[^<]*<\/th>/g) ?? []).join('|');
      expect([v, /customer|farmer|bank|account|aadhaar|name/i.test(heads)]).toEqual([v, false]);
      expect([v, /5150|c0de|4321|Test Bank/.test(html)]).toEqual([v, false]);
      expect([v, /href="[^"]*900\d/.test(html)]).toEqual([v, false]);
      expect([v, controls(html)]).toEqual([v, NONE]);
      expect([v, FALSE_1B.test(visible(html))]).toEqual([v, false]);
    }
  });
  it('the supervisor view says it is audited (one entry per opening) and shows the operator; the own view does neither', () => {
    const all = render('all'); const mine = render('mine');
    expect(all).toContain('data-kv-note="audited"'); expect(text(all)).toContain(en['ops1.aeps.exceptions.auditNote']);
    expect(mine).not.toContain('data-kv-note="audited"');
    expect(text(all)).toContain('Operator'); expect(text(mine)).not.toContain('Operator');
    expect(all).toContain('href="/aeps/exceptions"'); expect(all).toContain('href="/aeps/exceptions?view=all"');
  });
  it('states: empty / not enabled / forbidden / off / error — each its own sentence, no table', () => {
    for (const s of ['empty', 'not_enabled', 'forbidden', 'off', 'error'] as const) {
      const html = render(s === 'forbidden' ? 'all' : 'mine', s);
      expect([s, text(html).includes(en[`ops1.aeps.exceptions.state.${s}`]), html.includes('<table')]).toEqual([s, true, false]);
    }
  });
  it('the pure helpers: ?view=all only; 403 means not-enabled on the own view and forbidden on all; 404 off; a success is not an exception', () => {
    expect([exceptionsView({ view: 'all' }), exceptionsView({ view: ['all'] }), exceptionsView({ view: 'everyone' }), exceptionsView(undefined)]).toEqual(['all', 'all', 'mine', 'mine']);
    expect([exceptionsState('mine', 403, 0), exceptionsState('all', 403, 0), exceptionsState('all', 404, 0), exceptionsState('mine', 500, 0), exceptionsState('mine', 'failed', 0), exceptionsState('mine', 'ok', 0), exceptionsState('mine', 'ok', 2)])
      .toEqual(['not_enabled', 'forbidden', 'off', 'error', 'error', 'empty', 'ok']);
    expect(EVENTS_1B.map(isException)).toEqual([false, true, true, true]);
  });
});
