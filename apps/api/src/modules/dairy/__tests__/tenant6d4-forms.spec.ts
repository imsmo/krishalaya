// modules/dairy/__tests__/tenant6d4-forms.spec.ts · PC-56 TENANT-6d-4 · the canon's shared FORM pattern (B2).
//
// W2517–W2520 (*"Add BMC"*) and W2555–W2558 (*"Add centre"*) are eleven screens with one shape, and the whole wave
// rests on one promise: **a review that says "ready" cannot be followed by a failure screen.** Everything asserted here
// is that promise, or one of the ways this build already broke it:
//
//   • **READY IMPLIES THE WRITER ACCEPTS.** A table of adversarial bodies goes through the review AND through the
//     create schema; `ready` is never true where the schema would refuse. This is the wave's contract as a test.
//   • **EVERY REFUSAL IS REACHABLE.** A refusal naming a field with no review row prints NOWHERE — not general, not on
//     a row — so the operator reads a review with no reasons, confirms, and lands on the failure screen. This build
//     shipped two of them (`MCC_NOT_FOUND` against `mccId` while the row was `centre`; `REASON_WITHOUT_OPERATOR`
//     against a field with no row at all). `result()` now throws, and that throw is asserted.
//   • **THE REVIEW EXPLAINS, IT DOES NOT VALIDATE.** The `preview` routes take the LENIENT schema. Under the create
//     schema, a mistyped centre id was a 400 from a validator, `TOLERANCE_NEGATIVE` was unreachable (the regex forbids
//     a minus sign) and so was `REASON_WITHOUT_OPERATOR` (a refine rejects it first).
//   • **A TYPO IS NOT A 500.** A non-uuid id is never handed to Postgres, because `22P02` on the one screen whose job
//     is to explain an entry is a blank error page instead of a reason.
//   • **THE DEFAULTS ARE SHOWN.** `0.0 / 4.0 / 0.5` and the computed `bandMaxC` appear on the review though nobody
//     types them: the top of the band is the number somebody is phoned about at 4am.
//   • **NO FLOATS.** `2000` → `2000.00` moves digits; it does not scale a double.
//   • **`@Post('preview')` BEFORE `@Post(':id/…')`** — the route-order trap, fifth sighting.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  BMC_REVIEW_REFUSALS, CENTRE_REVIEW_REFUSALS, WRITER_REFUSALS, assertRefusalsPrintable, generalRefusals, refusalsFor,
  reviewBmc, reviewCentre, twoDecimals,
} from '../domain/dairy-form-review';
import {
  PreviewBmcSchema, PreviewMccSchema, looksLikeId, submittedValues, writerIssuesOf,
} from '../dto/dairy-form-preview.dto';
import { CreateMccSchema } from '../dto/create-mcc-centre.dto';
import { RegisterBmcSchema } from '../dto/bmc.dto';
import { BmcController } from '../controllers/v1/bmc.controller';
import { MccController } from '../controllers/v1/mcc.controller';
import { MccCentreService } from '../services/mcc-centre.service';
import { BmcUnitService } from '../services/bmc-unit.service';
import { DairyForbiddenError, MccCentreInvalidError } from '../domain/dairy.errors';

const CENTRE = { code: 'MCC-AND-04', name: 'Anand Ward 4', isActive: true };
const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const bmc = (entered: Record<string, string | undefined>, over: Record<string, unknown> = {}) =>
  reviewBmc({
    canManage: true, entered: entered as never, mcc: CENTRE, deviceRefTaken: false,
    writerIssues: writerIssuesOf(RegisterBmcSchema, submittedValues(entered)),
    ...over,
  } as never);

const centre = (entered: Record<string, string | undefined>, over: Record<string, unknown> = {}) =>
  reviewCentre({
    canManage: true, entered: entered as never, codeExists: false, operatorInTenant: null,
    writerIssues: writerIssuesOf(CreateMccSchema, submittedValues(entered)),
    ...over,
  } as never);

/** The row's stored value — and a MISSING row is a different answer from a row that stores nothing, so it is not
 *  collapsed into one. `null` means *nobody holds this centre yet*; a missing row means the review forgot the field. */
const stored = (r: { fields: Array<{ name: string; stored: string | null }> }, name: string) => {
  const f = r.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no review row named ${name}`);
  return f.stored;
};

const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field}:${x.code}`);

describe('PC-56 TENANT-6d-4 · the shared form pattern', () => {
  /* ------------------------------------------------------------------------------------------------------- */
  /* THE PROMISE: READY IMPLIES THE WRITER ACCEPTS                                                           */
  /* ------------------------------------------------------------------------------------------------------- */

  it('never says ready where the BMC create schema would refuse the same body', () => {
    const bodies: Array<Record<string, string>> = [
      { mccId: ID, capacityLitres: '2000' },                                  // the happy one
      { mccId: ID, capacityLitres: '2000', minTempC: '0.0', targetTempC: '4.0', toleranceC: '0.5' },
      { mccId: 'MCC-AND-03', capacityLitres: '2000' },                        // a code where an id belongs
      { mccId: ID, capacityLitres: '0' },                                     // a tank that holds nothing
      { mccId: ID, capacityLitres: '2000', toleranceC: '-0.5' },              // the regex forbids the minus
      { mccId: ID, capacityLitres: '2000', targetTempC: '4.55' },             // two decimals on a temperature
      { mccId: ID, capacityLitres: '2000', targetTempC: '-1.0', minTempC: '0.0' }, // inverted band
      { mccId: ID, capacityLitres: '2000', serialNo: 'S'.repeat(101) },       // one over the column
      { mccId: ID, capacityLitres: '2000', iotDeviceRef: 'dev-1', model: 'Fx' },
    ];
    for (const body of bodies) {
      const r = bmc(body);
      const writerAccepts = RegisterBmcSchema.safeParse(submittedValues(body)).success;
      // The one direction that matters. The reverse is allowed: the review may refuse what the schema would take
      // (an inactive centre, a taken sensor reference) — those are facts a schema cannot see.
      expect({ body, ready: r.ready, writerAccepts }).toEqual({ body, ready: r.ready, writerAccepts: r.ready ? true : writerAccepts });
    }
    // And at least one of those bodies IS ready, or this test would pass by proving nothing.
    expect(bmc({ mccId: ID, capacityLitres: '2000' }).ready).toBe(true);
  });

  it('never says ready where the centre create schema would refuse the same body', () => {
    const bodies: Array<Record<string, string>> = [
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4' },
      { code: '', defaultName: 'Anand Ward 4' },
      { code: 'C'.repeat(41), defaultName: 'Anand Ward 4' },                  // one over max(40)
      { code: 'MCC-AND-04', defaultName: 'N'.repeat(151) },
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4', operatorReason: 'handover' }, // reason, nobody named
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4', morningOpensAt: '06:00' },    // half a window
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4', morningOpensAt: '06:00:30', morningClosesAt: '09:00' },
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4', capacityLitresShift: '1.234' },
      { code: 'MCC-AND-04', defaultName: 'Anand Ward 4', operatorUserId: 'not-an-id' },
    ];
    for (const body of bodies) {
      const r = centre(body, { operatorInTenant: body.operatorUserId === undefined ? null : looksLikeId(body.operatorUserId) });
      const writerAccepts = CreateMccSchema.safeParse(submittedValues(body)).success;
      expect({ body, ready: r.ready, writerAccepts }).toEqual({ body, ready: r.ready, writerAccepts: r.ready ? true : writerAccepts });
    }
    expect(centre({ code: 'MCC-AND-04', defaultName: 'Anand Ward 4' }).ready).toBe(true);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* EVERY REFUSAL IS REACHABLE                                                                              */
  /* ------------------------------------------------------------------------------------------------------- */

  it('throws rather than shipping a refusal that names a field with no review row', () => {
    // The two defects this build had, reproduced through the only door left open: a writer issue whose path is a real
    // schema field that the review does not show. It becomes GENERAL rather than an orphan.
    const r = bmc({ mccId: ID, capacityLitres: '2000' }, {
      writerIssues: [{ path: 'notAReviewedField', tooLong: false }],
    });
    expect(codes(r)).toEqual(['null:VALUE_REJECTED']);
    expect(generalRefusals(r)).toEqual(['VALUE_REJECTED']);
    // And a refusal the reviewer itself files against a phantom field is a crash, not a silent drop. `reviewBmc` files
    // `MCC_NOT_FOUND` against `mccId`, so renaming that row back to `centre` is what this guards.
    expect(() => reviewBmc({
      canManage: true, entered: { mccId: ID, capacityLitres: '2000' } as never, mcc: null, deviceRefTaken: false,
      writerIssues: [],
    } as never)).not.toThrow();
    expect(refusalsFor(bmc({ mccId: ID, capacityLitres: '2000' }, { mcc: null }), 'mccId')).toEqual(['MCC_NOT_FOUND']);
  });

  it('refuses to build a review whose reasons cannot be printed', () => {
    // The invariant itself, exercised directly — no reviewer in the file files an orphan today, so a guard left
    // private would be a guard no test can reach.
    expect(() => assertRefusalsPrintable('bmc_unit', ['mccId'], [{ field: 'mccId', code: 'MCC_NOT_FOUND' }])).not.toThrow();
    expect(() => assertRefusalsPrintable('bmc_unit', ['mccId'], [{ field: null, code: 'NO_MANAGE' }])).not.toThrow();
    expect(() => assertRefusalsPrintable('bmc_unit', ['mccId'], [{ field: 'centre', code: 'MCC_NOT_FOUND' }]))
      .toThrow(/centre\/MCC_NOT_FOUND/);
    // Both the entity and every orphan are named, because the message is what a developer debugs from.
    expect(() => assertRefusalsPrintable('mcc_centre', [], [
      { field: 'operatorReason', code: 'REASON_WITHOUT_OPERATOR' }, { field: 'x', code: 'Y' },
    ])).toThrow(/mcc_centre.*operatorReason\/REASON_WITHOUT_OPERATOR, x\/Y/);
  });

  it('gives the centre review a row for every field a refusal can name', () => {
    const r = centre({ code: 'MCC-AND-04', defaultName: 'Anand Ward 4', operatorReason: 'handover' });
    // REASON_WITHOUT_OPERATOR used to be filed against a field the review did not show at all.
    expect(refusalsFor(r, 'operatorReason')).toEqual(['REASON_WITHOUT_OPERATOR']);
    expect(r.fields.map((f) => f.name)).toContain('operatorReason');
    // And the reason is not shown as something that will be stored, because nothing will be: there is no handover.
    expect(stored(r, 'operatorReason')).toBeNull();
  });

  it('keeps a field\'s own reason instead of stacking the writer\'s vaguer one on top', () => {
    // `capacityLitres: '0'` is refused by BOTH the reviewer (CAPACITY_INVALID) and the schema (the regex allows `0`,
    // so this is the reviewer's alone) — while `1.234` is refused by both, and the review must still say the precise
    // thing. A screen that printed "invalid capacity" and "value not accepted" on one row reads as two problems.
    expect(refusalsFor(bmc({ mccId: ID, capacityLitres: '1.234' }), 'capacityLitres')).toEqual(['CAPACITY_INVALID']);
    expect(refusalsFor(centre({ code: 'C', defaultName: 'N', capacityLitresShift: '1.234' }), 'capacityLitresShift'))
      .toEqual(['CAPACITY_INVALID']);
  });

  it('refuses a tank that holds nothing, though the schema would take it', () => {
    // `\d{1,8}` accepts `0`, so this refusal is the reviewer's alone — and a cooler with zero capacity makes every
    // fill percentage on W170 a division by nothing.
    expect(refusalsFor(bmc({ mccId: ID, capacityLitres: '0' }), 'capacityLitres')).toEqual(['CAPACITY_INVALID']);
    expect(refusalsFor(bmc({ mccId: ID, capacityLitres: '0.00' }), 'capacityLitres')).toEqual(['CAPACITY_INVALID']);
    expect(refusalsFor(centre({ code: 'C', defaultName: 'N', capacityLitresShift: '0' }), 'capacityLitresShift'))
      .toEqual(['CAPACITY_INVALID']);
    expect(bmc({ mccId: ID, capacityLitres: '0.01' }).ready).toBe(true);
  });

  it('treats a field of spaces as empty, not as an entry', () => {
    // A name of three spaces is a centre with no name. `min(1)` would take it and the register would print a blank.
    const r = centre({ code: '   ', defaultName: '  ', analyzerModel: ' ' });
    expect(codes(r).sort()).toEqual(['code:CODE_REQUIRED', 'defaultName:NAME_REQUIRED']);
    // And the "you entered" column says NOTHING rather than printing invisible characters an operator cannot see or
    // correct — a row that shows a blank as an entry is a row nobody can act on.
    for (const n of ['code', 'defaultName', 'analyzerModel']) {
      expect({ n, entered: r.fields.find((f) => f.name === n)?.entered }).toEqual({ n, entered: null });
    }
  });

  it('names the clock as the problem when a clock is the problem', () => {
    // `06:00:30` is a time with seconds. Truncating it to `06:00` would store a window nobody chose; falling through to
    // the writer's vaguer *"value not accepted"* would leave an operator guessing which part is wrong.
    expect(refusalsFor(centre({ code: 'C', defaultName: 'N', morningOpensAt: '06:00:30', morningClosesAt: '09:00' }), 'morningOpensAt'))
      .toEqual(['CLOCK_INVALID']);
    // AND `06:00:00` IS REFUSED TOO, though it means the same thing. `WallClockSchema` takes `HH:MM` and nothing else,
    // so a review that normalised the seconds away would show a stored value the create route answers with a 400 —
    // the review being more permissive than the act. Found by this wave's mutation pass.
    expect(refusalsFor(centre({ code: 'C', defaultName: 'N', morningOpensAt: '06:00:00', morningClosesAt: '09:00' }), 'morningOpensAt'))
      .toEqual(['CLOCK_INVALID']);
  });

  it('prints one reason once, even when the validator complains about several fields it does not show', () => {
    // `lat`, `lng` and `regionId` are on the create schema and on NO review row — the chains do not offer them. Two
    // malformed ones must read as one general *"value not accepted"*, not as the same sentence twice: a screen that
    // repeats itself reads as two separate problems and sends somebody looking for a second thing to fix.
    const r = centre({ code: 'C', defaultName: 'N', lat: 'north', lng: 'west' });
    expect(codes(r)).toEqual(['null:VALUE_REJECTED']);
    expect(generalRefusals(r)).toEqual(['VALUE_REJECTED']);
  });

  it('refuses a shift that opens and closes at the same minute', () => {
    // A zero-length window is not a window: `ck_mcc_shift_morning` requires close > open, and an operator would be
    // told so by a constraint name instead of a sentence.
    expect(refusalsFor(centre({ code: 'C', defaultName: 'N', morningOpensAt: '06:00', morningClosesAt: '06:00' }), 'morningClosesAt'))
      .toEqual(['WINDOW_INVERTED']);
    expect(centre({ code: 'C', defaultName: 'N', morningOpensAt: '06:00', morningClosesAt: '06:01' }).ready).toBe(true);
  });

  it('reports what only the schema knows, against the field it names', () => {
    const r = bmc({ mccId: ID, capacityLitres: '2000', serialNo: 'S'.repeat(101) });
    expect(refusalsFor(r, 'serialNo')).toEqual(['TOO_LONG']);
    expect(r.ready).toBe(false);
    const c = centre({ code: 'C'.repeat(41), defaultName: 'Anand Ward 4' });
    expect(refusalsFor(c, 'code')).toEqual(['TOO_LONG']);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE REVIEW IS NOT AN ECHO                                                                               */
  /* ------------------------------------------------------------------------------------------------------- */

  it('shows the band DEFAULTS nobody typed, and the top of the band nobody can type', () => {
    const r = bmc({ mccId: ID, capacityLitres: '2000' });
    expect(stored(r, 'minTempC')).toBe('0.0');
    expect(stored(r, 'targetTempC')).toBe('4.0');
    expect(stored(r, 'toleranceC')).toBe('0.5');
    // 4.0 + 0.5 — the number a breach is judged against, computed rather than typed.
    expect(stored(r, 'bandMaxC')).toBe('4.5');
    expect(r.fields.find((f) => f.name === 'bandMaxC')?.entered).toBeNull();
    // Every default is flagged as stored-differently, because the operator typed nothing at all.
    for (const n of ['minTempC', 'targetTempC', 'toleranceC']) {
      expect({ n, normalised: r.fields.find((f) => f.name === n)?.normalised }).toEqual({ n, normalised: true });
    }
  });

  it('shows the centre it resolved, not the id that was typed', () => {
    const r = bmc({ mccId: ID, capacityLitres: '2000' });
    expect(stored(r, 'mccId')).toBe('MCC-AND-04 · Anand Ward 4');
    expect(r.fields.find((f) => f.name === 'mccId')?.entered).toBe(ID);
  });

  it('normalises a quantity by moving digits, never through a float', () => {
    expect(twoDecimals('2000')).toBe('2000.00');
    expect(twoDecimals('0.1')).toBe('0.10');
    // A float would round this. The string does not.
    expect(twoDecimals('99999999.99')).toBe('99999999.99');
    expect(() => twoDecimals('1.234')).toThrow();
    expect(stored(bmc({ mccId: ID, capacityLitres: '2000' }), 'capacityLitres')).toBe('2000.00');
  });

  it('prints a wall clock exactly as the writer will store it', () => {
    const r = centre({ code: 'C', defaultName: 'N', morningOpensAt: ' 06:00 ', morningClosesAt: '09:30' });
    expect(stored(r, 'morningOpensAt')).toBe('06:00');
    // Trimmed on the way in, so the row reads as the operator meant it — and nothing else about a clock changes,
    // because `HH:MM` is the only shape the writer accepts.
    expect(r.fields.find((f) => f.name === 'morningOpensAt')?.normalised).toBe(false);
    expect(r.fields.find((f) => f.name === 'morningClosesAt')?.normalised).toBe(false);
    expect(r.ready).toBe(true);
  });

  it('says NOTHING rather than showing an empty cell where a blank is a decision', () => {
    const r = centre({ code: 'C', defaultName: 'N' });
    // Nobody holds this centre yet, and that is a fact the review states rather than an absence it hides.
    expect(stored(r, 'operatorUserId')).toBeNull();
    expect(r.ready).toBe(true);
  });

  it('has no diff for a create — "where applicable" means there is nothing to compare', () => {
    expect(bmc({ mccId: ID, capacityLitres: '2000' }).diff).toBeNull();
    expect(centre({ code: 'C', defaultName: 'N' }).diff).toBeNull();
    expect(bmc({ mccId: ID, capacityLitres: '2000' }).entityType).toBe('bmc_unit');
    expect(centre({ code: 'C', defaultName: 'N' }).entityType).toBe('mcc_centre');
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* EVERY REFUSAL THIS WAVE CLAIMS                                                                          */
  /* ------------------------------------------------------------------------------------------------------- */

  it('reaches every BMC refusal it declares', () => {
    const seen = new Set<string>();
    const add = (r: { refusals: Array<{ code: string }> }) => r.refusals.forEach((x) => seen.add(x.code));
    add(reviewBmc({ canManage: false, entered: { mccId: ID, capacityLitres: '2000' } as never, mcc: CENTRE, deviceRefTaken: false } as never));
    add(bmc({ mccId: ID, capacityLitres: '2000' }, { mcc: null }));
    add(bmc({ mccId: ID, capacityLitres: '2000' }, { mcc: { ...CENTRE, isActive: false } }));
    add(bmc({ mccId: ID, capacityLitres: '2000', iotDeviceRef: 'dev-1' }, { deviceRefTaken: true }));
    add(bmc({ mccId: ID, capacityLitres: 'lots' }));
    add(bmc({ mccId: ID, capacityLitres: '2000', targetTempC: 'cold' }));
    add(bmc({ mccId: ID, capacityLitres: '2000', minTempC: '2.0', targetTempC: '1.0' }));
    // Only reachable because the review's own schema is the LENIENT one: `RegisterBmcSchema` forbids the minus sign.
    add(bmc({ mccId: ID, capacityLitres: '2000', toleranceC: '-0.5' }));
    add(bmc({ mccId: ID, capacityLitres: '2000', serialNo: 'S'.repeat(101) }));
    add(bmc({ mccId: ID, capacityLitres: '2000' }, { writerIssues: [{ path: 'model', tooLong: false }] }));
    expect([...BMC_REVIEW_REFUSALS].filter((c) => !seen.has(c))).toEqual([]);
  });

  it('reaches every centre refusal it declares', () => {
    const seen = new Set<string>();
    const add = (r: { refusals: Array<{ code: string }> }) => r.refusals.forEach((x) => seen.add(x.code));
    add(reviewCentre({ canManage: false, entered: { code: 'C', defaultName: 'N' } as never, codeExists: false, operatorInTenant: null } as never));
    add(centre({ code: '', defaultName: 'N' }));
    add(centre({ code: 'C', defaultName: '' }));
    add(centre({ code: 'C', defaultName: 'N' }, { codeExists: true }));
    add(centre({ code: 'C', defaultName: 'N', operatorUserId: ID }, { operatorInTenant: false }));
    add(centre({ code: 'C', defaultName: 'N', capacityLitresShift: 'lots' }));
    add(centre({ code: 'C', defaultName: 'N', morningOpensAt: '06:00' }));
    add(centre({ code: 'C', defaultName: 'N', morningOpensAt: '09:00', morningClosesAt: '06:00' }));
    add(centre({ code: 'C', defaultName: 'N', eveningOpensAt: 'evening', eveningClosesAt: '20:00' }));
    // Only reachable because the review's own schema is the LENIENT one: `CreateMccSchema` refines this away.
    add(centre({ code: 'C', defaultName: 'N', operatorReason: 'handover' }));
    add(centre({ code: 'C'.repeat(41), defaultName: 'N' }));
    add(centre({ code: 'C', defaultName: 'N' }, { writerIssues: [{ path: 'analyzerModel', tooLong: false }] }));
    expect([...CENTRE_REVIEW_REFUSALS].filter((c) => !seen.has(c))).toEqual([]);
  });

  it('carries the writer\'s two codes on both forms', () => {
    for (const c of WRITER_REFUSALS) {
      expect({ c, bmc: (BMC_REVIEW_REFUSALS as readonly string[]).includes(c) }).toEqual({ c, bmc: true });
      expect({ c, centre: (CENTRE_REVIEW_REFUSALS as readonly string[]).includes(c) }).toEqual({ c, centre: true });
    }
  });

  it('lists EVERY reason at once, not the first', () => {
    const r = centre({ code: '', defaultName: '', morningOpensAt: '06:00', capacityLitresShift: 'lots' });
    expect(codes(r).sort()).toEqual([
      'capacityLitresShift:CAPACITY_INVALID', 'code:CODE_REQUIRED', 'defaultName:NAME_REQUIRED',
      'morningClosesAt:HALF_WINDOW',
    ]);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE REVIEW'S OWN BODY                                                                                   */
  /* ------------------------------------------------------------------------------------------------------- */

  it('accepts what the create schema refuses, so the refusal can be a sentence instead of a 400', () => {
    // A code where an id belongs, a negative tolerance, a reason with nobody to be about: all four of these are 400s
    // under the create schema and reviewable answers under this one.
    expect(PreviewBmcSchema.safeParse({ mccId: 'MCC-AND-03', capacityLitres: 'lots', toleranceC: '-0.5' }).success).toBe(true);
    expect(RegisterBmcSchema.safeParse({ mccId: 'MCC-AND-03', capacityLitres: 'lots' }).success).toBe(false);
    expect(PreviewMccSchema.safeParse({ operatorReason: 'handover' }).success).toBe(true);
    expect(CreateMccSchema.safeParse({ code: 'C', defaultName: 'N', operatorReason: 'handover' }).success).toBe(false);
    // Still bounded, and still closed to keys nobody declared.
    expect(PreviewMccSchema.safeParse({ code: 'C'.repeat(401) }).success).toBe(false);
    expect(PreviewMccSchema.safeParse({ code: 'C', mystery: 'x' }).success).toBe(false);
  });

  it('asks the create schema about the values the writer would actually receive', () => {
    // Trimmed, blanks dropped — exactly what the chain's submit sends. Without this, a field the operator left EMPTY
    // would come back as rejected (`min(1)`) beside a row that correctly says it stores nothing.
    expect(submittedValues({ model: '  ', serialNo: ' S-1 ', mccId: undefined })).toEqual({ serialNo: 'S-1' });
    expect(writerIssuesOf(RegisterBmcSchema, submittedValues({ mccId: ID, capacityLitres: '2000', model: '   ' }))).toEqual([]);
    expect(writerIssuesOf(RegisterBmcSchema, { mccId: ID, capacityLitres: '2000', model: '' }))
      .toEqual([{ path: 'model', tooLong: false }]);
    expect(writerIssuesOf(RegisterBmcSchema, { mccId: ID, capacityLitres: '2000', serialNo: 'S'.repeat(101) }))
      .toEqual([{ path: 'serialNo', tooLong: true }]);
  });

  it('never hands Postgres something that cannot be an id', () => {
    expect(looksLikeId(ID)).toBe(true);
    expect(looksLikeId(ID.toUpperCase())).toBe(true);
    expect(looksLikeId('MCC-AND-03')).toBe(false);
    expect(looksLikeId('')).toBe(false);
    expect(looksLikeId(`${ID} `)).toBe(false);
  });

  /* ------------------------------------------------------------------------------------------------------- */
  /* THE ROUTES                                                                                              */
  /* ------------------------------------------------------------------------------------------------------- */

  /**
   * Declaration order WITHIN ONE VERB is what Nest matches on, so the comparison is between POSTs only: a
   * `@Get(':id')` cannot swallow a `POST preview`, and a test that lumped the verbs together would fail for a reason
   * that is not a defect — or, worse, pass while a real parameterised POST sat above it.
   */
  const postPaths = (ctor: { prototype: unknown }) => {
    const proto = ctor.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((m) => m !== 'constructor')
      .filter((m) => Reflect.getMetadata(METHOD_METADATA, proto[m] as never) === RequestMethod.POST)
      .map((m) => Reflect.getMetadata(PATH_METADATA, proto[m] as never) as string | undefined)
      .filter((p): p is string => typeof p === 'string');
  };

  it('declares preview BEFORE any parameterised POST on both controllers', () => {
    for (const [name, ctor] of [['bmc', BmcController], ['mcc', MccController]] as const) {
      const paths = postPaths(ctor as { prototype: unknown });
      expect({ name, has: paths.includes('preview') }).toEqual({ name, has: true });
      const firstParam = paths.findIndex((p) => p.includes(':'));
      expect({ name, ok: firstParam >= 0 && paths.indexOf('preview') < firstParam })
        .toEqual({ name, ok: true });
    }
  });

  /**
   * THE ACT REFUSES WHAT THE REVIEW REFUSES — found by this wave's LIVE run, which asked both the same question and
   * got different answers.
   *
   * `CreateMccSchema` refines away a reason with no operator, so the HTTP edge was covered and every unit test passed.
   * The SERVICE did not check it, and the failure was silent: the reason is only ever written onto a custody row, so a
   * reason with nobody to be about was simply dropped and the centre created anyway. A rule that lives only in a DTO is
   * a rule the next caller — a job, another service, a fixture — walks straight past.
   */
  it('refuses a custody reason with nobody to be about, in the ACT and not only in the DTO', async () => {
    const repo = {
      insert: jest.fn().mockResolvedValue(undefined),
      userHoldsRoleInTenant: jest.fn().mockResolvedValue(true),
    };
    const custody = { openNew: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => unknown) => fn()) };
    const svc = new MccCentreService(uow as never, { write: jest.fn() } as never, idem as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, repo as never, custody as never);
    await expect(svc.create('t1', { userId: 'desk', canManage: true } as never, 'k1',
      { code: 'MCC-1', defaultName: 'Vanthali', operatorReason: 'handover' } as never, null))
      .rejects.toBeInstanceOf(MccCentreInvalidError);
    // Nothing was written on the way to the refusal.
    expect(repo.insert).not.toHaveBeenCalled();
    expect(custody.openNew).not.toHaveBeenCalled();
    // And the review says the same thing, against the same field.
    expect(refusalsFor(centre({ code: 'MCC-1', defaultName: 'Vanthali', operatorReason: 'handover' }), 'operatorReason'))
      .toEqual(['REASON_WITHOUT_OPERATOR']);
  });

  it('checks the permission BEFORE it asks the database anything', () => {
    // A clerk must not be able to probe which codes or sensor references are taken. The refusal comes first, and no
    // lookup happens on the way to it.
    const repo = { codeExists: jest.fn(), userHoldsRoleInTenant: jest.fn(), getById: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const mccSvc = new MccCentreService(uow as never, { write: jest.fn() } as never, { remember: jest.fn() } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, repo as never, {} as never);
    return expect(mccSvc.previewCreate('t1', { userId: 'clerk', canManage: false } as never, { code: 'C' } as never))
      .rejects.toBeInstanceOf(DairyForbiddenError)
      .then(() => {
        expect(repo.codeExists).not.toHaveBeenCalled();
        expect(uow.run).not.toHaveBeenCalled();
      });
  });

  it('never asks the database about a value that cannot be an id', async () => {
    // `22P02` on a review is a blank error page where a sentence belongs. The lookup is skipped and the reviewer's own
    // refusal is what the operator reads.
    const repo = { codeExists: jest.fn().mockResolvedValue(false), userHoldsRoleInTenant: jest.fn().mockResolvedValue(true) };
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => fn({ query: jest.fn() })) };
    const mccSvc = new MccCentreService(uow as never, { write: jest.fn() } as never, { remember: jest.fn() } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, repo as never, {} as never);
    const r = await mccSvc.previewCreate('t1', { userId: 'desk', canManage: true } as never,
      { code: 'C', defaultName: 'N', operatorUserId: 'raju' } as never);
    expect(repo.userHoldsRoleInTenant).not.toHaveBeenCalled();
    expect(r.refusals).toEqual([{ field: 'operatorUserId', code: 'OPERATOR_NOT_IN_TENANT' }]);

    const mccRepo = { getById: jest.fn().mockResolvedValue(null) };
    const unitRepo = { byDeviceRef: jest.fn().mockResolvedValue(null) };
    const bmcSvc = new BmcUnitService(uow as never, { write: jest.fn() } as never, { remember: jest.fn() } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, { write: jest.fn() } as never, unitRepo as never, mccRepo as never);
    const b = await bmcSvc.previewRegister('t1', { userId: 'desk', canManage: true } as never,
      { mccId: 'MCC-AND-03', capacityLitres: '2000' } as never);
    expect(mccRepo.getById).not.toHaveBeenCalled();
    expect(b.refusals).toEqual([{ field: 'mccId', code: 'MCC_NOT_FOUND' }]);
  });

  it('takes no idempotency key on either preview, because a question asked twice is the same question', () => {
    // A review WRITES NOTHING, so Law 3 has nothing to protect: requiring a key would make the chain's back button
    // replay a cached answer to a question whose facts may have moved on.
    expect(MccCentreService.prototype.previewCreate.length).toBe(3);   // tenantId, actor, dto
    expect(BmcUnitService.prototype.previewRegister.length).toBe(3);
  });
});
