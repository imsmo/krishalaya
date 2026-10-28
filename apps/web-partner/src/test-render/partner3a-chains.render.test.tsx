// apps/web-partner/src/test-render/partner3a-chains.render.test.tsx · PC-56 PARTNER-3a — every DECOR / PARITY-DECOR chain state of 3a renders its own
// true sentence, its refusals, and links back to ITS OWN page (never the canon's "Back → W252" from W253 / W264 — F-17): W2857–W2859
// (`?act=` on the queue, the claim and insights — PARITY-DECOR: a re-read; "Take next" is DECOR), W2855–W2856 (`/insurer/claims/insights?export=`
// — "exports are not available … write to the partners mailbox" + the mailbox fact). No form, no act, nothing written; no rupee figure.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerClaimsChain } from '../components/partner3/InsurerClaimsChain';
import { PARTNER3_CHAINS, partner3RefusalKeys } from '../features/partner3/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { MONEY } from './partner2b-fixtures';
import { FALSE_3A, percents, withoutRefusals } from './partner3a-fixtures';

const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;
const CLAIM_PAGE = '/insurer/claims/0192d2c4-c001-7000-8000-000000000001';

describe('PC-56 PARTNER-3a · the claim chains (render)', () => {
  it('four 3a chains, five canon pages (W2857–W2859 recorded once on the queue; the claim and insights reuse them) — PARTNER-3b\'s six are its own file', () => {
    expect(PARTNER3_CHAINS.filter((c) => c.wave === '3a').map((c) => c.id)).toEqual(['claims_act', 'claim_act', 'insights_act', 'insights_export']);
    expect(PARTNER3_CHAINS.filter((c) => c.wave === '3a').flatMap((c) => c.files)).toEqual(['W2857', 'W2858', 'W2859', 'W2855', 'W2856']);
    expect(PARTNER3_CHAINS.length).toBe(10);
  });
  for (const c of PARTNER3_CHAINS.filter((x) => x.wave === '3a')) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its refusals, the way back to its own page — nothing written`, (state) => {
      const back = c.id === 'claim_act' ? CLAIM_PAGE : undefined;
      const html = renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain={c.id} state={state} back={back} mailbox={MAILBOX} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner3RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${back ?? c.page}"`); expect(html).not.toContain('<form'); expect(html).not.toMatch(/back to confirm|W252|W253|W264/i);
      expect(text(withoutRefusals(html))).not.toMatch(FALSE_3A); expect(w).not.toMatch(MONEY); expect(percents(w)).toBe(0);
      if (c.mailbox) { expect(w).toContain(en['partner3.export.notAvailable']); expect(html).toContain('href="mailto:partners@example.org"'); }
      else expect(html).not.toContain('data-kv-export-note');
      for (const cat of [hi, gu]) expect(text(renderToStaticMarkup(<InsurerClaimsChain t={tr(cat)} chain={c.id} state={state} />))).toContain(cat[`${c.key(state)}.title`]);
    });
  }
  it('"Take next" lands on the queue\'s re-read with its refusal: nothing is taken; the export chain without a published mailbox says so', () => {
    expect(text(renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="claims_act" state="confirm" />))).toContain(en['partner3.refusal.takeNext']);
    expect(text(renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="insights_export" state="queued" mailbox={{ kind: 'none' }} />))).toContain(en['partner1.ops.mailboxNone']);
    // a claim's own chain without a back link falls back to the queue — never a route pattern
    expect(renderToStaticMarkup(<InsurerClaimsChain t={tr(en)} chain="claim_act" state="success" />)).toContain('href="/insurer/claims"');
  });
});
