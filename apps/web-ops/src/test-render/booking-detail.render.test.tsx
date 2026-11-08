// apps/web-ops/src/test-render/booking-detail.render.test.tsx · PC-56 OPS-2a · /warehouse/[id] — the booking drill-in (founder Q6-A, Q9-A, Q11-A; D3).
// The acts (confirm, store, cancel) are shown ONLY to the warehouse's named operator; the operator's cancel has a REQUIRED reason field; "Mark stored"
// with no "(weighed)" in any language; the paused-release sentence on a stored booking; the assay link; no issue form; no depositor id; no bare "←".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StorageBooking } from '@krishalaya/sdk-js';
import { BookingDetailView } from '../components/ops2/IntakeViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text, tr } from './ops1a-fixtures';
import { DEPOSITOR_ID, WAREHOUSE_ROWS } from './ops2a-fixtures';

const at = (status: string): StorageBooking => ({ ...WAREHOUSE_ROWS[Object.keys(WAREHOUSE_ROWS)[0]][0], status } as StorageBooking);
const render = (status: string, isOperator: boolean, cat: Record<string, string> = en, extra: { ok?: string | null; error?: string | null } = {}) =>
  renderToStaticMarkup(<BookingDetailView t={tr(cat)} lang="en" booking={at(status)} commodity="Test commodity" warehouseName={isOperator ? 'Test warehouse one' : null}
    isOperator={isOperator} ok={extra.ok ?? null} error={extra.error ?? null} action="/x" />);

describe('PC-56 OPS-2a · the booking drill-in', () => {
  it('the acts are offered ONLY to the named operator: requested → confirm + cancel (with a reason); confirmed → store + cancel; stored → none, the paused sentence', () => {
    const req = render('requested', true);
    expect([req.includes('data-kv-form="confirm"'), req.includes('data-kv-form="store"'), req.includes('data-kv-form="cancel"')]).toEqual([true, false, true]);
    const conf = render('confirmed', true);
    expect([conf.includes('data-kv-form="confirm"'), conf.includes('data-kv-form="store"'), conf.includes('data-kv-form="cancel"')]).toEqual([false, true, true]);
    const st = render('stored', true);
    expect(/data-kv-form=/.test(st)).toBe(false); expect(st).toContain('data-kv-release="paused"');
  });
  it('a non-operator sees NO act — no form, no button, no input — and is told why', () => {
    for (const s of ['requested', 'confirmed', 'stored']) {
      const h = render(s, false);
      expect([s, /<form|<button|<input/.test(h)]).toEqual([s, false]);
      expect(text(h)).toContain(en['ops2.booking.notOperator']);
    }
  });
  it('the operator\'s cancel form has a REQUIRED reason (1–500 characters)', () => {
    const h = render('requested', true);
    expect(h).toMatch(/<input id="wh-reason" name="reason" class="kv-input" required="" minLength="1" maxLength="500"\/>/);
    expect(en['wh.cancelReason']).toBe('Reason (required, up to 500 characters)');
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: "Mark stored" carries no "(weighed)"; the no-weight fact is printed', (_l, cat) => {
    const h = text(render('confirmed', true, cat));
    expect(h).toContain(cat['wh.actStore']); expect(/\((weighed|तौला|તોલાયું)\)/.test(h)).toBe(false);
    expect(h).toContain(cat['ops2.weighbridge.store']);
  });
  it('no depositor id, no issue form, no bare arrow; the assay link and the dashboard link', () => {
    const h = render('stored', true);
    expect(h.includes(DEPOSITOR_ID)).toBe(false);
    expect(/name="enwrNo"|name="valuationMajor"|←/.test(h)).toBe(false);
    expect(h).toContain('href="/warehouse/assay?booking='); expect(h).toContain('href="/warehouse/dashboard"');
  });
  it('the server\'s named refusals print their own sentence', () => {
    expect(text(render('requested', true, en, { error: 'reason' }))).toContain(en['wh.error.reason']);
    expect(text(render('requested', true, en, { error: 'notOperator' }))).toContain(en['wh.error.notOperator']);
  });
});
