// apps/web-gov/src/test-render/gov4b-chains.render.test.tsx · PC-56 GOV-4b — the two chain groups GOV-4b builds, both query states of /access:
//   the FILE chain (W3262–W3263, `?do=signins-file`) — DECOR: no file of sign-ins is queued, made or handed out (the sign-ins download sentence);
//   the RE-READ chain (W3264–W3266, `?do=signins-reread`) — PARITY-DECOR: the confirm state's one extra link IS a re-read of /access.
// Back → /access from every state (never the dashboard). Every state prints its statement and its refusals BY NAME, never the canon's shared
// chain sentences; no form, input or button anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov4Chain } from '../components/gov4/VerificationViews';
import { GOV4_CHAINS, gov4RefusalKeys, type Chain4Id } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';

const CATS = { en, hi, gu } as const;
const CHAINS_4B = GOV4_CHAINS.filter((c) => c.wave === '4b');
const chain = (id: Chain4Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov4Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
/** W356's and the session chains' false words, as they would appear in visible text (outside the refusal list). */
const FALSE_4B = /\bIP\b|device|SSO|hardware key|security key|step-up|regulator|RTI|export|never locked|throttl|append-only|watching the watchers|who got in|access events|out-of-state|security desk|data room|signed extract|sha256|signed URL|position and ETA|reconcile|zero-sum|on-call|audit trail|back to confirm|Directorate|Gujarat|Gandhinagar|Kapadia|Trivedi|\bDK\b/i;

describe('PC-56 GOV-4b · the sign-ins chains', () => {
  it('two chains, both 4b, on /access: the file chain DECOR, the re-read chain PARITY-DECOR', () => {
    expect(CHAINS_4B.map((c) => [c.id, c.kind, c.back])).toEqual([['signins_file', 'DECOR', '/access'], ['signins_reread', 'PARITY-DECOR', '/access']]);
  });
  it('the file chain (DECOR): no file is made; the sign-ins download sentence; one link (Back → /access)', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('signins_file', s);
      expect(h).toContain(`data-kv-chain="signins_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain('Sign-ins cannot be downloaded from this console.');
      expect(text(h)).toContain('No file is queued, made or handed out here.'); expect(text(h)).toContain('No file of sign-ins is made or handed out from this console.');
      expect(hrefs(h)).toEqual(['/access']); expect(backOf(h)).toBe('/access'); expect(text(h)).toContain('Back to access');
    }
    expect(text(chain('signins_file', 'ready'))).toContain('No file of sign-ins exists here.');
  });
  it('the re-read chain (PARITY-DECOR): confirm\'s extra link IS the re-read of /access; success and failure: Back only; Q4\'s sentence', () => {
    const c = chain('signins_reread', 'confirm');
    expect(c).toContain('data-kv-chain="signins_reread" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="confirm"');
    expect(c).toContain('href="/access" data-kv-real="reread"'); expect(hrefs(c)).toEqual(['/access', '/access']);
    expect(text(c)).toContain('Read the access page again'); expect(text(c)).toContain('Reading this page again writes nothing.');
    expect(text(c)).toContain(en['gov4.q4']);
    for (const s of ['success', 'failure']) { const h = chain('signins_reread', s); expect(hrefs(h)).toEqual(['/access']); expect(h).not.toContain('data-kv-real'); expect(backOf(h)).toBe('/access'); }
    expect(text(chain('signins_reread', 'success'))).toContain('No money moves on this console.');
    expect(text(chain('signins_reread', 'failure'))).toContain('No one is paged when this fails.');
  });
  it('no state links to the dashboard, to /verification or to an audit address', () => {
    for (const c of CHAINS_4B) for (const s of c.states) for (const href of hrefs(chain(c.id, s))) expect([c.id, s, href]).toEqual([c.id, s, '/access']);
  });
});

describe('PC-56 GOV-4b · every 4b chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form', (_l, cat) => {
    const c4 = cat as Record<string, string>;
    for (const c of CHAINS_4B) for (const s of c.states) {
      const h = chain(c.id, s, c4); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c4[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c4[c.statement]), t.includes(c4[c.backKey])]).toEqual([c.id, s, true, true]);
      for (const k of gov4RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c4[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, FALSE_4B.test(visible(h))]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov4\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
