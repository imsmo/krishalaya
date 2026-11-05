// apps/web-ops/src/test-render/aeps-record.render.test.tsx · PC-56 OPS-1b · W391 /aeps/withdrawal — THE RECORD FORM, REAL (founder Q1-A, Q7-A).
// The ONE form of the slice: its controls counted exactly (6 inputs, 4 selects, 1 textarea, 1 form, 1 button); the device box UNCHECKED by
// default; NO Aadhaar input and NO customer input (and no label for either); the balance is the one the bank's device showed after — no
// "before"; no limit number; the log sentence first; the refusals by name; a link to the exceptions read.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AepsRecordView } from '../components/ops1/AepsViews';
import { en } from '../i18n/en';
import { OPS1_REFUSALS } from '../features/ops1/refusals';
import { text, tr, visible } from './ops1a-fixtures';
import { FALSE_1B, controls } from './ops1b-fixtures';

const page = renderToStaticMarkup(<AepsRecordView t={tr(en)} mode="page" action="/aeps/withdrawal" />);
const FORM = { input: 6, select: 4, textarea: 1, form: 1, button: 1 };

describe('PC-56 OPS-1b · /aeps/withdrawal records what the bank\'s device showed', () => {
  it('the controls are pinned exactly: 6 inputs (bank, account last 4, amount, balance after, device box, bank reference), 4 selects, 1 textarea, 1 form, 1 button', () => {
    expect(controls(page)).toEqual(FORM);
    expect((page.match(/<input[^>]*name="([^"]+)"/g) ?? []).map((m) => m.replace(/.*name="([^"]+)".*/, '$1')).sort())
      .toEqual(['accountLast4', 'amountMajor', 'balanceAfterMajor', 'bankName', 'deviceCertified', 'npciRrn']);
  });
  it('the device box is UNCHECKED by default (certification is the operator\'s deliberate word)', () => {
    const box = page.match(/<input[^>]*name="deviceCertified"[^>]*>/)![0];
    expect(box).toContain('type="checkbox"');
    expect(/\bchecked\b/.test(box)).toBe(false);
  });
  it('Q7-A: no Aadhaar input and no customer input — no name, id or label for either; the page says so', () => {
    expect(/name="(aadhaarLast4|customerUserId)"|id="ae-(aad|cust)"|for="ae-(aad|cust)"/.test(page)).toBe(false);
    // no label asks for an identity: Aadhaar, a customer's id / account / name / phone, or a platform id ("Customer's bank (name)" is the bank's name)
    expect(/<label[^>]*>[^<]*(Aadhaar|customer['’]s (platform )?(id|account|name|phone)|platform id)/i.test(page)).toBe(false);
    expect(/<label[^>]*>[^<]*Aadhaar/i.test('<label for="x">Aadhaar: last 4 digits</label>')).toBe(true);   // control
    expect(text(page)).toContain(en['ops1.aeps.record.keepsLeast']);
  });
  it('the balance is "as the bank\'s device showed after" — no before, no arrow, no limit number, no canon false word in the visible text', () => {
    expect(text(page)).toContain('Balance the bank\'s device showed after (optional)');
    expect(/\bbefore\b|→/i.test(visible(page))).toBe(false);
    expect(FALSE_1B.test(visible(page))).toBe(false);
  });
  it('the log sentence comes first; the submit says what it does; a link to the exceptions; the W391 refusals by name', () => {
    const vis = visible(page);
    expect(vis.indexOf(en['ops1.aeps.statement'])).toBeGreaterThan(-1);
    expect(vis.indexOf(en['ops1.aeps.statement'])).toBeLessThan(vis.indexOf(en['ops1.aeps.record.kind']));
    expect(text(page)).toContain('Record what the bank\'s device showed');
    expect(page).toContain('href="/aeps/exceptions"');
    for (const r of OPS1_REFUSALS.filter((x) => x.surfaces.includes('aeps_record'))) expect([r.id, page.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
});
