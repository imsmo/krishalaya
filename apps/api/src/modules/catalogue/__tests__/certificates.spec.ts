// modules/catalogue/__tests__/certificates.spec.ts · UNIT suite for catalogue-certificates (pure / no I/O).
// Proves the certificate state machine (Law 5), the entity verify/reject/expire guards + validity/expiry checks,
// the regulated-rule applicability logic, and the .strict() DTO contracts. Integration coverage (real Postgres +
// cross-tenant RLS denial) lives in certificates.integration.spec.ts.
import { Certificate } from '../domain/certificate.entity';
import { canTransition, assertTransition } from '../domain/certificate.state';
import { RegulatedRule } from '../domain/regulated-rule.entity';
import { IllegalCertificateTransitionError, InvalidCertificateError } from '../domain/catalogue.errors';
import { CreateCertificateSchema, DecideCertificateSchema } from '../dto/create-certificate.dto';
import { QueryRegulatedRuleSchema } from '../dto/query-certificate.dto';

// PC-56 SEC-4 (zod 4): `.uuid()` checks the RFC version/variant digits, so fixtures are real v4-shaped ids (still one per n).
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const TENANT = U(1); const USER = U(2); const SUBJ = U(3); const TYPE = U(4);
const mk = (over: Partial<any> = {}) => Certificate.create({ id: U(9), tenantId: TENANT, ownerUserId: USER, certTypeId: TYPE, certNo: 'NPOP-1', issuingBody: 'APEDA', subjectType: 'product', subjectId: SUBJ, mediaId: null, validFrom: null, validUntil: null, blockchainAnchor: null, ...over });

describe('certificate.state (Law 5)', () => {
  it('valid transitions', () => {
    expect(canTransition('pending', 'verified')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('verified', 'expired')).toBe(true);
    expect(canTransition('verified', 'rejected')).toBe(true);   // revoke
  });
  it('illegal/terminal transitions rejected', () => {
    expect(canTransition('pending', 'expired')).toBe(false);
    expect(canTransition('rejected', 'verified')).toBe(false);
    expect(canTransition('expired', 'verified')).toBe(false);
    expect(() => assertTransition('expired', 'verified')).toThrow(IllegalCertificateTransitionError);
  });
});

describe('Certificate entity', () => {
  it('create → pending + emits submitted; rejects bad subject/dates', () => {
    const c = mk();
    expect(c.status).toBe('pending');
    expect(c.pullEvents().some((e) => e.type === 'catalogue.certificate_submitted')).toBe(true);
    expect(() => mk({ subjectType: 'galaxy' as any })).toThrow(InvalidCertificateError);
    expect(() => mk({ validFrom: '2025-05-01', validUntil: '2025-01-01' })).toThrow(InvalidCertificateError);
  });
  it('verify sets verified + verifiedBy + window; cannot verify an already-expired window', () => {
    const c = mk(); c.pullEvents();
    c.verify(U(5), '2025-01-01', '2999-12-31');
    expect(c.status).toBe('verified');
    expect(c.toProps().verifiedBy).toBe(U(5));
    expect(c.pullEvents().some((e) => e.type === 'catalogue.certificate_verified')).toBe(true);
    const c2 = mk();
    expect(() => c2.verify(U(5), '2020-01-01', '2020-12-31')).toThrow(InvalidCertificateError);   // past window
  });
  it('reject (pending→rejected) + verified→rejected revoke; expire only from verified', () => {
    const a = mk(); a.reject(U(5), 'forged'); expect(a.status).toBe('rejected');
    const b = mk(); b.verify(U(5), null, '2999-12-31'); b.reject(U(5), 'revoked'); expect(b.status).toBe('rejected');
    const c = mk(); expect(() => c.expire()).toThrow(IllegalCertificateTransitionError);   // pending can't expire
    const d = mk(); d.verify(U(5), null, '2999-12-31'); d.expire(); expect(d.status).toBe('expired');
  });
  it('isExpired only for a verified cert past its window', () => {
    // verify() rejects a past window, so build a verified-but-lapsed cert via rehydrate to test isExpired:
    const r = Certificate.rehydrate({ ...mk().toProps(), status: 'verified', validUntil: '2020-01-01' });
    expect(r.isExpired(new Date('2025-01-01'))).toBe(true);
    expect(Certificate.rehydrate({ ...mk().toProps(), status: 'pending', validUntil: '2020-01-01' }).isExpired(new Date('2025-01-01'))).toBe(false);
  });
});

describe('RegulatedRule applicability', () => {
  const mkr = (over: Partial<any> = {}) => new RegulatedRule({ id: U(7), productId: null, categoryId: U(8), ruleType: 'banned_state', regionId: null, payload: {}, effectiveFrom: '2020-01-01', effectiveTo: null, ...over });
  it('isEffective respects from/to window', () => {
    expect(mkr().isEffective(new Date('2025-06-01'))).toBe(true);
    expect(mkr({ effectiveFrom: '2999-01-01' }).isEffective(new Date('2025-06-01'))).toBe(false);
    expect(mkr({ effectiveTo: '2021-01-01' }).isEffective(new Date('2025-06-01'))).toBe(false);
  });
  it('appliesToRegion: national rule everywhere; region rule only in region', () => {
    expect(mkr({ regionId: null }).appliesToRegion(U(6))).toBe(true);
    expect(mkr({ regionId: U(6) }).appliesToRegion(U(6))).toBe(true);
    expect(mkr({ regionId: U(6) }).appliesToRegion(U(5))).toBe(false);
  });
});

describe('DTO .strict() contracts', () => {
  it('create-certificate: subject enum + uuids + rejects unknown', () => {
    expect(CreateCertificateSchema.safeParse({ certTypeId: U(1), subjectType: 'product', subjectId: U(2) }).success).toBe(true);
    expect(CreateCertificateSchema.safeParse({ certTypeId: U(1), subjectType: 'farm', subjectId: U(2), evil: 1 }).success).toBe(false);
    expect(CreateCertificateSchema.safeParse({ certTypeId: U(1), subjectType: 'nope', subjectId: U(2) }).success).toBe(false);
  });
  it('decide: reject requires a reason; verify does not', () => {
    expect(DecideCertificateSchema.safeParse({ decision: 'verify' }).success).toBe(true);
    expect(DecideCertificateSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(DecideCertificateSchema.safeParse({ decision: 'reject', reason: 'forged document' }).success).toBe(true);
  });
  it('regulated-rule query requires product or category', () => {
    expect(QueryRegulatedRuleSchema.safeParse({ productId: U(1) }).success).toBe(true);
    expect(QueryRegulatedRuleSchema.safeParse({ regionId: U(1) }).success).toBe(false);
  });
});
