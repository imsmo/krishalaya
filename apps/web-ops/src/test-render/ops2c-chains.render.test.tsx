// apps/web-ops/src/test-render/ops2c-chains.render.test.tsx · PC-56 OPS-2c — the three DECOR chains (W3350–W3351 and W3352–W3354 on
// /warehouse/billing, W3360–W3361 on /warehouse/insights) in every state: the page's statement first, the state's own sentence, the refusals BY
// NAME (the zero-sum sentence among them, never its words), no control, Back → the TRIGGERING page (never the canon's W370 for the wh export).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { en } from '../i18n/en';
import { chain2State, OPS2_CHAINS } from '../features/ops2/refusals';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2C } from './ops2c-fixtures';

const T = tr(en);
// NAMED UPDATE (PC-56 OPS-2b): OPS2_CHAINS now also holds 2b's four chains (ops2b-chains.render pins them); this file pins the THREE 2c chains,
// unchanged, by filtering on the wave.
const CHAINS_2C = OPS2_CHAINS.filter((c) => c.wave === '2c');
describe('PC-56 OPS-2c · the three DECOR chains', () => {
  it('three chains, seven states, seven canon files listed once, each Back to its trigger', () => {
    expect(CHAINS_2C.map((c) => [c.id, c.kind, c.page, c.param, c.states.join('|'), c.files.join('|')])).toEqual([
      ['storage_export', 'DECOR', '/warehouse/billing', 'export', 'queued|ready', 'W3350|W3351'],
      ['storage_act', 'DECOR', '/warehouse/billing', 'act', 'confirm|success|failure', 'W3352|W3353|W3354'],
      ['wh_export', 'DECOR', '/warehouse/insights', 'export', 'queued|ready', 'W3360|W3361'],
    ]);
  });
  it.each(CHAINS_2C.flatMap((c) => c.states.map((s) => [c.id, s] as const)))('%s · %s: statement first, its sentence, refusals by name, no control, Back to the page', (id, state) => {
    const c = OPS2_CHAINS.find((x) => x.id === id)!;
    const html = renderToStaticMarkup(<Ops2Chain t={T} chain={id} state={state} />);
    const vis = visible(html);
    expect(vis.indexOf(en[c.statement])).toBeGreaterThan(-1);
    expect(vis.indexOf(en[c.statement])).toBeLessThan(vis.indexOf(en[`${c.key(state)}.body`]));
    expect(text(html)).toContain(en[`${c.key(state)}.title`]);
    expect(html).toContain(`data-kv-back="${c.page}"`);
    expect(html).not.toContain('/warehouse/dashboard');
    expect(CONTROLS.test(html)).toBe(false);
    expect(/zero-sum|reconcil|audit trail has the entry|page the on-call|signed URL|sha256|ETA/i.test(text(html))).toBe(false);
    expect(FALSE_2C.test(vis)).toBe(false);
  });
  it('the storage mutate chain refuses the zero-sum sentence by name in every state; the exports refuse the export receipt', () => {
    for (const s of ['confirm', 'success', 'failure']) expect(renderToStaticMarkup(<Ops2Chain t={T} chain="storage_act" state={s} />)).toContain('data-kv-refusal="storage_zero_sum"');
    for (const id of ['storage_export', 'wh_export'] as const) for (const s of ['queued', 'ready']) expect(renderToStaticMarkup(<Ops2Chain t={T} chain={id} state={s} />)).toContain('data-kv-refusal="export_receipt"');
  });
  it('chain2State: only the declared states (on the declared parameter) open a chain; anything else is the page', () => {
    expect([chain2State('storage_export', { export: 'queued' }), chain2State('storage_export', { act: 'queued' }), chain2State('storage_act', { act: ['failure'] }),
      chain2State('storage_act', { act: 'run' }), chain2State('wh_export', { export: 'ready' }), chain2State('wh_export', undefined)])
      .toEqual(['queued', null, 'failure', null, 'ready', null]);
  });
});
