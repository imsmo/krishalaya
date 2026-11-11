// apps/web-gov/src/test-render/gov2c-chains.render.test.tsx · PC-56 GOV-2c — the three chain groups GOV-2c builds, as four built chains:
//   the APPLICATION ACT (W3159–W3161) — REAL: its confirm state carries the act's form, success the API's status, failure the named refusal;
//   the APPLICATION RE-READ (W3159–W3161 opened by W331's error Retry) and the LIST RE-READ (W3164–W3166) — PARITY-DECOR: the confirm
//   state's one link IS the re-read; the FILE chain (W3162–W3163) — DECOR (Q4-A): no file is made, queued or handed out.
// Back → the page that opened it: an application's chains → THAT application, the list's → /applications. Every state prints its statement
// (Q2-A on the act, Q4-A elsewhere) and its refusals BY NAME, never the canon's shared chain sentences.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov2Chain } from '../components/gov2/Gov2Chain';
import { ActFailureNote, ActForm } from '../components/gov2/ApplicationsViews';
import { GOV2_CHAINS, gov2RefusalKeys, type Chain2Id } from '../features/gov2/refusals';
import { appChainBack } from '../features/gov2/applications';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { APP_1, FALSE_2C } from './gov2c-fixtures';

const CATS = { en, hi, gu } as const;
const ON_APP: Chain2Id[] = ['application_act', 'application_reread'];
const chain = (id: Chain2Id, s: string, cat: Record<string, string> = en, children?: React.ReactNode) =>
  renderToStaticMarkup(<Gov2Chain t={tr(cat)} chain={id} state={s} back={appChainBack(ON_APP.includes(id) ? APP_1 : null)}>{children}</Gov2Chain>);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const TWO_C = GOV2_CHAINS.filter((c) => c.wave === '2c');
const noop = '/applications/act';   // a string action: renderToStaticMarkup cannot print a Server Action

describe('PC-56 GOV-2c · the application chains', () => {
  it('the registry\'s 2c chains are exactly these four, with their kinds and statements', () => {
    expect(TWO_C.map((c) => [c.id, c.kind, c.statement])).toEqual([['application_act', 'REAL', 'gov2.q2'], ['application_reread', 'PARITY-DECOR', 'gov2.q4'],
      ['applications_file', 'DECOR', 'gov2.q4'], ['applications_reread', 'PARITY-DECOR', 'gov2.q4']]);
  });
  it('the act (REAL): confirm carries the act\'s form; Back → THAT application', () => {
    const h = chain('application_act', 'confirm', en, <ActForm t={tr(en)} appId={APP_1} act="reject" idemKey="k" action={noop} />);
    expect(h).toContain('data-kv-chain="application_act" data-kv-chain-kind="REAL" data-kv-chain-state="confirm"');
    expect(h).toContain('data-kv-form="reject"'); expect(backOf(h)).toBe(`/applications/${APP_1}`);
    expect(text(h)).toContain('Back to the application');
    expect(text(h)).toContain('Nothing changes until you confirm. The step is recorded with your role and the time.');
    expect(h).not.toContain('data-kv-real');
  });
  it('the act\'s failure: the named refusal, nothing changed; success: recorded, the organisation can see it', () => {
    const f = chain('application_act', 'failure', en, <ActFailureNote t={tr(en)} error="GOV_DECIDER_IS_VERIFIER" />);
    expect(text(f)).toContain('The person who checked this application does not decide it. Another person decides.');
    expect(text(f)).toContain('Nothing changed.');
    expect(text(chain('application_act', 'success'))).toContain('The step was recorded. The farmer\'s organisation can see it.');
  });
  it('the re-reads (PARITY-DECOR): the confirm state\'s one link IS the re-read of the page that opened it', () => {
    expect(chain('application_reread', 'confirm')).toContain(`href="/applications/${APP_1}" data-kv-real="reread"`);
    expect(chain('applications_reread', 'confirm')).toContain('href="/applications" data-kv-real="reread"');
    expect(text(chain('applications_reread', 'confirm'))).toContain('Back to the applications');
    for (const s of ['success', 'failure']) expect(chain('applications_reread', s)).not.toContain('data-kv-real');
  });
  it('the file chain (DECOR, Q4-A): no file is made; no link of any kind but Back; no form', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('applications_file', s);
      expect(h).toContain(`data-kv-chain="applications_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain(en['gov2.q4']); expect(text(h)).toContain('No file of applications is made, queued or handed out here.');
      expect((h.match(/<a /g) ?? []).length).toBe(1); expect(backOf(h)).toBe('/applications');
      expect(h).not.toMatch(/<form|<input|<button/);
    }
  });
});

describe('PC-56 GOV-2c · every 2c chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word', (_l, cat) => {
    for (const c of TWO_C) for (const s of c.states) {
      const h = chain(c.id, s, cat); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(cat[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(cat[c.statement])]).toEqual([c.id, s, true]);
      for (const k of gov2RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(cat[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_2C.test(visible(h))]).toEqual([c.id, s, false]);
    }
  });
});
