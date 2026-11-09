// apps/web-ops/src/test-render/ops3a-chains.render.test.tsx · PC-56 OPS-3a — the pos chain (W3335–W3337), REAL: confirm IS the check step (one
// button, "Record this pour"); success prints "This pour is recorded" above what was recorded, with the SERVER's price; failure prints "Nothing was
// recorded" and the server's named reason — the brief's four (future day, billed window, the one-pour rule, no approved card) and the rest. The
// zero-sum sentence is refused BY NAME, never printed. Back is the page that opened the state (survey C-15: never W362 by default).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ops3Chain } from '../components/ops3/Ops3Chain';
import { PosQualityView, PourFailure, WhatWasRecorded } from '../components/ops3/CounterViews';
import { POUR_REASONS } from '../features/ops3/counter';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr, visible } from './ops1a-fixtures';
import { C1, CARD, CENTRE, POUR, RECORDED } from './ops3a-fixtures';

const t = tr(en);
const failure = (reason: (typeof POUR_REASONS)[number], cat: Record<string, string> = en) => renderToStaticMarkup(
  <Ops3Chain t={tr(cat)} chain="pos_act" state="failure" back={`/pos/quality?mcc=${C1}`} backKey="ops3.pos.backToCheck"><PourFailure t={tr(cat)} reason={reason} /></Ops3Chain>);
const success = renderToStaticMarkup(<Ops3Chain t={t} chain="pos_act" state="success" back={`/pos/collect?mcc=${C1}`} backKey="ops3.pos.slip.next">
  <WhatWasRecorded t={t} lang="en" pour={RECORDED} card={CARD} cardRead={true} /></Ops3Chain>);

describe('PC-56 OPS-3a · the pos chain (REAL)', () => {
  it('confirm = the check step: REAL, one submit, "Record this pour"', () => {
    const h = renderToStaticMarkup(<PosQualityView t={t} centre={CENTRE} pour={POUR} memberCode="TC-001" milkType="cow" idemKey="k" action={async () => undefined} back="/pos/collect" />);
    expect(h).toContain('data-kv-chain="pos_act" data-kv-chain-kind="REAL" data-kv-chain-state="confirm"');
    expect(text(h)).toContain('Check the numbers before recording');
    expect((h.match(/<button/g) ?? []).length).toBe(1);
  });
  it('success: "This pour is recorded", the server\'s price only; the zero-sum and audit-trail sentences refused BY NAME; Back → a fresh form', () => {
    expect(success).toContain('data-kv-chain-kind="REAL" data-kv-chain-state="success"');
    expect(text(success)).toContain('This pour is recorded'); expect(text(success)).toContain('₹430.50');
    expect(success).toContain('data-kv-refusal="pos_zero_sum"'); expect(success).toContain('data-kv-refusal="pos_audit_trail"');
    expect(/zero-sum|reconcil|audit trail has/i.test(visible(success))).toBe(false);
    expect(success).toContain(`data-kv-back="/pos/collect?mcc=${C1}"`);
  });
  it('failure: "Nothing was recorded" + the named reason; the duplicate states the one-pour rule; Back → the check step', () => {
    const PIN: Record<string, string> = {
      future: 'A pour cannot be recorded for a day after today.',
      billed: 'This member already has a bill for a period that contains this day, so a pour for that day cannot be recorded.',
      duplicate: 'A pour is already recorded for this member in this shift on this day.',
      noCard: 'No approved rate card for this member\'s milk type is in force on that day.',
    };
    for (const [r, s] of Object.entries(PIN)) {
      const h = failure(r as never);
      expect([r, text(h).includes('Nothing was recorded'), text(h).includes(s), h.includes(`data-kv-reason="${r}"`)]).toEqual([r, true, true, true]);
    }
    expect(text(failure('duplicate'))).toContain('Only one pour can be recorded for a member in each shift.');
    expect(text(failure('future'))).not.toContain('Only one pour');
    expect(failure('future')).toContain(`data-kv-back="/pos/quality?mcc=${C1}"`);
  });
  it('every reason has its sentence in en / hi / gu, and every failure state names it', () => {
    for (const r of POUR_REASONS) for (const cat of [en, hi, gu]) {
      expect([r, typeof cat[`ops3.pos.reason.${r}`] === 'string' && cat[`ops3.pos.reason.${r}`].length > 0]).toEqual([r, true]);
      expect([r, text(failure(r, cat)).includes(cat[`ops3.pos.reason.${r}`])]).toEqual([r, true]);
    }
  });
  it('no chain state prints a computed figure, "×", "=" or "%"', () => {
    for (const h of [success, ...POUR_REASONS.map((r) => failure(r))]) expect(/[×=÷]/.test(visible(h))).toBe(false);
    expect(/%/.test(visible(failure('record')))).toBe(false);
  });
});
