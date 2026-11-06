// apps/web-ops/src/test-render/ops1c-chain.render.test.tsx · PC-56 OPS-1c — THE KIOSK CHAIN (W3329–W3331), REAL: the create act's own states on
// /kiosk/session-start. confirm = the one form under "Create an account for this number"; success = "An account exists for this number; she signs
// in on her own phone"; failure = "Nothing was created" with the server's NAMED reason. Every state: the kiosk sentence, the refusals by name
// (W3330's zero-sum among them, never its words), Back → W381 (/kiosk/session-start) — NEVER W380 (/kiosk/home), the canon's defect.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KioskFailureView, KioskStartView, KioskSuccessView } from '../components/ops1/KioskViews';
import { en } from '../i18n/en';
import { chain1ById, chain1State } from '../features/ops1/refusals';
import { KIOSK_FAILURE_REASONS } from '../features/ops1/kiosk';
import { text, tr, visible } from './ops1a-fixtures';
import { NONE, controls } from './ops1b-fixtures';
import { FALSE_1C, LANGS_1C } from './ops1c-fixtures';

const T = tr(en);
const confirm = renderToStaticMarkup(<KioskStartView t={T} mode="confirm" action="/kiosk/session-start" languages={LANGS_1C} />);
const success = renderToStaticMarkup(<KioskSuccessView t={T} />);
const failure = (reason: string) => renderToStaticMarkup(<KioskFailureView t={T} searchParams={{ act: 'failure', reason }} />);

describe('PC-56 OPS-1c · the kiosk chain is the create act\'s own states (REAL)', () => {
  it('the chain: REAL, three states on /kiosk/session-start, W3329–W3331, the kiosk statement', () => {
    const c = chain1ById('kiosk_act');
    expect([c.kind, c.page, c.states.join('|'), c.files.join('|'), c.statement, c.wave]).toEqual(['REAL', '/kiosk/session-start', 'confirm|success|failure', 'W3329|W3330|W3331', 'ops1.kiosk.statement', '1c']);
    expect([chain1State('kiosk_act', { act: 'confirm' }), chain1State('kiosk_act', { act: 'open' }), chain1State('kiosk_act', {})]).toEqual(['confirm', null, null]);
  });
  it('confirm (W3329): "Create an account for this number", THE form (the same single form), Back → /kiosk/session-start', () => {
    expect(text(confirm)).toContain('Create an account for this number');
    expect(controls(confirm)).toEqual({ input: 2, select: 1, textarea: 0, form: 1, button: 1 });
    expect(confirm).toContain('data-kv-chain-state="confirm"');
    expect(confirm).toContain('data-kv-back="/kiosk/session-start"');
  });
  it('success (W3330): the sentence, a link to what to tell her; no control; the zero-sum line refused by name, never printed', () => {
    expect(text(success)).toContain('An account exists for this number; she signs in on her own phone');
    expect(controls(success)).toEqual(NONE);
    expect(success).toContain('href="/kiosk/summary"');
    expect(success).toContain('data-kv-refusal="kiosk_zero_sum"');
    expect(/zero-sum|reconcil|page the on-call|View audit trail/i.test(text(success))).toBe(false);
  });
  it.each(KIOSK_FAILURE_REASONS.map((r) => [r]))('failure (W3331) · %s: "Nothing was created" + the named reason; no control', (reason) => {
    const html = failure(reason);
    expect(text(html)).toContain('Nothing was created');
    expect(text(html)).toContain(en[`ops1.kiosk.reason.${reason}`]);
    expect(controls(html)).toEqual(NONE);
  });
  it('every state: Back → /kiosk/session-start and NEVER /kiosk/home; the kiosk sentence; no canon false word', () => {
    for (const html of [confirm, success, failure('exists')]) {
      expect(html).toContain('data-kv-back="/kiosk/session-start"');
      expect(html).not.toContain('href="/kiosk/home"');
      expect(text(html)).toContain(en['ops1.kiosk.statement']);
      expect(FALSE_1C.test(visible(html))).toBe(false);
    }
  });
  it('the page wires the chain: confirm renders the form, success / failure the chain views, the act redirects to the chain states', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'app/kiosk/session-start/page.tsx'), 'utf8');
    expect(page).toContain('chain1State(\'kiosk_act\', searchParams)');
    expect(page).toMatch(/act === 'confirm'\) return <KioskStartView t=\{t\} mode="confirm"/);
    const action = fs.readFileSync(path.join(__dirname, '..', 'app/kiosk/session-start/actions.ts'), 'utf8');
    expect(action).toContain('?act=success'); expect(action).toContain('?act=failure&reason=');
  });
});
