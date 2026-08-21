// apps/web-tenant/src/test/tenant6d4-forms.spec.ts · the canon's shared FORM pattern (B2) — TENANT-6d-4.
//
// Eleven canon screens, two chains, one implementation: W2517–W2520 (*"Add BMC"*) and W2555–W2558 (*"Add centre"*).
// What is asserted here is what the SCREENS promise, and each failure is a promise broken in the operator's hands:
//
//   • *"values you entered are preserved"* — this console ships no client JS, so they travel in the query string, and
//     when they cannot the screen SAYS SO rather than quietly losing one;
//   • *"every invalid field is listed with its reason"* — so every refusal code the API can return has copy in all
//     three languages. That list is READ FROM THE API'S OWN SOURCE rather than retyped here: a new refusal shipped
//     without copy would otherwise show a village operator a raw key like `form.bmc.refusal.NEW_THING`;
//   • *"the audit trail has the entry"* — a promise the success screen KEEPS, by deep-linking to that record's trail;
//   • *"Retry — back to confirm"* — the retry path is the review with the values intact, not a blank form;
//   • **the form-error screen IS the review with refusals** — one implementation, so the two cannot drift;
//   • **one write, one path.** The centre board's inline submit-and-hope form is GONE, because a maker-checker step
//     that can be walked around is decoration.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CHAIN_STEPS, MAX_CARRIED_LENGTH, auditHref, canLinkAudit, carryValues, chainHref, chainStep, chainStepKey, diffKey,
  failureKey, fieldLabelKey, generalRefusals, isFormError, normalisedKey, nothingStoredKey, readCarried, refusalKey,
  refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey,
} from '../features/forms/chain';
import { BMC_HREF, BMC_NEW_HREF } from '../features/dairy/bmc';
import { CENTRES_HREF, CENTRE_NEW_HREF } from '../features/dairy/centres';
import type { DairyReview } from '@krishalaya/sdk-js';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');
const hasKey = (k: string) => LOCALES.every((l) => dict(l).includes(`'${k}':`));
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/**
 * The refusal codes, taken from the API's own domain file.
 *
 * DERIVED, NOT RETYPED. A copy of the list in this spec would agree with the API exactly once — the day it was
 * written — and a refusal added later would reach a village screen as a raw key. Reading the source is how the two
 * packages are held together without importing across a service boundary.
 */
function apiRefusals(constName: string): string[] {
  const file = fs.readFileSync(
    path.join(__dirname, '../../../api/src/modules/dairy/domain/dairy-form-review.ts'), 'utf8');
  const block = file.slice(file.indexOf(`export const ${constName} = [`));
  const list = block.slice(block.indexOf('['), block.indexOf('] as const'));
  const own = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  // `...WRITER_REFUSALS` is spread into both lists, so it is resolved rather than missed.
  return list.includes('WRITER_REFUSALS') ? [...own, ...apiRefusals('WRITER_REFUSALS')] : own;
}

const review = (over: Partial<DairyReview> = {}): DairyReview => ({
  ready: true, fields: [], refusals: [], diff: null, entityType: 'bmc_unit', ...over,
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · the four states', () => {
  it('falls back to the form for a step nobody named', () => {
    // A hand-typed or truncated link lands on the form rather than on a page that refuses to render.
    expect(chainStep(undefined)).toBe('edit');
    expect(chainStep('')).toBe('edit');
    expect(chainStep('confirm')).toBe('edit');
    expect(chainStep('formError')).toBe('edit');   // NOT a step: it is the review with refusals
    for (const s of CHAIN_STEPS) expect(chainStep(s)).toBe(s);
  });

  it('makes the form-error screen the review, so the two cannot drift apart', () => {
    expect(isFormError('review', review({ ready: false }))).toBe(true);
    expect(isFormError('review', review({ ready: true }))).toBe(false);
    // Before the API has answered there is nothing to call an error.
    expect(isFormError('review', null)).toBe(false);
    expect(isFormError('edit', review({ ready: false }))).toBe(false);
    expect(chainStepKey('review', true)).toBe('form.step.formError');
    expect(chainStepKey('review', false)).toBe('form.step.review');
    expect(chainStepKey('success', false)).toBe('form.step.success');
    expect(chainStepKey('failure', true)).toBe('form.step.failure');
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · "values you entered are preserved"', () => {
  it('carries what was typed and never asserts a blank', () => {
    const q = carryValues('review', { code: ' MCC-AND-04 ', defaultName: 'Anand', analyzerModel: '   ', operatorUserId: undefined });
    expect(q.preserved).toBe(true);
    const p = new URLSearchParams(q.query);
    expect(p.get('step')).toBe('review');
    expect(p.get('code')).toBe('MCC-AND-04');
    // An empty field is ABSENT, not present-and-empty: a URL that says `analyzerModel=` asserts somebody typed a blank.
    expect(p.has('analyzerModel')).toBe(false);
    expect(p.has('operatorUserId')).toBe(false);
  });

  it('admits the loss instead of dropping one field silently', () => {
    const huge = carryValues('review', { code: 'C'.repeat(MAX_CARRIED_LENGTH + 1) });
    expect(huge.preserved).toBe(false);
    // The step survives — the operator lands on the review and is told to check the fields, not on a blank page.
    expect(huge.query).toBe('step=review');
    expect(hasKey(valuesLostKey())).toBe(true);
    // And the boundary itself is carried, not just what is far past it.
    expect(carryValues('review', { code: 'C'.repeat(MAX_CARRIED_LENGTH - 20) }).preserved).toBe(true);
  });

  it('reads the values back out, trimmed, and ignores a repeated parameter', () => {
    expect(readCarried({ code: ' MCC-AND-04 ', defaultName: '  ', other: 'x' }, ['code', 'defaultName']))
      .toEqual({ code: 'MCC-AND-04' });
    // A doubled query parameter takes the first, rather than rendering `code=A,B` into an input.
    expect(readCarried({ code: ['A', 'B'] }, ['code'])).toEqual({ code: 'A' });
    expect(readCarried({}, ['code'])).toEqual({});
  });

  it('sends the retry back to the REVIEW, with the entries, and not to a blank form', () => {
    const href = retryHref('/dairy/bmc/new', { mccId: 'abc', capacityLitres: '2000' });
    expect(href.startsWith('/dairy/bmc/new?')).toBe(true);
    const p = new URLSearchParams(href.split('?')[1]);
    expect(p.get('step')).toBe('review');
    expect(p.get('capacityLitres')).toBe('2000');
    expect(chainHref('/x', 'edit', { a: '1' })).toBe('/x?step=edit&a=1');
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · the review table', () => {
  it('says NOTHING where the platform will store nothing', () => {
    // On *Add centre* a blank operator is a decision — nobody holds this centre yet — and an empty cell would hide it.
    expect(storedText({ name: 'operatorUserId', entered: null, stored: null, normalised: false }))
      .toEqual({ text: '', isNothing: true });
    expect(storedText({ name: 'capacityLitres', entered: '2000', stored: '2000.00', normalised: true }))
      .toEqual({ text: '2000.00', isNothing: false });
    expect(hasKey(nothingStoredKey())).toBe(true);
    expect(hasKey(normalisedKey())).toBe(true);
  });

  it('lists EVERY reason against a field, and heads the page with the ones that belong to none', () => {
    const r = review({
      ready: false,
      refusals: [
        { field: null, code: 'NO_MANAGE' },
        { field: 'mccId', code: 'MCC_NOT_FOUND' },
        { field: 'mccId', code: 'VALUE_REJECTED' },
        { field: 'serialNo', code: 'TOO_LONG' },
      ],
    });
    expect(refusalsFor(r, 'mccId').map((x) => x.code)).toEqual(['MCC_NOT_FOUND', 'VALUE_REJECTED']);
    expect(generalRefusals(r).map((x) => x.code)).toEqual(['NO_MANAGE']);
    expect(refusalsFor(r, 'model')).toEqual([]);
    expect(refusalsFor(null, 'mccId')).toEqual([]);
    expect(generalRefusals(null)).toEqual([]);
  });

  it('says there is nothing to diff on a create, rather than drawing an empty table', () => {
    expect(diffKey(review({ diff: null }))).toBe('form.diff.notApplicable');
    expect(diffKey(review({ diff: [{ field: 'code', before: 'A', after: 'B' }] }))).toBe('form.diff.heading');
    expect(hasKey('form.diff.notApplicable')).toBe(true);
    expect(hasKey('form.diff.heading')).toBe(true);
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · success and failure', () => {
  it('KEEPS the audit promise by linking to the record\'s own trail', () => {
    expect(auditHref('mcc_centre', 'abc-1')).toBe('/auditor?entityType=mcc_centre&entityId=abc-1');
    // Encoded, because an id lands in a query string.
    expect(auditHref('bmc_unit', 'a b')).toBe('/auditor?entityType=bmc_unit&entityId=a+b');
    expect(canLinkAudit('bmc_unit', 'abc')).toBe(true);
    // No id, no link: a success screen that CLAIMED a trail and linked nowhere is the same defect as a figure nothing
    // measures.
    expect(canLinkAudit('bmc_unit', null)).toBe(false);
    expect(canLinkAudit('bmc_unit', '')).toBe(false);
    expect(canLinkAudit(null, 'abc')).toBe(false);
    expect(canLinkAudit('', 'abc')).toBe(false);
  });

  it('names the thing it cannot do rather than implying it', () => {
    // *"Repeated failures page the on-call"* is unbuildable today: an audit row is written inside the transaction that
    // performs the act, so a FAILED attempt rolls back with it and there is nothing to count.
    expect(hasKey(repeatedFailuresGapKey())).toBe(true);
    expect(hasKey(failureKey())).toBe(true);
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes(`'${repeatedFailuresGapKey()}':`)) ?? '';
      expect({ l, mentionsGap: line.length > 40 }).toEqual({ l, mentionsGap: true });
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · copy for every field and every refusal, in three languages', () => {
  const FORMS = {
    bmc: {
      const_: 'BMC_REVIEW_REFUSALS',
      // The form's own fields PLUS the one the review computes and nobody types.
      fields: ['mccId', 'capacityLitres', 'minTempC', 'targetTempC', 'toleranceC', 'bandMaxC', 'iotDeviceRef', 'model', 'serialNo'],
    },
    centre: {
      const_: 'CENTRE_REVIEW_REFUSALS',
      fields: ['code', 'defaultName', 'capacityLitresShift', 'analyzerModel', 'analyzerSerial', 'operatorUserId',
        'operatorReason', 'morningOpensAt', 'morningClosesAt', 'eveningOpensAt', 'eveningClosesAt'],
    },
  } as const;

  it('has a label for every field either chain shows', () => {
    for (const [form, spec] of Object.entries(FORMS)) {
      for (const f of spec.fields) {
        expect({ form, f, has: hasKey(fieldLabelKey(form, f)) }).toEqual({ form, f, has: true });
      }
    }
  });

  it('has a sentence for every refusal the API can return', () => {
    for (const [form, spec] of Object.entries(FORMS)) {
      const codes = apiRefusals(spec.const_);
      // The read itself has to have worked, or this test would pass by checking nothing.
      expect({ form, enough: codes.length >= 8 }).toEqual({ form, enough: true });
      for (const c of codes) {
        expect({ form, c, has: hasKey(refusalKey(form, c)) }).toEqual({ form, c, has: true });
      }
    }
  });

  it('has the chain\'s own copy, once, for both forms', () => {
    for (const k of ['form.step.edit', 'form.step.review', 'form.step.formError', 'form.step.success',
      'form.step.failure', 'form.toReview', 'form.submit', 'form.backToEdit', 'form.backToScreen', 'form.fixFirst',
      'form.reviewFailed', 'form.col.field', 'form.col.entered', 'form.col.stored', 'form.auditNote',
      'form.viewAudit', 'form.failure.title', 'form.retry']) {
      expect({ k, has: hasKey(k) }).toEqual({ k, has: true });
    }
    for (const k of ['form.bmc.title', 'form.bmc.add', 'form.bmc.created', 'form.bmc.bandDefaults',
      'form.centre.title', 'form.centre.created']) {
      expect({ k, has: hasKey(k) }).toEqual({ k, has: true });
    }
  });
});

/* =========================================================================================================== */
describe('TENANT-6d-4 · one write, one path', () => {
  it('has no inline create left on the centres board', () => {
    const board = src('app/dairy/centres/page.tsx');
    expect(board.includes('createCentreAction')).toBe(false);
    expect(board.includes('<AddCentreForm')).toBe(false);
    expect(board.includes(CENTRE_NEW_HREF) || board.includes('CENTRE_NEW_HREF')).toBe(true);
    // And the action itself is gone, not merely unreferenced: an unreachable writer is a writer somebody re-wires.
    expect(src('app/dairy/centres/actions.ts').includes('export async function createCentreAction')).toBe(false);
  });

  it('offers the BMC chain from the monitor, empty or not', () => {
    const monitor = src('app/dairy/bmc/page.tsx');
    // Twice: the empty state, and the populated board — a cooperative adds its second tank long after its first.
    expect(monitor.split('BMC_NEW_HREF').length - 1).toBeGreaterThanOrEqual(3);   // 1 import + 2 links
    expect(BMC_NEW_HREF).toBe(`${BMC_HREF}/new`);
    expect(CENTRE_NEW_HREF).toBe(`${CENTRES_HREF}/new`);
  });

  it('asks the API for the review only on the review step', () => {
    // The edit form must not tell an operator a code is taken before they have finished typing it.
    for (const p of ['app/dairy/bmc/new/page.tsx', 'app/dairy/centres/new/page.tsx']) {
      const page = src(p);
      const guard = page.indexOf("if (step === 'review')");
      const call = page.indexOf('tenantClient()');
      expect({ p, guarded: guard > 0 && guard < call }).toEqual({ p, guarded: true });
      // And the audit link is OFFERED, not asserted: no id, no link.
      expect({ p, guardedLink: page.includes('canLinkAudit(') }).toEqual({ p, guardedLink: true });
    }
  });

  /**
   * THE FORM CARRIES EVERY FIELD THE REVIEW HAS A LABEL FOR.
   *
   * Derived rather than restated: the page's own `FIELDS` list is read out of its source and checked against the copy
   * that exists for that form. A field quietly dropped from the form is a decision an operator can no longer make —
   * the tolerance is the sharp one, because the review would then show a default nobody was offered a chance to set.
   */
  it('offers every field the review has copy for, minus the ones it computes', () => {
    const COMPUTED = { bmc: ['bandMaxC'], centre: [] as string[] };
    const PAGES = { bmc: 'app/dairy/bmc/new/page.tsx', centre: 'app/dairy/centres/new/page.tsx' };
    for (const [form, rel] of Object.entries(PAGES)) {
      const page = src(rel);
      const list = page.slice(page.indexOf('const FIELDS = ['), page.indexOf('] as const'));
      const offered = [...list.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
      expect({ form, enough: offered.length >= 8 }).toEqual({ form, enough: true });
      const labelled = [...dict('en').matchAll(new RegExp(`'form\\.${form}\\.field\\.([A-Za-z]+)':`, 'g'))].map((m) => m[1]);
      const missing = labelled.filter((f) => !offered.includes(f) && !COMPUTED[form as 'bmc' | 'centre'].includes(f));
      expect({ form, missing }).toEqual({ form, missing: [] });
    }
  });

  it('never re-implements a rule in the chain\'s submit', () => {
    // The review has already asked the API every question these actions could ask; a second implementation of a rule
    // here is two rules that disagree the first time one changes. Presence, and nothing else.
    for (const p of ['app/dairy/bmc/new/actions.ts', 'app/dairy/centres/new/actions.ts']) {
      const action = src(p);
      expect({ p, regex: /new RegExp|\.test\(/.test(action) }).toEqual({ p, regex: false });
      // And a failure carries the values on WITH THE REASON, so the retry is a review of what was typed.
      expect({ p, carries: action.includes("carryValues('failure'") }).toEqual({ p, carries: true });
      expect({ p, why: action.includes('error=${encodeURIComponent(code)}') }).toEqual({ p, why: true });
      // The board behind the chain is revalidated, or a new centre is invisible on the screen that lists them.
      expect({ p, fresh: action.includes('revalidatePath(BOARD)') }).toEqual({ p, fresh: true });
    }
  });
});
