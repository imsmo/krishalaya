// apps/admin-api/src/modules/catalogue-depth/__tests__/admin3-eav.spec.ts · PC-56 ADMIN-3.
//
// GOLDEN LAW 9 CANNOT BE ENFORCED BY A CONSTRAINT, because it is a rule about MEANING: "attributes are descriptive only
// — they never drive money or state logic". What CAN be tested is every route by which breaking it would be easy, and
// the most inviting one is a jsonb column nobody reads. `{"min":0,"max":100,"priceMultiplier":1.2}` looks like
// validation and is a pricing rule.
//
// The other half of this file is about a NUMBER: the unit conversion factor. It multiplies every quoted quantity on the
// platform, 0.4 is not representable in binary floating point, and a bigha genuinely differs by state. So the factor is
// asserted to survive as a STRING, exactly as typed.
import {
  DATA_TYPES, isDataType, isNumericType, usesOptions, UNIT_CLASSES, isUnitClass,
  assertValidation, assertAttribute, assertAttributeEdit, tightenedBounds,
  assertOption, assertBinding, assertCondition, assertUnit, assertConversion, inconsistentPairs,
  MAX_VALIDATION_KEYS, DEFAULT_SORT,
} from '../domain/eav';
import { InvalidAttributeError, InvalidUnitError } from '../domain/catalogue-depth.errors';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('the vocabularies mirror the migrations', () => {
  it('lists 0004\'s nine data types in the canon\'s order', () => {
    expect([...DATA_TYPES]).toEqual(['text', 'number', 'decimal', 'bool', 'date', 'option', 'multi_option', 'range', 'file']);
    expect(isDataType('decimal')).toBe(true);
    expect(isDataType('money')).toBe(false);
  });

  it('knows which types carry a number and which draw from options', () => {
    expect(['number', 'decimal', 'range'].every(isNumericType as any)).toBe(true);
    expect(['text', 'bool', 'date', 'option', 'file'].some(isNumericType as any)).toBe(false);
    expect(usesOptions('option')).toBe(true);
    expect(usesOptions('multi_option')).toBe(true);
    expect(usesOptions('text')).toBe(false);
  });

  it('lists the six unit classes', () => {
    expect([...UNIT_CLASSES]).toEqual(['mass', 'volume', 'count', 'area', 'time', 'length']);
    expect(isUnitClass('mass')).toBe(true);
    expect(isUnitClass('bananas')).toBe(false);
  });
});

describe('GOLDEN LAW 9 — validation may never smuggle money or state', () => {
  it.each([
    'price', 'priceMultiplier', 'fee', 'commission', 'amount', 'minor', 'currency', 'discount', 'tax', 'gst',
    'status', 'state', 'transition', 'workflow', 'approve', 'blocks',
  ])('refuses a validation key of "%s" and NAMES Law 9', (key) => {
    expect(() => assertValidation(`{"min":0,"max":100,"${key}":1}`, 'decimal'))
      .toThrow(/never sets a price, fee or state \(Golden Law 9\)/);
  });

  it('is an ALLOW-LIST, so an unrecognised key is refused whatever it is called', () => {
    // a deny-list of money words would be bypassed by the first person who writes {"rate": 1.2}
    expect(() => assertValidation('{"rate":1.2}', 'decimal')).toThrow(/is not a validation key/);
    expect(() => assertValidation('{"multiplier":2}', 'decimal')).toThrow(/is not a validation key/);
    expect(() => assertValidation('{"onApprove":"x"}', 'text')).toThrow(/is not a validation key/);
  });

  it('accepts the keys each type legitimately takes', () => {
    expect(assertValidation('{"min":0,"max":100,"step":0.1}', 'decimal')).toEqual({ min: 0, max: 100, step: 0.1 });
    expect(assertValidation('{"minLength":2,"maxLength":40,"pattern":"^[A-Z]"}', 'text')).toMatchObject({ minLength: 2 });
    expect(assertValidation('{"max":"today"}', 'date')).toEqual({ max: 'today' });
    expect(assertValidation('{"maxSizeKb":2048}', 'file')).toEqual({ maxSizeKb: 2048 });
    expect(assertValidation('{"minSelected":1,"maxSelected":3}', 'multi_option')).toMatchObject({ minSelected: 1 });
  });

  it('refuses validation keys on a type that takes none', () => {
    expect(() => assertValidation('{"min":0}', 'bool')).toThrow(/a bool attribute takes no validation keys/);
  });

  it('refuses a key belonging to a DIFFERENT type', () => {
    // minLength on a decimal is not a stricter rule, it is a rule nothing will ever apply
    expect(() => assertValidation('{"minLength":2}', 'decimal')).toThrow(/not a validation key for a decimal/);
    expect(() => assertValidation('{"step":1}', 'date')).toThrow(/not a validation key for a date/);
  });

  it('treats empty and {} as no validation at all', () => {
    expect(assertValidation('', 'decimal')).toEqual({});
    expect(assertValidation('  ', 'decimal')).toEqual({});
    expect(assertValidation('{}', 'decimal')).toEqual({});
    expect(assertValidation(null, 'decimal')).toEqual({});
    expect(assertValidation(undefined, 'text')).toEqual({});
  });

  it('refuses malformed JSON with a message saying nothing was saved', () => {
    expect(() => assertValidation('{"min": 0,}', 'decimal')).toThrow(/valid JSON — nothing was saved/);
    expect(() => assertValidation('[0,100]', 'decimal')).toThrow(/must be a JSON object/);
    expect(() => assertValidation('null', 'decimal')).toThrow(/must be a JSON object/);
    expect(() => assertValidation('"min"', 'decimal')).toThrow(/must be a JSON object/);
  });

  it('refuses arithmetic nobody could satisfy', () => {
    expect(() => assertValidation('{"min":100,"max":0}', 'decimal')).toThrow(/min cannot be greater than/);
    expect(() => assertValidation('{"step":0}', 'decimal')).toThrow(/step must be greater than zero/);
    expect(() => assertValidation('{"step":-1}', 'decimal')).toThrow(/step must be greater than zero/);
    expect(() => assertValidation('{"min":"0"}', 'decimal')).toThrow(/must be a number/);
  });

  it('refuses a rule too complex to belong in a jsonb column', () => {
    const many = JSON.stringify(Object.fromEntries(Array.from({ length: MAX_VALIDATION_KEYS + 1 }, (_, i) => [`k${i}`, i])));
    expect(() => assertValidation(many, 'decimal')).toThrow(/belongs in code, not in a jsonb column/);
  });
});

describe('assertAttribute', () => {
  const base = { code: 'moisture_pct', defaultName: 'Moisture', dataType: 'decimal', unitCode: '%', validation: '{"min":0,"max":100}' };

  it('accepts a real definition and lower-cases the code', () => {
    const a = assertAttribute({ ...base, code: 'Moisture_Pct' });
    expect(a).toEqual({ code: 'moisture_pct', defaultName: 'Moisture', dataType: 'decimal', unitCode: '%', validation: { min: 0, max: 100 } });
  });

  it('demands a code that can safely live in an API forever', () => {
    // it cannot be renamed once bound, so a bad one is permanent
    for (const bad of ['Moisture Pct', 'moisture-pct', '1st_grade', 'x', '', 'a'.repeat(65)]) {
      expect(() => assertAttribute({ ...base, code: bad })).toThrow(/lower_snake_case/);
    }
  });

  it('REFUSES A UNIT ON A NON-NUMERIC TYPE — "true %" is not a measurement', () => {
    expect(() => assertAttribute({ ...base, dataType: 'bool', validation: null })).toThrow(/cannot carry a unit/);
    expect(() => assertAttribute({ ...base, dataType: 'date', validation: null })).toThrow(/cannot carry a unit/);
    expect(() => assertAttribute({ ...base, dataType: 'option', validation: null })).toThrow(/only number, decimal, range/);
    // and accepts one with no unit
    expect(assertAttribute({ ...base, dataType: 'bool', unitCode: null, validation: null }).unitCode).toBeNull();
  });

  it('treats a blank unit as no unit rather than as an empty code', () => {
    expect(assertAttribute({ ...base, unitCode: '   ' }).unitCode).toBeNull();
  });
});

describe('assertAttributeEdit — the checker gate', () => {
  const current = { code: 'moisture_pct', dataType: 'decimal' as const, unitCode: '%', validation: { min: 0, max: 100 } };

  it('lets an UNBOUND attribute be retyped freely — a draft is not a promise', () => {
    const e = assertAttributeEdit({ dataType: 'text' }, current, 0);
    expect(e.needsChecker).toBe(false);
    expect(e.consequences).toEqual([]);
    expect(e.dataType).toBe('text');
  });

  it('DEMANDS A CHECKER to retype a BOUND attribute, and says what the change actually does', () => {
    const e = assertAttributeEdit({ dataType: 'text' }, current, 89);
    expect(e.needsChecker).toBe(true);
    // the consequence must say the values are NOT converted — that is the part nobody expects
    expect(e.consequences.join(' ')).toMatch(/re-interprets every value already stored/);
    expect(e.consequences.join(' ')).toContain('89');
    expect(e.consequences.join(' ')).toMatch(/not converted/);
  });

  it('demands a checker to change the UNIT of a bound attribute, because 11.5 stays 11.5', () => {
    const e = assertAttributeEdit({ unitCode: 'kg' }, current, 89);
    expect(e.needsChecker).toBe(true);
    expect(e.consequences.join(' ')).toMatch(/does NOT rescale stored values/);
  });

  it('demands a checker to TIGHTEN a bound range — the canon\'s own max 100 → 40 example', () => {
    const e = assertAttributeEdit({ validation: '{"min":0,"max":40}' }, current, 89);
    expect(e.needsChecker).toBe(true);
    expect(e.consequences.join(' ')).toMatch(/maximum falls from 100 to 40/);
  });

  it('does NOT demand a checker to LOOSEN a range — no value that passed can start failing', () => {
    const e = assertAttributeEdit({ validation: '{"min":0,"max":200}' }, current, 89);
    expect(e.needsChecker).toBe(false);
    expect(e.consequences).toEqual([]);
  });

  it('does not demand a checker to rename the display name, however many bindings exist', () => {
    // the code is load-bearing; the display name is overridden by translations anyway
    const e = assertAttributeEdit({ defaultName: 'Moisture content' }, current, 214);
    expect(e.needsChecker).toBe(false);
    expect(e.defaultName).toBe('Moisture content');
  });

  it('validates the NEW type\'s keys, not the old one\'s', () => {
    // retyping decimal→text must reject {"min":0} even though it was valid a moment ago
    expect(() => assertAttributeEdit({ dataType: 'text', validation: '{"min":0}' }, current, 0))
      .toThrow(/not a validation key for a text attribute/);
  });

  it('refuses a unit when the edit makes the type non-numeric', () => {
    expect(() => assertAttributeEdit({ dataType: 'bool', unitCode: '%' }, current, 0)).toThrow(/cannot carry a unit/);
  });

  it('clears a unit when the edit passes null, and leaves it when the field is absent', () => {
    const cleared = assertAttributeEdit({ unitCode: null }, current, 0);
    expect('unitCode' in cleared).toBe(true);
    expect(cleared.unitCode).toBeNull();
    const untouched = assertAttributeEdit({ defaultName: 'Moisture' }, current, 0);
    expect('unitCode' in untouched).toBe(false);
  });
});

describe('tightenedBounds', () => {
  it('reports only the bounds that got STRICTER', () => {
    expect(tightenedBounds({ min: 0, max: 100 }, { min: 0, max: 40 })).toHaveLength(1);
    expect(tightenedBounds({ min: 0, max: 100 }, { min: 5, max: 40 })).toHaveLength(2);
    expect(tightenedBounds({ min: 0, max: 100 }, { min: 0, max: 100 })).toEqual([]);
    expect(tightenedBounds({ min: 0, max: 100 }, { min: 0, max: 200 })).toEqual([]);
  });

  it('treats ADDING a bound where there was none as tightening', () => {
    // previously unbounded means every stored value passed; a new ceiling can invalidate thousands
    expect(tightenedBounds({}, { max: 40 })[0]).toMatch(/from unbounded to 40/);
    expect(tightenedBounds({}, { min: 5 })[0]).toMatch(/from unbounded to 5/);
  });

  it('handles maxLength as well as numeric bounds', () => {
    expect(tightenedBounds({ maxLength: 200 }, { maxLength: 40 })[0]).toMatch(/maximum length falls/);
  });
});

describe('assertOption (W024)', () => {
  it('accepts an option and defaults its sort order', () => {
    const o = assertOption({ code: 'lokwan', defaultName: 'Lokwan' }, 'option');
    expect(o).toEqual({ code: 'lokwan', defaultName: 'Lokwan', sortOrder: DEFAULT_SORT, categoryId: null });
  });

  it('REFUSES OPTIONS ON A TYPE THAT TAKES FREE INPUT — they would be rows nothing reads', () => {
    expect(() => assertOption({ code: 'x_y', defaultName: 'X' }, 'decimal')).toThrow(/takes free input, so it has no options/);
    expect(() => assertOption({ code: 'x_y', defaultName: 'X' }, 'text')).toThrow(/only option and multi_option/);
  });

  it('narrows to a category when given a real uuid, and stays global otherwise', () => {
    expect(assertOption({ code: 'lokwan', defaultName: 'L', categoryId: UUID }, 'option').categoryId).toBe(UUID);
    // a malformed id becomes global rather than a dangling reference a later join fails on
    expect(assertOption({ code: 'lokwan', defaultName: 'L', categoryId: 'wheat' }, 'option').categoryId).toBeNull();
  });

  it('refuses a non-numeric or oversized sort order', () => {
    expect(() => assertOption({ code: 'a_b', defaultName: 'A', sortOrder: 'first' }, 'option')).toThrow(/whole number/);
    expect(() => assertOption({ code: 'a_b', defaultName: 'A', sortOrder: '99999' }, 'option')).toThrow(/0–32767/);
  });
});

describe('assertCondition — the field one step from being a state machine', () => {
  it('accepts the canon\'s own example verbatim', () => {
    const c = assertCondition('{"if":{"organic":true},"then":{"required":["cert_body","cert_no"]}}');
    expect(c).toEqual({ if: { organic: true }, then: { required: ['cert_body', 'cert_no'] } });
  });

  it('REFUSES a `then` that does anything but ask for more information', () => {
    // a then that could set a value, a price or a status would break Law 9 during listing validation, where there is no
    // audit trail at all
    expect(() => assertCondition('{"if":{"organic":true},"then":{"price":100}}'))
      .toThrow(/may only contain "required"/);
    expect(() => assertCondition('{"if":{"organic":true},"then":{"status":"blocked"}}'))
      .toThrow(/never set a value, a price or a state \(Golden Law 9\)/);
    expect(() => assertCondition('{"if":{"organic":true},"then":{"required":["a_b"],"price":1}}'))
      .toThrow(/may only contain "required"/);
  });

  it('refuses an `if` that tests money or state', () => {
    expect(() => assertCondition('{"if":{"price":100},"then":{"required":["a_b"]}}'))
      .toThrow(/never reads money or state/);
    expect(() => assertCondition('{"if":{"status":"paid"},"then":{"required":["a_b"]}}'))
      .toThrow(/never reads money or state/);
  });

  it('demands exactly if and then', () => {
    expect(() => assertCondition('{"if":{"a":1}}')).toThrow(/exactly two keys/);
    expect(() => assertCondition('{"if":{"a":1},"then":{"required":["a_b"]},"else":{}}')).toThrow(/exactly two keys/);
    expect(() => assertCondition('{"when":{"a":1},"then":{"required":["a_b"]}}')).toThrow(/exactly two keys/);
  });

  it('demands a non-empty if and real attribute codes in required', () => {
    expect(() => assertCondition('{"if":{},"then":{"required":["a_b"]}}')).toThrow(/non-empty object/);
    expect(() => assertCondition('{"if":{"a":1},"then":{"required":[]}}')).toThrow(/non-empty array of attribute codes/);
    expect(() => assertCondition('{"if":{"a":1},"then":{"required":["Not A Code"]}}')).toThrow(/attribute codes/);
    expect(() => assertCondition('{"if":{"a":1},"then":{"required":[1,2]}}')).toThrow(/attribute codes/);
  });

  it('treats absent and {} as no condition', () => {
    expect(assertCondition(null)).toBeNull();
    expect(assertCondition('')).toBeNull();
    expect(assertCondition('{}')).toBeNull();
  });
});

describe('assertBinding (W020\'s tab)', () => {
  it('accepts a plain binding with everything defaulted off', () => {
    const b = assertBinding({ attributeId: UUID });
    expect(b).toEqual({
      attributeId: UUID, isRequired: false, showInFilters: false, showOnCard: false,
      condition: null, sortOrder: DEFAULT_SORT,
    });
  });

  it('REFUSES a binding that is both always-required AND conditional', () => {
    // "always required" and "required only if organic" cannot both be true, and the listing form would silently pick one
    expect(() => assertBinding({
      attributeId: UUID, isRequired: true,
      condition: '{"if":{"organic":true},"then":{"required":["cert_no"]}}',
    })).toThrow(/cannot be both always-required and conditional/);
  });

  it('allows a conditional OPTIONAL binding, which is the canon\'s organic_cert_no row', () => {
    const b = assertBinding({
      attributeId: UUID, isRequired: false,
      condition: '{"if":{"organic":true},"then":{"required":["cert_no"]}}',
    });
    expect(b.isRequired).toBe(false);
    expect(b.condition).not.toBeNull();
  });

  it('coerces the three flags rather than trusting a truthy value', () => {
    const b = assertBinding({ attributeId: UUID, isRequired: true, showInFilters: true, showOnCard: true });
    expect([b.isRequired, b.showInFilters, b.showOnCard]).toEqual([true, true, true]);
    const off = assertBinding({ attributeId: UUID, isRequired: undefined });
    expect(off.isRequired).toBe(false);
  });

  it('refuses a binding to nothing', () => {
    expect(() => assertBinding({ attributeId: 'variety' })).toThrow(/attributeId must be a uuid/);
  });
});

describe('assertUnit', () => {
  it('accepts a unit and normalises its code', () => {
    expect(assertUnit({ code: 'KG', defaultName: 'Kilogram', unitClass: 'mass' }))
      .toEqual({ code: 'kg', defaultName: 'Kilogram', unitClass: 'mass' });
  });

  it('refuses a bad code, a blank name or an invented class', () => {
    expect(() => assertUnit({ code: '2kg', defaultName: 'X', unitClass: 'mass' })).toThrow(/lower_snake_case/);
    expect(() => assertUnit({ code: 'kg', defaultName: '', unitClass: 'mass' })).toThrow(/1–60 characters/);
    expect(() => assertUnit({ code: 'kg', defaultName: 'K', unitClass: 'weight' })).toThrow(/unit class must be one of/);
  });
});

describe('assertConversion — the most consequential number in this domain', () => {
  it('KEEPS THE FACTOR AS THE EXACT STRING TYPED', () => {
    // 0.4 is not representable in binary floating point. A round trip through a JS number is a silent change to
    // somebody's quantity, which is Law 2's reasoning for money applied to quantities.
    expect(assertConversion({ fromUnit: 'acre', toUnit: 'bigha', factor: '2.5000000000' }).factor).toBe('2.5000000000');
    expect(assertConversion({ fromUnit: 'bigha', toUnit: 'acre', factor: '0.4000000000' }).factor).toBe('0.4000000000');
    expect(assertConversion({ fromUnit: 'quintal', toUnit: 'kg', factor: '100' }).factor).toBe('100');
    // and it is a string, not a number that merely prints like one
    expect(typeof assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '0.1' }).factor).toBe('string');
  });

  it('refuses a factor that would turn every quantity into nothing', () => {
    expect(() => assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '0' })).toThrow(/turns every quantity into nothing/);
    expect(() => assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '0.0000000000' })).toThrow(/greater than zero/);
    expect(() => assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '-1' })).toThrow(/positive decimal/);
  });

  it('refuses more precision than the column holds, rather than rounding it away', () => {
    // numeric(20,10) would silently drop an eleventh decimal place somebody typed deliberately
    expect(() => assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '1.00000000001' })).toThrow(/at most 10 decimal places/);
    expect(assertConversion({ fromUnit: 'a', toUnit: 'b', factor: '1.0000000001' }).factor).toBe('1.0000000001');
  });

  it('refuses a self-conversion that is not exactly 1', () => {
    // kg → kg = 2.2 is not a typo anybody would spot in a table of fifty rows, and it would double every kilogram
    expect(() => assertConversion({ fromUnit: 'kg', toUnit: 'kg', factor: '2.2' })).toThrow(/must be exactly 1/);
    expect(assertConversion({ fromUnit: 'kg', toUnit: 'kg', factor: '1' }).factor).toBe('1');
  });

  it('refuses junk and lower-cases the codes', () => {
    expect(() => assertConversion({ fromUnit: '', toUnit: 'kg', factor: '1' })).toThrow(/valid unit codes/);
    expect(() => assertConversion({ fromUnit: 'kg', toUnit: 'kg ton', factor: '1' })).toThrow(/valid unit codes/);
    expect(() => assertConversion({ fromUnit: 'a', toUnit: 'b', factor: 'one' })).toThrow(/positive decimal/);
    expect(assertConversion({ fromUnit: 'QUINTAL', toUnit: 'KG', factor: '100' }).fromUnit).toBe('quintal');
  });
});

describe('inconsistentPairs — two conversions that cannot both be right', () => {
  it('finds a pair that disagrees with its own inverse', () => {
    const out = inconsistentPairs([
      { fromUnit: 'quintal', toUnit: 'kg', factor: '100' },
      { fromUnit: 'kg', toUnit: 'quintal', factor: '0.02' },   // should be 0.01
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fromUnit: 'quintal', toUnit: 'kg', factor: '100', inverseFactor: '0.02' });
  });

  it('accepts a consistent pair', () => {
    expect(inconsistentPairs([
      { fromUnit: 'quintal', toUnit: 'kg', factor: '100' },
      { fromUnit: 'kg', toUnit: 'quintal', factor: '0.01' },
    ])).toEqual([]);
  });

  it('accepts the acre/bigha pair from the canon', () => {
    expect(inconsistentPairs([
      { fromUnit: 'acre', toUnit: 'bigha', factor: '2.5000000000' },
      { fromUnit: 'bigha', toUnit: 'acre', factor: '0.4000000000' },
    ])).toEqual([]);
  });

  it('says nothing about a conversion with no inverse — absence is not disagreement', () => {
    expect(inconsistentPairs([{ fromUnit: 'ton', toUnit: 'kg', factor: '1000' }])).toEqual([]);
  });

  it('reports a disagreeing pair ONCE, not once per direction', () => {
    const out = inconsistentPairs([
      { fromUnit: 'a', toUnit: 'b', factor: '10' },
      { fromUnit: 'b', toUnit: 'a', factor: '0.5' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('tolerates rounding at ten decimal places rather than crying wolf', () => {
    // exact reciprocity is impossible for 1/3, and flagging it would train people to ignore the warning
    expect(inconsistentPairs([
      { fromUnit: 'a', toUnit: 'b', factor: '3' },
      { fromUnit: 'b', toUnit: 'a', factor: '0.3333333333' },
    ])).toEqual([]);
  });
});

describe('the error types carry the right HTTP status', () => {
  it('uses 422 for a rule refusal and names the rule', () => {
    const e = new InvalidAttributeError('unit on a bool');
    expect(e.getStatus()).toBe(422);
    expect((e.getResponse() as any).code).toBe('CATALOGUE_ATTRIBUTE_INVALID');
    const u = new InvalidUnitError('cross class');
    expect(u.getStatus()).toBe(422);
    expect((u.getResponse() as any).code).toBe('CATALOGUE_UNIT_INVALID');
  });
});
