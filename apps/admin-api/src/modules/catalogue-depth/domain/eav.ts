// apps/admin-api/src/modules/catalogue-depth/domain/eav.ts · rules for the EAV DEFINITION plane
// (PC-56 ADMIN-3, canon W020's bindings tab, W024, W025, W026, W027). No I/O → unit-provable.
//
// GOLDEN LAW 9, WHICH THE CANON STATES ON W026 AND AGAIN ON W027: "attributes are DESCRIPTIVE ONLY — they never drive
// money or state logic". That is the single most important thing in this file and it cannot be enforced by a CHECK
// constraint, because it is a rule about MEANING. What CAN be enforced is everything that would make breaking it easy:
// a `validation` blob that smuggles pricing keys, a data_type change on an attribute that 61,204 listings already carry,
// a unit on a boolean.
//
// FIVE RULES, EACH PROTECTING SOMETHING THAT IS ALREADY IN THE DATABASE:
//   1. `code` IS IMMUTABLE ONCE BOUND. The canon says so on W027 ("immutable after first binding") and it is not
//      cosmetic: listing values are stored against the definition, and renaming the code orphans them silently.
//   2. A data_type CHANGE ON A BOUND ATTRIBUTE IS CHECKER-GATED. Turning `moisture_pct` from decimal to text does not
//      migrate 61,204 stored decimals — it re-interprets them, and the re-interpretation is invisible.
//   3. VALIDATION MUST MATCH THE TYPE, AND MUST NOT CONTAIN MONEY. `{"min":0,"max":100}` on a date is nonsense;
//      `{"price":...}` on anything is Law 9 being broken in a jsonb column where no reviewer would look.
//   4. A UNIT ONLY BELONGS ON A NUMERIC TYPE. "11.5 %" is a measurement. "true %" is not.
//   5. TIGHTENING A BOUND RANGE IS A SEPARATE, NAMED ACT. The canon's W027 shows exactly this — max 100 → 40, "would
//      flag 212 existing listings for re-check" — so the domain reports it rather than letting it pass as an edit.
import { InvalidAttributeError, InvalidUnitError } from './catalogue-depth.errors';

/* ------------------------------------------------------------------ data types */

/** Mirrors 0004's CHECK on attribute_definitions.data_type, in the canon's own order (W027's select). */
export const DATA_TYPES = ['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file'] as const;
export type DataType = (typeof DATA_TYPES)[number];
export function isDataType(v: string): v is DataType {
  return (DATA_TYPES as readonly string[]).includes(v);
}

/** Types that carry a NUMBER, and are therefore the only ones a unit or a min/max can mean anything for. */
const NUMERIC_TYPES = new Set<DataType>(['number', 'decimal', 'range']);
export function isNumericType(t: DataType): boolean { return NUMERIC_TYPES.has(t); }

/** Types whose values come from `attribute_options` rather than free input. */
const OPTION_TYPES = new Set<DataType>(['option', 'multi_option']);
export function usesOptions(t: DataType): boolean { return OPTION_TYPES.has(t); }

/** Unit classes, mirroring the set the existing catalogue-depth zod schema already accepts. `units.unit_class` has no DB
 *  CHECK, so this list is the only thing standing between the registry and a unit class of "bananas". */
export const UNIT_CLASSES = ['mass', 'volume', 'count', 'area', 'time', 'length'] as const;
export type UnitClass = (typeof UNIT_CLASSES)[number];
export function isUnitClass(v: string): v is UnitClass {
  return (UNIT_CLASSES as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ validation jsonb */

/** Keys `validation` may contain, per type. Anything else is refused — see `assertValidation` for why an allow-list
 *  rather than a deny-list. */
const ALLOWED_VALIDATION_KEYS: Readonly<Record<DataType, readonly string[]>> = Object.freeze({
  text: ['minLength', 'maxLength', 'pattern'],
  number: ['min', 'max', 'step'],
  decimal: ['min', 'max', 'step'],
  range: ['min', 'max', 'step'],
  bool: [],
  date: ['min', 'max'],
  option: ['multiple'],
  multi_option: ['minSelected', 'maxSelected'],
  file: ['maxSizeKb', 'mimeTypes'],
});

/**
 * KEYS THAT MEAN MONEY OR STATE. Golden Law 9 says an attribute never drives either, and a jsonb column is exactly where
 * that law would be broken without anybody noticing — `{"min":0,"max":100,"priceMultiplier":1.2}` reads like validation
 * and is a pricing rule. Refused by name so the error can SAY so.
 */
const FORBIDDEN_VALIDATION_KEYS = [
  'price', 'priceMultiplier', 'fee', 'commission', 'amount', 'minor', 'currency', 'discount', 'tax', 'gst',
  'status', 'state', 'transition', 'workflow', 'approve', 'blocks',
] as const;

export const MAX_VALIDATION_KEYS = 12;

/**
 * Parse and check a `validation` blob for a given type.
 *
 * AN ALLOW-LIST, NOT A DENY-LIST. A deny-list of money words would be bypassed by the first person who writes
 * `{"rate": 1.2}`; an allow-list means an unrecognised key is refused whatever it is called, and the forbidden list
 * exists only so the MESSAGE can name Law 9 when somebody trips over it. Belt and braces, in that order.
 */
export function assertValidation(raw: string | null | undefined, type: DataType): Record<string, unknown> {
  const text = String(raw ?? '').trim();
  if (!text || text === '{}') return {};

  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new InvalidAttributeError('validation must be valid JSON — nothing was saved, fix the syntax and retry'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidAttributeError('validation must be a JSON object, e.g. {"min":0,"max":100}');
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > MAX_VALIDATION_KEYS) {
    throw new InvalidAttributeError(`validation has more than ${MAX_VALIDATION_KEYS} keys — a rule that complex belongs in code, not in a jsonb column`);
  }

  // Law 9 first, so its message wins over the generic allow-list message.
  const forbidden = keys.find((k) => (FORBIDDEN_VALIDATION_KEYS as readonly string[]).includes(k));
  if (forbidden) {
    throw new InvalidAttributeError(
      `validation may not contain "${forbidden}": an attribute describes produce and never sets a price, fee or state (Golden Law 9). Anything money or state belongs in a real column.`);
  }

  const allowed = ALLOWED_VALIDATION_KEYS[type];
  const stray = keys.find((k) => !allowed.includes(k));
  if (stray) {
    throw new InvalidAttributeError(
      allowed.length === 0
        ? `a ${type} attribute takes no validation keys, but got "${stray}"`
        : `"${stray}" is not a validation key for a ${type} attribute — allowed: ${allowed.join(', ')}`);
  }

  // Numeric bounds must be numbers AND ordered. min > max is a rule no listing can ever satisfy, which means every
  // create silently fails validation later rather than here.
  if (isNumericType(type) || type === 'number') {
    for (const k of ['min', 'max', 'step']) {
      if (k in obj && typeof obj[k] !== 'number') {
        throw new InvalidAttributeError(`validation.${k} must be a number for a ${type} attribute`);
      }
    }
    const min = obj.min as number | undefined;
    const max = obj.max as number | undefined;
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      throw new InvalidAttributeError('validation.min cannot be greater than validation.max — no value could ever satisfy it');
    }
    const step = obj.step as number | undefined;
    if (typeof step === 'number' && step <= 0) {
      throw new InvalidAttributeError('validation.step must be greater than zero');
    }
  }
  return obj;
}

/* ------------------------------------------------------------------ attribute definitions */

const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;

export interface AttributeInput {
  code: string; defaultName: string; dataType: string; unitCode?: string | null; validation?: string | null;
}
export interface Attribute {
  code: string; defaultName: string; dataType: DataType; unitCode: string | null; validation: Record<string, unknown>;
}

/** Validate a NEW attribute definition. */
export function assertAttribute(input: AttributeInput): Attribute {
  const code = String(input.code ?? '').trim().toLowerCase();
  if (!CODE_RE.test(code)) {
    throw new InvalidAttributeError('code must be lower_snake_case, start with a letter, and be 2–64 characters — it appears in APIs and cannot be renamed once bound');
  }
  const defaultName = String(input.defaultName ?? '').trim();
  if (defaultName.length < 2 || defaultName.length > 150) {
    throw new InvalidAttributeError('defaultName must be 2–150 characters');
  }
  const dataType = String(input.dataType ?? '').trim();
  if (!isDataType(dataType)) throw new InvalidAttributeError(`dataType must be one of ${DATA_TYPES.join('|')}`);

  const unitCode = String(input.unitCode ?? '').trim() || null;
  // RULE 4. A unit on a boolean or a date is not a stricter definition, it is a meaningless one — and it would render on
  // the farmer's form as a suffix beside a checkbox.
  if (unitCode && !isNumericType(dataType)) {
    throw new InvalidAttributeError(`a ${dataType} attribute cannot carry a unit — only ${[...NUMERIC_TYPES].join(', ')} attributes measure anything`);
  }
  const validation = assertValidation(input.validation, dataType);
  return { code, defaultName, dataType, unitCode, validation };
}

/** What an EDIT may touch, and what it may never touch. */
export interface AttributeEditInput {
  defaultName?: string | null; dataType?: string | null; unitCode?: string | null; validation?: string | null;
}
export interface AttributeEdit {
  defaultName?: string; dataType?: DataType; unitCode?: string | null; validation?: Record<string, unknown>;
  /** True when this edit needs a checker because it re-interprets data that already exists. */
  needsChecker: boolean;
  /** Human-readable reasons the edit is consequential — surfaced to the operator BEFORE they submit. */
  consequences: string[];
}

/**
 * Validate an edit against the attribute's CURRENT state and its binding count.
 *
 * `boundCount` is why this function takes the existing row: rules 1, 2 and 5 all depend on whether anything already uses
 * the attribute. An unbound attribute is a draft and may be freely changed; a bound one describes 61,204 listings.
 */
export function assertAttributeEdit(
  input: AttributeEditInput,
  current: { code: string; dataType: DataType; unitCode: string | null; validation: Record<string, unknown> },
  boundCount: number,
): AttributeEdit {
  const out: AttributeEdit = { needsChecker: false, consequences: [] };
  const bound = boundCount > 0;

  if (input.defaultName !== undefined && input.defaultName !== null) {
    const defaultName = String(input.defaultName).trim();
    if (defaultName.length < 2 || defaultName.length > 150) throw new InvalidAttributeError('defaultName must be 2–150 characters');
    out.defaultName = defaultName;
    // renaming the DISPLAY name is safe — it is the code that is load-bearing, and translations override it anyway
  }

  const nextType: DataType = input.dataType ? (() => {
    const t = String(input.dataType).trim();
    if (!isDataType(t)) throw new InvalidAttributeError(`dataType must be one of ${DATA_TYPES.join('|')}`);
    return t;
  })() : current.dataType;

  if (input.dataType && nextType !== current.dataType) {
    // RULE 2. The stored values are NOT migrated by this edit; they are re-read under a different type.
    if (bound) {
      out.needsChecker = true;
      out.consequences.push(
        `changing the type from ${current.dataType} to ${nextType} re-interprets every value already stored against this attribute on ${boundCount} bound categor${boundCount === 1 ? 'y' : 'ies'} — the values are not converted`);
    }
    out.dataType = nextType;
  }

  if (input.unitCode !== undefined) {
    const unitCode = String(input.unitCode ?? '').trim() || null;
    if (unitCode && !isNumericType(nextType)) {
      throw new InvalidAttributeError(`a ${nextType} attribute cannot carry a unit`);
    }
    if (unitCode !== current.unitCode) {
      out.unitCode = unitCode;
      if (bound) {
        // a unit change does not rescale anything either: 11.5 stays 11.5 and now means a different quantity
        out.needsChecker = true;
        out.consequences.push(
          `changing the unit from ${current.unitCode ?? 'none'} to ${unitCode ?? 'none'} does NOT rescale stored values — a recorded 11.5 will simply mean something else`);
      }
    }
  }

  if (input.validation !== undefined && input.validation !== null) {
    const validation = assertValidation(input.validation, nextType);
    const tightened = tightenedBounds(current.validation, validation);
    if (tightened.length > 0 && bound) {
      // RULE 5. The canon's own example: max 100 → 40 "would flag 212 existing listings for re-check".
      out.needsChecker = true;
      for (const t of tightened) out.consequences.push(t);
    }
    out.validation = validation;
  }

  return out;
}

/**
 * Which bounds got STRICTER. Only tightening matters: loosening a range cannot invalidate a value that already passed,
 * whereas tightening can invalidate thousands, and nothing in the system re-checks them at edit time.
 */
export function tightenedBounds(
  before: Record<string, unknown>, after: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const bMin = num(before.min); const aMin = num(after.min);
  const bMax = num(before.max); const aMax = num(after.max);
  if (aMin !== undefined && (bMin === undefined || aMin > bMin)) {
    out.push(`the minimum rises from ${bMin ?? 'unbounded'} to ${aMin} — existing values below it stay stored but will fail the next edit`);
  }
  if (aMax !== undefined && (bMax === undefined || aMax < bMax)) {
    out.push(`the maximum falls from ${bMax ?? 'unbounded'} to ${aMax} — existing values above it stay stored but will fail the next edit`);
  }
  const bLen = num(before.maxLength); const aLen = num(after.maxLength);
  if (aLen !== undefined && (bLen === undefined || aLen < bLen)) {
    out.push(`the maximum length falls from ${bLen ?? 'unbounded'} to ${aLen}`);
  }
  return out;
}

/** RULE 1, as its own function so the refusal is greppable. Nothing in this module ever produces a new `code`. */
export function codeIsImmutable(): true { return true; }

/* ------------------------------------------------------------------ options */

export interface OptionInput {
  code: string; defaultName: string; sortOrder?: string | number | null; categoryId?: string | null;
}
export interface Option { code: string; defaultName: string; sortOrder: number; categoryId: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DEFAULT_SORT = 100;

/** Validate one option value. `categoryId` narrows it to a branch (0102's DELTA-009 closure); null keeps it global. */
export function assertOption(input: OptionInput, attributeType: DataType): Option {
  // options only mean anything for a type that draws from them — otherwise they are rows nothing will ever read
  if (!usesOptions(attributeType)) {
    throw new InvalidAttributeError(`a ${attributeType} attribute takes free input, so it has no options — only ${[...OPTION_TYPES].join(' and ')} attributes do`);
  }
  const code = String(input.code ?? '').trim().toLowerCase();
  if (!CODE_RE.test(code)) throw new InvalidAttributeError('option code must be lower_snake_case, 2–64 characters');
  const defaultName = String(input.defaultName ?? '').trim();
  if (defaultName.length < 1 || defaultName.length > 150) throw new InvalidAttributeError('option name must be 1–150 characters');

  const sortRaw = String(input.sortOrder ?? '').trim();
  let sortOrder = DEFAULT_SORT;
  if (sortRaw) {
    if (!/^\d{1,5}$/.test(sortRaw)) throw new InvalidAttributeError('sort order must be a whole number');
    sortOrder = Number(sortRaw);
    if (sortOrder > 32767) throw new InvalidAttributeError('sort order must be 0–32767');
  }
  const categoryId = UUID_RE.test(String(input.categoryId ?? '')) ? String(input.categoryId) : null;
  return { code, defaultName, sortOrder, categoryId };
}

/* ------------------------------------------------------------------ bindings (W020's tab) */

export interface BindingInput {
  attributeId: string; isRequired?: boolean; showInFilters?: boolean; showOnCard?: boolean;
  condition?: string | null; sortOrder?: string | number | null;
}
export interface Binding {
  attributeId: string; isRequired: boolean; showInFilters: boolean; showOnCard: boolean;
  condition: Record<string, unknown> | null; sortOrder: number;
}

/**
 * Validate a category→attribute binding.
 *
 * THE CONDITION IS THE DANGEROUS FIELD. The canon shows a real one on W020:
 *   {"if":{"organic":true},"then":{"required":["cert_body","cert_no"]}}
 * That is a validation rule, and it is one short step from being a state machine in a jsonb column. So the shape is
 * constrained to exactly if/then, `then` may only require OTHER ATTRIBUTES, and nothing in it may name money or state —
 * the same Law 9 guard the validation blob gets.
 */
export function assertBinding(input: BindingInput): Binding {
  if (!UUID_RE.test(String(input.attributeId ?? ''))) throw new InvalidAttributeError('attributeId must be a uuid');

  const sortRaw = String(input.sortOrder ?? '').trim();
  let sortOrder = DEFAULT_SORT;
  if (sortRaw) {
    if (!/^\d{1,5}$/.test(sortRaw)) throw new InvalidAttributeError('sort order must be a whole number');
    sortOrder = Math.min(Number(sortRaw), 32767);
  }

  const isRequired = input.isRequired === true;
  const showInFilters = input.showInFilters === true;
  const showOnCard = input.showOnCard === true;
  const condition = assertCondition(input.condition);

  // A REQUIRED CONDITIONAL BINDING IS A CONTRADICTION. "always required" and "required only if organic" cannot both be
  // true, and the listing form would have to pick one — silently.
  if (isRequired && condition) {
    throw new InvalidAttributeError('a binding cannot be both always-required and conditional — drop the condition, or make it optional and let the condition require it');
  }
  return { attributeId: input.attributeId, isRequired, showInFilters, showOnCard, condition, sortOrder };
}

/** The condition blob. Null when absent. */
export function assertCondition(raw: string | null | undefined): Record<string, unknown> | null {
  const text = String(raw ?? '').trim();
  if (!text || text === '{}') return null;

  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new InvalidAttributeError('condition must be valid JSON — nothing was saved'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InvalidAttributeError('condition must be a JSON object of the form {"if":{...},"then":{"required":[...]}}');
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  if (keys.length !== 2 || keys[0] !== 'if' || keys[1] !== 'then') {
    throw new InvalidAttributeError('condition must have exactly two keys, "if" and "then"');
  }
  const iff = obj.if; const then = obj.then;
  if (!iff || typeof iff !== 'object' || Array.isArray(iff) || Object.keys(iff).length === 0) {
    throw new InvalidAttributeError('condition.if must be a non-empty object, e.g. {"organic":true}');
  }
  if (!then || typeof then !== 'object' || Array.isArray(then)) {
    throw new InvalidAttributeError('condition.then must be an object');
  }
  const thenKeys = Object.keys(then as Record<string, unknown>);
  // `required` ONLY. A `then` that could set a value, a price or a status would be Law 9 broken in the one field
  // nobody reads — and it would do it during listing validation, where there is no audit trail at all.
  if (thenKeys.length !== 1 || thenKeys[0] !== 'required') {
    throw new InvalidAttributeError('condition.then may only contain "required" — a condition can ask for more information and can never set a value, a price or a state (Golden Law 9)');
  }
  const req = (then as Record<string, unknown>).required;
  if (!Array.isArray(req) || req.length === 0 || !req.every((x) => typeof x === 'string' && CODE_RE.test(x))) {
    throw new InvalidAttributeError('condition.then.required must be a non-empty array of attribute codes');
  }
  for (const k of Object.keys(iff as Record<string, unknown>)) {
    if ((FORBIDDEN_VALIDATION_KEYS as readonly string[]).includes(k)) {
      throw new InvalidAttributeError(`condition.if may not test "${k}" — an attribute never reads money or state (Golden Law 9)`);
    }
  }
  return obj;
}

/* ------------------------------------------------------------------ units */

export interface UnitInput { code: string; defaultName: string; unitClass: string }
export interface Unit { code: string; defaultName: string; unitClass: UnitClass }

const UNIT_CODE_RE = /^[a-z][a-z0-9_]{0,19}$/;

export function assertUnit(input: UnitInput): Unit {
  const code = String(input.code ?? '').trim().toLowerCase();
  if (!UNIT_CODE_RE.test(code)) throw new InvalidUnitError('unit code must be lower_snake_case, 1–20 characters');
  const defaultName = String(input.defaultName ?? '').trim();
  if (defaultName.length < 1 || defaultName.length > 60) throw new InvalidUnitError('unit name must be 1–60 characters');
  const unitClass = String(input.unitClass ?? '').trim();
  if (!isUnitClass(unitClass)) throw new InvalidUnitError(`unit class must be one of ${UNIT_CLASSES.join('|')}`);
  return { code, defaultName, unitClass };
}

export interface ConversionInput { fromUnit: string; toUnit: string; factor: string | number }
export interface Conversion { fromUnit: string; toUnit: string; factor: string }

/** The maximum factor the numeric(20,10) column can hold without overflowing. */
const MAX_FACTOR = 1e9;

/**
 * Validate a conversion factor.
 *
 * THE FACTOR IS THE MOST CONSEQUENTIAL NUMBER IN THIS DOMAIN — the canon says so on W025 and it is right: it multiplies
 * every quoted quantity on the platform, and "bigha" genuinely differs by state (Gujarat 2.5/acre, UP about 1.6). The
 * factor is therefore kept as a STRING all the way to the database, never parsed to a float: 0.4 is not representable in
 * binary floating point, and a round-trip through a JS number is a silent change to somebody's quantity. Same reasoning
 * as Law 2 for money, applied to quantities for the same reason.
 */
export function assertConversion(input: ConversionInput): Conversion {
  const fromUnit = String(input.fromUnit ?? '').trim().toLowerCase();
  const toUnit = String(input.toUnit ?? '').trim().toLowerCase();
  if (!UNIT_CODE_RE.test(fromUnit) || !UNIT_CODE_RE.test(toUnit)) {
    throw new InvalidUnitError('both units must be valid unit codes');
  }
  const raw = String(input.factor ?? '').trim();
  // digits with at most 10 decimal places — the column is numeric(20,10) and silently rounding an eleventh place would
  // change a factor somebody typed deliberately
  if (!/^\d{1,10}(\.\d{1,10})?$/.test(raw)) {
    throw new InvalidUnitError('factor must be a positive decimal with at most 10 decimal places');
  }
  const asNumber = Number(raw);
  if (!(asNumber > 0)) throw new InvalidUnitError('factor must be greater than zero — a zero factor turns every quantity into nothing');
  if (asNumber > MAX_FACTOR) throw new InvalidUnitError('factor is too large');
  if (fromUnit === toUnit && asNumber !== 1) {
    throw new InvalidUnitError(`a conversion from ${fromUnit} to itself must be exactly 1`);
  }
  return { fromUnit, toUnit, factor: raw };
}

/**
 * Does a set of conversions contain a pair that disagrees with itself? `quintal→kg = 100` and `kg→quintal = 0.02` are
 * both plausible in isolation and cannot both be true. Reported rather than refused, because the inverse may legitimately
 * be absent and rounding makes exact reciprocity impossible at ten decimal places.
 */
export function inconsistentPairs(
  rows: ReadonlyArray<{ fromUnit: string; toUnit: string; factor: string }>,
  tolerance = 1e-6,
): Array<{ fromUnit: string; toUnit: string; factor: string; inverseFactor: string; expected: string }> {
  const byPair = new Map(rows.map((r) => [`${r.fromUnit}|${r.toUnit}`, r]));
  const out: Array<{ fromUnit: string; toUnit: string; factor: string; inverseFactor: string; expected: string }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const inv = byPair.get(`${r.toUnit}|${r.fromUnit}`);
    if (!inv) continue;
    const key = [`${r.fromUnit}|${r.toUnit}`, `${r.toUnit}|${r.fromUnit}`].sort().join('~');
    if (seen.has(key)) continue;
    seen.add(key);
    const f = Number(r.factor); const g = Number(inv.factor);
    if (!(f > 0) || !(g > 0)) continue;
    const expected = 1 / f;
    if (Math.abs(g - expected) / expected > tolerance) {
      out.push({ fromUnit: r.fromUnit, toUnit: r.toUnit, factor: r.factor, inverseFactor: inv.factor, expected: String(expected) });
    }
  }
  return out;
}
