// apps/web-ops/src/test-render/ops2a-chains.render.test.tsx · PC-56 OPS-2a — the four 2a chain groups (six built chains, 22 − 3 = 19 chain files) in
// every state. wh form (W3362–W3365) DECOR — "New booking" refused with the founder's Q12-A words; wh act (W3366–W3368) PARITY-DECOR — "Retry"
// re-reads the dashboard, Back → W370; weighbridge (W3355–W3359) DECOR; stacking (W3343–W3349) DECOR. The shared chain sentences are refused by name
// (zero-sum, on-call, audit trail, maker-checker) and never printed; no control on any state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { en } from '../i18n/en';
import { OPS2_CHAINS, chain2State } from '../features/ops2/refusals';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2A } from './ops2a-fixtures';

const T = tr(en);
const CHAINS_2A = OPS2_CHAINS.filter((c) => c.wave === '2a');
const render = (id: (typeof CHAINS_2A)[number]['id'], state: string) => renderToStaticMarkup(<Ops2Chain t={T} chain={id} state={state} />);

describe('PC-56 OPS-2a · the 2a chains', () => {
  it('six chains, nineteen states, nineteen canon files; wh act is the only PARITY-DECOR', () => {
    expect(CHAINS_2A.map((c) => [c.id, c.kind, c.param, c.states.join('|'), c.files.join('|')])).toEqual([
      ['wh_form', 'DECOR', 'form', 'error|review|success|failure', 'W3362|W3363|W3364|W3365'],
      ['wh_act', 'PARITY-DECOR', 'act', 'confirm|success|failure', 'W3366|W3367|W3368'],
      ['weighbridge_export', 'DECOR', 'export', 'queued|ready', 'W3355|W3356'],
      ['weighbridge_act', 'DECOR', 'act', 'confirm|success|failure', 'W3357|W3358|W3359'],
      ['stacking_form', 'DECOR', 'form', 'error|review|success|failure', 'W3343|W3344|W3345|W3346'],
      ['stacking_act', 'DECOR', 'act', 'confirm|success|failure', 'W3347|W3348|W3349'],
    ]);
  });
  it.each(CHAINS_2A.flatMap((c) => c.states.map((s) => [c.id, s] as const)))('%s · %s: statement first, its sentence, refusals by name, Back to its own page, no control, no zero-sum', (id, state) => {
    const c = CHAINS_2A.find((x) => x.id === id)!;
    const html = render(id, state);
    const vis = visible(html);
    expect(vis.indexOf(en[c.statement])).toBeGreaterThan(-1);
    expect(vis.indexOf(en[c.statement])).toBeLessThan(vis.indexOf(en[`${c.key(state)}.body`]));
    expect(html).toContain(`data-kv-back="${c.page}"`);
    expect(CONTROLS.test(html)).toBe(false);
    expect(/zero-sum|reconcil|page the on-call|signed URL|sha256|ETA|maker-checker|View audit trail/i.test(text(html))).toBe(false);
    // the stacking chains' statement and form bodies say "no pest-control log" (negated); everything else is held to FALSE_2A
    expect(FALSE_2A.test(vis.replace(en['ops2.stacking.statement'], '').replace(en[`${c.key(state)}.body`], ''))).toBe(false);
    expect(/\b(not|no|nothing|nobody)\b/i.test(en[`${c.key(state)}.body`])).toBe(true);
    if (['wh_form', 'wh_act', 'weighbridge_act', 'stacking_form', 'stacking_act'].includes(id)) expect(html).toContain('data-kv-refusal="intake_zero_sum"');
  });
  it('wh form carries the Q12-A sentence and refuses "New booking" and maker-checker by name; Back → W370', () => {
    const h = render('wh_form', 'review');
    expect(text(h)).toContain(en['ops2.whDash.newBooking']);
    for (const id of ['new_booking', 'maker_checker', 'intake_zero_sum', 'intake_on_call', 'intake_audit_trail']) expect([id, h.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    expect(h).toContain('data-kv-back="/warehouse/dashboard"');
  });
  it('the weighbridge export refuses the slip and the export receipt; the stacking form refuses the pest log', () => {
    for (const s of ['queued', 'ready']) for (const id of ['print_slip', 'export_receipt', 'export_queue']) expect(render('weighbridge_export', s)).toContain(`data-kv-refusal="${id}"`);
    expect(render('stacking_form', 'error')).toContain('data-kv-refusal="pest_log"');
  });
  it('chain2State: only declared states on the declared parameter', () => {
    expect([chain2State('wh_form', { form: 'review' }), chain2State('wh_form', { act: 'review' }), chain2State('wh_act', { act: 'confirm' }), chain2State('stacking_form', { form: 'run' }),
      chain2State('weighbridge_export', { export: 'ready' })]).toEqual(['review', null, 'confirm', null, 'ready']);
  });
});
