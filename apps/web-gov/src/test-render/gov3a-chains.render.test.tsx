// apps/web-gov/src/test-render/gov3a-chains.render.test.tsx · PC-56 GOV-3a — the two chain groups GOV-3a builds, as three built chains:
//   the FILE chain (W3167–W3168) — DECOR (Q4-A): no file is made, queued or handed out;
//   the STOP (W3169–W3171 opened by the canon's "Pause") — DECOR (Q1-A): nothing to stop, nothing sent;
//   the RE-READ (W3169–W3171 opened by /dbt's error Retry) — PARITY-DECOR: the confirm state's one link IS the re-read.
// Back → /dbt from every state. Every state prints its statement (Q4 on the file, Q1 elsewhere) and its refusals BY NAME, never the canon's
// shared chain sentences; no form, input or button anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov3Chain } from '../components/gov3/DbtViews';
import { GOV3_CHAINS, gov3RefusalKeys, type Chain3Id } from '../features/gov3/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { FALSE_3A } from './gov-dbt.render.test';

const CATS = { en, hi, gu } as const;
const chain = (id: Chain3Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov3Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];

describe('PC-56 GOV-3a · the dbt chains', () => {
  it('the file chain (DECOR, Q4-A): no file is made; one link (Back → /dbt); no form', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('dbt_file', s);
      expect(h).toContain(`data-kv-chain="dbt_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain(en['gov3.q4']); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect((h.match(/<a /g) ?? []).length).toBe(1); expect(backOf(h)).toBe('/dbt');
    }
  });
  it('the stop (DECOR, Q1-A): nothing to stop; nothing sent; Back → /dbt, never a confirm step', () => {
    const c = text(chain('dbt_pause', 'confirm'));
    expect(c).toContain('Nothing to stop'); expect(c).toContain('This console holds no payment that could be stopped. Nothing is sent from this page.');
    expect(c).toContain(en['gov3.q1']); expect(c).toContain('Back returns to the benefit payments page, never to a step to confirm.');
    for (const s of ['confirm', 'success', 'failure']) { const h = chain('dbt_pause', s); expect(backOf(h)).toBe('/dbt'); expect(h).not.toContain('data-kv-real'); expect((h.match(/<a /g) ?? []).length).toBe(1); }
  });
  it('the re-read (PARITY-DECOR): the confirm state\'s one link IS the re-read of /dbt; its other states have only Back', () => {
    expect(chain('dbt_reread', 'confirm')).toContain('href="/dbt" data-kv-real="reread"');
    expect(text(chain('dbt_reread', 'confirm'))).toContain('Back to benefit payments');
    for (const s of ['success', 'failure']) expect(chain('dbt_reread', s)).not.toContain('data-kv-real');
  });
});

describe('PC-56 GOV-3a · every 3a chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form', (_l, cat) => {
    for (const c of GOV3_CHAINS) for (const s of c.states) {
      const h = chain(c.id, s, cat); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(cat[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(cat[c.statement])]).toEqual([c.id, s, true]);
      for (const k of gov3RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(cat[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_3A.test(visible(h))]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
    }
  });
});
