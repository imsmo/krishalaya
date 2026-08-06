// apps/web-admin/src/features/catalogue/eav.ts · the EAV definition plane, console side
// (PC-56 ADMIN-3, canon W020's bindings tab, W024, W025, W026, W027).
//
// The RULES live in admin-api's `domain/eav.ts` and are not duplicated here — the same split as every wave since
// ADMIN-2b, for the same reason: two copies of a rule become one copy of the rule and one copy of last quarter's rule.
// Golden Law 9's guards in particular MUST stay server-side, because a browser check is advice and this one is a law.
//
// What lives here is form SHAPE and the reading helpers that decide what a screen may claim. Two of those are the point
// of the file:
//   • `factorText` NEVER parses the factor. It arrives as a string from an API that kept it a string on purpose, and the
//     console's job is to render it unchanged — formatting it through a Number would undo the whole chain.
//   • `bindingIsEditableHere` distinguishes a category's OWN bindings from the ones it inherits. The canon shows both in
//     one table (W020's Source column), and an inherited row must not offer an edit that would silently write to a
//     different category.

export const DATA_TYPES = ['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file'] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const UNIT_CLASSES = ['mass', 'volume', 'count', 'area', 'time', 'length'] as const;
export type UnitClass = (typeof UNIT_CLASSES)[number];

/** Types that measure something, and therefore the only ones a unit belongs on. Mirrored so the form can hide the unit
 *  select rather than offering one the server will refuse. */
const NUMERIC = new Set<string>(['number', 'decimal', 'range']);
export function isNumericType(t: string): boolean { return NUMERIC.has(t); }

const OPTIONED = new Set<string>(['option', 'multi_option']);
export function usesOptions(t: string): boolean { return OPTIONED.has(t); }

export const MIN_REASON = 10;

/* ------------------------------------------------------------------ read models */

export interface AttributeRow {
  id: string; code: string; defaultName: string; dataType: string;
  unitCode?: string | null; validation?: Record<string, unknown>; isActive: boolean;
  boundTo?: number; optionCount?: number; unitMissing?: boolean;
}
export interface OptionRow {
  id: string; code: string; defaultName: string; sortOrder: number; isActive: boolean;
  categoryId?: string | null; categoryCode?: string | null; scope?: string;
}
export interface BindingRow {
  id: string; categoryId: string; attributeId: string; attributeCode: string; attributeName: string;
  dataType: string; unitCode?: string | null;
  isRequired: boolean; showInFilters: boolean; showOnCard: boolean;
  condition?: Record<string, unknown> | null; sortOrder: number;
  isLocal?: boolean; source?: string; editableHere?: boolean;
}
export interface UnitRow { code: string; defaultName: string; unitClass: string; isActive: boolean; usedByAttrs?: number }
export interface ConversionRow { fromUnit: string; toUnit: string; factor: string; unitClass?: string }

/* ------------------------------------------------------------------ reading */

/**
 * The factor, EXACTLY as the API sent it. No Number(), no toFixed, no locale formatting.
 *
 * numeric(20,10) does not survive a round trip through a JS float — 0.4 becomes 0.4000000000000000222… — and this number
 * multiplies every quoted quantity on the platform. The API keeps it a string for that reason and the console's only job
 * is not to undo it. Returns null for a missing factor rather than "0", which would read as a real conversion.
 */
export function factorText(factor: string | null | undefined): string | null {
  const s = String(factor ?? '').trim();
  return s.length > 0 ? s : null;
}

/** Trailing zeros trimmed FOR DISPLAY ONLY, and only when that cannot change the value. "2.5000000000" reads as noise
 *  in a table; "2.5" is the same number. The untrimmed string is what any form re-submits. */
export function factorForDisplay(factor: string | null | undefined): string | null {
  const s = factorText(factor);
  if (s === null) return null;
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

/** An inherited binding belongs to an ancestor category and is edited THERE. Offering an edit here would write to a
 *  different category than the one the operator is looking at. */
export function bindingIsEditableHere(b: Pick<BindingRow, 'isLocal' | 'editableHere'>): boolean {
  if (typeof b.editableHere === 'boolean') return b.editableHere;
  return b.isLocal === true;
}

/** Bindings split into this category's own and the ones it inherits — the canon renders both in one table with a Source
 *  column, and the counts belong in the footer. */
export function splitBindings(rows: readonly BindingRow[]): { local: BindingRow[]; inherited: BindingRow[] } {
  return {
    local: rows.filter((b) => bindingIsEditableHere(b)),
    inherited: rows.filter((b) => !bindingIsEditableHere(b)),
  };
}

/** A numeric attribute with no unit measures nothing — the canon flags it "unit missing" on W026. Computed here as well
 *  as served, so a screen can flag it even on a payload from an older API. */
export function unitIsMissing(a: Pick<AttributeRow, 'dataType' | 'unitCode'>): boolean {
  return isNumericType(a.dataType) && !a.unitCode;
}

/** Validation rendered as the compact string the canon shows in its table ({"min":0,"max":100}), or null when empty —
 *  never "{}", which reads as a rule rather than the absence of one. */
export function validationSummary(v: Record<string, unknown> | null | undefined): string | null {
  if (!v || Object.keys(v).length === 0) return null;
  return JSON.stringify(v);
}

/** A required option-attribute with no options is an unfillable form. Flagged BEFORE somebody binds it. */
export function isUnfillable(a: Pick<AttributeRow, 'dataType' | 'optionCount'>): boolean {
  return usesOptions(a.dataType) && Number(a.optionCount ?? 0) === 0;
}

/* ------------------------------------------------------------------ forms */

export type FormBag = (name: string) => string;
export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;
const UNIT_CODE_RE = /^[a-z][a-z0-9_]{0,19}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reason(get: FormBag): string | null {
  const r = get('reason').trim();
  return r.length >= MIN_REASON && r.length <= 1000 ? r : null;
}

export interface AttributePayload {
  code: string; defaultName: string; dataType: string; unitCode?: string | null; validation?: string; reason: string;
}

export function buildAttribute(get: FormBag): Built<AttributePayload> {
  const code = get('code').trim().toLowerCase();
  if (!CODE_RE.test(code)) return { ok: false, error: 'code' };
  const defaultName = get('defaultName').trim();
  if (defaultName.length < 2 || defaultName.length > 150) return { ok: false, error: 'name' };
  const dataType = get('dataType').trim();
  if (!(DATA_TYPES as readonly string[]).includes(dataType)) return { ok: false, error: 'dataType' };
  const unitCode = get('unitCode').trim() || null;
  // refused here as well as server-side, because the form should not have offered the select at all
  if (unitCode && !isNumericType(dataType)) return { ok: false, error: 'unitOnNonNumeric' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  const validation = get('validation').trim();
  return { ok: true, value: { code, defaultName, dataType, unitCode, ...(validation ? { validation } : {}), reason: r } };
}

export interface AttributeEditPayload {
  defaultName?: string; dataType?: string; unitCode?: string | null; validation?: string;
  acknowledgeConsequences?: boolean; reason: string;
}

/** An edit sends only what changed. `current` is passed so an untouched field is OMITTED rather than re-sent — a PATCH
 *  echoing every field back makes the audit row claim a change that did not happen. */
export function buildAttributeEdit(
  get: FormBag,
  current: Pick<AttributeRow, 'defaultName' | 'dataType' | 'unitCode' | 'validation'>,
): Built<AttributeEditPayload> {
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  const out: AttributeEditPayload = { reason: r };

  const defaultName = get('defaultName').trim();
  if (defaultName && defaultName !== current.defaultName) {
    if (defaultName.length < 2 || defaultName.length > 150) return { ok: false, error: 'name' };
    out.defaultName = defaultName;
  }
  const dataType = get('dataType').trim();
  if (dataType && dataType !== current.dataType) {
    if (!(DATA_TYPES as readonly string[]).includes(dataType)) return { ok: false, error: 'dataType' };
    out.dataType = dataType;
  }
  const nextType = out.dataType ?? current.dataType;
  const unitRaw = get('unitCode');
  if (unitRaw !== '' || current.unitCode) {
    const unitCode = unitRaw.trim() || null;
    if (unitCode !== (current.unitCode ?? null)) {
      if (unitCode && !isNumericType(nextType)) return { ok: false, error: 'unitOnNonNumeric' };
      out.unitCode = unitCode;
    }
  }
  const validation = get('validation').trim();
  const currentValidation = validationSummary(current.validation) ?? '';
  if (validation !== currentValidation) out.validation = validation;

  if (get('acknowledgeConsequences').trim() === 'true') out.acknowledgeConsequences = true;

  // a PATCH with nothing but a reason is a no-op that would still write an audit row saying something changed
  const touched = Object.keys(out).filter((k) => k !== 'reason' && k !== 'acknowledgeConsequences');
  if (touched.length === 0) return { ok: false, error: 'noChange' };
  return { ok: true, value: out };
}

export interface OptionPayload { code: string; defaultName: string; sortOrder?: number; categoryId?: string | null; reason: string }

export function buildOption(get: FormBag): Built<OptionPayload> {
  const code = get('code').trim().toLowerCase();
  if (!CODE_RE.test(code)) return { ok: false, error: 'code' };
  const defaultName = get('defaultName').trim();
  if (defaultName.length < 1 || defaultName.length > 150) return { ok: false, error: 'name' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  const out: OptionPayload = { code, defaultName, reason: r };
  const sortRaw = get('sortOrder').trim();
  if (sortRaw) {
    if (!/^\d{1,5}$/.test(sortRaw) || Number(sortRaw) > 32767) return { ok: false, error: 'sortOrder' };
    out.sortOrder = Number(sortRaw);
  }
  const categoryId = get('categoryId').trim();
  if (categoryId) {
    if (!UUID_RE.test(categoryId)) return { ok: false, error: 'categoryId' };
    out.categoryId = categoryId;
  }
  return { ok: true, value: out };
}

export interface BindingPayload {
  attributeId: string; isRequired: boolean; showInFilters: boolean; showOnCard: boolean;
  condition?: string | null; sortOrder?: number; reason: string;
}

export function buildBinding(get: FormBag): Built<BindingPayload> {
  const attributeId = get('attributeId').trim();
  if (!UUID_RE.test(attributeId)) return { ok: false, error: 'attribute' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  const isRequired = get('isRequired') === 'on' || get('isRequired') === 'true';
  const condition = get('condition').trim();
  // the contradiction the server also refuses — caught here so the operator does not lose their typing
  if (isRequired && condition && condition !== '{}') return { ok: false, error: 'requiredAndConditional' };
  const out: BindingPayload = {
    attributeId, isRequired,
    showInFilters: get('showInFilters') === 'on' || get('showInFilters') === 'true',
    showOnCard: get('showOnCard') === 'on' || get('showOnCard') === 'true',
    reason: r,
  };
  if (condition && condition !== '{}') out.condition = condition;
  const sortRaw = get('sortOrder').trim();
  if (sortRaw) {
    if (!/^\d{1,5}$/.test(sortRaw) || Number(sortRaw) > 32767) return { ok: false, error: 'sortOrder' };
    out.sortOrder = Number(sortRaw);
  }
  return { ok: true, value: out };
}

export interface UnitPayload { code: string; defaultName: string; unitClass: string; reason: string }

export function buildUnit(get: FormBag): Built<UnitPayload> {
  const code = get('code').trim().toLowerCase();
  if (!UNIT_CODE_RE.test(code)) return { ok: false, error: 'unitCode' };
  const defaultName = get('defaultName').trim();
  if (defaultName.length < 1 || defaultName.length > 60) return { ok: false, error: 'name' };
  const unitClass = get('unitClass').trim();
  if (!(UNIT_CLASSES as readonly string[]).includes(unitClass)) return { ok: false, error: 'unitClass' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { code, defaultName, unitClass, reason: r } };
}

export interface ConversionPayload { fromUnit: string; toUnit: string; factor: string; reason: string }

/** The factor is validated as TEXT and sent as TEXT. Never Number(). */
export function buildConversion(get: FormBag): Built<ConversionPayload> {
  const fromUnit = get('fromUnit').trim().toLowerCase();
  const toUnit = get('toUnit').trim().toLowerCase();
  if (!UNIT_CODE_RE.test(fromUnit) || !UNIT_CODE_RE.test(toUnit)) return { ok: false, error: 'unitCode' };
  const factor = get('factor').trim();
  if (!/^\d{1,10}(\.\d{1,10})?$/.test(factor)) return { ok: false, error: 'factor' };
  if (!(Number(factor) > 0)) return { ok: false, error: 'factorZero' };
  if (fromUnit === toUnit && Number(factor) !== 1) return { ok: false, error: 'factorReflexive' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { fromUnit, toUnit, factor, reason: r } };
}

export interface SetActivePayload { isActive: boolean; reason: string }

export function buildSetActive(get: FormBag): Built<SetActivePayload> {
  const raw = get('isActive').trim();
  if (raw !== 'true' && raw !== 'false') return { ok: false, error: 'isActive' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { isActive: raw === 'true', reason: r } };
}
