// apps/web-partner/src/test-render/partner2b-chains.render.test.tsx · PC-56 PARTNER-2b — every DECOR / PARITY-DECOR chain page of 2b renders its own
// true sentence (and its page's founder-approved statement where it has one), its refusals, and links back to ITS OWN page (never the canon's
// "Retry — back to confirm" on a form chain — W2947, F-18): W2944–W2947 (`/insurer/issuance?form=`), W2948–W2950 (`/insurer/issuance?act=`),
// W2896–W2897 (`/insurer/premiums?export=` — "exports are not available … write to the partners mailbox" + the mailbox fact), W2898–W2900
// (`/insurer/premiums?act=`), W254's pack (`/insurer/reports?form=` — no canon file of its own), W2977–W2979 (`/insurer/parametric?act=`).
// No form, no act, nothing written; no rupee figure.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { PARTNER2_CHAINS, chain2State, partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A } from './partner2a-fixtures';
import { FALSE_2B, MONEY } from './partner2b-fixtures';

const CHAINS_2B = PARTNER2_CHAINS.filter((c) => c.wave === '2b');
const MAILBOX = { kind: 'published', address: 'partners@example.org' } as const;

describe('PC-56 PARTNER-2b · the DECOR / PARITY-DECOR chains (render)', () => {
  it('six chains, fifteen canon pages (the reports pack owns none)', () => {
    expect(CHAINS_2B.map((c) => c.id)).toEqual(['issuance_form', 'issuance_act', 'premiums_export', 'premiums_act', 'reports_form', 'parametric_act']);
    expect(CHAINS_2B.flatMap((c) => c.files)).toEqual(['W2944', 'W2945', 'W2946', 'W2947', 'W2948', 'W2949', 'W2950', 'W2896', 'W2897', 'W2898', 'W2899', 'W2900', 'W2977', 'W2978', 'W2979']);
  });
  for (const c of CHAINS_2B) {
    it.each(c.states.map((s) => [s]))(`${c.id} · %s: its sentence, its statement, its refusals, the way back to its own page — nothing written`, (state) => {
      const html = renderToStaticMarkup(<InsurerChain t={tr(en)} chain={c.id} state={state} mailbox={MAILBOX} />); const w = text(html);
      expect(html).toContain(`data-kv-chain="${c.id}"`); expect(w).toContain(en[`${c.key(state)}.title`]); expect(w).toContain(en[`${c.key(state)}.body`]);
      if (c.statement) expect(w).toContain(en[c.statement]);
      for (const k of partner2RefusalKeys(c.surface)) expect([k, w.includes(en[k])]).toEqual([k, true]);
      expect(html).toContain(`href="${c.page}"`); expect(html).not.toContain('<form'); expect(html).not.toMatch(/back to confirm|W249|W251|W254|W262/i);
      const outside = c.statement ? w.replace(en[c.statement], '') : w;
      expect(outside).not.toMatch(FALSE_2A); expect(outside).not.toMatch(FALSE_2B); expect(w).not.toMatch(MONEY);
      if (c.mailbox) { expect(w).toContain(en['partner2.export.notAvailable']); expect(html).toContain('href="mailto:partners@example.org"'); }
      else expect(html).not.toContain('data-kv-export-note');
      for (const cat of [hi, gu]) expect(text(renderToStaticMarkup(<InsurerChain t={tr(cat)} chain={c.id} state={state} />))).toContain(cat[`${c.key(state)}.title`]);
    });
  }
  it('the export chain without a published mailbox says so; the issuance form chain prints the founder\'s sentence (W2944–W2947)', () => {
    expect(text(renderToStaticMarkup(<InsurerChain t={tr(en)} chain="premiums_export" state="queued" mailbox={{ kind: 'none' }} />))).toContain(en['partner1.ops.mailboxNone']);
    for (const s of ['error', 'review', 'success', 'failure']) {
      expect(text(renderToStaticMarkup(<InsurerChain t={tr(en)} chain="issuance_form" state={s} />))).toContain('the insurer does not issue policies on the platform yet');
    }
  });
  it('a chain state is read from its own query key only', () => {
    expect(chain2State('issuance_form', { form: 'review' })).toBe('review');
    expect(chain2State('issuance_act', { act: 'confirm' })).toBe('confirm');
    expect(chain2State('issuance_act', { retry: 'confirm' })).toBeNull();
    expect(chain2State('premiums_export', { export: 'ready' })).toBe('ready');
    expect(chain2State('premiums_export', { export: 'download' })).toBeNull();
    expect(chain2State('reports_form', { form: 'success' })).toBe('success');
    expect(chain2State('parametric_act', { act: 'failure' })).toBe('failure');
    expect(chain2State('parametric_act', { act: 'run' })).toBeNull();
  });
});
