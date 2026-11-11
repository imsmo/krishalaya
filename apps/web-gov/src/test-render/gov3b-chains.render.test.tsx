// apps/web-gov/src/test-render/gov3b-chains.render.test.tsx · PC-56 GOV-3b — the four chain groups GOV-3b builds, as four built chains:
//   the PFMS REQUEST (W3179–W3181, opened by W342's "Ask PFMS for credit [certificate]") — DECOR (Q5-A): nothing can be asked of PFMS;
//   the FARMER MESSAGE (W3211–W3213, opened by W343's "Send fix-[messages]") — DECOR (Q5-A): no message is sent to a farmer;
//   the PFMS FILE (W3239–W3240, opened by W341's "Export recon") — DECOR (Q4-A): no file is made, queued or handed out;
//   the PFMS RE-READ (W3241–W3243, W341's "Retry") — PARITY-DECOR: the confirm state's one link IS the re-read of /dbt.
// Back → /dbt from every state (never a confirm step, never another page). Every state prints its statement (Q5, or Q4 on the file) and its
// refusals BY NAME, never the canon's shared chain sentences; no form, input or button anywhere. All six GOV-3 groups are now built.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov3Chain } from '../components/gov3/DbtViews';
import { GOV3_CHAIN_GROUPS, GOV3_CHAINS, gov3RefusalKeys, type Chain3Id } from '../features/gov3/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { FALSE_3A } from './gov-dbt.render.test';

const CATS = { en, hi, gu } as const;
const Q4 = 'Payment records cannot be downloaded from this console.';
const Q5 = 'PFMS is not connected to this platform. Nothing here is matched against PFMS, and no message about a payment is sent to a farmer from this console.';
const CHAINS_3B = GOV3_CHAINS.filter((c) => c.wave === '3b');
const chain = (id: Chain3Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov3Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

describe('PC-56 GOV-3b · the four 3b chains', () => {
  it('four chains, one per 3b group; with GOV-3a\'s, all six groups are built', () => {
    expect(CHAINS_3B.map((c) => [c.id, c.group, c.kind])).toEqual([
      ['recon_ask', 'recon_mutate', 'DECOR'], ['returns_remind', 'bounce_mutate', 'DECOR'], ['pfms_file', 'pfms_export', 'DECOR'], ['pfms_reread', 'pfms_mutate', 'PARITY-DECOR'],
    ]);
    expect(GOV3_CHAIN_GROUPS.every((g) => GOV3_CHAINS.some((c) => c.group === g.id))).toBe(true);
  });
  it('the PFMS request (DECOR, Q5-A): nothing is asked of PFMS; Q5 verbatim; Back → /dbt, never a confirm step; one link', () => {
    const c = text(chain('recon_ask', 'confirm'));
    expect(c).toContain('Nothing is asked of PFMS'); expect(c).toContain('No request for a certificate can be sent from this page. Nothing is sent.');
    expect(c).toContain(Q5); expect(c).toContain('This platform has no connection to PFMS, so no request can be sent to it.');
    expect(text(chain('recon_ask', 'failure'))).toContain('Back returns to the benefit payments page, never to a step to confirm.');
    for (const s of ['confirm', 'success', 'failure']) { const h = chain('recon_ask', s); expect([s, backOf(h), hrefs(h), h.includes('data-kv-real')]).toEqual([s, '/dbt', ['/dbt'], false]); }
  });
  it('the farmer message (DECOR, Q5-A): no message is sent to a farmer; Q5 verbatim; Back → /dbt; one link', () => {
    const c = text(chain('returns_remind', 'confirm'));
    expect(c).toContain('No message to send'); expect(c).toContain('Nothing on this console sends a farmer a message about a returned payment. Nothing is sent from this page.');
    expect(c).toContain(Q5); expect(c).toContain('No farmer is asked from here to fix anything about a payment.');
    expect(text(chain('returns_remind', 'success'))).toContain('No farmer was contacted, and nothing was written.');
    for (const s of ['confirm', 'success', 'failure']) { const h = chain('returns_remind', s); expect([s, backOf(h), hrefs(h), h.includes('data-kv-real')]).toEqual([s, '/dbt', ['/dbt'], false]); }
  });
  it('the PFMS file (DECOR, Q4-A): no file is made, queued or handed out; Q4 verbatim; Back → /dbt; one link', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('pfms_file', s); const t = text(h);
      expect(h).toContain(`data-kv-chain="pfms_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(t).toContain(Q4); expect(t).toContain('No file is queued, made or handed out here.'); expect(t).toContain('No payment, matching or report file is made from this console.');
      expect([s, backOf(h), hrefs(h)]).toEqual([s, '/dbt', ['/dbt']]);
    }
    expect(text(chain('pfms_file', 'ready'))).toContain('No file comparing payments with PFMS exists here.');
  });
  it('the PFMS re-read (PARITY-DECOR): the confirm state\'s one link IS the re-read of /dbt; PFMS is not asked; its other states have only Back', () => {
    const h = chain('pfms_reread', 'confirm');
    expect(h).toContain('href="/dbt" data-kv-real="reread"'); expect(hrefs(h)).toEqual(['/dbt', '/dbt']);
    expect(text(h)).toContain('This page is read again from this platform. PFMS is not asked for anything.'); expect(text(h)).toContain('Reading the counts again writes nothing.');
    for (const s of ['success', 'failure']) { const x = chain('pfms_reread', s); expect([s, x.includes('data-kv-real'), hrefs(x)]).toEqual([s, false, ['/dbt']]); }
  });
  it('every 3b chain state: Back is /dbt and only /dbt (never /dashboard, never a confirm step)', () => {
    for (const c of CHAINS_3B) for (const s of c.states) {
      const h = chain(c.id, s);
      expect([c.id, s, backOf(h), hrefs(h).every((x) => x === '/dbt')]).toEqual([c.id, s, '/dbt', true]);
    }
  });
});

describe('PC-56 GOV-3b · every 3b chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form; no bank detail', (_l, cat) => {
    for (const c of CHAINS_3B) for (const s of c.states) {
      const h = chain(c.id, s, cat); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, typeof cat[`${c.key(s)}.${part}`], t.includes(cat[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, 'string', true]);
      expect([c.id, s, typeof cat[c.statement], t.includes(cat[c.statement])]).toEqual([c.id, s, 'string', true]);
      for (const k of gov3RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(cat[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|credit certificate|fix-reminder/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_3A.test(visible(h))]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /••|a\/c|IFSC|account/i.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov3\.|gov2\.|gov1\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
