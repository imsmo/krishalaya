// apps/web-partner/src/test-render/partner2a-chains.render.test.tsx · PC-56 PARTNER-2a — every DECOR / PARITY-DECOR chain page of the 22 renders
// its own true sentence and its refusals, and links back to ITS OWN page (never the canon's "Back → W245" or "Retry — back to confirm"):
// W2869–W2872 (`?form=`), W2873–W2875 (`?retry=`), W2881–W2882 (`/insurer/policies?export=`), W2883–W2885 (`/insurer/policies?retry=`),
// W2886–W2887 (`/insurer/policies/[id]?export=`), W2888–W2890 (`/insurer/policies/[id]?act=`). No form, no act, nothing written.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { PARTNER2_CHAINS, chain2State, partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A } from './partner2a-fixtures';

describe('PC-56 PARTNER-2a · the DECOR / PARITY-DECOR chains (render)', () => {
  it('six chains, seventeen pages', () => {
    expect(PARTNER2_CHAINS.map((c) => c.id)).toEqual(['ins_form', 'ins_retry', 'policies_export', 'policies_retry', 'policy_export', 'policy_act']);
    expect(PARTNER2_CHAINS.flatMap((c) => c.files).length).toBe(17);
  });
  for (const c of PARTNER2_CHAINS) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its refusals, the way back to its own page — nothing written`, (state) => {
      const back = c.page.includes('[id]') ? '/insurer/policies/0192d2c4-1111-7000-8000-000000000001' : c.page;
      const html = renderToStaticMarkup(<InsurerChain t={tr(en)} chain={c.id} state={state} back={back} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner2RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${back}"`); expect(html).not.toContain('<form'); expect(html).not.toMatch(/back to confirm|W245/i);
      expect(w).not.toMatch(FALSE_2A);
      for (const cat of [hi, gu]) expect(text(renderToStaticMarkup(<InsurerChain t={tr(cat)} chain={c.id} state={state} />))).toContain(cat[`${c.key(state)}.title`]);
    });
  }
  it('a chain state is read from its own query key only', () => {
    expect(chain2State('ins_form', { form: 'review' })).toBe('review');
    expect(chain2State('ins_form', { act: 'review' })).toBeNull();
    expect(chain2State('policies_export', { export: 'ready' })).toBe('ready');
    expect(chain2State('policies_export', { export: 'download' })).toBeNull();
    expect(chain2State('policy_act', { act: 'confirm' })).toBe('confirm');
    expect(chain2State('ins_retry', { retry: ['success', 'x'] })).toBe('success');
  });
  it('without a back override a chain links to its own parent page', () => {
    expect(renderToStaticMarkup(<InsurerChain t={tr(en)} chain="ins_form" state="error" />)).toContain('href="/insurer/products"');
    expect(renderToStaticMarkup(<InsurerChain t={tr(en)} chain="policies_retry" state="confirm" />)).toContain('href="/insurer/policies"');
  });
});
