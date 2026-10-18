// apps/web-partner/src/test-render/partner1b-chains.render.test.tsx · PC-56 PARTNER-1b — every DECOR chain page of the 25 renders its own true
// sentence and its refusals, and links back to its page (never "Retry — back to confirm" on a form chain, never W253): W2907–W2910
// (`/account/api?form=`), W3017–W3020 (`/account/webhooks?form=`), W3021–W3023 (`/account/webhooks?act=`), W2970–W2973 / W2974–W2976
// (`/onboarding/settlement?form=` / `?act=`). No form, no act, nothing written.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { PARTNER1_CHAINS, chainState, partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_1B } from './partner1b-fixtures';

const ONE_B = ['keys_form', 'hooks_form', 'hooks_act', 'onboarding_form', 'onboarding_act'];

describe('PC-56 PARTNER-1b · the DECOR chains (render)', () => {
  const chains = PARTNER1_CHAINS.filter((c) => ONE_B.includes(c.id));
  it('five chains, eighteen pages', () => { expect(chains.map((c) => c.id)).toEqual(ONE_B); expect(chains.flatMap((c) => c.files).length).toBe(18); });
  for (const c of chains) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its refusals, the way back — nothing written`, (state) => {
      const html = renderToStaticMarkup(<ChainNotice t={tr(en)} chain={c.id} state={state} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner1RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${c.page}"`); expect(html).not.toContain('<form'); expect(html).not.toMatch(/back to confirm|W253/i);
      expect(w).not.toMatch(FALSE_1B);
      for (const cat of [hi, gu]) expect(text(renderToStaticMarkup(<ChainNotice t={tr(cat)} chain={c.id} state={state} />))).toContain(cat[`${c.key(state)}.title`]);
    });
  }
  it('a chain state is read from its own query key only', () => {
    expect(chainState('keys_form', { form: 'review' })).toBe('review');
    expect(chainState('keys_form', { act: 'revoke' })).toBeNull();
    expect(chainState('hooks_act', { act: 'confirm' })).toBe('confirm');
    expect(chainState('hooks_act', { act: 'revoke' })).toBeNull();
    expect(chainState('onboarding_act', { act: 'success' })).toBe('success');
  });
});
