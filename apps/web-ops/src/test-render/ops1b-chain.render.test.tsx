// apps/web-ops/src/test-render/ops1b-chain.render.test.tsx · PC-56 OPS-1b — THE AEPS CHAIN (W3289–W3291), REAL: the record act's own states on
// /aeps/withdrawal. confirm = the record form under "Record what the bank's device showed (nothing moves here)"; success = "Recorded: a record,
// not a receipt"; failure = "Nothing was recorded" with the server's NAMED reason. Every state: the log sentence, the refusals by name (W3290's
// zero-sum among them, never its words), Back → W391 (/aeps/withdrawal) — NEVER W393 (/aeps/receipt).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AepsRecordView } from '../components/ops1/AepsViews';
import { Ops1Chain } from '../components/ops1/Ops1Chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { chain1ById, chain1State } from '../features/ops1/refusals';
import { AEPS_FAILURE_REASONS, aepsFailureReason, parseAepsReason } from '../features/ops1/aeps';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

const T = tr(en);
const confirm = renderToStaticMarkup(<AepsRecordView t={T} mode="confirm" action="/aeps/withdrawal" />);
const success = renderToStaticMarkup(<Ops1Chain t={T} chain="aeps_act" state="success" />);
const failure = (reason: string) => renderToStaticMarkup(<Ops1Chain t={T} chain="aeps_act" state="failure"><p data-kv-reason={reason}>{T.t(`ops1.aeps.reason.${reason}`)}</p></Ops1Chain>);

describe('PC-56 OPS-1b · the aeps chain is the record act\'s own states (REAL)', () => {
  it('the chain: REAL, three states on /aeps/withdrawal, W3289–W3291', () => {
    const c = chain1ById('aeps_act');
    expect([c.kind, c.page, c.states.join('|'), c.files.join('|'), c.statement]).toEqual(['REAL', '/aeps/withdrawal', 'confirm|success|failure', 'W3289|W3290|W3291', 'ops1.aeps.statement']);
    expect([chain1State('aeps_act', { act: 'confirm' }), chain1State('aeps_act', { act: 'pay' }), chain1State('aeps_act', {})]).toEqual(['confirm', null, null]);
  });
  it('confirm (W3289): the confirm sentence, the log sentence, THE form (the same single form), Back → /aeps/withdrawal', () => {
    expect(text(confirm)).toContain('Record what the bank\'s device showed (nothing moves here)');
    expect(text(confirm)).toContain(en['ops1.aeps.statement']);
    expect(controls(confirm)).toEqual({ input: 6, select: 4, textarea: 1, form: 1, button: 1 });
    expect(confirm).toContain('data-kv-chain-state="confirm"');
    expect(confirm).toContain('data-kv-back="/aeps/withdrawal"');
  });
  it('success (W3290): "Recorded: a record, not a receipt"; no control; the zero-sum line refused by name, never printed', () => {
    expect(text(success)).toContain('Recorded: a record, not a receipt');
    expect(controls(success)).toEqual(NONE);
    expect(success).toContain('data-kv-refusal="aeps_zero_sum"');
    expect(/zero-sum|reconcil|page the on-call|View audit trail/i.test(text(success))).toBe(false);
  });
  it.each(AEPS_FAILURE_REASONS.map((r) => [r]))('failure (W3291) · %s: "Nothing was recorded" + the named reason; no control', (reason) => {
    const html = failure(reason);
    expect(text(html)).toContain('Nothing was recorded');
    expect(text(html)).toContain(en[`ops1.aeps.reason.${reason}`]);
    expect([hi, gu].every((c) => typeof c[`ops1.aeps.reason.${reason}`] === 'string' && c[`ops1.aeps.reason.${reason}`].length > 0)).toBe(true);
    expect(controls(html)).toEqual(NONE);
  });
  it('every state: Back → /aeps/withdrawal and NEVER /aeps/receipt; the log sentence; no canon false word', () => {
    for (const html of [confirm, success, failure('dup')]) {
      expect(html).toContain('href="/aeps/withdrawal"');
      expect(html).not.toContain('href="/aeps/receipt"');
      expect(text(html)).toContain(en['ops1.aeps.statement']);
      expect(FALSE_1B.test(visible(html))).toBe(false);
    }
  });
  it('the server\'s answer → the named reason: 403 / 404 / the two Q7-A codes / 400 / 422 / 409 / else; a hostile reason is never echoed', () => {
    expect([aepsFailureReason(403, 'FORBIDDEN'), aepsFailureReason(404, 'NOT_FOUND'), aepsFailureReason(400, 'AEPS_AADHAAR_NOT_RECORDED'), aepsFailureReason(400, 'AEPS_CUSTOMER_LINK_NOT_RECORDED'),
      aepsFailureReason(400, 'BAD_REQUEST'), aepsFailureReason(422, 'VALIDATION_FAILED'), aepsFailureReason(409, 'CONFLICT'), aepsFailureReason(500, 'X')])
      .toEqual(['notEnabled', 'off', 'q7aAadhaar', 'q7aCustomer', 'rule', 'rule', 'dup', 'record']);
    expect([parseAepsReason({ reason: 'dup' }), parseAepsReason({ reason: '<script>' }), parseAepsReason({ reason: ['q7aAadhaar'] }), parseAepsReason(undefined)]).toEqual(['dup', 'record', 'q7aAadhaar', 'record']);
  });
  it('the page wires the chain: confirm renders the form, success/failure the chain, the action redirects to the chain states', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'app/aeps/withdrawal/page.tsx'), 'utf8');
    expect(page).toContain('chain1State(\'aeps_act\', searchParams)');
    expect(page).toMatch(/act === 'confirm'\) return <AepsRecordView t=\{t\} mode="confirm"/);
    const action = fs.readFileSync(path.join(__dirname, '..', 'app/aeps/withdrawal/actions.ts'), 'utf8');
    expect(action).toContain('?act=success'); expect(action).toContain('?act=failure&reason=');
    expect(action).toMatch(/aepsFailureReason\(e\.status, e\.code\)/);
  });
});
