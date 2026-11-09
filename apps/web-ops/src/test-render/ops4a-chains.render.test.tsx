// apps/web-ops/src/test-render/ops4a-chains.render.test.tsx · PC-56 OPS-4a — the two mutate chains in every state, PARITY-DECOR:
//   chc mutate (W3304–W3306), opened by "Retry" on W405 / W407 (and W409, where it is DECOR — that page reads nothing);
//   equipment mutate (W3318–W3320), opened by "Retry" on W406.
// confirm = the statement + one link that IS a re-read of the page that opened it; success = nothing changed, read afresh; failure = nothing
// changed. Back ALWAYS → the page that opened it (never the canon's donor W405 by default). The zero-sum / audit / on-call sentences are refused
// BY NAME and never printed. No form, no act, no money.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { OPS4_CHAINS } from '../features/ops4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, FALSE_4A, MATH_4A, affirmed } from './ops4a-fixtures';

const DETAIL = `/chc/equipment-detail?id=${A1}`;
const OPENERS: Array<[chain: 'chc_act' | 'equipment_act', page: string]> = [['chc_act', '/chc/dashboard'], ['chc_act', '/chc/bookings'], ['equipment_act', DETAIL]];
const r = (chain: 'chc_act' | 'equipment_act', state: string, page: string, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<Ops4Chain t={tr(cat)} chain={chain} state={state} page={page} />);
const esc = (s: string) => s.replace(/&/g, '&amp;');

describe('PC-56 OPS-4a · the hire chains (PARITY-DECOR)', () => {
  it.each(OPENERS)('%s opened from %s: all three states; Back → that page; the confirm link re-reads it', (chain, page) => {
    for (const st of ['confirm', 'success', 'failure']) {
      const h = r(chain, st, page);
      expect(h).toContain(`data-kv-chain="${chain}" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="${st}"`);
      expect(h).toContain(`data-kv-back="${esc(page)}"`);
      expect(text(h)).toContain('This console only reads machine hire.');
      expect(/<form|<input|<button|<select/.test(h)).toBe(false);
      expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
      expect(/₹/.test(h)).toBe(false);
    }
    expect(r(chain, 'confirm', page)).toContain(`data-kv-real="reread" href="${esc(page)}"`);
    expect(r(chain, 'success', page)).not.toContain('data-kv-real="reread"');
    expect(text(r(chain, 'failure', page))).toMatch(/could not be read\. Nothing was changed\. Going back reads it again\./);
  });
  it('the canon\'s zero-sum, audit and on-call sentences are refused BY NAME in each chain, never printed', () => {
    const c = r('chc_act', 'success', '/chc/bookings'); const e = r('equipment_act', 'success', DETAIL);
    for (const id of ['chc_confirm_audit', 'chc_zero_sum', 'chc_on_call']) expect(c).toContain(`data-kv-refusal="${id}"`);
    for (const id of ['eq_confirm_audit', 'eq_zero_sum', 'eq_on_call']) expect(e).toContain(`data-kv-refusal="${id}"`);
    for (const h of [c, e]) expect(/zero-sum|audit[- ]trail|on-call|reconcil/i.test(text(h))).toBe(false);
  });
  it('every state title and body exists ×3 and renders in hi / gu', () => {
    for (const c of OPS4_CHAINS) for (const st of c.states) for (const cat of [hi, gu]) {
      const h = r(c.id, st, '/chc/dashboard', cat);
      expect(text(h)).toContain(cat[`${c.key(st)}.title`]);
    }
  });
});
