// apps/web-ops/src/test-render/ops3c-chains.render.test.tsx · PC-56 OPS-3c — the two rate chains as query states of `/rates`: W3338–W3339 (export,
// DECOR — the poster refused, Q15-A) and W3340–W3342 (mutate, PARITY-DECOR — "Retry" is a plain re-read). Each state prints the change statement,
// its own "nothing" sentence, its refusals BY NAME (the zero-sum sentence among them, never printed) and Back → /rates. No form, no act, no money.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { OPS3_CHAINS, chain3State } from '../features/ops3/refusals';
import { en } from '../i18n/en';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_3C } from './ops3c-fixtures';

const r = (chain: 'rate_export' | 'rate_act', state: string) => renderToStaticMarkup(<Ops3Chain t={tr(en)} chain={chain} state={state} />);

describe('PC-56 OPS-3c · the rate chains', () => {
  it('rate export (DECOR): queued / ready — nothing queued, no file, the poster refused by name; Back → /rates', () => {
    for (const s of ['queued', 'ready']) {
      const h = r('rate_export', s);
      expect(h).toContain('data-kv-chain-kind="DECOR"'); expect(h).toContain('data-kv-back="/rates"');
      expect(h).toContain('data-kv-refusal="poster"'); expect(h).toContain('data-kv-refusal="export_receipt"');
      expect(text(h)).toContain(en['ops3.rates.notHere']);
      expect(/data-kv-real=/.test(h)).toBe(false);
    }
    expect(text(r('rate_export', 'queued'))).toContain('Nothing is queued. Nothing on this platform makes a rate poster.');
  });
  it('rate mutate (PARITY-DECOR): confirm links a plain re-read of /rates; success / failure say nothing was changed; zero-sum refused BY NAME', () => {
    const c = r('rate_act', 'confirm');
    expect(c).toContain('data-kv-chain-kind="PARITY-DECOR"');
    expect(c).toMatch(/<a [^>]*data-kv-real="reread" href="\/rates"/);
    for (const s of ['success', 'failure']) {
      const h = r('rate_act', s);
      expect(text(h)).toContain('Nothing was changed'); expect(/data-kv-real=/.test(h)).toBe(false);
      expect(h).toContain('data-kv-refusal="rate_zero_sum"'); expect(h).toContain('data-kv-refusal="rate_on_call"');
    }
    expect(/\?act=confirm/.test(r('rate_act', 'failure'))).toBe(false);   // no "Retry — back to confirm" loop
  });
  it('every chain state: zero controls, the statement first, no canon false word in visible text, Back → /rates', () => {
    for (const ch of OPS3_CHAINS) for (const s of ch.states) {
      const h = r(ch.id, s);
      expect([ch.id, s, CONTROLS.test(h)]).toEqual([ch.id, s, false]);
      expect([ch.id, s, FALSE_3C.test(visible(h))]).toEqual([ch.id, s, false]);
      expect([ch.id, s, h.includes('data-kv-back="/rates"')]).toEqual([ch.id, s, true]);
    }
  });
  it('the query states: an unknown state is the page itself', () => {
    expect(chain3State('rate_act', { act: 'confirm' })).toBe('confirm');
    expect(chain3State('rate_act', { act: 'apply' })).toBeNull();
    expect(chain3State('rate_export', { export: ['ready', 'queued'] })).toBe('ready');
    expect(chain3State('rate_export', undefined)).toBeNull();
  });
});
