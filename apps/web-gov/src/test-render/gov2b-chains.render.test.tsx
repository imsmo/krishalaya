// apps/web-gov/src/test-render/gov2b-chains.render.test.tsx · PC-56 GOV-2b — the four chain groups GOV-2b builds, as six built chains:
//   the SCHEME FORM (W3182–W3185) and the SCHEME SEND (W3186–W3188), the RULE FORM (W3172–W3175) and the RULE REMOVAL (W3176–W3178) — DECOR in
//   every state: refused BY NAME, no form, no input, nothing sent (Q5-A);
//   the SCHEME and RULES RE-READS (W3186–W3188 / W3176–W3178, opened by an error state's Retry) — PARITY-DECOR: the confirm state's one link
//   IS the re-read of the page that opened it.
// Back → the page that opened it, ALWAYS: a chain opened on a scheme returns to THAT scheme (never the list — the canon's W3182/W3183/W3185
// defect); the list's "Define a scheme" chain returns to /schemes. Every state prints Q5-A's sentence and its refusals BY NAME, never the
// canon's shared chain sentences.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gov2Chain } from '../components/gov2/Gov2Chain';
import { chain2Back, GOV2_CHAINS, gov2RefusalKeys, type Chain2Id, type SchemeTab } from '../features/gov2/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './gov1a-fixtures';
import { FALSE_2B, SCHEME_A_ID } from './gov2b-fixtures';

const Q5 = 'Schemes are written by the platform\'s team, not from this console. Each version is drafted by one person and published by another.';
const CATS = { en, hi, gu } as const;
const chain = (id: Chain2Id, s: string, schemeId: string | null = SCHEME_A_ID, tab?: SchemeTab, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<Gov2Chain t={tr(cat)} chain={id} state={s} back={chain2Back(id, schemeId, tab)} />);
const backOf = (h: string) => (h.match(/data-kv-back="([^"]*)"/) ?? [])[1];
const TWO_B = GOV2_CHAINS.filter((c) => c.wave === '2b');

describe('PC-56 GOV-2b · the authoring chains — DECOR, refused BY NAME', () => {
  it('the registry\'s 2b chains are exactly these six, with their kinds', () => {
    expect(TWO_B.map((c) => [c.id, c.kind])).toEqual([['scheme_form', 'DECOR'], ['scheme_send', 'DECOR'], ['scheme_reread', 'PARITY-DECOR'],
      ['rule_form', 'DECOR'], ['rule_remove', 'DECOR'], ['rules_reread', 'PARITY-DECOR']]);
  });
  it('the scheme form opened on a scheme: Back → THAT scheme (the tab that opened it), never the list; no form, no input', () => {
    for (const s of ['form-error', 'review', 'success', 'failure']) {
      const h = chain('scheme_form', s);
      expect(h).toContain(`data-kv-chain="scheme_form" data-kv-chain-kind="DECOR" data-kv-chain-state="${s}"`);
      expect(backOf(h)).toBe(`/schemes/${SCHEME_A_ID}?tab=identity`);
      expect(text(h)).toContain('Back to the scheme');
      expect(h).not.toMatch(/<form|<input|<button|<select|<textarea/);
    }
    expect(backOf(chain('scheme_form', 'review', SCHEME_A_ID, 'versions'))).toBe(`/schemes/${SCHEME_A_ID}?tab=versions`);
    expect(text(chain('scheme_form', 'success'))).toContain('No scheme was created or changed.');
  });
  it('the list\'s "Define a scheme" chain: Back → /schemes', () => {
    const h = chain('scheme_form', 'review', null);
    expect(backOf(h)).toBe('/schemes'); expect(text(h)).toContain('Back to the schemes'); expect(text(h)).toContain('Defining a scheme is not offered here.');
  });
  it('the scheme send ("Copy an existing scheme", "Send for approval"): nothing copied or sent; Back → the scheme', () => {
    for (const s of ['confirm', 'success', 'failure']) expect([s, backOf(chain('scheme_send', s))]).toEqual([s, `/schemes/${SCHEME_A_ID}?tab=identity`]);
    expect(text(chain('scheme_send', 'confirm'))).toContain('No scheme is copied or sent for publishing from this console.');
    expect(chain('scheme_send', 'confirm')).not.toContain('data-kv-real');
  });
  it('the rule form and the rule removal: Back → THAT scheme\'s rules, whatever tab is named', () => {
    for (const id of ['rule_form', 'rule_remove'] as const) for (const s of TWO_B.find((c) => c.id === id)!.states) {
      expect([id, s, backOf(chain(id, s, SCHEME_A_ID, 'identity'))]).toEqual([id, s, `/schemes/${SCHEME_A_ID}?tab=rules`]);
    }
    expect(text(chain('rule_remove', 'confirm'))).toContain('No rule is removed from this console.');
    expect(text(chain('rule_form', 'success'))).toContain('No rule was added or changed.');
  });
});

describe('PC-56 GOV-2b · the re-read chains — PARITY-DECOR', () => {
  it('the confirm state\'s one link IS the re-read of the page that opened it; writes nothing', () => {
    const l = chain('scheme_reread', 'confirm', null);
    expect(l).toContain('href="/schemes" data-kv-real="reread"'); expect(text(l)).toContain('Reading this page again writes nothing.');
    const r = chain('rules_reread', 'confirm');
    expect(r).toContain(`href="/schemes/${SCHEME_A_ID}?tab=rules" data-kv-real="reread"`);
    const v = chain('scheme_reread', 'confirm', SCHEME_A_ID, 'versions');
    expect(v).toContain(`href="/schemes/${SCHEME_A_ID}?tab=versions" data-kv-real="reread"`);
    for (const s of ['success', 'failure']) expect(chain('scheme_reread', s)).not.toContain('data-kv-real');
  });
});

describe('PC-56 GOV-2b · every 2b chain state, en/hi/gu', () => {
  it.each(Object.entries(CATS))('%s: title, Q5-A, body, the refusals BY NAME; none of the canon\'s shared sentences; no false word', (_l, cat) => {
    for (const c of TWO_B) for (const s of c.states) {
      const h = chain(c.id, s, SCHEME_A_ID, undefined, cat); const t = text(h);
      for (const part of ['title', 'body']) expect([c.id, s, part, t.includes(cat[`${c.key(s)}.${part}`])]).toEqual([c.id, s, part, true]);
      expect([c.id, s, t.includes(cat['gov2.q5'])]).toEqual([c.id, s, true]);
      for (const k of gov2RefusalKeys(c.surface)) expect([c.id, s, k, t.includes(cat[k])]).toEqual([c.id, s, k, true]);
      expect([c.id, s, /reconcile|zero-sum|on-call|View audit trail|back to confirm|Maker-checker/i.test(t)]).toEqual([c.id, s, false]);
      expect([c.id, s, FALSE_2B.test(visible(h))]).toEqual([c.id, s, false]);
    }
    expect(text(chain('scheme_form', 'review'))).toContain(Q5);
  });
});
