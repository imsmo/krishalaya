// apps/web-ops/src/test-render/ops1a-chains.render.test.tsx · PC-56 OPS-1a — the two DECOR chains (W3332–W3334 on /payout, W3369–W3371 on
// /warehouse/withdrawal) in every state: the page's statement first, the state's own sentence (nothing to confirm / nothing done / nothing
// attempted), the refusals BY NAME (zero-sum among them, never its words), no control, Back → the triggering page.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops1Chain } from '../components/ops1/Ops1Chain';
import { en } from '../i18n/en';
import { chain1State, OPS1_CHAINS } from '../features/ops1/refusals';
import { CONTROLS, FALSE_1A, text, tr, visible } from './ops1a-fixtures';

const T = tr(en);
describe('PC-56 OPS-1a · the two DECOR chains', () => {
  it('two chains, three states each, six canon files listed once', () => {
    expect(OPS1_CHAINS.map((c) => [c.id, c.page, c.states.join('|'), c.files.join('|')])).toEqual([
      ['payout_act', '/payout', 'confirm|success|failure', 'W3332|W3333|W3334'],
      ['withdrawal_act', '/warehouse/withdrawal', 'confirm|success|failure', 'W3369|W3370|W3371'],
    ]);
  });
  it.each(OPS1_CHAINS.flatMap((c) => c.states.map((s) => [c.id, s] as const)))('%s · %s: statement first, its sentence, refusals by name, no control, Back to the page', (id, state) => {
    const c = OPS1_CHAINS.find((x) => x.id === id)!;
    const html = renderToStaticMarkup(<Ops1Chain t={T} chain={id} state={state} />);
    const vis = visible(html);
    expect(vis.indexOf(en[c.statement])).toBeGreaterThan(-1);
    expect(vis.indexOf(en[c.statement])).toBeLessThan(vis.indexOf(en[`${c.key(state)}.body`]));
    expect(text(html)).toContain(en[`${c.key(state)}.title`]);
    expect(html).toContain('data-kv-refusal="zero_sum"');
    expect(/zero-sum|reconcil|audit trail has the entry|page the on-call/i.test(text(html))).toBe(false);
    expect(CONTROLS.test(html)).toBe(false);
    expect(html).toContain(`data-kv-back="${c.page}"`);
    expect(FALSE_1A.test(vis)).toBe(false);
  });
  it('chain1State: only the declared states open a chain; anything else is the page', () => {
    expect([chain1State('payout_act', { act: 'confirm' }), chain1State('payout_act', { act: ['failure'] }), chain1State('payout_act', { act: 'pay' }), chain1State('withdrawal_act', {}), chain1State('withdrawal_act', undefined)])
      .toEqual(['confirm', 'failure', null, null, null]);
  });
});
