// apps/web-ops/src/test-render/enwr-detail.render.test.tsx · PC-56 OPS-2b · /warehouse/enwr/[id] — ONE RECEIPT RECORD. No holder, no value (the
// fixture carries both), "recorded, not confirmed", the status verbatim, the quantity as recorded with its BOOKING's unit (or "the receipt stores no
// unit"), zero inputs, no release / cancel / pledge / transfer; a link back to the register.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnwrReceiptView } from '../components/ops2/EnwrViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, text, tr, visible } from './ops1a-fixtures';
import { FALSE_2B, HOLDER_ID, RECEIPTS_2B, VALUE_MINOR } from './ops2b-fixtures';

const view = (cat: Record<string, string>, unit: string | null = 'quintal', state: 'ok' | 'unavailable' | 'error' = 'ok') =>
  renderToStaticMarkup(<EnwrReceiptView t={tr(cat)} lang="en" state={state} receipt={state === 'ok' ? RECEIPTS_2B[0] : null} unitCode={unit} />);
const html = view(en);

describe('PC-56 OPS-2b · the receipt drill-in', () => {
  it('no holder, no value; recorded, not confirmed; the status verbatim', () => {
    expect([html.includes(HOLDER_ID), html.includes(VALUE_MINOR), /holder|valuation/i.test(visible(html))]).toEqual([false, false, false]);
    expect(html).toContain('data-kv-label="recorded-not-confirmed"');
    expect(html).toContain('<code>issued</code>');
    expect(FALSE_2B.test(visible(html))).toBe(false);
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the quantity with its booking\'s unit, or the receipt\'s lack of one', (_l, cat) => {
    expect(text(view(cat))).toContain('62.600'); expect(view(cat)).toContain('data-kv-unit="quintal"');
    expect(view(cat, null)).toContain('data-kv-unit="none"'); expect(text(view(cat, null))).toContain(cat['ops2.enwrReceipt.noUnit']);
    expect(view(cat, '<script>')).toContain('data-kv-unit="none"');
  });
  it('zero inputs in every state; no act button; the acts sentence said; a link back to the register only', () => {
    for (const s of ['ok', 'unavailable', 'error'] as const) expect([s, CONTROLS.test(view(en, 'quintal', s))]).toEqual([s, false]);
    expect(text(html)).toContain(en['ops2.enwrReceipt.acts']);
    expect(Array.from(html.matchAll(/href="([^"]+)"/g)).map((m) => m[1])).toEqual(['/warehouse/enwr/registry']);
    for (const id of ['pledged_loan', 'holding_transfer', 'partly_released', 'receipt_acts', 'holder_name', 'receipt_value']) expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
});
