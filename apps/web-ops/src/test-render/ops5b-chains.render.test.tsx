// apps/web-ops/src/test-render/ops5b-chains.render.test.tsx · PC-56 OPS-5b — the two insights chains, as query states of W369:
//   the export (W3321 queued / W3322 ready), REAL on the tenant export plane — from a plane fixture: position and an ETA called an estimate ("no
//   estimate yet" with no history), "Check again" re-reads the job; the receipt in words (file name, data rows, sha256, generated-at, requester as
//   YOU — or another person, never an id), fetch counts, the download a POST to the console's route (no token in the page); expired / failed by
//   name; switched off / refused / no such file / error; Back → W369 with its window.
//   the re-read (W3323–W3325), PARITY-DECOR: the confirm state's one link IS a re-read; nothing written; zero-sum and on-call refused BY NAME; Back → W369.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportJobView } from '../components/ops5/InsightsViews';
import { Ops5Chain } from '../components/ops5/Ops5Chain';
import { chain5ById, OPS5_CHAINS } from '../features/ops5/refusals';
import { exportJobState, type ExportJobState } from '../features/ops5/insights';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { JOB, JOB_EXPIRED, JOB_FAILED, JOB_OTHER_DATASET, JOB_QUEUED, JOB_QUEUED_ETA, JOB_READY, JOB_READY_OTHER, ME, OTHER, SHA } from './ops5b-fixtures';
import type { ExportJob } from '@krishalaya/sdk-js';

const BACK = '/insights?window=90';
const exp = (job: ExportJob | null, state: ExportJobState | 'off' | 'forbidden' | 'notFound' | 'error', cat: Record<string, string> = en, extra: Partial<React.ComponentProps<typeof ExportJobView>> = {}) =>
  renderToStaticMarkup(<Ops5Chain t={tr(cat)} chain="insights_export" state={state} page={BACK}><ExportJobView t={tr(cat)} w={90} state={state} job={job} meId={ME} downloadError={null} {...extra} /></Ops5Chain>);
const reread = (s: string, cat: Record<string, string> = en) => renderToStaticMarkup(<Ops5Chain t={tr(cat)} chain="insights_act" state={s} page={BACK} />);

describe('PC-56 OPS-5b · the export chain (REAL, the plane)', () => {
  it('the plane decides the state: queued/running → queued, ready, expired, failed; another dataset\'s job is not this page\'s', () => {
    expect([JOB_QUEUED, JOB_QUEUED_ETA, JOB_READY, JOB_EXPIRED, JOB_FAILED, JOB_OTHER_DATASET].map(exportJobState)).toEqual(['queued', 'queued', 'ready', 'expired', 'failed', 'notFound']);
  });
  it('queued (W3321): position, no estimate yet, asked for by you; "Check again" re-reads the job; Back → W369', () => {
    const h = exp(JOB_QUEUED, 'queued');
    expect(h).toContain('data-kv-chain="insights_export" data-kv-chain-kind="REAL" data-kv-chain-state="queued"');
    expect(text(h)).toContain(en['ops5.chain.insightsExport.queued.title']);
    expect(text(h)).toContain(en['ops5.ins.export.statement']);
    expect(text(h)).toContain('2 (1 ahead)'); expect(text(h)).toContain('no estimate yet: no file has been made before');
    expect(text(h)).toContain('2026-11-10 11:40 UTC'); expect(text(h)).toMatch(/Asked for by you/);
    expect(h).toContain(`data-kv-real="poll" href="/insights?export=${JOB}&amp;window=90"`);
    expect(h).toContain(`data-kv-back="${BACK}"`);
    expect(text(exp(JOB_QUEUED_ETA, 'queued'))).toContain('about 42 seconds — an estimate from the last 7 files made');
    expect(/<form/.test(h)).toBe(false);
  });
  it('ready (W3322): the receipt in words — file, data rows, sha256, made, requester as you; fetch counts; the download is a POST to the console route', () => {
    const h = exp(JOB_READY, 'ready');
    expect(text(h)).toContain('dairy-insights-90d-2026-11-10.csv');
    expect(text(h)).toContain('41 rows of figures (the heading line is not counted)');
    expect(h).toContain(`data-kv-sha256="${SHA}"`); expect(text(h)).toContain('3f1a9c0d 5e7b2a4c');
    expect(text(h)).toContain('2026-11-10 11:41 UTC'); expect(text(h)).toMatch(/Asked for by you/);
    expect(text(h)).toContain('3 tried, 2 served, 1 refused — each one recorded');
    expect(h).toContain(`<form method="post" action="/insights/exports/${JOB}/download"`);
    expect(text(h)).toContain('Download — the link it makes lasts 900 seconds');
    expect(/token/i.test(h)).toBe(false);
    for (const id of [ME, OTHER]) expect(h).not.toContain(id);
    const o = exp(JOB_READY_OTHER, 'ready');
    expect(text(o)).toMatch(/Asked for by another person of this organisation/); expect(o).not.toContain(OTHER);
    expect(text(exp(JOB_READY, 'ready', en, { meId: null }))).toMatch(/Asked for by not known just now/);
    expect(h).toContain('data-kv-refusal="export_record_view"');
  });
  it('expired keeps the receipt and offers no download; failed names the server\'s code; a download refusal comes back as a sentence', () => {
    const e = exp(JOB_EXPIRED, 'expired');
    expect(text(e)).toContain(en['ops5.chain.insightsExport.expired.body']); expect(text(e)).toContain('No longer served since'); expect(/<form/.test(e)).toBe(false);
    const f = exp(JOB_FAILED, 'failed');
    expect(text(f)).toContain('The server\'s reason: dataset_disabled'); expect(/<form/.test(f)).toBe(false);
    expect(text(exp(JOB_READY, 'ready', en, { downloadError: 'link' }))).toContain(en['ops5.ins.export.download.error.link']);
  });
  it('switched off, refused, no such file, error: their own sentences, no job shown, Back → W369', () => {
    for (const s of ['off', 'forbidden', 'notFound', 'error'] as const) {
      const h = exp(null, s);
      expect([s, text(h).includes(en[`ops5.chain.insightsExport.${s}.title`]), text(h).includes(en[`ops5.chain.insightsExport.${s}.body`])]).toEqual([s, true, true]);
      expect(h).not.toContain('data-kv-export-job'); expect(h).toContain(`data-kv-back="${BACK}"`);
    }
  });
});

describe('PC-56 OPS-5b · the re-read chain from W369 (PARITY-DECOR)', () => {
  it.each(['confirm', 'success', 'failure'])('%s: nothing written; the re-read link only on confirm; zero-sum, on-call and the schedule refused BY NAME; Back → W369', (st) => {
    const h = reread(st);
    expect(h).toContain(`data-kv-chain="insights_act" data-kv-chain-kind="PARITY-DECOR" data-kv-chain-state="${st}"`);
    expect(text(h)).toContain(en['ops5.ins.q2']);
    if (st === 'confirm') expect(h).toContain(`data-kv-real="reread" href="${BACK.replace('?', '?')}"`); else expect(h).not.toContain('data-kv-real="reread"');
    expect(h).toContain(`data-kv-back="${BACK}"`); expect(text(h)).toContain('Back to the insights');
    for (const id of ['act_zero_sum', 'act_on_call', 'compute_schedule', 'insights_act_writes']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(/<form|<input|<button/.test(h)).toBe(false);
    expect(/zero-sum|on-call|nightly|audit trail/i.test(text(h))).toBe(false);
  });
  it('every state of both 5b chains renders its own title in en / hi / gu', () => {
    const fiveB = OPS5_CHAINS.filter((c) => c.wave === '5b');
    expect(fiveB.map((c) => c.id)).toEqual(['insights_export', 'insights_act']);
    for (const cat of [en, hi, gu]) {
      for (const st of chain5ById('insights_act').states) expect(text(reread(st, cat))).toContain(cat[`ops5.chain.insightsAct.${st}.title`]);
      for (const st of chain5ById('insights_export').states) expect(text(exp(null, st as ExportJobState, cat))).toContain(cat[`ops5.chain.insightsExport.${st}.title`]);
    }
  });
});
