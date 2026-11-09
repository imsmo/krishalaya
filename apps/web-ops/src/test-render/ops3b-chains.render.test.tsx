// apps/web-ops/src/test-render/ops3b-chains.render.test.tsx · PC-56 OPS-3b — the two cooler chains in every state:
//   bmc form (W3282–W3285), REAL: form-error = the value the API refuses, the typed value KEPT, nothing recorded; review = the reading as typed and the
//     band, "Record this reading", no verdict guessed; success = the SERVER's answer (reading, verdict, band, its time); failure = the named refusal —
//     L1's custody refusal among them — and Back → /bmc (never the canon's "Retry — back to confirm"). Zero-sum / audit trail / on-call /
//     maker-checker refused BY NAME, never printed.
//   bmc mutate (W3286–W3288): "Request tanker dispatch" refused by name in every state (DECOR); "Retry" a re-read of /bmc (PARITY-DECOR).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { FormErrorReason, ManualReadingForm, ReadingFailure, ReadingRecorded, ReadingReview } from '../components/ops3/BmcViews';
import { FORM_ERRORS, READING_REASONS, readingFailureReason } from '../features/ops3/bmc';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_3B, RECORDED, T1, U1 } from './ops3b-fixtures';

const t = tr(en);
const back = `/bmc?unit=${U1}`;
const chain = (state: string, child: React.ReactNode, cat: Record<string, string> = en) => renderToStaticMarkup(
  <Ops3Chain t={tr(cat)} chain="bmc_form" state={state} back={back} backKey="ops3.bmc.back">{child}</Ops3Chain>);
const act = (state: string) => renderToStaticMarkup(<Ops3Chain t={t} chain="bmc_act" state={state} backKey="ops3.bmc.back" />);

describe('PC-56 OPS-3b · the bmc form chain (REAL)', () => {
  it('form-error (W3282): the API\'s refusal named, the typed value kept in the form, nothing recorded', () => {
    const h = chain('error', <><FormErrorReason t={t} error="temp" /><ManualReadingForm t={t} tile={T1} value="3.85" /></>);
    expect(h).toContain('data-kv-chain="bmc_form" data-kv-chain-kind="REAL" data-kv-chain-state="error"');
    expect(text(h)).toContain('Type the temperature as a number with at most one decimal, for example 3.8. Nothing was recorded.');
    expect(h).toContain('value="3.85"');
    expect(text(h)).toContain('The value you typed is kept below.');
    for (const e of FORM_ERRORS) for (const cat of [en, hi, gu]) expect([e, !!cat[`ops3.bmc.formError.${e}`]]).toEqual([e, true]);
  });
  it('review (W3283): the reading as typed and the band; "Record this reading" posts unit + temperature only; no verdict guessed; no maker-checker', () => {
    const h = chain('review', <ReadingReview t={t} tile={T1} tempC="4.6" action={async () => undefined} />);
    expect(h).toContain('data-kv-chain-state="review"');
    expect(h).toContain('data-kv-review-temp="4.6"'); expect(text(h)).toContain('4.6 °C'); expect(text(h)).toContain('2.0 °C to 4.5 °C');
    expect(text(h)).toContain('Record this reading');
    expect(text(h)).toContain('The server gives its verdict when the reading is recorded.');
    expect(/above its band|inside its band|below its band/.test(text(h))).toBe(false);   // the page never guesses the server's verdict
    expect((h.match(/<input\b[^>]*>/g) ?? []).map((x) => /name="(\w+)"/.exec(x)?.[1]).sort()).toEqual(['tempC', 'unit']);
    expect(text(h)).toContain('A manual reading is typed by a person');
    expect(h).toContain('data-kv-refusal="bmc_form_maker_checker"');
    expect(/maker[- ]checker|diff against/i.test(visible(h))).toBe(false);
  });
  it('success (W3284): the SERVER\'s answer — reading, verdict, band, its time; zero-sum and audit trail refused BY NAME; Back → the cooler', () => {
    const h = chain('success', <ReadingRecorded t={t} reading={RECORDED} />);
    expect(text(h)).toContain('The reading is recorded'); expect(text(h)).toContain('5.2 °C'); expect(text(h)).toContain('above its band');
    expect(text(h)).toContain('2026-11-09 03:10 UTC');
    for (const r of ['bmc_form_zero_sum', 'bmc_form_audit_trail']) expect(h).toContain(`data-kv-refusal="${r}"`);
    expect(/zero-sum|reconcil|audit trail has/i.test(visible(h))).toBe(false);
    expect(h).toContain(`data-kv-back="${back}"`);
    expect(text(chain('success', <ReadingRecorded t={t} reading={null} />))).toContain('This browser keeps no recorded reading to show.');
  });
  it('failure (W3285): every named reason in en / hi / gu; L1\'s custody refusal; "no band" says the reading was KEPT; Back → /bmc; nobody paged', () => {
    for (const r of READING_REASONS) for (const cat of [en, hi, gu]) {
      const h = chain('failure', <ReadingFailure t={tr(cat)} reason={r} />, cat);
      expect([r, h.includes(`data-kv-reason="${r}"`), text(h).includes(cat[`ops3.bmc.reason.${r}`])]).toEqual([r, true, true]);
    }
    const c = chain('failure', <ReadingFailure t={t} reason="custody" />);
    expect(text(c)).toContain('You do not hold this cooler\'s centre, so the reading was refused.');
    expect(text(chain('failure', <ReadingFailure t={t} reason="noThreshold" />))).toContain('The reading itself was kept.');
    expect(c).toContain(`data-kv-back="${back}"`); expect(/Retry/.test(text(c))).toBe(false);
    expect(c).toContain('data-kv-refusal="bmc_form_on_call"'); expect(/on-call/i.test(visible(c))).toBe(false);
  });
  it('the API\'s refusals map to their names: custody, no band (kept) vs retired, unknown, permission, switched off; the value → form-error', () => {
    expect(readingFailureReason(403, 'DAIRY_CENTRE_NOT_IN_CUSTODY')).toBe('custody');
    expect(readingFailureReason(422, 'BMC_READING_REFUSED', { reason: 'x', unitId: U1, readingId: '42' })).toBe('noThreshold');
    expect(readingFailureReason(422, 'BMC_READING_REFUSED', { reason: 'x', unitId: U1 })).toBe('retired');
    expect(readingFailureReason(404, 'BMC_UNIT_NOT_FOUND')).toBe('notFound');
    expect(readingFailureReason(403, 'FORBIDDEN')).toBe('forbidden');
    expect(readingFailureReason(404, 'NOT_FOUND')).toBe('off');
    expect(readingFailureReason(422, 'VALIDATION_FAILED')).toBeNull();
    expect(readingFailureReason(500, 'X')).toBe('record');
  });
  it('no chain state affirms a canon claim or prints a computed figure', () => {
    for (const h of [chain('success', <ReadingRecorded t={t} reading={RECORDED} />), ...READING_REASONS.map((r) => chain('failure', <ReadingFailure t={t} reason={r} />))]) {
      expect(FALSE_3B.test(visible(h).split(/(?<=[.!?])\s+/).filter((s) => !/\b(not|no|never|nothing|none|cannot|nobody)\b/i.test(s)).join(' '))).toBe(false);
      expect(/[×=÷%]/.test(visible(h))).toBe(false);
    }
  });
});

describe('PC-56 OPS-3b · the bmc mutate chain (dispatch DECOR · Retry PARITY-DECOR)', () => {
  it('every state: "Request tanker dispatch" refused BY NAME, no act; Back → /bmc', () => {
    for (const s of ['confirm', 'success', 'failure']) {
      const h = act(s);
      expect([s, h.includes('data-kv-chain="bmc_act" data-kv-chain-kind="PARITY-DECOR"'), h.includes('data-kv-refusal="bmc_dispatch"'), /<form|<button|<input/.test(h)]).toEqual([s, true, true, false]);
      expect(h).toContain('data-kv-back="/bmc"');
      expect([s, /tanker|dispatch/i.test(visible(h))]).toEqual([s, false]);
    }
  });
  it('confirm: its one link IS the re-read of /bmc, labelled "Read the cooler again"; success and failure: nothing changed, nobody paged', () => {
    const c = act('confirm');
    expect(c).toContain('data-kv-real="reread" href="/bmc"'); expect(text(c)).toContain('Read the cooler again');
    expect(text(c)).toContain('Reading the cooler again changes nothing.');
    expect(act('success')).toContain('data-kv-refusal="bmc_act_zero_sum"');
    expect(/zero-sum|audit trail has|on-call/i.test(visible(act('success')) + visible(act('failure')))).toBe(false);
    expect(text(act('failure'))).toContain('Nothing was changed');
  });
});
