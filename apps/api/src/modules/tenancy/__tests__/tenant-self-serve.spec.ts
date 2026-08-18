// modules/tenancy/__tests__/tenant-self-serve.spec.ts · pure-domain unit tests for API-W3-05: the Tenant profile
// aggregate (self-serve fields only — NO lifecycle/identity mutation), TenantDomain (hostname + verified-before-
// primary), typed setting validation (value_type + tenant scope), and the read-only feature/usage models. The
// service-level UoW/outbox/audit/RLS/no-privilege-escalation is covered by tenant-self-serve.integration.spec.ts.
import { Tenant } from '../domain/tenant.entity';
import { TenantDomain, normalizeDomain } from '../domain/tenant-domain.entity';
import { validateSettingValue, TenantSetting } from '../domain/tenant-settings.entity';
import { TenantFeature } from '../domain/tenant-feature.entity';
import { UsageCounter } from '../domain/usage-counter.entity';
import { TENANT_STATUSES, isLive, allowsSelfServeWrites } from '../domain/tenant.state';
import { InvalidTenantProfileError, TenantNotPendingError, InvalidTenantDomainError, InvalidSettingError, SettingNotTenantScopedError } from '../domain/tenancy.errors';
import { TenancyEventType } from '../domain/tenancy.events';

const tenant = (over: any = {}) => Tenant.rehydrate({
  id: 't1', slug: 'acme', legalName: 'Acme FPO', displayName: 'Acme', tenantTypeId: 'tt1', countryCode: 'IN',
  regionId: null, gstin: null, pan: null, cinOrRegNo: null, fssaiLicense: null, ownerName: null, ownerPhone: null,
  ownerEmail: null, status: 'active', riskScore: 0, ...over,
});

describe('tenant.state vocabulary', () => {
  it('matches the 0002 enum order and classifies correctly', () => {
    expect(TENANT_STATUSES).toEqual(['pending', 'trial', 'active', 'grace', 'suspended', 'archived', 'terminated']);
    expect(isLive('active')).toBe(true); expect(isLive('suspended')).toBe(false);
    expect(allowsSelfServeWrites('pending')).toBe(true); expect(allowsSelfServeWrites('trial')).toBe(true);
    expect(allowsSelfServeWrites('suspended')).toBe(false); expect(allowsSelfServeWrites('terminated')).toBe(false);
  });
});


// PC-56 TENANT-4d-3: the formats are now an ARGUMENT, resolved per country from `tax_identity_formats` (0147),
// because the Indian GSTIN/PAN regexes that used to be hardcoded in the entity refused every other country's
// identifier outright. India's four rows, as the migration seeds them.
const IN_FORMATS = [
  { fieldCode: 'gstin' as const, labelKey: 'tax.field.gstin', pattern: '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$', maxLength: 15, example: '24AABCU9603R1Z5', checksumAlgo: 'gstin_mod36', isRequired: false, sortOrder: 10 },
  { fieldCode: 'pan' as const, labelKey: 'tax.field.pan', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', maxLength: 10, example: 'AABCU9603R', checksumAlgo: null, isRequired: false, sortOrder: 20 },
];

describe('Tenant profile (self-serve)', () => {
  it('updates editable fields, validates GSTIN/PAN/email, emits profile_updated', () => {
    const t = tenant();
    // 29ABCDE1234F1Z5 is shape-valid but its CHECK DIGIT is wrong, which the old regex could not see. With a
    // real GSTIN it passes; the checksum case is asserted in tenant4d3-tax-identity.spec.ts.
    const diff = t.updateProfile({ displayName: 'Acme Farmer Producer Co', gstin: '24AABCU9603R1Z5', ownerEmail: 'Owner@Acme.IN' }, IN_FORMATS);
    expect(diff.new.displayName).toBe('Acme Farmer Producer Co');
    expect(t.toProps().gstin).toBe('24AABCU9603R1Z5');
    expect(t.toProps().ownerEmail).toBe('owner@acme.in');      // normalised
    expect(t.pullEvents().map((e) => e.type)).toContain(TenancyEventType.TenantProfileUpdated);
  });
  it('rejects malformed GSTIN/PAN/phone/email and markup — against the COUNTRY\'s formats', () => {
    expect(() => tenant().updateProfile({ gstin: 'NOPE' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
    expect(() => tenant().updateProfile({ pan: '1234567890' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
    expect(() => tenant().updateProfile({ ownerPhone: 'abc' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
    expect(() => tenant().updateProfile({ ownerEmail: 'not-an-email' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
    expect(() => tenant().updateProfile({ displayName: '<script>' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
  });
  it('EVERY invalid field is reported, not just the first (W2424)', () => {
    // The old validator threw inside the first failing helper, so a form with three problems reported one and
    // the tenant learned the other two on two more round trips.
    try {
      tenant().updateProfile({ gstin: 'NOPE', pan: 'ALSO-BAD', ownerEmail: 'not-an-email' }, IN_FORMATS);
      throw new Error('expected a refusal');
    } catch (e) {
      const fields = (e as InvalidTenantProfileError).fields ?? [];
      expect(fields.map((f) => f.field).sort()).toEqual(['gstin', 'ownerEmail', 'pan']);
    }
  });
  it('a country with NO recorded formats is not blocked — the identifier is stored as plain text', () => {
    // Rule zero: refusing a correct Bangladeshi BIN because nobody has seeded its format is the defect.
    const t = tenant({ countryCode: 'BD' });
    t.updateProfile({ gstin: 'BIN-1234567890' }, []);
    expect(t.toProps().gstin).toBe('BIN-1234567890');
  });
  it('a no-op patch throws (nothing to change)', () => {
    expect(() => tenant({ displayName: 'Acme' }).updateProfile({ displayName: 'Acme' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
  });
  it('cannot touch status/slug/risk — unknown keys are ignored, status unchanged (Law 11)', () => {
    const t = tenant({ status: 'active' });
    // @ts-expect-error status is not part of TenantProfilePatch — it is ignored, leaving no real change
    expect(() => t.updateProfile({ status: 'terminated' }, IN_FORMATS)).toThrow(InvalidTenantProfileError);
    expect(t.toProps().status).toBe('active');   // never mutated by the self-serve path
  });
  it('submitForReview is allowed only when pending and never changes status', () => {
    const p = tenant({ status: 'pending' }); p.submitForReview();
    expect(p.toProps().status).toBe('pending');
    expect(p.pullEvents().map((e) => e.type)).toContain(TenancyEventType.TenantOnboardingSubmitted);
    expect(() => tenant({ status: 'active' }).submitForReview()).toThrow(TenantNotPendingError);
  });
});

describe('TenantDomain', () => {
  it('normalises + validates the hostname', () => {
    expect(normalizeDomain('  Mandi.Example.COM ')).toBe('mandi.example.com');
    expect(() => normalizeDomain('not a host')).toThrow(InvalidTenantDomainError);
    expect(() => normalizeDomain('nodot')).toThrow(InvalidTenantDomainError);
  });
  it('create starts pending+unverified and emits domain_added', () => {
    const d = TenantDomain.create({ id: 'd1', tenantId: 't1', domain: 'mandi.example.com' });
    const p = d.toProps(); expect(p.tlsStatus).toBe('pending'); expect(p.isPrimary).toBe(false); expect(p.verifiedAt).toBeNull();
    expect(d.pullEvents().map((e) => e.type)).toContain(TenancyEventType.TenantDomainAdded);
  });
  it('only a VERIFIED domain can be made primary (fail closed)', () => {
    const d = TenantDomain.create({ id: 'd1', tenantId: 't1', domain: 'mandi.example.com' }); d.pullEvents();
    expect(() => d.makePrimary()).toThrow(InvalidTenantDomainError);   // not verified yet
    d.markVerified(new Date());
    d.makePrimary(); expect(d.isPrimary).toBe(true);
    expect(d.pullEvents().map((e) => e.type)).toContain(TenancyEventType.TenantDomainPrimaryChanged);
  });
});

describe('typed tenant settings', () => {
  const def = (over: any = {}) => ({ key: 'order.auto_confirm_hours', valueType: 'int' as const, scope: 'tenant' as const, ...over });
  it('validates by value_type', () => {
    expect(validateSettingValue(def({ valueType: 'int' }), 24)).toBe(24);
    expect(() => validateSettingValue(def({ valueType: 'int' }), 1.5)).toThrow(InvalidSettingError);
    expect(validateSettingValue(def({ valueType: 'bool' }), true)).toBe(true);
    expect(() => validateSettingValue(def({ valueType: 'bool' }), 'yes')).toThrow(InvalidSettingError);
    expect(() => validateSettingValue(def({ valueType: 'string' }), 'x'.repeat(5000))).toThrow(InvalidSettingError);
  });
  it('refuses non-tenant-scoped keys (Law 11 — no platform setting self-edit)', () => {
    expect(() => validateSettingValue(def({ scope: 'platform' }), 1)).toThrow(SettingNotTenantScopedError);
    expect(() => TenantSetting.of('t1', def({ scope: 'user' }), 1)).toThrow(SettingNotTenantScopedError);
  });
});

describe('read-only feature + usage models', () => {
  it('feature override is effective only when enabled and not expired', () => {
    const past = new Date(Date.now() - 86400_000); const future = new Date(Date.now() + 86400_000);
    expect(TenantFeature.rehydrate({ tenantId: 't1', featureCode: 'f', isEnabled: true, reason: null, expiresAt: future }).isEffective()).toBe(true);
    expect(TenantFeature.rehydrate({ tenantId: 't1', featureCode: 'f', isEnabled: true, reason: null, expiresAt: past }).isEffective()).toBe(false);
    expect(TenantFeature.rehydrate({ tenantId: 't1', featureCode: 'f', isEnabled: false, reason: null, expiresAt: null }).isEffective()).toBe(false);
  });
  it('usage ratio handles unlimited/zero/normal limits', () => {
    const u = UsageCounter.rehydrate({ tenantId: 't1', metricCode: 'max_orders_month', period: '2026-06-01', usedValue: 50n });
    expect(u.ratioOf(-1n)).toBe(0);          // unlimited
    expect(u.ratioOf(100n)).toBeCloseTo(0.5);
    expect(u.ratioOf(0n)).toBe(1);           // any usage against a 0 cap = full
  });
});
