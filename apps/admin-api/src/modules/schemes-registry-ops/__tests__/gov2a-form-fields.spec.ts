// PC-56 GOV-2a · B2f — the form fields a scheme version declares (GOV-2 Q3-A, lead-applied 2026-11-10), authored in the admin realm's draft →
// publish plane. Pure: the domain validator (a copy of 0240's CHECK `kv_scheme_form_fields_valid`), the draft DTO, and the version plane's
// handling (the seventh versioned field: a change opens a draft, the diff names it).
import { assertFormFields, keyTokens, mustBePersonal, isLocationKey, FORM_FIELD_KINDS } from '../domain/scheme-form-fields';
import { SaveDraftSchema, FormFieldsSchema } from '../dto/schemes-registry.dto';
import { applyRulesPatch, versionDiff, rulesEqual, VERSIONED_FIELDS, type VersionRules } from '../domain/scheme-version';
import { InvalidSchemeInputError } from '../domain/schemes-registry.errors';

const rules = (over: Partial<VersionRules> = {}): VersionRules => ({
  benefitSummary: { type: 'dbt_annual', instalments: 3 }, eligibilityRules: { roles: ['farmer'] }, requiredDocTypeIds: [],
  applicationWindow: null, applicableRegionIds: [], processingFeeMinor: '0', formFields: [], ...over,
});
const crop = { key: 'cropName', label: 'Crop', kind: 'text' as const, personal: false };

describe('GOV-2a · the declared form fields (domain)', () => {
  it('a valid list passes and labels are trimmed; the five kinds', () => {
    expect([...FORM_FIELD_KINDS]).toEqual(['text', 'number', 'date', 'boolean', 'choice']);
    expect(assertFormFields([{ ...crop, label: '  Crop  ' }, { key: 'landAcres', label: 'Land (acres)', kind: 'number', personal: false }]))
      .toEqual([{ ...crop, label: 'Crop' }, { key: 'landAcres', label: 'Land (acres)', kind: 'number', personal: false }]);
    expect(assertFormFields([])).toEqual([]);
  });
  it('refuses: not an array, duplicate keys, a bad key, an unknown kind, a non-boolean personal, extra keys, > 100 fields, an HTML label', () => {
    for (const bad of [
      {}, [crop, crop], [{ ...crop, key: '1crop' }], [{ ...crop, kind: 'file' }], [{ ...crop, personal: 'no' }], [{ ...crop, amount: 5 }],
      Array.from({ length: 101 }, (_, i) => ({ ...crop, key: `k${i}` })), [{ ...crop, label: '<b>x</b>' }], [{ ...crop, label: '' }],
    ]) expect(() => assertFormFields(bad)).toThrow(InvalidSchemeInputError);
  });
  it('a name, village or caste key (and the GOV-0 identifiers) must be personal; a location key cannot be declared', () => {
    expect(keyTokens('farmerName')).toBe('_farmer_name_');
    for (const k of ['farmerName', 'name', 'fatherName', 'village', 'villageName', 'casteCertificateNo', 'mobileNumber', 'aadhaar', 'bankAccount', 'ifsc', 'upiId', 'panNo']) {
      expect([k, mustBePersonal(k)]).toEqual([k, true]);
      expect(() => assertFormFields([{ key: k, label: 'x', kind: 'text', personal: false }])).toThrow(/must be declared personal/);
      expect(assertFormFields([{ key: k, label: 'x', kind: 'text', personal: true }])[0].personal).toBe(true);
    }
    // a crop's or a scheme's name is not a person's name (found while building: a token rule masked `cropName`)
    for (const k of ['company', 'cropName', 'schemeName', 'landAcres', 'plateCount']) expect([k, mustBePersonal(k)]).toEqual([k, false]);
    for (const k of ['farmLocation', 'gpsLat', 'address', 'boundary']) {
      expect([k, isLocationKey(k)]).toEqual([k, true]);
      expect(() => assertFormFields([{ key: k, label: 'x', kind: 'text', personal: true }])).toThrow(/location/);
    }
  });
});

describe('GOV-2a · the draft DTO carries formFields (validated)', () => {
  it('accepts a valid list alone as a draft edit; refuses duplicate keys, a bad kind, a non-boolean personal, a name not personal, a location', () => {
    expect(SaveDraftSchema.safeParse({ formFields: [crop], reason: 'declare the crop field' }).success).toBe(true);
    for (const bad of [[crop, crop], [{ ...crop, kind: 'file' }], [{ ...crop, personal: 1 }], [{ key: 'farmerName', label: 'Name', kind: 'text', personal: false }],
      [{ key: 'farmLocation', label: 'Where', kind: 'text', personal: true }], [{ ...crop, extra: true }]])
      expect([JSON.stringify(bad), FormFieldsSchema.safeParse(bad).success]).toEqual([JSON.stringify(bad), false]);
  });
});

describe('GOV-2a · formFields is the seventh versioned field', () => {
  it('a change in the declared fields is a rule change; the diff names it; unchanged lists compare equal', () => {
    expect(VERSIONED_FIELDS).toContain('formFields');
    const next = applyRulesPatch(rules(), { formFields: [crop] });
    expect(next.formFields).toEqual([crop]);
    expect(rulesEqual(rules(), next)).toBe(false);
    expect(versionDiff(rules(), next).map((d) => d.field)).toEqual(['formFields']);
    expect(rulesEqual(rules({ formFields: [crop] }), rules({ formFields: [{ personal: false, kind: 'text', label: 'Crop', key: 'cropName' }] as never }))).toBe(true);
    expect(() => applyRulesPatch(rules(), { formFields: [{ key: 'village', label: 'Village', kind: 'text', personal: false }] })).toThrow(InvalidSchemeInputError);
  });
});
