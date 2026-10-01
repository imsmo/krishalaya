// modules/identity/__tests__/tenant9a-kyc-desk.spec.ts · PC-56 TENANT-9a · THE KYC DESK — the pure rules.
//
// The owning spec of the wave's domain: role-scope derivation (F-1/F-2), the organisation's computed verification (F-4),
// the expiry maths (F-3), the submit review builder (W2319–W2322), the acts' verdicts (W2323–W2325) and the microsecond
// cursor (F-7). The mutation pass runs against this file.
import { deriveRoleStatus, hasValidEvidence, isValidOn, payoutDestinationAllowed, planRoleWrites, roleMapFrom, rolesEvidencedBy, DocFact } from '../domain/kyc-role-scope';
import { organisationVerdict, typeState } from '../domain/kyc-org-status';
import { daysUntil, dueForReminder, isExpiringWithin, isLapsed, noticeDay, parseCivil } from '../domain/kyc-expiry';
import { buildSubmitReview, isMasked, SubmitFacts } from '../domain/kyc-submit-review';
import { actVerdict, isKycAct, retryIsMutation, ActDoc, ActActor } from '../domain/kyc-acts';
import { BIGINT_RE, decodeKeyset, encodeKeyset, US_SQL, UUID_RE } from '../domain/kyc-cursor';
import { canKycTransition } from '../domain/kyc-document.state';
import { KycDocument } from '../domain/kyc-document.entity';

const MAP = roleMapFrom([
  { docTypeCode: 'aadhaar', roleCode: 'worker' }, { docTypeCode: 'aadhaar', roleCode: 'sardar' },
  { docTypeCode: 'land_record', roleCode: 'farmer' }, { docTypeCode: 'pan', roleCode: 'vyapari' },
  { docTypeCode: 'aadhaar', roleCode: 'worker' },
]);
const TODAY = '2026-10-04';
const doc = (o: Partial<DocFact>): DocFact => ({ docTypeCode: 'aadhaar', status: 'verified', roleCode: null, validUntil: null, decidedAt: '2026-10-01T10:00:00.000000Z', ...o });

describe('TENANT-9a · role scope (F-1, F-2)', () => {
  it('the map is data, deduplicated, and a type with no rows evidences nothing', () => {
    expect(MAP.get('aadhaar')).toEqual(['worker', 'sardar']);
    expect(rolesEvidencedBy('rc', MAP, ['worker', 'farmer'])).toEqual([]);
  });
  it('F-1 · an Aadhaar evidences the worker the person holds, never the farmer', () => {
    expect(rolesEvidencedBy('aadhaar', MAP, ['worker', 'farmer'])).toEqual(['worker']);
    expect(rolesEvidencedBy('aadhaar', MAP, ['farmer'])).toEqual([]);
    expect(rolesEvidencedBy('aadhaar', MAP, ['worker', 'sardar'], 'sardar')).toEqual(['sardar']);
    expect(rolesEvidencedBy('aadhaar', MAP, ['worker', 'sardar'], 'farmer')).toEqual([]);
  });
  it('derivation: verified-and-valid wins; else pending; else the latest ending; nothing evidencing → null', () => {
    expect(deriveRoleStatus('farmer', [doc({})], MAP, TODAY)).toBeNull();
    expect(deriveRoleStatus('worker', [doc({})], MAP, TODAY)).toBe('verified');
    expect(deriveRoleStatus('worker', [doc({ status: 'verified' }), doc({ status: 'pending' })], MAP, TODAY)).toBe('verified');
    expect(deriveRoleStatus('worker', [doc({ status: 'pending' }), doc({ status: 'rejected' })], MAP, TODAY)).toBe('pending');
    expect(deriveRoleStatus('worker', [doc({ status: 'rejected', decidedAt: '2026-10-02T00:00:00.000000Z' }), doc({ status: 'expired', validUntil: '2026-09-01', decidedAt: '2026-10-01T00:00:00.000000Z' })], MAP, TODAY)).toBe('rejected');
    expect(deriveRoleStatus('worker', [doc({ status: 'rejected', decidedAt: '2026-09-02T00:00:00.000000Z' }), doc({ status: 'expired', validUntil: '2026-09-01', decidedAt: '2026-10-01T00:00:00.000000Z' })], MAP, TODAY)).toBe('expired');
    // a verification whose date has passed counts as an expiry even before the job writes it
    expect(deriveRoleStatus('worker', [doc({ validUntil: '2026-10-03' })], MAP, TODAY)).toBe('expired');
    expect(deriveRoleStatus('worker', [doc({ validUntil: '2026-10-04' })], MAP, TODAY)).toBe('verified');
    expect(deriveRoleStatus('worker', [doc({ status: 'weird' })], MAP, TODAY)).toBeNull();
    // a document filed for one role evidences only that role
    expect(deriveRoleStatus('worker', [doc({ roleCode: 'sardar' })], MAP, TODAY)).toBeNull();
    expect(deriveRoleStatus('sardar', [doc({ roleCode: 'sardar' })], MAP, TODAY)).toBe('verified');
  });
  it('isValidOn is inclusive of the last day and open for a document with no date', () => {
    expect(isValidOn(null, TODAY)).toBe(true);
    expect(isValidOn(TODAY, TODAY)).toBe(true);
    expect(isValidOn('2026-10-03', TODAY)).toBe(false);
  });
  it('F-2 · a renewal (a new pending document) leaves the verified role verified and writes nothing', () => {
    const roles = [{ roleCode: 'worker', kycStatus: 'verified', isActive: true }, { roleCode: 'farmer', kycStatus: 'verified', isActive: true }];
    const docs = [doc({ validUntil: '2026-12-31' }), doc({ status: 'pending', validUntil: '2027-12-31' })];
    expect(planRoleWrites(roles, docs, MAP, TODAY)).toEqual([]);
  });
  it('the plan writes only changed, evidenced roles', () => {
    const roles = [{ roleCode: 'worker', kycStatus: 'none', isActive: true }, { roleCode: 'farmer', kycStatus: 'pending', isActive: true }, { roleCode: 'sardar', kycStatus: 'verified', isActive: true }];
    expect(planRoleWrites(roles, [doc({})], MAP, TODAY)).toEqual([{ roleCode: 'worker', from: 'none', to: 'verified' }]);
    expect(planRoleWrites(roles, [doc({ status: 'pending' })], MAP, TODAY)).toEqual([{ roleCode: 'worker', from: 'none', to: 'pending' }, { roleCode: 'sardar', from: 'verified', to: 'pending' }]);
  });
  it('the plan never moves a verified role off verified while valid evidence exists (the belt under the derivation)', () => {
    const docs = [doc({ roleCode: 'sardar' })];
    expect(hasValidEvidence('sardar', docs, MAP, TODAY)).toBe(true);
    expect(hasValidEvidence('worker', docs, MAP, TODAY)).toBe(false);
    expect(hasValidEvidence('sardar', [doc({ roleCode: 'sardar', validUntil: '2026-01-01' })], MAP, TODAY)).toBe(false);
    expect(hasValidEvidence('farmer', [doc({})], MAP, TODAY)).toBe(false);
    const lapsed = [doc({ validUntil: '2026-10-01' })];
    expect(planRoleWrites([{ roleCode: 'worker', kycStatus: 'verified', isActive: true }], lapsed, MAP, TODAY)).toEqual([{ roleCode: 'worker', from: 'verified', to: 'expired' }]);
  });
  it('F-19 · a payout destination needs a verified PAYEE role, active', () => {
    expect(payoutDestinationAllowed([{ roleCode: 'customer', kycStatus: 'verified', isActive: true }], ['farmer', 'worker'])).toEqual({ allowed: false, decidingRole: null });
    expect(payoutDestinationAllowed([{ roleCode: 'worker', kycStatus: 'verified', isActive: false }], ['worker'])).toEqual({ allowed: false, decidingRole: null });
    expect(payoutDestinationAllowed([{ roleCode: 'worker', kycStatus: 'expired', isActive: true }], ['worker'])).toEqual({ allowed: false, decidingRole: null });
    expect(payoutDestinationAllowed([{ roleCode: 'worker', kycStatus: 'verified', isActive: true }], ['worker'])).toEqual({ allowed: true, decidingRole: 'worker' });
  });
});

describe('TENANT-9a · the organisation, computed (F-4)', () => {
  const reqs = [{ docTypeCode: 'society_registration', isRequired: true }, { docTypeCode: 'pan_org', isRequired: true }, { docTypeCode: 'fssai_licence', isRequired: false }];
  const od = (id: string, code: string, status: string, validUntil: string | null = null, reviewedAt: string | null = '2026-09-01T00:00:00.000Z') => ({ id, docTypeCode: code, status, validUntil, reviewedAt });
  it('no requirement declared for the country → NOT verified (unknown refuses)', () => {
    expect(organisationVerdict([], [od('a', 'pan_org', 'verified')], TODAY)).toMatchObject({ verified: false, reason: 'no_requirement_declared' });
    expect(organisationVerdict([{ docTypeCode: 'pan_org', isRequired: false }], [od('a', 'pan_org', 'verified')], TODAY).verified).toBe(false);
  });
  it('every REQUIRED type verified and unexpired → verified, at the latest decision; optional types do not decide', () => {
    const v = organisationVerdict(reqs, [od('a', 'society_registration', 'verified', null, '2026-09-01T00:00:00.000Z'), od('b', 'pan_org', 'verified', null, '2026-09-03T00:00:00.000Z')], TODAY);
    expect(v).toMatchObject({ verified: true, reason: 'all_required_verified', missingRequired: [], verifiedAt: '2026-09-03T00:00:00.000Z' });
    expect(v.lines.find((l) => l.docTypeCode === 'fssai_licence')!.state).toBe('missing');
  });
  it('a required type pending, rejected, lapsed or missing → not verified, with the types named', () => {
    const v = organisationVerdict(reqs, [od('a', 'society_registration', 'verified', '2026-10-01'), od('b', 'pan_org', 'pending')], TODAY);
    expect(v).toMatchObject({ verified: false, reason: 'required_types_missing', missingRequired: ['society_registration', 'pan_org'], verifiedAt: null });
    expect(v.lines.map((l) => l.state)).toEqual(['expired', 'pending', 'missing']);
    // ONE required type short is enough to be not verified
    expect(organisationVerdict(reqs, [od('a', 'society_registration', 'verified')], TODAY)).toMatchObject({ verified: false, missingRequired: ['pan_org'] });
  });
  it('typeState: valid beats pending beats the newest ending', () => {
    expect(typeState('x', [od('1', 'x', 'pending'), od('2', 'x', 'verified')], TODAY)).toMatchObject({ state: 'verified', doc: { id: '2' } });
    expect(typeState('x', [od('1', 'x', 'rejected'), od('2', 'x', 'pending')], TODAY)).toMatchObject({ state: 'pending', doc: { id: '2' } });
    expect(typeState('x', [od('1', 'x', 'rejected'), od('2', 'x', 'expired', '2026-01-01')], TODAY)).toMatchObject({ state: 'rejected', doc: { id: '1' } });
    expect(typeState('x', [od('1', 'x', 'expired', '2026-01-01'), od('2', 'x', 'rejected')], TODAY)).toMatchObject({ state: 'expired', doc: { id: '1' } });
    expect(typeState('x', [od('1', 'y', 'verified')], TODAY)).toEqual({ state: 'missing', doc: null });
    expect(typeState('x', [od('1', 'x', 'odd')], TODAY)).toEqual({ state: 'missing', doc: null });
  });
});

describe('TENANT-9a · expiry maths (F-3)', () => {
  it('civil dates, with the impossible ones refused', () => {
    expect(parseCivil('2026-02-31')).toBeNull();
    expect(parseCivil('2026-13-01')).toBeNull();
    expect(parseCivil('2026-00-10')).toBeNull();
    expect(parseCivil('2026-1-01')).toBeNull();
    expect(parseCivil('2026-12-31')).not.toBeNull();
    expect(parseCivil('2024-02-29')).not.toBeNull();
    expect(parseCivil('2026-01-32')).toBeNull();
    expect(parseCivil('2026-01-00')).toBeNull();
  });
  it('days until, lapsed, expiring within (inclusive)', () => {
    expect(daysUntil('2026-10-04', TODAY)).toBe(0);
    expect(daysUntil('2026-12-22', TODAY)).toBe(79);
    expect(daysUntil('2026-10-03', TODAY)).toBe(-1);
    expect(daysUntil('bad', TODAY)).toBeNull();
    expect(daysUntil(TODAY, 'bad')).toBeNull();
    expect(isLapsed(null, TODAY)).toBe(false);
    expect(isLapsed('2026-10-04', TODAY)).toBe(false);
    expect(isLapsed('2026-10-03', TODAY)).toBe(true);
    expect(isLapsed('junk', TODAY)).toBe(false);
    expect(isExpiringWithin('2026-11-03', TODAY, 30)).toBe(true);
    expect(isExpiringWithin('2026-11-04', TODAY, 30)).toBe(false);
    expect(isExpiringWithin('2026-10-04', TODAY, 30)).toBe(true);
    expect(isExpiringWithin('2026-10-03', TODAY, 30)).toBe(false);
    expect(isExpiringWithin(null, TODAY, 30)).toBe(false);
    expect(isExpiringWithin('junk', TODAY, 30)).toBe(false);
  });
  it('a reminder goes once, only for a verified document still inside the window', () => {
    const d = { status: 'verified', validUntil: '2026-10-20', remindedAt: null };
    expect(dueForReminder(d, TODAY, 30)).toBe(true);
    expect(dueForReminder({ ...d, remindedAt: '2026-10-01T00:00:00Z' }, TODAY, 30)).toBe(false);
    expect(dueForReminder({ ...d, status: 'pending' }, TODAY, 30)).toBe(false);
    expect(dueForReminder({ ...d, validUntil: '2026-10-01' }, TODAY, 30)).toBe(false);
  });
  it('the notice prints digits, never a month name', () => {
    expect(noticeDay('2026-09-30')).toBe('30/09/2026');
    expect(noticeDay('soon')).toBe('soon');
  });
});

describe('TENANT-9a · the submit review (W2319–W2322)', () => {
  const ME = '11111111-1111-4111-8111-111111111111';
  const MEMBER = '22222222-2222-4222-8222-222222222222';
  const base: SubmitFacts = {
    actorUserId: ME, canManage: true, docType: { code: 'aadhaar', validity: 'optional' }, docTypeKnown: true,
    heldRoles: ['worker', 'farmer'], map: MAP, media: { kind: 'image', scanStatus: 'clean' }, openDuplicateId: null, current: null, today: TODAY,
  };
  const ok = { subjectKind: 'user', userId: MEMBER, docTypeCode: 'aadhaar', mediaId: '33333333-3333-4333-8333-333333333333' };
  const codes = (r: ReturnType<typeof buildSubmitReview>) => r.refusals.map((x) => `${x.field ?? '-'}:${x.code}`);

  it('a member document on behalf: ready, and it says WHICH roles it will evidence', () => {
    const r = buildSubmitReview(ok, base);
    expect(r.ready).toBe(true);
    expect(r.evidences).toEqual(['worker']);
    expect(r.self).toBe(false);
    expect(r.subjectKind).toBe('user');
    expect(r.follows).toBeNull();
    expect(r.diff).toBeNull();
    expect(r.scan).toBe('clean');
    expect(r.fields.map((f) => f.name)).toEqual(['subjectKind', 'userId', 'docTypeCode', 'roleCode', 'mediaId', 'docNoMasked', 'issuedBy', 'validFrom', 'validUntil']);
  });
  it('permission: on behalf needs kyc.manage, your own does not; the organisation always does', () => {
    expect(codes(buildSubmitReview(ok, { ...base, canManage: false }))).toEqual(['-:NO_PERMISSION']);
    expect(buildSubmitReview({ ...ok, userId: ME }, { ...base, canManage: false })).toMatchObject({ ready: true, self: true });
    expect(buildSubmitReview({ ...ok, userId: null }, { ...base, canManage: false })).toMatchObject({ ready: true, self: true });
    expect(codes(buildSubmitReview({ subjectKind: 'organisation', docTypeCode: 'pan_org', mediaId: ok.mediaId }, { ...base, canManage: false, heldRoles: [], docType: { code: 'pan_org', validity: 'optional' } }))).toEqual(['-:NO_PERMISSION']);
  });
  it('an organisation document evidences no role, drops the person fields, and needs no held role', () => {
    const r = buildSubmitReview({ subjectKind: 'organisation', docTypeCode: 'pan_org', mediaId: ok.mediaId }, { ...base, heldRoles: [], docType: { code: 'pan_org', validity: 'optional' } });
    expect(r).toMatchObject({ ready: true, evidences: [], subjectKind: 'organisation', self: false });
    expect(r.fields.map((f) => f.name)).not.toContain('userId');
    expect(r.fields.map((f) => f.name)).not.toContain('roleCode');
    expect(r.fields.find((f) => f.name === 'userId')).toBeUndefined();
  });
  it('subject refusals', () => {
    expect(codes(buildSubmitReview({ ...ok, subjectKind: 'cow' }, base))).toContain('subjectKind:SUBJECT_KIND_INVALID');
    expect(codes(buildSubmitReview(ok, { ...base, heldRoles: null }))).toContain('userId:SUBJECT_NOT_MEMBER');
  });
  it('document type refusals, in order of what is wrong', () => {
    expect(codes(buildSubmitReview({ ...ok, docTypeCode: '' }, base))).toEqual(['docTypeCode:DOC_TYPE_REQUIRED']);
    expect(codes(buildSubmitReview(ok, { ...base, docTypeKnown: false }))).toEqual(['docTypeCode:DOC_TYPE_UNKNOWN']);
    expect(codes(buildSubmitReview(ok, { ...base, docType: null }))).toEqual(['docTypeCode:DOC_TYPE_NOT_FOR_SUBJECT']);
    expect(codes(buildSubmitReview(ok, { ...base, heldRoles: ['farmer'] }))).toEqual(['docTypeCode:EVIDENCES_NO_HELD_ROLE']);
    expect(codes(buildSubmitReview({ ...ok, roleCode: 'farmer' }, base))).toEqual(['roleCode:ROLE_NOT_EVIDENCED']);
    expect(buildSubmitReview({ ...ok, roleCode: 'worker' }, base)).toMatchObject({ ready: true, evidences: ['worker'] });
  });
  it('evidence refusals: required, unknown, the wrong kind, infected or failed; a pending scan is accepted and shown', () => {
    expect(codes(buildSubmitReview({ ...ok, mediaId: ' ' }, base))).toEqual(['mediaId:MEDIA_REQUIRED']);
    expect(codes(buildSubmitReview(ok, { ...base, media: null }))).toEqual(['mediaId:MEDIA_UNKNOWN']);
    expect(codes(buildSubmitReview(ok, { ...base, media: { kind: 'video', scanStatus: 'clean' } }))).toEqual(['mediaId:MEDIA_KIND_MISMATCH']);
    expect(codes(buildSubmitReview(ok, { ...base, media: { kind: 'document', scanStatus: 'infected' } }))).toEqual(['mediaId:MEDIA_INFECTED']);
    expect(codes(buildSubmitReview(ok, { ...base, media: { kind: 'document', scanStatus: 'failed' } }))).toEqual(['mediaId:MEDIA_INFECTED']);
    expect(buildSubmitReview(ok, { ...base, media: { kind: 'document', scanStatus: 'pending' } })).toMatchObject({ ready: true, scan: 'pending' });
  });
  it('the number must arrive masked; issuer bounded and plain', () => {
    expect(isMasked('1072••••••0143')).toBe(true);
    expect(isMasked('24AAB••••••1Z5')).toBe(true);
    expect(isMasked('XXXX-XXXX-1234')).toBe(true);
    expect(isMasked('107212340143')).toBe(false);
    expect(isMasked('1072•0143')).toBe(false);
    expect(isMasked('10721••')).toBe(false);
    expect(codes(buildSubmitReview({ ...ok, docNoMasked: '999999990019' }, base))).toEqual(['docNoMasked:DOC_NO_NOT_MASKED']);
    expect(codes(buildSubmitReview({ ...ok, docNoMasked: 'X'.repeat(51) }, base))).toEqual(['docNoMasked:TOO_LONG']);
    expect(buildSubmitReview({ ...ok, docNoMasked: 'X'.repeat(50) }, base).ready).toBe(true);
    expect(codes(buildSubmitReview({ ...ok, issuedBy: 'a'.repeat(151) }, base))).toEqual(['issuedBy:TOO_LONG']);
    expect(buildSubmitReview({ ...ok, issuedBy: 'a'.repeat(150) }, base).ready).toBe(true);
    expect(codes(buildSubmitReview({ ...ok, issuedBy: 'FSSAI <b>' }, base))).toEqual(['issuedBy:TEXT_HAS_MARKUP']);
    const r = buildSubmitReview({ ...ok, issuedBy: '  FSSAI   Gujarat ' }, base);
    expect(r.fields.find((f) => f.name === 'issuedBy')).toMatchObject({ stored: 'FSSAI Gujarat', normalised: true });
    expect(r.fields.find((f) => f.name === 'docTypeCode')).toMatchObject({ stored: 'aadhaar', normalised: false });
  });
  it('validity: required dates, real dates, order, not lapsed, not from the future', () => {
    const lic = { ...base, docType: { code: 'fssai_licence', validity: 'required' as const }, heldRoles: [], map: MAP };
    const org = { subjectKind: 'organisation', docTypeCode: 'fssai_licence', mediaId: ok.mediaId };
    expect(codes(buildSubmitReview(org, lic))).toEqual(['validUntil:VALID_UNTIL_REQUIRED']);
    expect(buildSubmitReview({ ...org, validUntil: '2027-09-30' }, lic)).toMatchObject({ ready: true, validity: { required: true, validUntil: '2027-09-30', daysValid: 361 } });
    expect(codes(buildSubmitReview({ ...org, validUntil: '2027-02-30' }, lic))).toEqual(['validUntil:DATE_INVALID']);
    expect(codes(buildSubmitReview({ ...org, validUntil: '2027-09-30', validFrom: 'x' }, lic))).toEqual(['validFrom:DATE_INVALID']);
    expect(codes(buildSubmitReview({ ...org, validUntil: '2026-10-03' }, lic))).toEqual(['validUntil:ALREADY_LAPSED']);
    expect(buildSubmitReview({ ...org, validUntil: '2026-10-04' }, lic).ready).toBe(true);
    expect(codes(buildSubmitReview({ ...org, validUntil: '2026-12-01', validFrom: '2026-12-02' }, lic))).toEqual(['validUntil:VALIDITY_ORDER', 'validFrom:VALID_FROM_FUTURE']);
    expect(codes(buildSubmitReview({ ...org, validUntil: '2026-12-01', validFrom: '2026-10-05' }, lic))).toEqual(['validFrom:VALID_FROM_FUTURE']);
    expect(buildSubmitReview({ ...org, validUntil: '2026-12-01', validFrom: '2026-10-04' }, lic).ready).toBe(true);
    expect(buildSubmitReview({ ...org, validUntil: '2026-12-01', validFrom: '2026-12-01' }, { ...lic, today: '2026-12-01' }).ready).toBe(true);
    expect(buildSubmitReview(ok, base).validity).toEqual({ required: false, validFrom: null, validUntil: null, daysValid: null });
  });
  it('a duplicate open submission is refused', () => {
    expect(codes(buildSubmitReview(ok, { ...base, openDuplicateId: 'x' }))).toEqual(['docTypeCode:DUPLICATE_OPEN_SUBMISSION']);
  });
  it('a renewal follows the verified document, must reach further, and shows the diff; a resubmission follows a rejection', () => {
    const cur = { id: 'old', status: 'verified', validUntil: '2026-12-31', docNoMasked: '1072••••••0143', issuedBy: 'FSSAI Gujarat' };
    const lic = { ...base, docType: { code: 'fssai_licence', validity: 'required' as const }, heldRoles: [], current: cur };
    const org = { subjectKind: 'organisation', docTypeCode: 'fssai_licence', mediaId: ok.mediaId, docNoMasked: '1072••••••0143', issuedBy: 'FSSAI Gujarat' };
    const r = buildSubmitReview({ ...org, validUntil: '2027-12-31' }, lic);
    expect(r).toMatchObject({ ready: true, follows: { id: 'old', kind: 'renewal', validUntil: '2026-12-31' } });
    expect(r.diff).toEqual([{ field: 'validUntil', before: '2026-12-31', after: '2027-12-31' }]);
    expect(codes(buildSubmitReview({ ...org, validUntil: '2026-12-31' }, lic))).toEqual(['validUntil:RENEWAL_NOT_LATER']);
    expect(buildSubmitReview({ ...org, validUntil: '2027-01-01' }, lic).ready).toBe(true);
    expect(buildSubmitReview({ ...org, validUntil: '2026-11-01' }, { ...lic, current: { ...cur, status: 'rejected' } })).toMatchObject({ ready: true, follows: { kind: 'resubmission' } });
    expect(buildSubmitReview({ ...org, validUntil: '2026-11-01' }, { ...lic, current: { ...cur, validUntil: null } }).ready).toBe(true);
  });
  it('entered vs stored: the person defaults to the actor, blanks become nothing', () => {
    const r = buildSubmitReview({ subjectKind: 'user', docTypeCode: 'aadhaar', mediaId: ok.mediaId, docNoMasked: '   ' }, base);
    expect(r.fields.find((f) => f.name === 'userId')).toMatchObject({ entered: null, stored: ME, normalised: false });
    expect(r.fields.find((f) => f.name === 'docNoMasked')).toMatchObject({ entered: '   ', stored: null, normalised: true });
    expect(r.fields.find((f) => f.name === 'subjectKind')).toMatchObject({ entered: 'user', stored: 'user' });
    expect(buildSubmitReview({ docTypeCode: 'aadhaar', mediaId: ok.mediaId }, base).subjectKind).toBe('user');
  });
});

describe('TENANT-9a · the desk acts (W2323–W2325)', () => {
  const D: ActDoc = { status: 'pending', subjectKind: 'user', userId: 'member', submittedBy: 'maker', hasMedia: true, scanStatus: 'clean', validUntil: null };
  const A: ActActor = { userId: 'checker', canReview: true, canReveal: true, isTenantAdmin: false };
  const reasons = new Map([['blurry_image', { acts: ['reject', 'request_more'], needsNote: false }], ['other', { acts: ['reject', 'request_more'], needsNote: true }], ['back_side_missing', { acts: ['request_more'], needsNote: false }]]);
  const o = { revealedByActor: true, reasons, today: TODAY };
  it('a checker who has opened the evidence verifies a pending document', () => {
    expect(actVerdict('verify', D, A, o)).toEqual({ act: 'verify', allowed: true, refusals: [], to: 'verified' });
  });
  it('maker ≠ checker, never your own, never your organisation as its admin', () => {
    expect(actVerdict('verify', D, { ...A, userId: 'maker' }, o).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(actVerdict('verify', D, { ...A, userId: 'member' }, o).refusals).toEqual(['OWN_DOCUMENT']);
    expect(actVerdict('verify', { ...D, subjectKind: 'organisation', userId: null }, { ...A, isTenantAdmin: true }, o).refusals).toEqual(['SELF_CERTIFICATION']);
    expect(actVerdict('verify', D, { ...A, isTenantAdmin: true }, o).allowed).toBe(true);
    expect(actVerdict('verify', { ...D, subjectKind: 'organisation', userId: null }, { ...A, userId: 'member' }, o).allowed).toBe(true);
  });
  it('the desk verb, a pending document, evidence before decision, a clean scan, not lapsed', () => {
    expect(actVerdict('verify', D, { ...A, canReview: false }, o).refusals).toEqual(['NO_PERMISSION']);
    expect(actVerdict('verify', { ...D, status: 'verified' }, A, o).refusals).toEqual(['NOT_PENDING']);
    expect(actVerdict('verify', D, A, { ...o, revealedByActor: false }).refusals).toEqual(['EVIDENCE_NOT_REVEALED']);
    expect(actVerdict('verify', { ...D, hasMedia: false }, A, { ...o, revealedByActor: false }).allowed).toBe(true);
    expect(actVerdict('verify', { ...D, scanStatus: 'pending' }, A, o).refusals).toEqual(['EVIDENCE_NOT_CLEAN']);
    expect(actVerdict('reject', { ...D, scanStatus: 'pending' }, A, { ...o, reasonCode: 'blurry_image' }).allowed).toBe(true);
    expect(actVerdict('verify', { ...D, validUntil: '2026-10-03' }, A, o).refusals).toEqual(['ALREADY_LAPSED']);
    expect(actVerdict('verify', { ...D, validUntil: '2026-10-04' }, A, o).allowed).toBe(true);
  });
  it('a refusal carries a coded reason that grounds the act, with words when it asks', () => {
    expect(actVerdict('reject', D, A, o).refusals).toEqual(['REASON_REQUIRED']);
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'nope' }).refusals).toEqual(['REASON_UNKNOWN']);
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'back_side_missing' }).refusals).toEqual(['REASON_NOT_FOR_ACT']);
    expect(actVerdict('request_more', D, A, { ...o, reasonCode: 'back_side_missing' })).toEqual({ act: 'request_more', allowed: true, refusals: [], to: 'rejected' });
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'other', note: 'ok' }).refusals).toEqual(['NOTE_REQUIRED']);
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'other', note: 'the stamp is torn' }).allowed).toBe(true);
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'blurry_image', note: 'x'.repeat(501) }).refusals).toEqual(['NOTE_TOO_LONG']);
    expect(actVerdict('reject', D, A, { ...o, reasonCode: 'blurry_image', note: 'x'.repeat(500) }).allowed).toBe(true);
    expect(actVerdict('verify', D, A, { ...o, note: 'x'.repeat(501) }).refusals).toEqual(['NOTE_TOO_LONG']);
    expect(actVerdict('reject', D, A, { ...o, judgeWords: false }).allowed).toBe(true);
  });
  it('reveal: its own grant, evidence that exists and is clean, a reason of twenty characters', () => {
    const why = 'checking the name against the land record';
    expect(actVerdict('reveal', D, A, { ...o, note: why })).toEqual({ act: 'reveal', allowed: true, refusals: [], to: null });
    expect(actVerdict('reveal', D, { ...A, canReveal: false }, { ...o, note: why }).refusals).toEqual(['NO_PERMISSION']);
    expect(actVerdict('reveal', { ...D, hasMedia: false }, A, { ...o, note: why }).refusals).toEqual(['NO_EVIDENCE']);
    expect(actVerdict('reveal', { ...D, scanStatus: 'pending' }, A, { ...o, note: why }).refusals).toEqual(['EVIDENCE_NOT_CLEAN']);
    expect(actVerdict('reveal', D, A, { ...o, note: '  short reason  here ' }).refusals).toEqual(['REVEAL_REASON_TOO_SHORT']);
    expect(actVerdict('reveal', D, A, { ...o, note: 'x'.repeat(20) }).allowed).toBe(true);
    expect(actVerdict('reveal', D, A, { ...o, note: 'x'.repeat(501) }).refusals).toEqual(['NOTE_TOO_LONG']);
    expect(actVerdict('reveal', D, A, { ...o, judgeWords: false }).allowed).toBe(true);
    // a reveal is not a decision: the submitter, a verified document and the admin may all open it
    expect(actVerdict('reveal', { ...D, status: 'verified', subjectKind: 'organisation' }, { ...A, userId: 'maker', isTenantAdmin: true }, { ...o, note: why }).allowed).toBe(true);
  });
  it('acts are a closed list; Retry is a page load', () => {
    expect(isKycAct('verify')).toBe(true);
    expect(isKycAct('retry')).toBe(false);
    expect(retryIsMutation()).toBe(false);
  });
});

describe('TENANT-9a · the microsecond cursor (F-7)', () => {
  const id = '0190a8c2-1111-7000-8000-000000000001';
  it('round-trips the instant to the microsecond', () => {
    const c = encodeKeyset('2026-10-04T10:00:00.123456Z', id);
    expect(decodeKeyset(c, UUID_RE)).toEqual({ ts: '2026-10-04T10:00:00.123456Z', id });
  });
  it('refuses a millisecond instant at encode, and anything malformed decodes to page one', () => {
    expect(() => encodeKeyset('2026-10-04T10:00:00.123Z', id)).toThrow(/microsecond/);
    expect(decodeKeyset(Buffer.from(`2026-10-04T10:00:00.123Z|${id}`).toString('base64url'), UUID_RE)).toBeUndefined();
    expect(decodeKeyset(Buffer.from(`2026-10-04T10:00:00.123456Z|nope`).toString('base64url'), UUID_RE)).toBeUndefined();
    expect(decodeKeyset(Buffer.from('nobar').toString('base64url'), UUID_RE)).toBeUndefined();
    expect(decodeKeyset('', UUID_RE)).toBeUndefined();
    expect(decodeKeyset(undefined, UUID_RE)).toBeUndefined();
    expect(decodeKeyset(Buffer.from('2026-10-04T10:00:00.123456Z|42').toString('base64url'), BIGINT_RE)).toEqual({ ts: '2026-10-04T10:00:00.123456Z', id: '42' });
  });
  it('the SQL prints six fractional digits in UTC', () => {
    expect(US_SQL('k.created_at')).toBe(`to_char(k.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
  });
});

describe('TENANT-9a · the document lifecycle (Law 5)', () => {
  it('a document never goes back to pending; a verified one only expires', () => {
    expect(canKycTransition('pending', 'verified')).toBe(true);
    expect(canKycTransition('pending', 'rejected')).toBe(true);
    expect(canKycTransition('verified', 'expired')).toBe(true);
    expect(canKycTransition('verified', 'rejected')).toBe(false);
    expect(canKycTransition('rejected', 'pending')).toBe(false);
    expect(canKycTransition('expired', 'pending')).toBe(false);
  });
  it('the entity names its maker, its notice recipient, and a coded refusal', () => {
    const d = KycDocument.submit({ id: 'd1', tenantId: 't', subjectKind: 'organisation', docTypeId: 'x', docTypeCode: 'pan_org', submittedBy: 'admin' });
    expect(d.toProps()).toMatchObject({ subjectKind: 'organisation', userId: null, organisationId: 't', submittedBy: 'admin', lastDecision: 'submit' });
    expect(d.notifyUserId).toBe('admin');
    d.pullEvents();
    d.reject('checker', 'blurry', new Date('2026-10-04T00:00:00Z'), { reasonCode: 'blurry_image', decision: 'request_more' });
    expect(d.toProps()).toMatchObject({ status: 'rejected', reasonCode: 'blurry_image', lastDecision: 'request_more', reviewedBy: 'checker' });
    expect(d.pullEvents()[0]).toMatchObject({ type: 'identity.kyc_rejected', payload: { notifyUserId: 'admin', reasonCode: 'blurry_image', decision: 'request_more' } });
    expect(() => KycDocument.submit({ id: 'd2', tenantId: 't', subjectKind: 'organisation', docTypeId: 'x' })).toThrow(/submitted/);
    const p = KycDocument.submit({ id: 'd3', tenantId: 't', userId: 'member', docTypeId: 'x' });
    expect(p.toProps().submittedBy).toBe('member');
    p.verify(null);
    expect(p.toProps()).toMatchObject({ status: 'verified', reviewedBy: null, lastDecision: 'verify' });
  });
});
