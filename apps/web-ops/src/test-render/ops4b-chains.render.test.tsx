// apps/web-ops/src/test-render/ops4b-chains.render.test.tsx · PC-56 OPS-4b — the two 4b chains in every state:
//   chc form (W3300–W3303), REAL, opened by "Record a maintenance entry" on W408: form-error = the refusal by name with the values kept; review = the
//   entry as typed, "Recorded by you, as typed — not a measurement.", one POST with the key; success = the SERVER's id and entry; failure = the
//   named refusal (MAINTENANCE_NOT_YOUR_MACHINE, MAINTENANCE_DATE_IN_FUTURE). Back → `/chc/maintenance` in EVERY state (never the canon's W405).
//   eartag mutate (W3310–W3312), DECOR: W394 reads nothing — no re-read; Back → W394.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops4Chain } from '../components/ops4/Ops4Chain';
import { MaintFailureNote, MaintForm, MaintFormError, MaintRecorded, MaintReview } from '../components/ops4/UpkeepViews';
import { OPS4_CHAINS } from '../features/ops4/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { A1, CATEGORIES, FALSE_4A, MACHINES, MATH_4A, affirmed } from './ops4a-fixtures';
import { DRAFT, FALSE_4B, RECORDED } from './ops4b-fixtures';

const KEY = '0192d2c4-0000-7000-8000-0000000000ff';
const BODY = { assetId: A1, logType: 'service' as const, performedOn: '2026-11-09', costMinor: '73150', engineHoursAt: '1210.0' };
const states = (cat: Record<string, string> = en) => {
  const t = tr(cat);
  return {
    error: renderToStaticMarkup(<Ops4Chain t={t} chain="chc_form" state="error" page="/chc/maintenance"><MaintFormError t={t} error="day" /><MaintForm t={t} machines={MACHINES} categories={CATEGORIES} values={DRAFT} /></Ops4Chain>),
    review: renderToStaticMarkup(<Ops4Chain t={t} chain="chc_form" state="review" page="/chc/maintenance"><MaintReview t={t} lang="en" machine="Test tractor class · TEST-REG-1" body={BODY} idemKey={KEY} action="/x" draft={DRAFT} /></Ops4Chain>),
    success: renderToStaticMarkup(<Ops4Chain t={t} chain="chc_form" state="success" page="/chc/maintenance"><MaintRecorded t={t} lang="en" entry={RECORDED} machine={null} /></Ops4Chain>),
    failure: renderToStaticMarkup(<Ops4Chain t={t} chain="chc_form" state="failure" page="/chc/maintenance"><MaintFailureNote t={t} reason="not_your_machine" /></Ops4Chain>),
  };
};

describe('PC-56 OPS-4b · the chc form chain (REAL)', () => {
  const s = states();
  it('every state: REAL, the owner-only statement, Back → /chc/maintenance (never /chc/dashboard)', () => {
    for (const [st, h] of Object.entries(s)) {
      expect(h).toContain(`data-kv-chain="chc_form" data-kv-chain-kind="REAL" data-kv-chain-state="${st}"`);
      expect(h).toContain('data-kv-back="/chc/maintenance"'); expect(h).not.toContain('href="/chc/dashboard"');
      expect(text(h)).toContain('Only the machine\'s owner records its maintenance. Each entry is recorded.');
      expect(FALSE_4B.test(affirmed(visible(h)))).toBe(false); expect(FALSE_4A.test(affirmed(visible(h)))).toBe(false); expect(MATH_4A.test(visible(h))).toBe(false);
    }
  });
  it('form-error: the field named, the values KEPT in the form', () => {
    expect(text(s.error)).toContain('Choose a real day.');
    expect(s.error).toContain('value="2026-11-09"'); expect(s.error).toContain('value="731.5"'); expect(s.error).toContain('value="1210.0"');
    expect(s.error).toMatch(new RegExp(`<option value="${A1}" selected=""`));
  });
  it('review: the entry as typed, "Recorded by you, as typed — not a measurement.", one POST carrying the key; a link to change it', () => {
    expect(text(s.review)).toContain('Recorded by you, as typed — not a measurement.');
    expect(text(s.review)).toContain('Service'); expect(text(s.review)).toContain('2026-11-09'); expect(text(s.review)).toContain('cost ₹731.50, as typed');
    expect((s.review.match(/<form/g) ?? []).length).toBe(1); expect(s.review).toMatch(/method="post"/);
    expect(s.review).toContain(`name="key" value="${KEY}"`); expect(s.review).toContain('name="costMinor" value="73150"');
    expect((s.review.match(/<input(?![^>]*type="hidden")/g) ?? []).length).toBe(0);
    expect(s.review).toContain('data-kv-change="form"');
  });
  it('success: the SERVER\'s id and the entry it stored', () => {
    expect(text(s.success)).toContain(`The server's id for this entry: ${RECORDED.id}`);
    expect(text(s.success)).toContain('Service · 2026-11-09 · at 1210.0 engine hours, as typed · cost ₹731.50, as typed');
    expect(/<form|<input/.test(s.success)).toBe(false);
  });
  it('failure: each refusal BY NAME; nothing recorded', () => {
    expect(text(s.failure)).toContain('Not recorded: only the owner of this machine can record its maintenance.');
    const fut = renderToStaticMarkup(<MaintFailureNote t={tr(en)} reason="date_in_future" />);
    expect(text(fut)).toContain('Not recorded: a maintenance entry cannot be dated after today.');
    expect(text(s.failure)).toContain('Nothing was recorded.');
  });
  it('the canon\'s zero-sum, audit-view and on-call sentences are refused BY NAME, never printed', () => {
    for (const id of ['form_maker_checker', 'form_zero_sum', 'form_view_audit', 'form_on_call', 'log_completion', 'off_calendar']) expect(s.success).toContain(`data-kv-refusal="${id}"`);
    expect(/zero-sum|audit[- ]trail|on-call|reconcil/i.test(text(s.success))).toBe(false);
  });
  it('every state renders its own title in hi / gu', () => {
    for (const cat of [hi, gu]) { const x = states(cat); for (const st of ['error', 'review', 'success', 'failure']) expect(text((x as Record<string, string>)[st])).toContain(cat[`ops4.chain.chcForm.${st}.title`]); }
  });
});

describe('PC-56 OPS-4b · the eartag chain (DECOR)', () => {
  const c = OPS4_CHAINS.find((x) => x.id === 'eartag_act')!;
  it.each(['confirm', 'success', 'failure'])('%s: DECOR, no re-read, no control, Back → /animals/eartag-scan', (st) => {
    const h = renderToStaticMarkup(<Ops4Chain t={tr(en)} chain="eartag_act" state={st} page="/animals/eartag-scan" />);
    expect(h).toContain(`data-kv-chain="eartag_act" data-kv-chain-kind="DECOR" data-kv-chain-state="${st}"`);
    expect(h).not.toContain('data-kv-real="reread"'); expect(h).toContain('data-kv-back="/animals/eartag-scan"');
    expect(/<form|<input|<button|<select/.test(h)).toBe(false);
    expect(text(h)).toContain('This desk does not look up animals by tag.');
    for (const id of ['kiosk_ambassador', 'merge_desk', 'eartag_confirm_audit', 'eartag_zero_sum', 'eartag_on_call']) expect(h).toContain(`data-kv-refusal="${id}"`);
    expect(FALSE_4B.test(affirmed(visible(h)))).toBe(false); expect(/zero-sum|audit[- ]trail|on-call/i.test(text(h))).toBe(false);
    for (const cat of [hi, gu]) expect(text(renderToStaticMarkup(<Ops4Chain t={tr(cat)} chain="eartag_act" state={st} page="/animals/eartag-scan" />))).toContain(cat[`${c.key(st)}.title`]);
  });
});
