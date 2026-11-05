// apps/web-ops/src/test-render/aeps-receipt.render.test.tsx · PC-56 OPS-1b · W393 /aeps/receipt — THERE IS NO RECEIPT HERE (founder Q1-A,
// survey F-4): honest, reads nothing. The bank's device prints the bank's slip; this console keeps the operator's record. Zero controls; no
// figure; "Retry" (FM:101) opens the aeps chain's confirm on /aeps/withdrawal; the slip, the SMS mirror and "the bank's own ledger" refused.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AepsReceiptView } from '../components/ops1/AepsViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, NONE, controls } from './ops1b-fixtures';

const html = renderToStaticMarkup(<AepsReceiptView t={tr(en)} />);
describe('PC-56 OPS-1b · /aeps/receipt says there is no receipt here', () => {
  it('the statement verbatim, and the log sentence', () => {
    expect(text(html)).toContain('There is no receipt here: the bank\'s device prints the bank\'s slip, and this console keeps the operator\'s record.');
    expect(text(html)).toContain(en['ops1.aeps.statement']);
  });
  it('zero controls; no digit; no canon false word; nothing that looks like a slip (no amount, no reference, no phone)', () => {
    expect(controls(html)).toEqual(NONE);
    expect(/\d/.test(visible(html))).toBe(false);
    expect(FALSE_1B.test(visible(html))).toBe(false);
    expect(/₹|Txn ref|thermal|reprint|SMS/i.test(visible(html))).toBe(false);
  });
  it('"Retry" opens the aeps chain confirm on /aeps/withdrawal; the slip refusals are listed by name', () => {
    expect(html).toContain('href="/aeps/withdrawal?act=confirm"');
    for (const id of ['slip', 'sms_mirror', 'bank_ledger', 'settled_with_bank', 'reprint_by_name', 'family_phone', 'masked_ref']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('aeps_receipt'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
