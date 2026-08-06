// apps/web-admin/src/test/admin3-eav.spec.ts · PC-56 ADMIN-3, console side.
//
// The RULES are admin-api's — Golden Law 9's guards in particular must stay server-side, because a browser check is
// advice and that one is a law. What this file protects is the two things the CONSOLE can break on its own:
//
//   1. THE FACTOR. It arrives as a string from an API that deliberately kept it a string, and the console's only job is
//      not to undo that. `factorText` must never parse; `factorForDisplay` may trim trailing zeros only because that
//      cannot change the value. A single Number() anywhere in this chain turns 0.4 into 0.4000000000000000222.
//   2. THE INHERITED BINDING. An inherited row belongs to an ancestor category. Offering an edit for it here would write
//      to a category the operator never visited, and the audit row would name that other category.
import {
  DATA_TYPES, UNIT_CLASSES, isNumericType, usesOptions,
  factorText, factorForDisplay, bindingIsEditableHere, splitBindings,
  unitIsMissing, validationSummary, isUnfillable,
  buildAttribute, buildAttributeEdit, buildOption, buildBinding, buildUnit, buildConversion, buildSetActive,
  MIN_REASON, type BindingRow,
} from '../features/catalogue/eav';

const UUID = '11111111-1111-4111-8111-111111111111';
const REASON = 'operator gave a real reason here';
const bag = (o: Record<string, string>) => (n: string) => o[n] ?? '';

describe('vocabularies mirror the server', () => {
  it('lists the same nine data types and six unit classes', () => {
    expect([...DATA_TYPES]).toEqual(['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file']);
    expect([...UNIT_CLASSES]).toEqual(['mass', 'volume', 'count', 'area', 'time', 'length']);
    expect(isNumericType('decimal')).toBe(true);
    expect(isNumericType('bool')).toBe(false);
    expect(usesOptions('multi_option')).toBe(true);
    expect(usesOptions('text')).toBe(false);
  });
});

describe('THE FACTOR IS NEVER PARSED', () => {
  it('returns the API string byte for byte', () => {
    // 0.4 is not representable in binary floating point; a round trip through Number would change somebody's quantity
    expect(factorText('2.5000000000')).toBe('2.5000000000');
    expect(factorText('0.4000000000')).toBe('0.4000000000');
    expect(factorText('1000.0000000000')).toBe('1000.0000000000');
    expect(factorText('0.0000000001')).toBe('0.0000000001');
  });

  it('returns null for a missing factor rather than "0"', () => {
    // "0" would read as a real conversion that turns every quantity into nothing
    expect(factorText(null)).toBeNull();
    expect(factorText(undefined)).toBeNull();
    expect(factorText('   ')).toBeNull();
  });

  it('trims trailing zeros FOR DISPLAY ONLY, and only where that cannot change the value', () => {
    expect(factorForDisplay('2.5000000000')).toBe('2.5');
    expect(factorForDisplay('0.4000000000')).toBe('0.4');
    expect(factorForDisplay('100')).toBe('100');
    expect(factorForDisplay('1000.0000000000')).toBe('1000');
    // and a value that is all zeros after the point does not become empty
    expect(factorForDisplay('1.0000000000')).toBe('1');
    expect(factorForDisplay('0.0000000000')).toBe('0');
  });

  it('never introduces float noise, however many places the factor carries', () => {
    for (const f of ['0.1', '0.2', '0.3', '0.7', '1.1', '2.675', '0.1234567891']) {
      expect(factorForDisplay(f)).toBe(f);
      // the giveaway of a Number() round trip
      expect(factorForDisplay(f)).not.toMatch(/0000000[0-9]|9999999/);
    }
  });

  it('NEVER RENDERS SCIENTIFIC NOTATION for a tiny factor', () => {
    // MUTATION TESTING FOUND THIS GAP. Every value above survives a double round trip, so a mutant that formatted the
    // factor with String(Number(...)) passed the whole suite. These are the values where it diverges:
    //   String(Number('0.0000000001')) === '1e-10'
    //   String(Number('0.0000001000')) === '1e-7'
    // A factor shown as "1e-10" is unreadable to the operator, and a form re-submitting it would be REJECTED by the
    // API's own decimal regex — so a display bug becomes an edit that cannot be saved.
    expect(factorForDisplay('0.0000000001')).toBe('0.0000000001');
    expect(factorForDisplay('0.0000001000')).toBe('0.0000001');
    expect(factorForDisplay('0.0000000001')).not.toContain('e');
    expect(factorForDisplay('0.0000001000')).not.toContain('e');
  });

  it('NEVER DROPS DIGITS from a factor wider than a double can hold', () => {
    // the same mutant, the other end of the range: a double keeps ~17 significant digits, and this value has 20.
    //   String(Number('1234567890.1234567891')) === '1234567890.1234567'  — four digits silently gone
    // The API accepts 10 before the point and 10 after, so this is a value an operator can legitimately type.
    expect(factorForDisplay('1234567890.1234567891')).toBe('1234567890.1234567891');
    expect(factorForDisplay('9999999999.9999999999')).toBe('9999999999.9999999999');
  });

  it('leaves an integer untouched', () => {
    expect(factorForDisplay('100')).toBe('100');
    expect(factorForDisplay('1')).toBe('1');
  });
});

describe('buildConversion — validated as TEXT, sent as TEXT', () => {
  const base = { fromUnit: 'quintal', toUnit: 'kg', factor: '100', reason: REASON };

  it('passes the factor through unchanged and lower-cases the codes', () => {
    const r = buildConversion(bag({ ...base, fromUnit: 'QUINTAL', factor: '2.5000000000' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.factor).toBe('2.5000000000');
    expect(typeof r.value.factor).toBe('string');
    expect(r.value.fromUnit).toBe('quintal');
  });

  it('refuses a zero factor with its own error, not a generic one', () => {
    expect(buildConversion(bag({ ...base, factor: '0' }))).toEqual({ ok: false, error: 'factorZero' });
    expect(buildConversion(bag({ ...base, factor: '0.0000000000' }))).toEqual({ ok: false, error: 'factorZero' });
  });

  it('refuses a self-conversion that is not exactly 1', () => {
    expect(buildConversion(bag({ ...base, fromUnit: 'kg', toUnit: 'kg', factor: '2.2' })))
      .toEqual({ ok: false, error: 'factorReflexive' });
    expect(buildConversion(bag({ ...base, fromUnit: 'kg', toUnit: 'kg', factor: '1' })).ok).toBe(true);
  });

  it('refuses more precision than the column holds rather than rounding it away', () => {
    expect(buildConversion(bag({ ...base, factor: '1.00000000001' }))).toEqual({ ok: false, error: 'factor' });
    expect(buildConversion(bag({ ...base, factor: '1.0000000001' })).ok).toBe(true);
  });

  it('refuses junk and a missing reason', () => {
    expect(buildConversion(bag({ ...base, factor: 'one hundred' }))).toEqual({ ok: false, error: 'factor' });
    expect(buildConversion(bag({ ...base, factor: '-1' }))).toEqual({ ok: false, error: 'factor' });
    expect(buildConversion(bag({ ...base, fromUnit: '' }))).toEqual({ ok: false, error: 'unitCode' });
    expect(buildConversion(bag({ ...base, reason: 'fix' }))).toEqual({ ok: false, error: 'reason' });
  });
});

describe('inherited bindings offer no edit', () => {
  const b = (over: Partial<BindingRow> = {}): BindingRow => ({
    id: 'b1', categoryId: 'c1', attributeId: UUID, attributeCode: 'variety', attributeName: 'Variety',
    dataType: 'option', isRequired: false, showInFilters: false, showOnCard: false, sortOrder: 100,
    isLocal: true, editableHere: true, ...over,
  });

  it('trusts the server\'s editableHere when it is present', () => {
    expect(bindingIsEditableHere(b({ editableHere: true }))).toBe(true);
    expect(bindingIsEditableHere(b({ editableHere: false }))).toBe(false);
  });

  it('falls back to isLocal for a payload without the flag', () => {
    expect(bindingIsEditableHere({ isLocal: true })).toBe(true);
    expect(bindingIsEditableHere({ isLocal: false })).toBe(false);
    // and an ambiguous payload is NOT editable — the safe default, because the cost of guessing wrong is an edit
    // silently written to a different category
    expect(bindingIsEditableHere({})).toBe(false);
  });

  it('splits a table into what this category owns and what it inherits', () => {
    const rows = [
      b({ id: 'local1' }),
      b({ id: 'inherited1', isLocal: false, editableHere: false, source: 'inherited: crops' }),
      b({ id: 'local2' }),
      b({ id: 'inherited2', isLocal: false, editableHere: false, source: 'inherited: crops.cereals' }),
    ];
    const out = splitBindings(rows);
    expect(out.local.map((r) => r.id)).toEqual(['local1', 'local2']);
    expect(out.inherited.map((r) => r.id)).toEqual(['inherited1', 'inherited2']);
  });

  it('reports an all-inherited category as having nothing to edit here', () => {
    const rows = [b({ isLocal: false, editableHere: false })];
    expect(splitBindings(rows).local).toEqual([]);
  });
});

describe('reading helpers state facts rather than guessing', () => {
  it('flags a numeric attribute with no unit — it measures nothing', () => {
    expect(unitIsMissing({ dataType: 'decimal', unitCode: null })).toBe(true);
    expect(unitIsMissing({ dataType: 'number', unitCode: '' })).toBe(true);
    expect(unitIsMissing({ dataType: 'decimal', unitCode: '%' })).toBe(false);
    // a text attribute with no unit is correct, not missing one
    expect(unitIsMissing({ dataType: 'text', unitCode: null })).toBe(false);
    expect(unitIsMissing({ dataType: 'bool', unitCode: null })).toBe(false);
  });

  it('flags an option attribute with no options as unfillable', () => {
    expect(isUnfillable({ dataType: 'option', optionCount: 0 })).toBe(true);
    expect(isUnfillable({ dataType: 'multi_option', optionCount: undefined })).toBe(true);
    expect(isUnfillable({ dataType: 'option', optionCount: 4 })).toBe(false);
    // a decimal has no option list and is not unfillable for lacking one
    expect(isUnfillable({ dataType: 'decimal', optionCount: 0 })).toBe(false);
  });

  it('renders no validation as NULL, never as "{}"', () => {
    // "{}" on screen reads as a rule; the absence of one is a different fact
    expect(validationSummary({})).toBeNull();
    expect(validationSummary(null)).toBeNull();
    expect(validationSummary(undefined)).toBeNull();
    expect(validationSummary({ min: 0, max: 100 })).toBe('{"min":0,"max":100}');
  });
});

describe('buildAttribute', () => {
  const base = { code: 'moisture_pct', defaultName: 'Moisture', dataType: 'decimal', unitCode: '%', reason: REASON };

  it('accepts a definition and normalises the code', () => {
    const r = buildAttribute(bag({ ...base, code: 'Moisture_Pct', validation: '{"min":0}' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ code: 'moisture_pct', dataType: 'decimal', unitCode: '%', validation: '{"min":0}' });
  });

  it('OMITS validation when blank rather than sending an empty string', () => {
    const r = buildAttribute(bag(base));
    expect(r.ok && 'validation' in r.value).toBe(false);
  });

  it('refuses a unit on a non-numeric type — the form should not have offered the select', () => {
    expect(buildAttribute(bag({ ...base, dataType: 'bool' }))).toEqual({ ok: false, error: 'unitOnNonNumeric' });
  });

  it('refuses a bad code, a thin name, an unlisted type and a thin reason', () => {
    expect(buildAttribute(bag({ ...base, code: 'Moisture Pct' }))).toEqual({ ok: false, error: 'code' });
    expect(buildAttribute(bag({ ...base, defaultName: 'M' }))).toEqual({ ok: false, error: 'name' });
    expect(buildAttribute(bag({ ...base, dataType: 'money' }))).toEqual({ ok: false, error: 'dataType' });
    expect(buildAttribute(bag({ ...base, reason: 'a'.repeat(MIN_REASON - 1) }))).toEqual({ ok: false, error: 'reason' });
  });
});

describe('buildAttributeEdit — sends only what changed', () => {
  const current = { defaultName: 'Moisture', dataType: 'decimal', unitCode: '%', validation: { min: 0, max: 100 } };

  it('OMITS an untouched field, so the audit row cannot claim a change that did not happen', () => {
    const r = buildAttributeEdit(bag({
      defaultName: 'Moisture', dataType: 'decimal', unitCode: '%',
      validation: '{"min":0,"max":100}', reason: REASON,
    }), current);
    // nothing changed at all — refused rather than sent as an empty PATCH with a reason
    expect(r).toEqual({ ok: false, error: 'noChange' });
  });

  it('sends exactly the one field that moved', () => {
    const r = buildAttributeEdit(bag({
      defaultName: 'Moisture', dataType: 'decimal', unitCode: '%',
      validation: '{"min":0,"max":40}', reason: REASON,
    }), current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value).sort()).toEqual(['reason', 'validation']);
    expect(r.value.validation).toBe('{"min":0,"max":40}');
  });

  it('carries the acknowledgement only when the form ticked it', () => {
    const without = buildAttributeEdit(bag({ dataType: 'text', reason: REASON }), current);
    expect(without.ok && 'acknowledgeConsequences' in without.value).toBe(false);
    const with_ = buildAttributeEdit(bag({ dataType: 'text', reason: REASON, acknowledgeConsequences: 'true' }), current);
    expect(with_.ok && with_.value.acknowledgeConsequences).toBe(true);
  });

  it('clears a unit when the field is emptied', () => {
    const r = buildAttributeEdit(bag({ unitCode: '', reason: REASON }), current);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.unitCode).toBeNull();
  });

  it('refuses a unit that the new type cannot carry', () => {
    expect(buildAttributeEdit(bag({ dataType: 'bool', unitCode: 'kg', reason: REASON }), current))
      .toEqual({ ok: false, error: 'unitOnNonNumeric' });
  });

  it('always requires a reason, whatever changed', () => {
    expect(buildAttributeEdit(bag({ dataType: 'text' }), current)).toEqual({ ok: false, error: 'reason' });
  });
});

describe('buildBinding', () => {
  it('accepts a plain binding with the flags off', () => {
    const r = buildBinding(bag({ attributeId: UUID, reason: REASON }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ attributeId: UUID, isRequired: false, showInFilters: false, showOnCard: false });
  });

  it('reads a checkbox\'s "on" as true', () => {
    const r = buildBinding(bag({ attributeId: UUID, isRequired: 'on', showInFilters: 'on', reason: REASON }));
    expect(r.ok && r.value.isRequired).toBe(true);
    expect(r.ok && r.value.showInFilters).toBe(true);
    expect(r.ok && r.value.showOnCard).toBe(false);
  });

  it('refuses required AND conditional before the round trip, so typing is not lost', () => {
    expect(buildBinding(bag({
      attributeId: UUID, isRequired: 'on',
      condition: '{"if":{"organic":true},"then":{"required":["cert_no"]}}', reason: REASON,
    }))).toEqual({ ok: false, error: 'requiredAndConditional' });
  });

  it('treats {} as no condition, so an empty textarea is not a rule', () => {
    const r = buildBinding(bag({ attributeId: UUID, isRequired: 'on', condition: '{}', reason: REASON }));
    expect(r.ok).toBe(true);
    if (r.ok) expect('condition' in r.value).toBe(false);
  });

  it('refuses a binding to nothing and a bad sort order', () => {
    expect(buildBinding(bag({ attributeId: 'variety', reason: REASON }))).toEqual({ ok: false, error: 'attribute' });
    expect(buildBinding(bag({ attributeId: UUID, sortOrder: '99999', reason: REASON }))).toEqual({ ok: false, error: 'sortOrder' });
  });
});

describe('buildOption and buildUnit and buildSetActive', () => {
  it('builds an option, omitting the scope when it is global', () => {
    const r = buildOption(bag({ code: 'lokwan', defaultName: 'Lokwan', reason: REASON }));
    expect(r.ok).toBe(true);
    if (r.ok) expect('categoryId' in r.value).toBe(false);
  });

  it('narrows an option when given a real category id and refuses a bad one', () => {
    expect(buildOption(bag({ code: 'lokwan', defaultName: 'L', categoryId: UUID, reason: REASON }))).toMatchObject({ ok: true });
    expect(buildOption(bag({ code: 'lokwan', defaultName: 'L', categoryId: 'wheat', reason: REASON })))
      .toEqual({ ok: false, error: 'categoryId' });
  });

  it('builds a unit and refuses an invented class', () => {
    expect(buildUnit(bag({ code: 'QUINTAL', defaultName: 'Quintal', unitClass: 'mass', reason: REASON })))
      .toMatchObject({ ok: true, value: { code: 'quintal' } });
    expect(buildUnit(bag({ code: 'kg', defaultName: 'K', unitClass: 'weight', reason: REASON })))
      .toEqual({ ok: false, error: 'unitClass' });
  });

  it('requires an explicit true/false for an activation, never a truthy guess', () => {
    expect(buildSetActive(bag({ isActive: 'true', reason: REASON }))).toEqual({ ok: true, value: { isActive: true, reason: REASON } });
    expect(buildSetActive(bag({ isActive: 'false', reason: REASON }))).toEqual({ ok: true, value: { isActive: false, reason: REASON } });
    expect(buildSetActive(bag({ isActive: 'on', reason: REASON }))).toEqual({ ok: false, error: 'isActive' });
    expect(buildSetActive(bag({ isActive: '', reason: REASON }))).toEqual({ ok: false, error: 'isActive' });
  });

  it('demands a reason on every one of them', () => {
    expect(buildOption(bag({ code: 'a_b', defaultName: 'A' }))).toEqual({ ok: false, error: 'reason' });
    expect(buildUnit(bag({ code: 'kg', defaultName: 'K', unitClass: 'mass' }))).toEqual({ ok: false, error: 'reason' });
    expect(buildSetActive(bag({ isActive: 'true' }))).toEqual({ ok: false, error: 'reason' });
  });
});
