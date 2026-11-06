// apps/web-ops/src/test-render/ops2b-chains.render.test.tsx · PC-56 OPS-2b — the four 2b chains in every state. The assay ACT chain (W3297–W3299) is
// REAL: confirm carries the record form under the Q13-A label; success and failure print the act's result (failure with the server's named reason);
// its Back → W372 for that booking, NEVER W373 (survey mutant 13). The assay EXPORT chain (W3295–W3296) is DECOR, Back → W373, the trigger (DELTA).
// The enwr chains are DECOR: export Back → W376 (the trigger, DELTA), act Back → W375. No zero-sum sentence anywhere, no control on a DECOR state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops2Chain } from '../components/ops2/Ops2Chain';
import { AssayForm } from '../components/ops2/AssayViews';
import { en } from '../i18n/en';
import { OPS2_CHAINS, chain2State } from '../features/ops2/refusals';
import { chain2bBack, assayFailureReason, ASSAY_FAILURE_REASONS } from '../features/ops2/receipts';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { ASSAYS_2B, BOOKING_ID, FALSE_2B } from './ops2b-fixtures';

const T = tr(en);
const CHAINS_2B = OPS2_CHAINS.filter((c) => c.wave === '2b');
const ctx = { booking: BOOKING_ID, assay: ASSAYS_2B[0].id };
const render = (id: (typeof CHAINS_2B)[number]['id'], state: string, children?: React.ReactNode) =>
  renderToStaticMarkup(<Ops2Chain t={T} chain={id} state={state} back={chain2bBack(id as never, ctx)}>{children}</Ops2Chain>);

describe('PC-56 OPS-2b · the four 2b chains', () => {
  it('four chains, ten states, ten canon files; the assay act chain is the only REAL one', () => {
    expect(CHAINS_2B.map((c) => [c.id, c.kind, c.param, c.states.join('|'), c.files.join('|')])).toEqual([
      ['assay_act', 'REAL', 'act', 'confirm|success|failure', 'W3297|W3298|W3299'],
      ['assay_export', 'DECOR', 'export', 'queued|ready', 'W3295|W3296'],
      ['enwr_export', 'DECOR', 'export', 'queued|ready', 'W3313|W3314'],
      ['enwr_act', 'DECOR', 'act', 'confirm|success|failure', 'W3315|W3316|W3317'],
    ]);
  });
  it('Back: the assay act chain → W372 for its booking (never W373); the assay export → W373 (its trigger); enwr export → W376; enwr act → W375', () => {
    expect(chain2bBack('assay_act', ctx)).toBe(`/warehouse/assay?booking=${BOOKING_ID}`);
    expect(chain2bBack('assay_act', ctx)).not.toMatch(/certificate/);
    expect(chain2bBack('assay_export', ctx)).toBe(`/warehouse/assay/certificate?booking=${BOOKING_ID}&assay=${ASSAYS_2B[0].id}`);
    expect([chain2bBack('enwr_export'), chain2bBack('enwr_act')]).toEqual(['/warehouse/enwr/registry', '/warehouse/enwr/issue']);
  });
  it.each(CHAINS_2B.flatMap((c) => c.states.map((s) => [c.id, s] as const)))('%s · %s: statement first, its sentence, refusals by name, Back as pinned, no zero-sum', (id, state) => {
    const c = CHAINS_2B.find((x) => x.id === id)!;
    const html = render(id, state);
    const vis = visible(html);
    expect(vis.indexOf(en[c.statement])).toBeGreaterThan(-1);
    expect(vis.indexOf(en[c.statement])).toBeLessThan(vis.indexOf(en[`${c.key(state)}.body`]));
    expect(html).toContain(`data-kv-back="${chain2bBack(id as never, ctx).replace(/&/g, '&amp;')}"`);
    expect(CONTROLS.test(html)).toBe(false);
    expect(/zero-sum|reconcil|page the on-call|signed URL|sha256|ETA/i.test(text(html))).toBe(false);
    expect(FALSE_2B.test(vis.replace(en['ops2.assay.label'], ''))).toBe(false);
  });
  it('REAL confirm: the record form under the confirm sentence; success says one audit entry, no money; failure names the reason', () => {
    const confirm = render('assay_act', 'confirm', <AssayForm t={T} bookingId={BOOKING_ID} action="/warehouse/assay" />);
    expect(confirm).toContain('data-kv-chain-kind="REAL"'); expect(confirm).toContain('data-kv-form="assay_record"');
    expect(text(confirm)).toContain(en['ops2.chain.assayAct.confirm.body']);
    expect(text(render('assay_act', 'success'))).toContain('one audit entry was written. No money moved.');
    expect(render('assay_act', 'success')).toContain('data-kv-refusal="assay_zero_sum"');
    expect(render('enwr_act', 'success')).toContain('data-kv-refusal="enwr_zero_sum"');
    for (const id of ['assay_export', 'enwr_export'] as const) for (const s of ['queued', 'ready']) expect(render(id, s)).toContain('data-kv-refusal="export_receipt"');
  });
  it('the failure reasons map the server\'s answers by name, and every reason has its sentence', () => {
    expect([assayFailureReason(409, 'BOOKING_NOT_STORED'), assayFailureReason(403, 'WAREHOUSE_OPERATOR_ONLY'), assayFailureReason(404, null), assayFailureReason(422, 'VALIDATION_FAILED'), assayFailureReason(500, null)])
      .toEqual(['notStored', 'notOperator', 'off', 'invalid', 'record']);
    for (const r of ASSAY_FAILURE_REASONS) expect([r, !!en[`ops2.assay.reason.${r}`]]).toEqual([r, true]);
  });
  it('chain2State: only declared states on the declared parameter', () => {
    expect([chain2State('assay_act', { act: 'confirm' }), chain2State('assay_act', { export: 'confirm' }), chain2State('assay_export', { export: 'ready' }),
      chain2State('enwr_act', { act: 'run' }), chain2State('enwr_export', undefined)]).toEqual(['confirm', null, 'ready', null, null]);
  });
});
