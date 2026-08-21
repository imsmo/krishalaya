// modules/dairy/domain/dairy-form-review.ts · PC-56 TENANT-6d-4 · the review step, as a decision rather than an echo.
//
// The canon's shared FORM pattern (B2) is four screens, and two of its sentences are the whole design:
//
//   • W2518 (review): *"Maker-checker friendly review step: everything you entered, shown read-only, with the diff
//     against current values where applicable."*
//   • W2517 (form-error): *"every invalid field is listed with its reason, values you entered are preserved, nothing
//     was saved."*
//
// **A REVIEW SCREEN BUILT FROM WHAT THE OPERATOR TYPED IS NOT A REVIEW.** It is an echo. What a maker-checker step has
// to show is what the PLATFORM will write — the values as they will be stored, normalised the way the writer
// normalises them — and every reason the write would be refused, gathered before anybody presses anything. So the
// review is computed by the same module that performs the act, from the same facts, and the refusals it lists are the
// refusals the act itself raises. A review that says "ready" and is followed by a failure screen is the defect this
// file exists to prevent.
//
// WHAT IS DELIBERATELY *NOT* HERE
//   • **No diff for a create.** *"Where applicable"* — a new cooler and a new centre have nothing to be different
//     from, and an empty before/after table implies a comparison that was not made. `diff: null` says so.
//   • **No client-side validation of a fact.** Whether a card, a code or a sensor reference is free is a question only
//     the database can answer, and asking it in the browser would answer it about a moment that has passed.
import { cOfDeci, deciOfC } from './bmc';
import { ShiftColumns, hhmm } from './mcc-console';

/* --------------------------------------------------------------------------------------------------------- */
/* THE SHAPE                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** One line of the read-only review: what was typed, and what will actually be stored. */
export interface ReviewField {
  name: string;
  /** As submitted, trimmed. Null when the operator left it empty. */
  entered: string | null;
  /**
   * As it will be STORED — normalised by the same functions the writer uses. `"4"` becomes `"4.0"`, `"06:00:00"`
   * becomes `"06:00"`, and an omitted band end becomes the default the register would apply. This column is the
   * difference between a review and an echo.
   */
  stored: string | null;
  /** True when the platform will store something other than what was typed, so the review can draw attention to it. */
  normalised: boolean;
}

/** One refusal, against a field where there is one to blame. */
export interface ReviewRefusal { field: string | null; code: string }

export interface ReviewDiffRow { field: string; before: string | null; after: string | null }

export interface ReviewResult {
  ready: boolean;
  fields: ReviewField[];
  /** EVERY refusal, not the first: a form-error screen listing one field at a time is a form nobody finishes. */
  refusals: ReviewRefusal[];
  /** Null for a create — *"where applicable"* — so an empty table never implies a comparison nobody made. */
  diff: ReviewDiffRow[] | null;
  /** What the act will be audited as, so the success screen can link to that entity's own trail. */
  entityType: string;
}

const field = (name: string, entered: string | null, stored: string | null): ReviewField => ({
  name,
  entered: entered === null || entered.trim().length === 0 ? null : entered.trim(),
  stored,
  normalised: (entered === null || entered.trim().length === 0 ? null : entered.trim()) !== stored,
});

/**
 * EVERY REFUSAL MUST BE REACHABLE.
 *
 * A refusal naming a field with no row on the review is a refusal the screen cannot print: it is not general (so it
 * does not head the page) and it belongs to no row (so it appears nowhere). The operator would read a review with no
 * reasons on it, press confirm, and land on the failure screen — precisely the defect this file exists to prevent, and
 * a silent one, because `ready` is still correctly false. This platform had two of them the first time these two
 * reviewers were written (`MCC_NOT_FOUND` filed against `mccId` while the row was called `centre`, and
 * `REASON_WITHOUT_OPERATOR` filed against a field that had no row at all).
 *
 * EXPORTED so it can be tested directly: no reviewer in this file files an orphan today, so an invariant left private
 * would be unreachable from any test — and an unreachable guard is a guard that quietly stops working.
 *
 * So the invariant is enforced where it cannot be forgotten, and it FAILS LOUD. A 500 on a review is recoverable —
 * the operator has written nothing and can be told the console is broken. A review that hides the one reason the write
 * will be refused is not: it spends somebody's afternoon and teaches them the confirm step means nothing.
 */
export function assertRefusalsPrintable(entityType: string, fieldNames: readonly string[], refusals: readonly ReviewRefusal[]): void {
  const rows = new Set(fieldNames);
  const orphans = refusals.filter((r) => r.field !== null && !rows.has(r.field));
  if (orphans.length > 0) {
    throw new Error(
      `dairy review (${entityType}): refusal(s) name fields with no review row: ${orphans.map((o) => `${o.field}/${o.code}`).join(', ')}`,
    );
  }
}

function result(entityType: string, fields: ReviewField[], refusals: ReviewRefusal[], diff: ReviewDiffRow[] | null): ReviewResult {
  assertRefusalsPrintable(entityType, fields.map((f) => f.name), refusals);
  return { ready: refusals.length === 0, fields, refusals, diff, entityType };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE WRITER WOULD REFUSE                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/** One complaint from the create schema, named by the field it is about. See `dto/dairy-form-preview.dto.ts`. */
export interface WriterIssue { path: string | null; tooLong: boolean }

/** Both forms carry these two, because both writers can refuse a value for a reason the review has no words for. */
export const WRITER_REFUSALS = ['TOO_LONG', 'VALUE_REJECTED'] as const;

/**
 * The create schema's complaints, as review refusals — and NEVER on top of a reason that already names the field.
 *
 * This is the belt that makes `ready` a promise rather than a hope: whatever the writer's validator refuses, the review
 * refuses too. But it is only the belt. `VALUE_REJECTED` is a fallback for a rule this file does not model, and
 * printing it beside a precise reason would add noise to a screen somebody is reading in a hurry — so a field that
 * already has a reason of its own keeps only that reason.
 */
function writerRefusals(issues: readonly WriterIssue[], rows: readonly string[], existing: readonly ReviewRefusal[]): ReviewRefusal[] {
  const named = new Set(existing.filter((r) => r.field !== null).map((r) => r.field as string));
  const out: ReviewRefusal[] = [];
  for (const i of issues) {
    const field = i.path !== null && rows.includes(i.path) ? i.path : null;
    if (field !== null && named.has(field)) continue;
    const code = i.tooLong ? 'TOO_LONG' : 'VALUE_REJECTED';
    if (out.some((o) => o.field === field && o.code === code)) continue;
    out.push({ field, code });
  }
  return out;
}

/* --------------------------------------------------------------------------------------------------------- */
/* ADD BMC — W2517–W2520                                                                                     */
/* --------------------------------------------------------------------------------------------------------- */

export const BMC_REVIEW_REFUSALS = [
  'NO_MANAGE', 'MCC_NOT_FOUND', 'MCC_INACTIVE', 'DEVICE_REF_TAKEN',
  'CAPACITY_INVALID', 'TEMP_INVALID', 'BAND_INVERTED', 'TOLERANCE_NEGATIVE',
  ...WRITER_REFUSALS,
] as const;
export type BmcReviewRefusal = (typeof BMC_REVIEW_REFUSALS)[number];

export interface BmcReviewInput {
  canManage: boolean;
  /** What the operator typed. Every one a raw string, because that is what a form produces. */
  entered: {
    mccId: string; capacityLitres: string;
    minTempC?: string | null; targetTempC?: string | null; toleranceC?: string | null;
    iotDeviceRef?: string | null; model?: string | null; serialNo?: string | null;
  };
  /** Facts only the database knows. */
  mcc: { code: string; name: string; isActive: boolean } | null;
  deviceRefTaken: boolean;
  /** What `RegisterBmcSchema` would say about the same body. Empty when it would accept it. */
  writerIssues?: readonly WriterIssue[];
}

/**
 * What registering this cooler will write, and every reason it would be refused.
 *
 * THE DEFAULTS ARE SHOWN AS STORED VALUES. `BmcUnitService.register` applies `0.0 / 4.0 / 0.5` when the band ends are
 * omitted — W170's own numbers — and a review that left those blank would be hiding three decisions the operator is
 * about to make on behalf of every family pouring into that tank.
 */
export function reviewBmc(i: BmcReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canManage) refusals.push({ field: null, code: 'NO_MANAGE' });
  if (i.mcc === null) refusals.push({ field: 'mccId', code: 'MCC_NOT_FOUND' });
  else if (!i.mcc.isActive) refusals.push({ field: 'mccId', code: 'MCC_INACTIVE' });
  if (i.deviceRefTaken) refusals.push({ field: 'iotDeviceRef', code: 'DEVICE_REF_TAKEN' });

  // The band, in the writer's own units. `deciOfC` is what `register` calls, so a value it rejects is a value the act
  // rejects — reported here as a field error instead of as a 422 after a confirm step.
  const band = { minDeci: null as number | null, targetDeci: null as number | null, tolDeci: null as number | null };
  const parse = (raw: string | null | undefined, fallback: string, name: string, key: 'minDeci' | 'targetDeci' | 'tolDeci') => {
    const s = raw === null || raw === undefined || raw.trim().length === 0 ? fallback : raw.trim();
    try { band[key] = deciOfC(s); } catch { refusals.push({ field: name, code: 'TEMP_INVALID' }); }
  };
  parse(i.entered.minTempC, '0.0', 'minTempC', 'minDeci');
  parse(i.entered.targetTempC, '4.0', 'targetTempC', 'targetDeci');
  parse(i.entered.toleranceC, '0.5', 'toleranceC', 'tolDeci');

  if (band.tolDeci !== null && band.tolDeci < 0) refusals.push({ field: 'toleranceC', code: 'TOLERANCE_NEGATIVE' });
  // `BmcUnit.register` asserts the band; the review says WHICH pair is wrong rather than letting the entity throw.
  if (band.minDeci !== null && band.targetDeci !== null && band.targetDeci < band.minDeci) {
    refusals.push({ field: 'targetTempC', code: 'BAND_INVERTED' });
  }

  const capacity = i.entered.capacityLitres?.trim() ?? '';
  const capacityOk = /^\d{1,8}(\.\d{1,2})?$/.test(capacity) && Number(capacity) > 0;
  if (!capacityOk) refusals.push({ field: 'capacityLitres', code: 'CAPACITY_INVALID' });

  const fields: ReviewField[] = [
    // The row is named for the FORM FIELD, not for the thing it resolves to: `MCC_NOT_FOUND` is filed against `mccId`
    // and a row called `centre` would leave that reason with nowhere to print. What it SHOWS is the resolved centre.
    field('mccId', i.entered.mccId, i.mcc === null ? null : `${i.mcc.code} · ${i.mcc.name}`),
    field('capacityLitres', capacity, capacityOk ? twoDecimals(capacity) : null),
    field('minTempC', i.entered.minTempC ?? null, band.minDeci === null ? null : cOfDeci(band.minDeci)),
    field('targetTempC', i.entered.targetTempC ?? null, band.targetDeci === null ? null : cOfDeci(band.targetDeci)),
    field('toleranceC', i.entered.toleranceC ?? null, band.tolDeci === null ? null : cOfDeci(band.tolDeci)),
    // THE BAND'S TOP, computed rather than typed — the number a breach is actually judged against, and the one an
    // operator will be phoned about. Never on the form, always on the review.
    field('bandMaxC', null, band.targetDeci === null || band.tolDeci === null ? null : cOfDeci(band.targetDeci + band.tolDeci)),
    field('iotDeviceRef', i.entered.iotDeviceRef ?? null, trimOrNull(i.entered.iotDeviceRef)),
    field('model', i.entered.model ?? null, trimOrNull(i.entered.model)),
    field('serialNo', i.entered.serialNo ?? null, trimOrNull(i.entered.serialNo)),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));
  // A CREATE HAS NOTHING TO DIFF. W2518 says "where applicable".
  return result('bmc_unit', fields, refusals, null);
}

/* --------------------------------------------------------------------------------------------------------- */
/* ADD CENTRE — W2555–W2558                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

export const CENTRE_REVIEW_REFUSALS = [
  'NO_MANAGE', 'CODE_REQUIRED', 'NAME_REQUIRED', 'CODE_EXISTS', 'OPERATOR_NOT_IN_TENANT',
  'CAPACITY_INVALID', 'HALF_WINDOW', 'WINDOW_INVERTED', 'CLOCK_INVALID', 'REASON_WITHOUT_OPERATOR',
  ...WRITER_REFUSALS,
] as const;
export type CentreReviewRefusal = (typeof CENTRE_REVIEW_REFUSALS)[number];

export interface CentreReviewInput {
  canManage: boolean;
  entered: {
    code: string; defaultName: string;
    capacityLitresShift?: string | null; analyzerModel?: string | null; analyzerSerial?: string | null;
    operatorUserId?: string | null; operatorReason?: string | null;
  } & Partial<Record<keyof ShiftColumns, string | null>>;
  codeExists: boolean;
  /** Null when no operator was named; false when the named one holds no active role in this cooperative. */
  operatorInTenant: boolean | null;
  /** What `CreateMccSchema` would say about the same body. Empty when it would accept it. */
  writerIssues?: readonly WriterIssue[];
}

/**
 * What creating this centre will write, and every reason it would be refused.
 *
 * The two rules worth stating on a review rather than discovering afterwards: an operator who is not of this
 * cooperative cannot be given custody of its milk (TENANT-6d-2's gate, checked here so the refusal names the person),
 * and a shift window is both ends or neither (`ck_mcc_shift_*`, checked here so the refusal names the field).
 */
export function reviewCentre(i: CentreReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canManage) refusals.push({ field: null, code: 'NO_MANAGE' });

  const code = (i.entered.code ?? '').trim();
  const name = (i.entered.defaultName ?? '').trim();
  if (code.length === 0) refusals.push({ field: 'code', code: 'CODE_REQUIRED' });
  if (name.length === 0) refusals.push({ field: 'defaultName', code: 'NAME_REQUIRED' });
  if (i.codeExists) refusals.push({ field: 'code', code: 'CODE_EXISTS' });
  if (i.operatorInTenant === false) refusals.push({ field: 'operatorUserId', code: 'OPERATOR_NOT_IN_TENANT' });
  if ((i.entered.operatorReason ?? '').trim().length > 0 && trimOrNull(i.entered.operatorUserId) === null) {
    refusals.push({ field: 'operatorReason', code: 'REASON_WITHOUT_OPERATOR' });
  }

  const capacity = (i.entered.capacityLitresShift ?? '').trim();
  let capacityStored: string | null = null;
  if (capacity.length > 0) {
    if (/^\d{1,8}(\.\d{1,2})?$/.test(capacity) && Number(capacity) > 0) capacityStored = twoDecimals(capacity);
    else refusals.push({ field: 'capacityLitresShift', code: 'CAPACITY_INVALID' });
  }

  // EXACTLY AS STRICT AS THE WRITER. `WallClockSchema` accepts `HH:MM` and nothing else, so a review that quietly
  // normalised `06:00:00` to `06:00` would show a stored value the create route then refuses with a 400 — the review
  // being MORE permissive than the act, which is the one direction this file is not allowed to be. `hhmm` still does
  // the judging (whole minutes, a real time of day); the shape is checked first so the reason names the clock rather
  // than falling through to the writer's vaguer *"value not accepted"*.
  const clock = (raw: string | null | undefined, name_: string): string | null => {
    const s = (raw ?? '').trim();
    if (s.length === 0) return null;
    try {
      if (s.length !== 5) throw new Error(`dairy review: a shift boundary is HH:MM, not ${JSON.stringify(s)}`);
      return hhmm(`${s}:00`);
    } catch { refusals.push({ field: name_, code: 'CLOCK_INVALID' }); return null; }
  };
  const mo = clock(i.entered.morningOpensAt, 'morningOpensAt');
  const mc = clock(i.entered.morningClosesAt, 'morningClosesAt');
  const eo = clock(i.entered.eveningOpensAt, 'eveningOpensAt');
  const ec = clock(i.entered.eveningClosesAt, 'eveningClosesAt');
  const pair = (o: string | null, c: string | null, rawO: string | null | undefined, rawC: string | null | undefined, closeField: string) => {
    const gaveO = (rawO ?? '').trim().length > 0;
    const gaveC = (rawC ?? '').trim().length > 0;
    if (gaveO !== gaveC) { refusals.push({ field: closeField, code: 'HALF_WINDOW' }); return; }
    if (o !== null && c !== null && c <= o) refusals.push({ field: closeField, code: 'WINDOW_INVERTED' });
  };
  pair(mo, mc, i.entered.morningOpensAt, i.entered.morningClosesAt, 'morningClosesAt');
  pair(eo, ec, i.entered.eveningOpensAt, i.entered.eveningClosesAt, 'eveningClosesAt');

  const operator = trimOrNull(i.entered.operatorUserId);
  const fields: ReviewField[] = [
    field('code', code, code.length > 0 ? code : null),
    field('defaultName', name, name.length > 0 ? name : null),
    field('capacityLitresShift', capacity, capacityStored),
    field('analyzerModel', i.entered.analyzerModel ?? null, trimOrNull(i.entered.analyzerModel)),
    field('analyzerSerial', i.entered.analyzerSerial ?? null, trimOrNull(i.entered.analyzerSerial)),
    // NOBODY, spelled out. TENANT-6d-2 stopped defaulting this to the caller, and a review that showed an empty cell
    // would hide the decision the blank field actually makes: this centre's milk is nobody's responsibility yet.
    field('operatorUserId', operator, operator),
    // WHY, on its own row. `create` stores the reason on the custody row rather than on the centre, and it is the only
    // field here whose refusal (`REASON_WITHOUT_OPERATOR`) is about what it was typed BESIDE.
    field('operatorReason', i.entered.operatorReason ?? null, operator === null ? null : trimOrNull(i.entered.operatorReason)),
    field('morningOpensAt', i.entered.morningOpensAt ?? null, mo),
    field('morningClosesAt', i.entered.morningClosesAt ?? null, mc),
    field('eveningOpensAt', i.entered.eveningOpensAt ?? null, eo),
    field('eveningClosesAt', i.entered.eveningClosesAt ?? null, ec),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));
  return result('mcc_centre', fields, refusals, null);
}

/* --------------------------------------------------------------------------------------------------------- */
/* HELPERS                                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

function trimOrNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

/**
 * `"2000"` → `"2000.00"`, by STRING.
 *
 * `numeric(10,2)` is what comes back out of the column, and a review that showed `2000` beside a stored `2000.00`
 * would flag a normalisation that did not happen — or hide one that did. No float: the digits are moved, not scaled.
 */
export function twoDecimals(s: string): string {
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) throw new Error(`dairy review: not a two-decimal quantity: ${JSON.stringify(s)}`);
  return `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}`;
}

/** Does this review's refusal list contain a reason against a given field? The form-error screen's own question. */
export function refusalsFor(r: ReviewResult, fieldName: string): string[] {
  return r.refusals.filter((x) => x.field === fieldName).map((x) => x.code);
}

/** The refusals that belong to no field — a permission, a flag. They head the form-error screen rather than a row. */
export function generalRefusals(r: ReviewResult): string[] {
  return r.refusals.filter((x) => x.field === null).map((x) => x.code);
}
