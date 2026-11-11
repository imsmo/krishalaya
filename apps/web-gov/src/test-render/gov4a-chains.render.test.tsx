// apps/web-gov/src/test-render/gov4a-chains.render.test.tsx · PC-56 GOV-4a — the three chain groups GOV-4a builds, all DECOR:
//   the FILE chain (W3189–W3190) — no file is made, queued or handed out (the download sentence);
//   the FORM chain (W3191–W3194) — no form exists: nothing to correct, look over, save or send (Q2's sentence);
//   the ACT chain (W3195–W3197) — no field visit is given to an officer, no code is sent to a farmer, nothing is submitted (Q2's sentence).
// Back → /verification from every state, the ONE link. Every state prints its statement and its refusals BY NAME, never the canon's shared
// chain sentences; no form, input or button anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov4Chain } from '../components/gov4/VerificationViews';
import { GOV4_CHAINS, gov4RefusalKeys, type Chain4Id } from '../features/gov4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { FALSE_4A } from './gov-verification.render.test';

const CATS = { en, hi, gu } as const;
const chain = (id: Chain4Id, s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Gov4Chain t={tr(cat)} chain={id} state={s} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];

describe('PC-56 GOV-4a · the verification chains', () => {
  it('the file chain (DECOR): no file is made; the download sentence; one link (Back → /verification)', () => {
    for (const s of ['queued', 'ready']) {
      const h = chain('visit_file', s);
      expect(h).toContain(`data-kv-chain="visit_file" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(text(h)).toContain(en['gov4.download']); expect(text(h)).toContain('No file is queued, made or handed out here.');
      expect((h.match(/<a /g) ?? []).length).toBe(1); expect(backOf(h)).toBe('/verification');
    }
  });
  it('the form chain (DECOR): no form here; Back returns to the page; nothing to review', () => {
    const e = text(chain('visit_draft', 'form-error'));
    expect(e).toContain('No form here'); expect(e).toContain('Field visits are not entered on this console, so there is no form to correct.');
    expect(e).toContain(en['gov4.q2']); expect(e).toContain('Back returns to the field visits page; no form exists to go back to.');
    expect(text(chain('visit_draft', 'review'))).toContain('There is no form here, so there is nothing to review or compare.');
    for (const s of ['form-error', 'review', 'success', 'failure']) { const h = chain('visit_draft', s); expect(backOf(h)).toBe('/verification'); expect((h.match(/<a /g) ?? []).length).toBe(1); }
  });
  it('the act chain (DECOR): assigning, a code to a farmer and submitting are refused by name; nothing written', () => {
    const c = text(chain('visit_act', 'confirm'));
    expect(c).toContain('Nothing to confirm');
    expect(c).toContain('No field visit is given to an officer, no code is sent to a farmer and no field visit is submitted from this console.');
    expect(c).toContain('No money moves on this console.');
    for (const s of ['confirm', 'success', 'failure']) { const h = chain('visit_act', s); expect(backOf(h)).toBe('/verification'); expect((h.match(/<a /g) ?? []).length).toBe(1); }
  });
});

describe('PC-56 GOV-4a · every 4a chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, statement, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word; no form', (_l, cat) => {
    const c4 = cat as Record<string, string>;
    for (const c of GOV4_CHAINS) for (const s of c.states) {
      const h = chain(c.id, s, c4); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(c4[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(c4[c.statement])]).toEqual([c.id, s, true]);
      for (const k of gov4RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(c4[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|signed URL|sha256|position and ETA|maker-checker|diff against/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_4A.test(visible(h))]).toEqual([c.id, s, false]);
      expect([c.id, s, /<form|<input|<button/.test(h)]).toEqual([c.id, s, false]);
      expect([c.id, s, /gov4\.|common\./.test(t)]).toEqual([c.id, s, false]);
    }
  });
});
