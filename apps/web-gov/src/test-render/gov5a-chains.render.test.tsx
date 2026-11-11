// apps/web-gov/src/test-render/gov5a-chains.render.test.tsx · PC-56 GOV-5a — the six chain groups GOV-5a builds, all query states of /mgnrega:
//   job FILE (W3224–W3225, `?do=job-file`) — DECOR: no file of job cards is queued, made or handed out (the download sentence);
//   job RE-READ (W3226–W3228), muster RE-READ (W3236–W3238), work RE-READ (W3279–W3281) — PARITY-DECOR: the confirm state's one extra link IS
//     a re-read of /mgnrega;
//   SYNC (W3233–W3235, `?do=sync`) — DECOR: "Sync now" refused by name (Q3's sentence);
//   DEMAND form (W3275–W3278, `?do=demand`) — DECOR: no request for work is entered here (Q3's sentence).
// Back → /mgnrega from every state. Every state prints its statement and its refusals BY NAME, never the canon's shared chain sentences; no
// form, input or button anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov5Chain } from '../components/gov5/MgnregaViews';
import { GOV5_CHAINS, gov5RefusalKeys, type Chain5Id } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const chain = (id: Chain5Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov5Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
/** The chains' false words in visible text (outside the refusal list), beyond each chain's own statement. */
const FALSE_CHAIN = /₹|%|\bsync|mirror|job.?card|GJ-|household|attendance|worksite|panchayat|clock|allowance|compensation|wage|export|audit|reconcile|zero-sum|on-call|back to confirm|signed URL|sha256|position and ETA|maker-checker|diff against|values you entered|publish|\bwall\b/i;

describe('PC-56 GOV-5a · the MGNREGA chains', () => {
  it('six chains, all 5a, on /mgnrega: file, sync and demand DECOR; job, muster and work re-reads PARITY-DECOR', () => {
    expect(GOV5_CHAINS.map((c) => [c.id, c.kind, c.back])).toEqual([
      ['job_file', 'DECOR', '/mgnrega'], ['job_reread', 'PARITY-DECOR', '/mgnrega'], ['sync_act', 'DECOR', '/mgnrega'],
      ['muster_reread', 'PARITY-DECOR', '/mgnrega'], ['demand_form', 'DECOR', '/mgnrega'], ['work_reread', 'PARITY-DECOR', '/mgnrega'],
    ]);
  });
  it('the job file chain (DECOR): no file is made; the download sentence; one link (Back → /mgnrega)', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('job_file', s);
      expect(h).toContain(`data-kv-chain="job_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain('Nothing on this page can be downloaded.'); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect(hrefs(h)).toEqual(['/mgnrega']); expect(backOf(h)).toBe('/mgnrega'); expect(text(h)).toContain('Back to MGNREGA');
    }
    expect(text(chain('job_file', 'ready'))).toContain('No file of job cards exists here.');
  });
  it('the sync chain (DECOR): "Sync now" refused by name; Q3\'s sentence; nothing brought in; Back only', () => {
    const c = text(chain('sync_act', 'confirm'));
    expect(c).toContain('Nothing to confirm'); expect(c).toContain(en['gov5.q3']);
    expect(c).toContain('No update from NREGASoft is started from this console.'); expect(c).toContain('No update from NREGASoft can be started from this console.');
    expect(text(chain('sync_act', 'success'))).toContain('Nothing was brought in, and nothing was written.');
    expect(text(chain('sync_act', 'success'))).toContain('No money moves on this console.');
    for (const s of ['confirm', 'success', 'failure']) { const h = chain('sync_act', s); expect(hrefs(h)).toEqual(['/mgnrega']); expect(h).not.toContain('data-kv-real'); }
  });
  it('the demand form chain (DECOR): no form here; Back returns to the page; nothing to keep, review or compare', () => {
    const e = text(chain('demand_form', 'form-error'));
    expect(e).toContain('No form here'); expect(e).toContain('Requests for work are not entered on this console, so there is no form to correct.');
    expect(e).toContain(en['gov5.q3']); expect(e).toContain('Back returns to the MGNREGA page; no form exists to go back to.');
    expect(e).toContain('There is no form here to enter a request for work.');
    expect(text(chain('demand_form', 'review'))).toContain('There is no form here, so there is nothing to keep, review or compare.');
    expect(text(chain('demand_form', 'success'))).toContain('No request for work was recorded, and nothing was written.');
    for (const s of ['form-error', 'review', 'success', 'failure']) { const h = chain('demand_form', s); expect(backOf(h)).toBe('/mgnrega'); expect(hrefs(h)).toEqual(['/mgnrega']); }
  });
  it('the re-read chains (PARITY-DECOR): confirm\'s extra link IS the re-read of /mgnrega; success and failure: Back only', () => {
    for (const id of ['job_reread', 'muster_reread', 'work_reread'] as Chain5Id[]) {
      const c = chain(id, 'confirm');
      expect(c).toContain(`data-kv-chain="${id}" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="confirm"`);
      expect(c).toContain('href="/mgnrega" data-kv-real="reread"'); expect(hrefs(c)).toEqual(['/mgnrega', '/mgnrega']);
      expect(text(c)).toContain('Read the MGNREGA page again'); expect(text(c)).toContain('Reading this page again writes nothing.');
      for (const s of ['success', 'failure']) { const h = chain(id, s); expect(hrefs(h)).toEqual(['/mgnrega']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/mgnrega'); }
      expect(text(chain(id, 'failure'))).toContain('No one is paged when this fails.');
    }
    expect(text(chain('job_reread', 'confirm'))).toContain('job cards are still not shown'); expect(text(chain('job_reread', 'confirm'))).toContain(en['gov5.q2']);
    expect(text(chain('muster_reread', 'confirm'))).toContain('musters are still not shown');
  });
  it('no state links anywhere but /mgnrega (never the dashboard, a /mgnrega/… sub-address or an audit address)', () => {
    for (const c of GOV5_CHAINS) for (const s of c.states) for (const href of hrefs(chain(c.id, s))) expect([c.id, s, href]).toEqual([c.id, s, '/mgnrega']);
  });
});

describe('PC-56 GOV-5a · every 5a chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form; no digit', (_l, cat) => {
    const c5 = cat as Record<string, string>;
    for (const c of GOV5_CHAINS) for (const s of c.states) {
      const h = chain(c.id, s, c5); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c5[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c5[c.statement]), t.includes(c5['gov5.chain.back'])]).toEqual([c.id, s, true, true]);
      for (const k of gov5RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c5[k])]).toEqual([c.id, s, k, true]);
      const own = visible(h).replace(text(`<p>${c5[c.statement]}</p>`), ' ').replace(text(`<p>${c5[`${c.key(s)}.body`]}</p>`), ' ');
      expect([c.id, s, FALSE_CHAIN.test(own)]).toEqual([c.id, s, false]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|maker-checker|diff against/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /\d/.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov5\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
