// apps/web-gov/src/test-render/gov5b-chains.render.test.tsx · PC-56 GOV-5b — the three chain groups GOV-5b builds, all query states of /mgnrega:
//   wage FILE (W3270–W3271, `?do=wage-file`) — DECOR: no file of pay or payment orders is queued, made or handed out (the download sentence);
//   wage RE-READ (W3272–W3274, `?do=wage-reread`) — PARITY-DECOR: the confirm state's one extra link IS a re-read of /mgnrega (Q1's sentence);
//   PUBLISH (W3267–W3269, `?do=publish`) — DECOR: "Publish this month's wall" refused by name (Q5's sentence); nothing is published.
// Back → /mgnrega from every state (never /dbt, the dashboard or a /mgnrega/… sub-address). Every state prints its statement and its
// refusals BY NAME, never the canon's shared chain sentences; no form, input or button anywhere; no digit.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov5Chain } from '../components/gov5/MgnregaViews';
import { GOV5_CHAINS, gov5RefusalKeys, type Chain5Id } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const CHAINS_5B = GOV5_CHAINS.filter((c) => c.wave === '5b');
const chain = (id: Chain5Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov5Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const Q1 = 'This console shows no wage or payment figure.';
const Q5 = 'This console publishes nothing, compiles no social-audit pack and takes no complaints.';
/** The 5b chains' false words in visible text (outside the refusal list), beyond each chain's own statement and body. */
const FALSE_5B_CHAIN = /₹|%|wage|\bFTO\b|payment order|compensation|allowance|credited|\bbank\b|publish|\bwall\b|social.?audit|grievance|complaint|export|audit|reconcile|zero-sum|on-call|back to confirm|signed URL|sha256|position and ETA|two-person|maker-checker|sarpanch|secretary/i;

describe('PC-56 GOV-5b · the wage and social chains', () => {
  it('three chains, all 5b, on /mgnrega: wage file DECOR, wage re-read PARITY-DECOR, publish DECOR', () => {
    expect(CHAINS_5B.map((c) => [c.id, c.kind, c.group, c.back, c.doing])).toEqual([
      ['wage_file', 'DECOR', 'wage_export', '/mgnrega', 'wage-file'],
      ['wage_reread', 'PARITY-DECOR', 'wage_mutate', '/mgnrega', 'wage-reread'],
      ['publish_act', 'DECOR', 'social_mutate', '/mgnrega', 'publish'],
    ]);
  });
  it('the wage file chain (DECOR): no file is made; the download sentence; one link (Back → /mgnrega)', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('wage_file', s);
      expect(h).toContain(`data-kv-chain="wage_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain('Nothing on this page can be downloaded.'); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect(text(h)).toContain('No file of pay or payment orders is made or handed out from this console.');
      expect(hrefs(h)).toEqual(['/mgnrega']); expect(backOf(h)).toBe('/mgnrega'); expect(text(h)).toContain('Back to MGNREGA');
    }
    expect(text(chain('wage_file', 'ready'))).toContain('No file of pay or payment orders exists here.');
  });
  it('the wage re-read chain (PARITY-DECOR): Q1\'s sentence; confirm\'s extra link IS the re-read of /mgnrega; success and failure: Back only', () => {
    const c = chain('wage_reread', 'confirm');
    expect(c).toContain('data-kv-chain="wage_reread" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="confirm"');
    expect(c).toContain('href="/mgnrega" data-kv-real="reread"'); expect(hrefs(c)).toEqual(['/mgnrega', '/mgnrega']);
    expect(text(c)).toContain(Q1); expect(text(c)).toContain('pay is still not shown'); expect(text(c)).toContain('Reading this page again writes nothing.');
    for (const s of ['success', 'failure']) { const h = chain('wage_reread', s); expect(hrefs(h)).toEqual(['/mgnrega']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/mgnrega'); }
    expect(text(chain('wage_reread', 'failure'))).toContain('No one is paged when this fails.');
    expect(text(chain('wage_reread', 'success'))).toContain('No money moves on this console.');
  });
  it('the publish chain (DECOR): "Publish this month\'s wall" refused by name; Q5\'s sentence; nothing published; Back only — no re-read link', () => {
    const c = text(chain('publish_act', 'confirm'));
    expect(c).toContain('Nothing to confirm'); expect(c).toContain(Q5);
    expect(c).toContain('Nothing can be published from this console, by one person or by two.');
    expect(text(chain('publish_act', 'success'))).toContain('Nothing was published, and nothing was written.');
    for (const s of ['confirm', 'success', 'failure']) {
      const h = chain('publish_act', s);
      expect(hrefs(h)).toEqual(['/mgnrega']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/mgnrega');
    }
  });
  it('no state links anywhere but /mgnrega', () => {
    for (const c of CHAINS_5B) for (const s of c.states) for (const href of hrefs(chain(c.id, s))) expect([c.id, s, href]).toEqual([c.id, s, '/mgnrega']);
  });
});

describe('PC-56 GOV-5b · every 5b chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form; no digit', (_l, cat) => {
    const c5 = cat as Record<string, string>;
    for (const c of CHAINS_5B) for (const s of c.states) {
      const h = chain(c.id, s, c5); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c5[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c5[c.statement]), t.includes(c5['gov5.chain.back'])]).toEqual([c.id, s, true, true]);
      expect([c.id, s, t.split(c5[c.statement]).length - 1]).toEqual([c.id, s, 1]);
      for (const k of gov5RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c5[k])]).toEqual([c.id, s, k, true]);
      const own = visible(h).replace(text(`<p>${c5[c.statement]}</p>`), ' ').replace(text(`<p>${c5[`${c.key(s)}.body`]}</p>`), ' ');
      if (c5 === en) expect([c.id, s, FALSE_5B_CHAIN.test(own)]).toEqual([c.id, s, false]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|maker-checker|Two-person/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /\d/.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov5\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
