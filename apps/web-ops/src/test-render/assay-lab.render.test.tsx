// apps/web-ops/src/test-render/assay-lab.render.test.tsx · PC-56 OPS-2b · W372 /warehouse/assay — A READ OF ONE BOOKING'S ASSAYS + THE RECORD ACT
// (founder Q13-A, Q11-A). The Q13-A label in every language; parameters `name = value` exactly as entered (no unit, no "%"); the assayer "as the
// warehouse typed it"; each entry links its own page (W373); the record form ONLY for the named operator on a STORED booking (F-16) — otherwise a
// sentence that says why; the booking an id only; no depositor; every 2b state; the refusals by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssayLabView } from '../components/ops2/AssayViews';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { CONTROLS, percents, text, tr, visible } from './ops1a-fixtures';
import { ASSAYS_2B, BOOKING_ID, FALSE_2B } from './ops2b-fixtures';

const view = (cat: Record<string, string>, p: Partial<React.ComponentProps<typeof AssayLabView>> = {}) => renderToStaticMarkup(
  <AssayLabView t={tr(cat)} lang="en" state="ok" bookingId={BOOKING_ID} bookingStatus="stored" isOperator assays={ASSAYS_2B} action="/warehouse/assay" {...p} />);
const html = view(en);

describe('PC-56 OPS-2b · /warehouse/assay', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the founder\'s Q13-A label is printed (and in the form)', (_l, cat) => {
    const h = view(cat);
    expect(text(h)).toContain(cat['ops2.assay.label']);
    expect((h.match(/data-kv-statement="ops2.assay.label"/g) ?? []).length).toBe(2);   // the page and the form
  });
  it('parameters are printed name = value EXACTLY as entered — no unit, no percentage added', () => {
    expect(text(html)).toContain('moisture = 11.50'); expect(text(html)).toContain('foreign_matter = 0.7'); expect(text(html)).toContain('organic = true'); expect(text(html)).toContain('grade = FAQ');
    expect(percents(text(html))).toBe(0);
    expect(/11\.50\s*%|0\.7\s*%/.test(text(html))).toBe(false);
  });
  it('the assayer as typed; valid-until only when entered; each entry links its own record page (W373) with ids only', () => {
    expect(text(html)).toContain('Test assay lab (as the warehouse typed it)');
    expect(text(html)).toContain('None entered');
    for (const a of ASSAYS_2B) expect(html).toContain(`href="/warehouse/assay/certificate?booking=${BOOKING_ID}&amp;assay=${a.id}"`);
  });
  it('the form: shown to the named operator on a stored booking, with exactly the record fields; never otherwise', () => {
    expect(html).toContain('data-kv-form="assay_record"');
    expect(Array.from(html.matchAll(/name="(\w+)"/g)).map((m) => m[1])).toEqual(['booking', 'assayerName', 'paramsText', 'validUntil']);
    expect(html).toContain(`value="${BOOKING_ID}"`);
    const notOp = view(en, { isOperator: false });
    expect(CONTROLS.test(notOp)).toBe(false); expect(notOp).toContain('data-kv-form-hidden="not-operator"'); expect(text(notOp)).toContain(en['ops2.assay.formNotOperator']);
    for (const st of ['confirmed', 'requested', 'released', 'cancelled']) {
      const h = view(en, { bookingStatus: st });
      expect([st, CONTROLS.test(h), h.includes('data-kv-form-hidden="not-stored"')]).toEqual([st, false, true]);
    }
  });
  it('no depositor, no price, none of the canon\'s false words in the visible text', () => {
    expect(/depositor[A-Z]|holder/i.test(html)).toBe(false);
    expect(FALSE_2B.test(visible(html).replace(en['ops2.assay.label'], ''))).toBe(false);
  });
  it('the other states: pick a booking (a link to the warehouse page), unavailable, error (a re-read) — no form in any', () => {
    const pick = view(en, { state: 'pick', bookingId: undefined, assays: [] });
    expect(pick).toContain('data-kv-empty="booking"'); expect(pick).toContain('href="/warehouse"'); expect(CONTROLS.test(pick)).toBe(false);
    const un = view(en, { state: 'unavailable', assays: [] }); expect(un).toContain('data-kv-error="unavailable"'); expect(CONTROLS.test(un)).toBe(false);
    const er = view(en, { state: 'error', assays: [] }); expect(er).toContain(`href="/warehouse/assay?booking=${BOOKING_ID}"`); expect(CONTROLS.test(er)).toBe(false);
    const none = view(en, { assays: [] }); expect(text(none)).toContain(en['ops2.assay.empty']);
  });
  it('the W372 refusals are printed by name', () => {
    for (const id of ['sample_object', 'accredited_lab', 'price_birth', 'percent_added', 'validity_rule', 'analyzer', 'technician_only', 'depositor_kyc'])
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
  });
});
