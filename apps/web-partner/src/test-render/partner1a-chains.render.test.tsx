// apps/web-partner/src/test-render/partner1a-chains.render.test.tsx · PC-56 PARTNER-1a — every DECOR / PARITY-DECOR chain page of the 20 renders
// its own true sentence and its refusals, and links back to its page (never "Retry — back to confirm" on a form chain: DELTA): W2926–W2928
// (`/dashboard?retry=`), W3002–W3005 (`/account/settings?form=`), W2937–W2940 (`/help?ticket=`), W2941–W2943 (`/help?retry=`). No form, no act.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChainNotice } from '../components/partner1/ChainNotice';
import { PARTNER1_CHAINS, chainState, partner1RefusalKeys } from '../features/partner1/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { text, tr } from './partner1a-fixtures';

describe('PC-56 PARTNER-1a · the DECOR / PARITY-DECOR chains (render)', () => {
  for (const c of PARTNER1_CHAINS) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its refusals, the way back — nothing written`, (state) => {
      const html = renderToStaticMarkup(<ChainNotice t={tr(en)} chain={c.id} state={state} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(html).toContain(`data-kv-chain-state="${state}"`);
      expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      for (const k of partner1RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${c.page}"`);
      expect(html).not.toContain('<form'); expect(html).not.toMatch(/back to confirm/i);
      expect(w).not.toMatch(/audit trail has the entry|reconcile zero-sum before|page the on-call/i);
      expect(text(renderToStaticMarkup(<ChainNotice t={tr(gu)} chain={c.id} state={state} />))).toContain(gu[`${c.key(state)}.title`]);
    });
  }
  it('a chain state is read from its own query key only; anything else is the page itself', () => {
    expect(chainState('dashboard_retry', { retry: 'confirm' })).toBe('confirm');
    expect(chainState('dashboard_retry', { retry: 'review' })).toBeNull();
    expect(chainState('settings_form', { form: ['failure'] })).toBe('failure');
    expect(chainState('help_ticket', { retry: 'confirm' })).toBeNull();
    expect(chainState('help_retry', undefined)).toBeNull();
  });
});
