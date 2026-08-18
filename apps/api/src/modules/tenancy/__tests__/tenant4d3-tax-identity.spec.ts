// PC-56 TENANT-4d-3 · W2424-W2427 — the tax-identity validator, the diff, the reason, and 0147's promises,
// each pinned against the SOURCE with comments stripped so a promise in a comment cannot pass a test.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CurrentIdentity, REASON_MAX, TAX_FIELD_CODES, TAX_FIELD_PROPS, TaxIdentityFormat, UNFORMATTED_MAX_LENGTH,
  assertValid, checksumAdvisories, checksumSupported, diffOf, gstinChecksumOk, isNoOp, reasonProblem,
  reasonRequired, validateAll,
} from '../domain/tax-identity';
import { InvalidTenantProfileError } from '../domain/tenancy.errors';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const migration = () => fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0147_tax_identity_formats.sql'), 'utf8');
const sqlOnly = () => migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

/** India's four rows, exactly as 0147 seeds them. */
const IN: TaxIdentityFormat[] = [
  { fieldCode: 'gstin', labelKey: 'tax.field.gstin', pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$', maxLength: 15, example: '27AAPFU0939F1ZV', checksumAlgo: 'gstin_mod36', isRequired: false, sortOrder: 10 },
  { fieldCode: 'pan', labelKey: 'tax.field.pan', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', maxLength: 10, example: 'AABCU9603R', checksumAlgo: null, isRequired: false, sortOrder: 20 },
  { fieldCode: 'cin_or_reg_no', labelKey: 'tax.field.cin', pattern: '^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$', maxLength: 21, example: 'U74999MH2015PTC123456', checksumAlgo: null, isRequired: false, sortOrder: 30 },
  { fieldCode: 'fssai_license', labelKey: 'tax.field.fssai', pattern: '^[0-9]{14}$', maxLength: 14, example: '10012011000123', checksumAlgo: null, isRequired: false, sortOrder: 40 },
];

const current = (over: Partial<CurrentIdentity> = {}): CurrentIdentity => ({
  gstin: null, pan: null, cinOrRegNo: null, fssaiLicense: null,
  legalName: 'Anand FPO', ownerName: null, ownerPhone: null, ownerEmail: null, ...over,
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · A TAX IDENTITY IS NOT AN INDIAN REGEX (rule zero)', () => {
  it('a country with NO recorded formats is never blocked — the identifier is stored as plain text', () => {
    // The old code applied /^[0-9]{2}[A-Z]{5}.../ to every tenant on the platform, so a Bangladeshi
    // co-operative's BIN was REFUSED as "gstin is malformed". Refusing a correct registration is the defect.
    const r = validateAll([], { gstin: 'BIN-1234567890' });
    expect(r.errors).toEqual([]);
    expect(r.cleaned.gstin).toBe('BIN-1234567890');
    // …and the verdict SAYS the shape was not checked, rather than implying it passed a format.
    expect(r.verdicts.gstin).toEqual({ kind: 'ok', checksum: 'not_verifiable' });
  });

  it('but an unformatted country is still LENGTH-capped, so the field cannot become a paragraph', () => {
    const r = validateAll([], { gstin: 'X'.repeat(UNFORMATTED_MAX_LENGTH + 1) });
    expect(r.errors).toEqual([{ field: 'gstin', reason: 'too_long', detail: String(UNFORMATTED_MAX_LENGTH) }]);
    expect(r.cleaned.gstin).toBeUndefined();
  });

  it('with India\'s formats the Indian rules apply, and the value is normalised to upper case', () => {
    const r = validateAll(IN, { gstin: ' 27aapfu0939f1zv ', pan: 'aabcu9603r' });
    expect(r.errors).toEqual([]);
    expect(r.cleaned.gstin).toBe('27AAPFU0939F1ZV');
    expect(r.cleaned.pan).toBe('AABCU9603R');
  });

  it('LENGTH IS CHECKED BEFORE THE PATTERN — it bounds what an operator-authored regex can chew on', () => {
    const r = validateAll(IN, { gstin: 'A'.repeat(400) });
    expect(r.errors).toEqual([{ field: 'gstin', reason: 'too_long', detail: '15' }]);
  });

  it('every field code maps to a real entity property, so a format row cannot govern nothing', () => {
    expect(Object.keys(TAX_FIELD_PROPS).sort()).toEqual([...TAX_FIELD_CODES].sort());
    expect(Object.values(TAX_FIELD_PROPS)).toEqual(['gstin', 'pan', 'cinOrRegNo', 'fssaiLicense']);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · EVERY invalid field, with its reason (W2424)', () => {
  it('collects them all instead of throwing on the first', () => {
    const r = validateAll(IN, { gstin: 'NOPE', pan: 'BAD', ownerEmail: 'not-an-email', ownerPhone: 'abc' });
    expect(r.errors.map((e) => e.field).sort()).toEqual(['gstin', 'ownerEmail', 'ownerPhone', 'pan']);
    // Each carries its own reason — "the form has errors" is not a reason.
    expect(r.errors.every((e) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true);
  });

  it('a malformed field carries the country\'s EXAMPLE as its detail, so the message can be specific', () => {
    const r = validateAll(IN, { gstin: 'NOPE' });
    expect(r.errors).toEqual([{ field: 'gstin', reason: 'malformed', detail: '27AAPFU0939F1ZV' }]);
  });

  it('markup and control characters are refused as such, not as "malformed"', () => {
    const r = validateAll(IN, { legalName: 'Acme <script>' });
    expect(r.errors).toEqual([{ field: 'legalName', reason: 'not_plain_text' }]);
  });

  it('a valid field alongside invalid ones is still CLEANED, so the form can keep it', () => {
    const r = validateAll(IN, { gstin: '27AAPFU0939F1ZV', pan: 'BAD' });
    expect(r.cleaned.gstin).toBe('27AAPFU0939F1ZV');
    expect(r.errors.map((e) => e.field)).toEqual(['pan']);
  });

  it('CLEARING a field is an allowed act — unless the country marks it required', () => {
    expect(validateAll(IN, { gstin: null }).cleaned.gstin).toBeNull();
    expect(validateAll(IN, { gstin: '   ' }).cleaned.gstin).toBeNull();     // whitespace is a clear, not a value
    expect(validateAll(IN, { gstin: null }).verdicts.gstin).toEqual({ kind: 'cleared' });
    const required = IN.map((f) => (f.fieldCode === 'gstin' ? { ...f, isRequired: true } : f));
    expect(validateAll(required, { gstin: null }).errors).toEqual([{ field: 'gstin', reason: 'required' }]);
  });

  it('assertValid throws ONE error carrying every field, which is what the screen renders', () => {
    const r = validateAll(IN, { gstin: 'NOPE', pan: 'BAD' });
    try {
      assertValid(r);
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTenantProfileError);
      expect((e as InvalidTenantProfileError).fields?.map((f) => f.field)).toEqual(['gstin', 'pan']);
      expect((e as { code: string }).code).toBe('TENANT_PROFILE_INVALID');
    }
    expect(() => assertValid(validateAll(IN, { gstin: '27AAPFU0939F1ZV' }))).not.toThrow();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · the check digit ADVISES, and never silently passes', () => {
  it('agrees with the published specimen', () => {
    expect(gstinChecksumOk('27AAPFU0939F1ZV')).toBe(true);
  });

  it('catches a single-character substitution in the check position', () => {
    expect(gstinChecksumOk('27AAPFU0939F1ZA')).toBe(false);
    expect(gstinChecksumOk('27AAPFU0939F1Z5')).toBe(false);
  });

  it('rejects a wrong length and a non-alphanumeric outright', () => {
    expect(gstinChecksumOk('27AAPFU0939F1Z')).toBe(false);
    expect(gstinChecksumOk('27AAPFU0939F1Z*')).toBe(false);
  });

  /**
   * THE LIMIT, STATED AS A TEST. A mismatch is an ADVISORY, not a refusal: the algorithm agrees with the one
   * specimen available and could not be checked against an authoritative GSTN source from this build
   * environment. A checksum subtly wrong would REFUSE numbers genuinely a tenant's own, which is a trust cost
   * rule zero forbids. If this test is ever changed to expect an error, the algorithm must first be verified.
   */
  it('A FAILED CHECK DIGIT DOES NOT REFUSE THE WRITE — it is surfaced for a human at the review step', () => {
    const r = validateAll(IN, { gstin: '27AAPFU0939F1Z5' });   // shape-valid, check digit wrong
    expect(r.errors).toEqual([]);                               // stored, not refused
    expect(r.cleaned.gstin).toBe('27AAPFU0939F1Z5');
    expect(r.verdicts.gstin).toEqual({ kind: 'ok', checksum: 'failed' });
    expect(checksumAdvisories(r.verdicts)).toEqual(['gstin']);
  });

  it('the four checksum verdicts are four DIFFERENT states, and "not verifiable" is not "verified"', () => {
    expect(validateAll(IN, { gstin: '27AAPFU0939F1ZV' }).verdicts.gstin).toEqual({ kind: 'ok', checksum: 'verified' });
    // A format with no check digit at all (PAN, CIN, FSSAI) — nothing to verify, which is its own answer.
    expect(validateAll(IN, { pan: 'AABCU9603R' }).verdicts.pan).toEqual({ kind: 'ok', checksum: 'not_applicable' });
    // No format recorded for the country.
    expect(validateAll([], { pan: 'WHATEVER' }).verdicts.pan).toEqual({ kind: 'ok', checksum: 'not_verifiable' });
    // An algorithm NAME this build does not implement behaves like NULL, never like a pass.
    const unknown = IN.map((f) => (f.fieldCode === 'gstin' ? { ...f, checksumAlgo: 'martian_mod7' } : f));
    expect(validateAll(unknown, { gstin: '27AAPFU0939F1Z5' }).verdicts.gstin).toEqual({ kind: 'ok', checksum: 'not_verifiable' });
    expect(checksumSupported('gstin_mod36')).toBe(true);
    expect(checksumSupported('martian_mod7')).toBe(false);
    expect(checksumSupported(null)).toBe(false);
  });

  it('and a checksum advisory is never raised for a field that has no check digit', () => {
    expect(checksumAdvisories(validateAll(IN, { pan: 'AABCU9603R' }).verdicts)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · W2425\'s diff and W2426\'s reason', () => {
  it('the diff is computed from the CLEANED values — what will be stored, not what was typed', () => {
    const r = validateAll(IN, { gstin: ' 27aapfu0939f1zv ' });
    const d = diffOf(current(), r.cleaned);
    expect(d).toEqual([{ field: 'gstin', from: null, to: '27AAPFU0939F1ZV' }]);
  });

  it('an unchanged value produces NO row, so a review screen with nothing to show says so', () => {
    const r = validateAll(IN, { gstin: '27AAPFU0939F1ZV' });
    const d = diffOf(current({ gstin: '27AAPFU0939F1ZV' }), r.cleaned);
    expect(d).toEqual([]);
    expect(isNoOp(d)).toBe(true);
    expect(isNoOp([{ field: 'gstin', from: null, to: 'X' }])).toBe(false);
  });

  it('SET, REPLACED and CLEARED are three distinguishable acts in the diff', () => {
    const d = diffOf(current({ gstin: '27AAPFU0939F1ZV', pan: 'AABCU9603R' }), { gstin: null, pan: 'ZZBCU9603R', ownerEmail: 'a@b.co' });
    expect(d).toEqual([
      { field: 'gstin', from: '27AAPFU0939F1ZV', to: null },        // cleared
      { field: 'pan', from: 'AABCU9603R', to: 'ZZBCU9603R' },       // replaced
      { field: 'ownerEmail', from: null, to: 'a@b.co' },            // set
    ]);
  });

  it('a REASON is required to replace or clear, and not to set for the first time', () => {
    expect(reasonRequired([{ field: 'gstin', from: null, to: 'X' }])).toBe(false);
    expect(reasonRequired([{ field: 'gstin', from: 'OLD', to: 'X' }])).toBe(true);
    expect(reasonRequired([{ field: 'gstin', from: 'OLD', to: null }])).toBe(true);
    expect(reasonRequired([])).toBe(false);
  });

  it('and the reason itself is validated: missing when required, over-long, or markup', () => {
    const replacing = [{ field: 'gstin' as const, from: 'OLD', to: 'NEW' }];
    const setting = [{ field: 'gstin' as const, from: null, to: 'NEW' }];
    expect(reasonProblem('', replacing)).toBe('required');
    expect(reasonProblem(null, replacing)).toBe('required');
    expect(reasonProblem('   ', replacing)).toBe('required');
    expect(reasonProblem('', setting)).toBeNull();                  // nothing to explain
    expect(reasonProblem('x'.repeat(REASON_MAX + 1), setting)).toBe('too_long');
    expect(reasonProblem('<script>', setting)).toBe('not_plain_text');
    expect(reasonProblem('Corrected a typo from the GST portal', replacing)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · the entity, the service and the surface', () => {
  it('the hardcoded Indian regexes are GONE from the entity', () => {
    const src = read('domain', 'tenant.entity.ts');
    expect(src).not.toContain('GSTIN_RE');
    expect(src).not.toContain('PAN_RE');
    expect(src).toContain('validateAll(formats');
  });

  it('`formats` is a REQUIRED argument — no default, so a forgotten load cannot fail open', () => {
    const src = read('domain', 'tenant.entity.ts');
    // A default of [] would make the dangerous case (an Indian tenant whose formats the caller forgot) accept
    // any string into a field 0146 freezes onto every invoice.
    expect(src).toContain('formats: readonly TaxIdentityFormat[])');
    expect(src).not.toContain('formats: readonly TaxIdentityFormat[] = []');
  });

  it('the service resolves the formats from the tenant\'s COUNTRY before validating', () => {
    const src = read('services', 'tenant.service.ts');
    expect(src).toContain('taxIdentityFormats(tenantId, t.countryCode)');
  });

  /**
   * MUTATION SURVIVOR (round 1): only a source-text pin held this, and it did not hold it. Changing the call
   * to `t.updateProfile(patch, [])` — leaving the resolve line above it untouched — passed every test, while
   * silently making an Indian tenant's GSTIN accept any string into a field 0146 freezes onto every invoice.
   * A required argument stops an OMISSION; only a behavioural test stops an empty one being passed on purpose.
   */
  it('THE RESOLVED FORMATS REACH THE ENTITY — a malformed Indian GSTIN is refused by the SERVICE', async () => {
    const { TenantService } = await import('../services/tenant.service');
    const { Tenant } = await import('../domain/tenant.entity');

    const tenantRow = () => Tenant.rehydrate({
      id: 't1', slug: 'anand', legalName: 'Anand FPO', displayName: 'Anand', tenantTypeId: 'tt',
      countryCode: 'IN', regionId: null, gstin: null, pan: null, cinOrRegNo: null, fssaiLicense: null,
      ownerName: null, ownerPhone: null, ownerEmail: null, status: 'active', riskScore: 0,
    });
    const audited: Array<Record<string, unknown>> = [];
    const repo = {
      getForUpdate: async () => tenantRow(),
      getById: async () => tenantRow(),
      updateProfile: async () => undefined,
      // The country's real formats — exactly what 0147 seeds for IN.
      taxIdentityFormats: async () => IN,
    };
    const svc = new TenantService(
      { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { write: async () => undefined } as never,
      { remember: async (_k: string, _u: string, _n: string, fn: () => unknown) => fn() } as never,
      { inc: () => undefined, observe: () => undefined } as never,
      { write: async (_tx: unknown, e: Record<string, unknown>) => { audited.push(e); } } as never,
      repo as never, {} as never, {} as never, {} as never,
    );
    const actor = { userId: 'u1', canManage: true } as never;

    await expect(svc.updateProfile('t1', actor, 'k1', { gstin: 'NOPE' } as never, null))
      .rejects.toThrow(InvalidTenantProfileError);
    expect(audited).toEqual([]);                                   // nothing audited, nothing written

    // …and a real one goes through, carrying the reason into the audit row (W2426).
    await svc.updateProfile('t1', actor, 'k2', { gstin: '27AAPFU0939F1ZV', reason: 'registered at last' } as never, null);
    expect(audited).toHaveLength(1);
    expect(audited[0].reason).toBe('registered at last');
    expect((audited[0].newValue as Record<string, unknown>).gstin).toBe('27AAPFU0939F1ZV');
  });

  it('and a REPLACEMENT without a reason is refused by the service (W2426\'s fourth fact)', async () => {
    const { TenantService } = await import('../services/tenant.service');
    const { Tenant } = await import('../domain/tenant.entity');
    const withGstin = () => Tenant.rehydrate({
      id: 't1', slug: 'anand', legalName: 'Anand FPO', displayName: 'Anand', tenantTypeId: 'tt',
      countryCode: 'IN', regionId: null, gstin: '27AAPFU0939F1ZV', pan: null, cinOrRegNo: null,
      fssaiLicense: null, ownerName: null, ownerPhone: null, ownerEmail: null, status: 'active', riskScore: 0,
    });
    const svc = new TenantService(
      { run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { write: async () => undefined } as never,
      { remember: async (_k: string, _u: string, _n: string, fn: () => unknown) => fn() } as never,
      { inc: () => undefined, observe: () => undefined } as never,
      { write: async () => undefined } as never,
      { getForUpdate: async () => withGstin(), updateProfile: async () => undefined, taxIdentityFormats: async () => IN } as never,
      {} as never, {} as never, {} as never,
    );
    const actor = { userId: 'u1', canManage: true } as never;
    await expect(svc.updateProfile('t1', actor, 'k3', { gstin: '24AAACT2727Q1ZW' } as never, null))
      .rejects.toThrow(/reason is required/);
  });

  it('and it writes the audit REASON the success screen promises', () => {
    const src = read('services', 'tenant.service.ts');
    expect(src).toContain('reason: reason?.trim() || null');
    expect(src).toContain('oldValue: diff.old');
    expect(src).toContain('newValue: diff.new');
  });

  it('the preview endpoint SHARES the write\'s validator — it is not a second mechanism', () => {
    const src = read('services', 'tenant.service.ts');
    expect(src).toContain('previewProfile');
    expect(src).toContain('validateAll(formats');
    // …and it writes nothing: no uow, no audit, no outbox inside it.
    const preview = src.slice(src.indexOf('async previewProfile'), src.indexOf('async taxIdentityFields'));
    expect(preview).not.toContain('uow.run');
    expect(preview).not.toContain('audit.write');
  });

  it('the routes are flag-gated and permission-gated, and the preview is not idempotency-keyed', () => {
    const src = read('controllers', 'v1', 'tenants.controller.ts');
    expect(src).toContain("@FeatureFlag('tenant_tax_identity_form')");
    expect(src).toContain("@Get('me/tax-identity')");
    expect(src).toContain("@Post('me/preview')");
    expect(src).toContain('TenancyPermissions.ManageTenant');
    const preview = src.slice(src.indexOf("@Post('me/preview')"), src.indexOf("@Post('me/submit')"));
    expect(preview).not.toContain('reqKey');
  });

  it('a reason ALONE is not a profile change (it would fail deep in the entity and read as a server fault)', () => {
    expect(read('dto', 'update-tenant.dto.ts')).toContain("Object.keys(d).filter((k) => k !== 'reason').length > 0");
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-3 · migration 0147 says what it does, and does what it says', () => {
  it('the formats are a TABLE keyed by country, with the field code CHECKed against real columns', () => {
    const sql = sqlOnly();
    expect(sql).toContain('CREATE TABLE tax_identity_formats');
    expect(sql).toContain('country_code   char(2) NOT NULL REFERENCES countries(code)');
    expect(sql).toContain("CHECK (field_code IN ('gstin', 'pan', 'cin_or_reg_no', 'fssai_license'))");
  });

  it('the pattern must be ANCHORED and bounded — an unanchored one would match a substring', () => {
    expect(sqlOnly()).toContain("CHECK (pattern LIKE '^%' AND pattern LIKE '%$' AND length(pattern) <= 400)");
  });

  it('the label is an i18n KEY, never a literal — "GSTIN" is India\'s word for this field', () => {
    const sql = sqlOnly();
    expect(sql).toContain('label_key');
    expect(sql).toContain("'tax.field.gstin'");
    expect(sql).not.toMatch(/label_key[^\n]*'GSTIN'/);
  });

  it('ONLY India is seeded — inventing a country\'s format would refuse correct numbers', () => {
    const sql = sqlOnly();
    const countries = [...sql.matchAll(/\('([A-Z]{2})', '(?:gstin|pan|cin_or_reg_no|fssai_license)'/g)].map((m) => m[1]);
    expect([...new Set(countries)]).toEqual(['IN']);
    expect(countries.length).toBe(4);
  });

  it('the seeded GSTIN example is itself checksum-valid — a form must not show a failing specimen', () => {
    const m = sqlOnly().match(/'gstin',\s*'tax\.field\.gstin',[^\n]*?'([0-9A-Z]{15})'/);
    expect(m).not.toBeNull();
    expect(gstinChecksumOk((m as RegExpMatchArray)[1])).toBe(true);
  });

  it('only algorithms the code implements are admissible as checksum_algo', () => {
    expect(sqlOnly()).toContain("CHECK (checksum_algo IS NULL OR checksum_algo IN ('gstin_mod36'))");
    expect(checksumSupported('gstin_mod36')).toBe(true);
  });

  it('reference data is READ-ONLY to the application', () => {
    const sql = sqlOnly();
    expect(sql).toContain('GRANT SELECT ON tax_identity_formats TO kv_app');
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tax_identity_formats FROM kv_app');
    expect(sql).not.toMatch(/GRANT[^\n]*tax_identity_formats[^\n]*kv_relay/);
  });

  /**
   * DEFECT 5, found by probing this migration's OWN grants as the role. 0018 set
   * `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kv_relay`, so every table
   * created since is born fully relay-writable with no GRANT naming it — the outbox relay could DELETE the
   * platform's tax-format rows, which would silently turn every tenant's validation into "no format recorded".
   * An explicit REVOKE is the only thing that makes a least-privilege claim true.
   */
  it('THE RELAY DEFAULT IS REVOKED EXPLICITLY — a new table is otherwise born writable by it', () => {
    const sql = sqlOnly();
    expect(sql).toContain('REVOKE ALL ON tax_identity_formats FROM kv_relay');
    // The REVOKE must come AFTER the CREATE: the default privilege is applied at creation time.
    expect(sql.indexOf('CREATE TABLE tax_identity_formats')).toBeLessThan(sql.indexOf('REVOKE ALL ON tax_identity_formats FROM kv_relay'));
    // 0018 is the source, and this file names it rather than leaving a mystery grant.
    expect(migration()).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kv_relay');
    expect(migration()).toContain('NAMED, NOT SWEPT');
  });

  it('the flag defaults OFF (Law 10)', () => {
    expect(new RegExp("SELECT 'tenant_tax_identity_form',[\\s\\S]{0,500}?false").test(sqlOnly())).toBe(true);
  });

  it('and it names what it does NOT fix, including the checksum limit', () => {
    const header = migration();
    for (const claim of [
      'ONE REGEX BLOCKS EVERY COUNTRY BUT INDIA',
      'AND IT ADVISES RATHER THAN REFUSES',
      'THE TENANT PROFILE PLANE HAS NO SDK SURFACE AT ALL',
      "THE GSTIN'S STATE CODE IS NOT CROSS-CHECKED",
      'THE GRACE PERIOD IS STILL A SENTENCE, NOT A STATE',
    ]) expect(header).toContain(claim);
  });
});
