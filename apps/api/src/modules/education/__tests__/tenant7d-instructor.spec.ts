// modules/education/__tests__/tenant7d-instructor.spec.ts · PC-56 TENANT-7d · the instructor's pure logic: the two
// reviewers (profile · credential), the studio form's reviewer (from a template), the acts as verdicts, the entities'
// transitions, and W410's completeness as facts.
import { Instructor } from '../domain/instructor.entity';
import { InstructorCredential, canCredentialTransition } from '../domain/instructor-credential.entity';
import {
  CredentialReviewInput, MAX_LANGUAGES, ProfileReviewInput, RegistryLanguage, credentialFormValues, parseCredentialYear, parseLanguageCodes, profileCompleteness, profileFormValues,
  reviewCredential, reviewInstructorProfile, storedCredential, storedProfile, INSTRUCTOR_REVIEW_REFUSALS,
} from '../domain/instructor-review';
import { INSTRUCTOR_ACTS, INSTRUCTOR_ACT_REFUSALS, InstructorActInput, allInstructorVerdicts, instructorActVerdict, isInstructorAct } from '../domain/instructor-acts';
import { CourseTemplateRow, TEMPLATE_REVIEW_REFUSALS, TemplateReviewInput, parseOutline, reviewFromTemplate, storedFromTemplate } from '../domain/course-template';
import { InvalidCourseError } from '../domain/education.errors';

const REG: RegistryLanguage[] = [
  { code: 'gu', nameEnglish: 'Gujarati', nameNative: 'ગુજરાતી', isActive: true },
  { code: 'hi', nameEnglish: 'Hindi', nameNative: 'हिन्दी', isActive: true },
  { code: 'en', nameEnglish: 'English', nameNative: 'English', isActive: true },
  { code: 'mr', nameEnglish: 'Marathi', nameNative: 'मराठी', isActive: false },
];
const P = (o: Partial<ProfileReviewInput> = {}): ProfileReviewInput => ({ canAuthor: true, current: null, entered: { displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist with Anand FPO.', languages: 'gu,hi,en', visibility: 'public' }, registry: REG, ...o });
const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => (x.field ? `${x.field}/${x.code}` : x.code));
const row = (r: { fields: Array<{ name: string; stored: string | null }> }, n: string) => r.fields.find((f) => f.name === n)!.stored;

describe('PC-56 TENANT-7d · the profile review', () => {
  it('a ready review stores the name, the bio, the codes the registry holds, the visibility — and shows each language by its own name', () => {
    const r = reviewInstructorProfile(P());
    expect(r.ready).toBe(true); expect(r.entityType).toBe('instructor'); expect(r.diff).toBeNull();
    expect(row(r, 'languages')).toBe('gu · ગુજરાતી (Gujarati)\nhi · हिन्दी (Hindi)\nen · English (English)');
    expect(storedProfile(P())).toEqual({ displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist with Anand FPO.', languages: ['gu', 'hi', 'en'], visibility: 'public' });
  });
  it('refuses by name: no author, no bio, a code the registry lacks, an inactive code, too many, a visibility that is not one, a name too short', () => {
    expect(codes(reviewInstructorProfile(P({ canAuthor: false })))).toEqual(['NO_AUTHOR']);
    expect(codes(reviewInstructorProfile(P({ entered: { bio: '   ', languages: 'gu' } })))).toEqual(['bio/BIO_REQUIRED']);
    expect(codes(reviewInstructorProfile(P({ entered: { bio: 'x', languages: 'gu,xx,yy' } })))).toEqual(['languages/LANGUAGE_UNKNOWN']);   // once, not per code
    expect(codes(reviewInstructorProfile(P({ entered: { bio: 'x', languages: 'mr' } })))).toEqual(['languages/LANGUAGE_INACTIVE']);
    expect(codes(reviewInstructorProfile(P({ entered: { bio: 'x', languages: 'gu,hi,en,gu,hi' } })))).toEqual([]);   // duplicates collapse
    expect(codes(reviewInstructorProfile(P({ registry: [...REG, ...'abcdefg'.split('').map((c) => ({ code: c, nameEnglish: c, nameNative: c, isActive: true }))], entered: { bio: 'x', languages: 'a,b,c,d,e,f,g' } })))).toEqual(['languages/LANGUAGES_TOO_MANY']);
    expect(codes(reviewInstructorProfile(P({ entered: { bio: 'x', visibility: 'secret' } })))).toEqual(['visibility/VISIBILITY_INVALID']);
    expect(codes(reviewInstructorProfile(P({ entered: { displayName: 'K', bio: 'x' } })))).toEqual(['displayName/DISPLAY_NAME_INVALID']);
    expect(codes(reviewInstructorProfile(P({ entered: { displayName: 'K'.repeat(121), bio: 'x' } })))).toEqual(['displayName/DISPLAY_NAME_INVALID']);   // the column's width (0173: varchar(120))
    expect(codes(reviewInstructorProfile(P({ entered: { displayName: 'K'.repeat(120), bio: 'x' } })))).toEqual([]);
    expect(storedProfile(P({ entered: { bio: '' } }))).toBeNull();
    expect(MAX_LANGUAGES).toBe(6);
  });
  it('the languages are parsed as codes, lower-cased, deduplicated, blanks dropped; a blank visibility keeps the current one', () => {
    expect(parseLanguageCodes(' GU, hi ,,en,gu ')).toEqual(['gu', 'hi', 'en']); expect(parseLanguageCodes(undefined)).toEqual([]);
    const cur = { displayName: null, bio: 'old', languages: ['gu'], visibility: 'private' as const };
    expect(storedProfile(P({ current: cur, entered: { bio: 'new' } }))!.visibility).toBe('private');
    // and the REVIEW ROW says the same — a review that showed 'public' over a row that stays private is an echo of a default, not of the fact
    expect(row(reviewInstructorProfile(P({ current: cur, entered: { bio: 'new' } })), 'visibility')).toBe('private');
    // languages NOT sent = every box unticked = cleared; the diff says so (a blank visibility, by contrast, keeps the row's)
    expect(reviewInstructorProfile(P({ current: cur, entered: { bio: 'new' } })).diff).toEqual([{ field: 'bio', before: 'old', after: 'new' }, { field: 'languages', before: 'gu', after: null }]);
    expect(storedProfile(P({ current: null, entered: { bio: 'new' } }))!.visibility).toBe('public');
  });
  it('an edit carries the diff of what changed and nothing else; the form values re-open as typed', () => {
    const cur = { displayName: 'Kalpana', bio: 'old bio', languages: ['gu', 'hi'], visibility: 'public' as const };
    const r = reviewInstructorProfile(P({ current: cur, entered: { displayName: 'Dr. Kalpana Joshi', bio: 'old bio', languages: 'hi,gu', visibility: 'private' } }));
    expect(r.diff).toEqual([{ field: 'displayName', before: 'Kalpana', after: 'Dr. Kalpana Joshi' }, { field: 'languages', before: 'gu, hi', after: 'hi, gu' }, { field: 'visibility', before: 'public', after: 'private' }]);
    expect(profileFormValues(cur)).toEqual({ displayName: 'Kalpana', bio: 'old bio', languages: 'gu,hi', visibility: 'public' });
    expect(profileFormValues({ ...cur, displayName: null, bio: null, languages: [] })).toEqual({ displayName: '', bio: '', languages: '', visibility: 'public' });
  });
  it('the writer\'s own complaints reach the review as refusals against the field, never on top of a named reason', () => {
    const r = reviewInstructorProfile(P({ writerIssues: [{ path: 'bio', tooLong: true }, { path: 'displayName', tooLong: false }, { path: 'nope', tooLong: false }] }));
    expect(codes(r)).toEqual(['bio/TOO_LONG', 'displayName/VALUE_REJECTED', 'VALUE_REJECTED']);
    expect(codes(reviewInstructorProfile(P({ entered: { bio: '' }, writerIssues: [{ path: 'bio', tooLong: false }] })))).toEqual(['bio/BIO_REQUIRED']);
    expect(INSTRUCTOR_REVIEW_REFUSALS).toContain('TOO_LONG');
  });
});

const DOC = { kind: 'document', scanStatus: 'clean', mimeType: 'application/pdf' };
const C = (o: Partial<CredentialReviewInput> = {}): CredentialReviewInput => ({ canAuthor: true, hasProfile: true, entered: { title: 'BVSc & AH', issuer: 'GAU', yearAwarded: '2009', documentMediaId: 'd1' }, document: DOC, thisYear: 2026, ...o });

describe('PC-56 TENANT-7d · the credential review', () => {
  it('a ready review stores the title, issuer, year and document — and shows what the form never asked: the status it will have', () => {
    const r = reviewCredential(C());
    expect(r.ready).toBe(true); expect(r.entityType).toBe('instructor_credential'); expect(r.diff).toBeNull();
    expect(row(r, 'documentMediaId')).toBe('d1 · document · application/pdf · clean'); expect(row(r, 'status')).toBe('submitted'); expect(row(r, 'answersNote')).toBeNull();
    expect(storedCredential(C())).toEqual({ title: 'BVSc & AH', issuer: 'GAU', yearAwarded: 2009, documentMediaId: 'd1' });
  });
  it('refuses by name: no author, no profile, no title, a year that is not one or is next year, no document, a foreign or typo\'d document, a video, an infected file', () => {
    expect(codes(reviewCredential(C({ canAuthor: false })))).toEqual(['NO_AUTHOR']);
    expect(codes(reviewCredential(C({ hasProfile: false })))).toEqual(['NO_INSTRUCTOR_PROFILE']);
    expect(codes(reviewCredential(C({ entered: { title: ' ', documentMediaId: 'd1' } })))).toEqual(['title/TITLE_REQUIRED']);
    expect(codes(reviewCredential(C({ entered: { title: 'x', yearAwarded: '20O9', documentMediaId: 'd1' } })))).toEqual(['yearAwarded/YEAR_INVALID']);
    expect(codes(reviewCredential(C({ entered: { title: 'x', yearAwarded: '2027', documentMediaId: 'd1' } })))).toEqual(['yearAwarded/YEAR_INVALID']);
    expect(codes(reviewCredential(C({ entered: { title: 'x', yearAwarded: '1899', documentMediaId: 'd1' } })))).toEqual(['yearAwarded/YEAR_INVALID']);
    expect(codes(reviewCredential(C({ entered: { title: 'x', yearAwarded: '1900', documentMediaId: 'd1' } })))).toEqual([]);
    expect(codes(reviewCredential(C({ entered: { title: 'x' }, document: undefined })))).toEqual(['documentMediaId/DOCUMENT_REQUIRED']);
    expect(codes(reviewCredential(C({ document: null })))).toEqual(['documentMediaId/MEDIA_UNKNOWN']);
    expect(codes(reviewCredential(C({ document: { ...DOC, kind: 'video' } })))).toEqual(['documentMediaId/MEDIA_KIND_MISMATCH']);
    expect(codes(reviewCredential(C({ document: { ...DOC, scanStatus: 'infected' } })))).toEqual(['documentMediaId/MEDIA_INFECTED']);
    expect(codes(reviewCredential(C({ document: { ...DOC, kind: 'image', scanStatus: 'pending' } })))).toEqual([]);   // a pending scan may be filed; the desk cannot ACCEPT it
    expect(storedCredential(C({ document: null }))).toBeNull();
    expect(parseCredentialYear('2009', 2026)).toBe(2009); expect(parseCredentialYear('209', 2026)).toBeNull(); expect(parseCredentialYear('2026', 2026)).toBe(2026);
  });
  it('a re-upload is an edit: only a REJECTED credential of the caller\'s, the desk\'s note shown, the diff against the row, the form opening WITHOUT the rejected document', () => {
    const cur = { id: 'k1', status: 'rejected' as const, title: 'BVSc & AH', issuer: 'GAU', yearAwarded: 2009, documentMediaId: 'd0', reviewNote: 'too blurred' };
    const r = reviewCredential(C({ current: cur, entered: { title: 'BVSc & AH', issuer: 'GAU', yearAwarded: '2009', documentMediaId: 'd1' } }));
    expect(r.ready).toBe(true); expect(row(r, 'answersNote')).toBe('too blurred');
    expect(r.diff).toEqual([{ field: 'documentMediaId', before: 'd0', after: 'd1' }, { field: 'status', before: 'rejected', after: 'submitted' }]);
    expect(codes(reviewCredential(C({ current: null })))).toEqual(['CREDENTIAL_NOT_FOUND']);
    expect(codes(reviewCredential(C({ current: { ...cur, status: 'accepted' } })))).toEqual(['CREDENTIAL_NOT_REJECTED']);
    expect(codes(reviewCredential(C({ current: { ...cur, status: 'submitted' } })))).toEqual(['CREDENTIAL_NOT_REJECTED']);
    expect(credentialFormValues(cur)).toEqual({ title: 'BVSc & AH', issuer: 'GAU', yearAwarded: '2009', documentMediaId: '' });
    expect(credentialFormValues({ ...cur, issuer: null, yearAwarded: null })).toEqual({ title: 'BVSc & AH', issuer: '', yearAwarded: '', documentMediaId: '' });
  });
});

describe('PC-56 TENANT-7d · W410 completeness — facts, not a percentage', () => {
  it('lists five facts in order; withdrawn credentials do not count as filed', () => {
    expect(profileCompleteness({ bio: null, languages: [], credentials: [], isVerified: false }).map((c) => c.done)).toEqual([false, false, false, false, false]);
    expect(profileCompleteness({ bio: 'x', languages: ['gu'], credentials: [{ status: 'withdrawn' }], isVerified: false }).map((c) => `${c.check}:${c.done}`)).toEqual(['bio:true', 'languages:true', 'credentialFiled:false', 'credentialAccepted:false', 'verified:false']);
    expect(profileCompleteness({ bio: ' ', languages: [], credentials: [{ status: 'accepted' }, { status: 'rejected' }], isVerified: true }).map((c) => c.done)).toEqual([false, false, true, true, true]);
  });
});

const A = (o: Partial<InstructorActInput> = {}): InstructorActInput => ({ act: 'verify', canAuthor: false, canPublish: true, isSelf: false, isTenantInstructor: true, isVerified: false, credentialStatuses: ['accepted'], credential: undefined, reason: 'checked the certificate against the university register', ...o });
const why = (i: InstructorActInput) => instructorActVerdict(i).refusals;

describe('PC-56 TENANT-7d · the acts as verdicts', () => {
  it('names every act and refusal the pages print', () => {
    expect(INSTRUCTOR_ACTS).toEqual(['verify', 'unverify', 'accept', 'reject', 'withdraw']); expect(isInstructorAct('deactivate')).toBe(false); expect(isInstructorAct('verify')).toBe(true);
    expect(INSTRUCTOR_ACT_REFUSALS).toContain('MAKER_IS_CHECKER'); expect(INSTRUCTOR_ACT_REFUSALS).toContain('LAST_ACCEPTED_CREDENTIAL');
  });
  it('verify: the desk, never themselves, only on an accepted credential, not twice; unverify: the desk, only when verified', () => {
    expect(instructorActVerdict(A())).toEqual({ act: 'verify', allowed: true, refusals: [], to: 'verified' });
    expect(why(A({ canPublish: false, canAuthor: true }))).toEqual(['NOT_DESK']);
    expect(why(A({ canPublish: false, canAuthor: false }))).toEqual(['NO_PERMISSION', 'NOT_DESK']);
    expect(why(A({ isSelf: true }))).toEqual(['MAKER_IS_CHECKER']);
    expect(why(A({ credentialStatuses: ['submitted', 'rejected', 'withdrawn'] }))).toEqual(['NO_ACCEPTED_CREDENTIAL']);
    expect(why(A({ credentialStatuses: [] }))).toEqual(['NO_ACCEPTED_CREDENTIAL']);
    expect(why(A({ isVerified: true }))).toEqual(['ALREADY_VERIFIED']);
    expect(why(A({ isTenantInstructor: false }))).toEqual(['PLATFORM_INSTRUCTOR']);
    expect(instructorActVerdict(A({ act: 'unverify', isVerified: true }))).toEqual({ act: 'unverify', allowed: true, refusals: [], to: 'unverified' });
    expect(why(A({ act: 'unverify' }))).toEqual(['NOT_VERIFIED']);
    expect(why(A({ act: 'unverify', isVerified: true, isSelf: true }))).toEqual(['MAKER_IS_CHECKER']);
  });
  it('the reason: 3–300 characters, never pre-filled — its absence is the last reason, after every other', () => {
    expect(why(A({ reason: '' }))).toEqual(['REASON_REQUIRED']); expect(why(A({ reason: 'ok' }))).toEqual(['REASON_REQUIRED']); expect(why(A({ reason: 'x'.repeat(301) }))).toEqual(['REASON_REQUIRED']);
    expect(why(A({ reason: 'x'.repeat(300) }))).toEqual([]); expect(why(A({ reason: '  yes  ' }))).toEqual([]);
    expect(why(A({ isSelf: true, reason: '' }))).toEqual(['MAKER_IS_CHECKER', 'REASON_REQUIRED']);
  });
  it('accept / reject: the desk, a credential named and found, submitted, the scan clean for accept', () => {
    const c = { status: 'submitted' as const, documentScanStatus: 'clean' };
    expect(instructorActVerdict(A({ act: 'accept', credential: c }))).toMatchObject({ allowed: true, to: 'accepted' });
    expect(instructorActVerdict(A({ act: 'reject', credential: c, reason: 'the photo is too blurred to read' }))).toMatchObject({ allowed: true, to: 'rejected' });
    expect(why(A({ act: 'accept', credential: undefined }))).toEqual(['CREDENTIAL_REQUIRED']);
    expect(why(A({ act: 'accept', credential: null }))).toEqual(['CREDENTIAL_UNKNOWN']);
    expect(why(A({ act: 'accept', credential: { ...c, documentScanStatus: 'pending' } }))).toEqual(['DOCUMENT_NOT_CLEAN']);
    expect(why(A({ act: 'accept', credential: { ...c, documentScanStatus: 'failed' } }))).toEqual(['DOCUMENT_NOT_CLEAN']);
    expect(why(A({ act: 'reject', credential: { ...c, documentScanStatus: 'pending' } }))).toEqual([]);   // a blurred or unscannable file is rejected, not accepted
    expect(why(A({ act: 'accept', credential: { ...c, status: 'accepted' } }))).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(why(A({ act: 'reject', credential: { ...c, status: 'withdrawn' } }))).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(why(A({ act: 'accept', credential: c, isSelf: true, canAuthor: true }))).toEqual(['MAKER_IS_CHECKER']);
    expect(why(A({ act: 'accept', credential: c, canPublish: false, canAuthor: true, isSelf: true }))).toEqual(['NOT_DESK', 'MAKER_IS_CHECKER']);
  });
  it('withdraw: the instructor themselves or the desk; not the last accepted credential while verified; nothing twice', () => {
    const acc = { status: 'accepted' as const, documentScanStatus: 'clean' };
    expect(instructorActVerdict(A({ act: 'withdraw', canPublish: false, canAuthor: true, isSelf: true, credential: acc, isVerified: false }))).toMatchObject({ allowed: true, to: 'withdrawn' });
    expect(why(A({ act: 'withdraw', canPublish: false, canAuthor: true, isSelf: false, credential: acc }))).toEqual(['NOT_OWNER']);
    expect(why(A({ act: 'withdraw', credential: acc, isVerified: true, credentialStatuses: ['accepted'] }))).toEqual(['LAST_ACCEPTED_CREDENTIAL']);
    expect(why(A({ act: 'withdraw', credential: acc, isVerified: true, credentialStatuses: ['accepted', 'accepted'] }))).toEqual([]);
    expect(why(A({ act: 'withdraw', credential: { ...acc, status: 'submitted' }, isVerified: true, credentialStatuses: ['accepted', 'submitted'] }))).toEqual([]);
    expect(why(A({ act: 'withdraw', credential: acc, isVerified: false, credentialStatuses: ['accepted'] }))).toEqual([]);
    expect(why(A({ act: 'withdraw', credential: { ...acc, status: 'withdrawn' } }))).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('every verdict for the page: two on the instructor, three per credential, the reason left as the confirm step\'s question', () => {
    const all = allInstructorVerdicts({ canAuthor: true, canPublish: false, isSelf: true, isTenantInstructor: true, isVerified: false, credentialStatuses: ['submitted', 'rejected'] }, [{ id: 'k1', status: 'submitted', documentScanStatus: 'clean' }, { id: 'k2', status: 'rejected', documentScanStatus: 'clean' }]);
    expect(all.map((v) => `${v.act}:${v.credentialId ?? '-'}:${v.allowed}`)).toEqual(['verify:-:false', 'unverify:-:false', 'accept:k1:false', 'reject:k1:false', 'withdraw:k1:true', 'accept:k2:false', 'reject:k2:false', 'withdraw:k2:true']);
    expect(all[0].refusals).toEqual(['NOT_DESK', 'MAKER_IS_CHECKER', 'NO_ACCEPTED_CREDENTIAL']);
    expect(all.every((v) => !v.refusals.includes('REASON_REQUIRED'))).toBe(true);
  });
});

describe('PC-56 TENANT-7d · the entities', () => {
  it('the instructor: created unverified; verify needs a checker other than themselves; unverify forgets the checker; the profile patch touches only what it names', () => {
    const i = Instructor.create({ id: 'i1', userId: 'u1', tenantId: 't1', bio: 'x' });
    expect(i.toJSON()).toMatchObject({ isVerified: false, displayName: null, languages: [], visibility: 'public', verifiedAt: null });
    expect(() => i.verify('u1', new Date(), null)).toThrow(InvalidCourseError);
    i.verify('desk', new Date('2026-09-24T00:00:00Z'), 'checked'); expect(i.toJSON()).toMatchObject({ isVerified: true, verifiedBy: 'desk', verificationNote: 'checked' });
    expect(() => i.verify('desk', new Date(), null)).toThrow(InvalidCourseError);
    i.unverify(); expect(i.toJSON()).toMatchObject({ isVerified: false, verifiedAt: null, verifiedBy: null, verificationNote: null });
    expect(() => i.unverify()).toThrow(InvalidCourseError);
    i.updateProfile({ languages: ['gu'] }); expect(i.toJSON()).toMatchObject({ bio: 'x', languages: ['gu'], visibility: 'public' });
    i.updateProfile({ displayName: 'Dr K', visibility: 'private', bio: null }); expect(i.toJSON()).toMatchObject({ displayName: 'Dr K', visibility: 'private', bio: null, languages: ['gu'] });
    // PC-26's rehydrate shape (no 0173 fields) still rehydrates
    expect(Instructor.rehydrate({ id: 'i', userId: 'u', tenantId: 't', bio: null, royaltyBps: 8000, isVerified: false }).toJSON()).toMatchObject({ languages: [], visibility: 'public' });
  });
  it('the credential: submitted → accepted | rejected (with a note) | withdrawn; rejected → submitted by a re-file; withdrawn is final', () => {
    const at = new Date('2026-09-24T00:00:00Z');
    const c = InstructorCredential.file({ id: 'k1', tenantId: 't1', instructorId: 'i1', at, title: 'BVSc', issuer: null, yearAwarded: 2009, documentMediaId: 'd0' });
    expect(c.status).toBe('submitted');
    expect(() => c.reject('desk', at, '  ')).toThrow(InvalidCourseError);
    c.reject('desk', at, 'too blurred'); expect(c.toJSON()).toMatchObject({ status: 'rejected', reviewedBy: 'desk', reviewNote: 'too blurred' });
    expect(() => c.accept('desk', at, null)).toThrow(InvalidCourseError);
    c.refile({ title: 'BVSc & AH', issuer: 'GAU', yearAwarded: 2009, documentMediaId: 'd1' }, at); expect(c.toJSON()).toMatchObject({ status: 'submitted', documentMediaId: 'd1', reviewedBy: null, reviewNote: null, title: 'BVSc & AH' });
    c.accept('desk', at, 'checked'); expect(c.status).toBe('accepted');
    expect(() => c.refile({ title: 'x', issuer: null, yearAwarded: null, documentMediaId: 'd2' }, at)).toThrow(InvalidCourseError);
    c.withdraw(); expect(c.status).toBe('withdrawn');
    expect(() => c.withdraw()).toThrow(InvalidCourseError);
    expect(canCredentialTransition('withdrawn', 'submitted')).toBe(false); expect(canCredentialTransition('accepted', 'rejected')).toBe(false); expect(canCredentialTransition('rejected', 'withdrawn')).toBe(true);
    expect(() => InstructorCredential.file({ id: 'k', tenantId: 't', instructorId: 'i', at, title: ' ', issuer: null, yearAwarded: null, documentMediaId: 'd' })).toThrow(InvalidCourseError);
  });
});

const OUTLINE = [{ title: 'Why clean milk', lessons: [{ title: 'What spoils milk', kind: 'video' }, { title: 'Check yourself', kind: 'quiz' }] }, { title: 'At the animal', lessons: [{ title: 'Udder hygiene', kind: 'article' }] }];
const TPL: CourseTemplateRow = { id: 'tp1', code: 'clean_milk', title: 'Clean Milk Production', topicCode: 'safety', level: 'basic', outline: OUTLINE, isActive: true, tenantId: null };
const T = (o: Partial<TemplateReviewInput> = {}): TemplateReviewInput => ({ canAuthor: true, hasInstructorProfile: true, template: TPL, topic: { id: 'tid', code: 'safety', name: 'Farm safety' }, money: { currencyCode: 'INR', minorUnits: 2 }, entered: { templateCode: 'clean_milk', title: '' }, ...o });

describe('PC-56 TENANT-7d · the studio form — from a template', () => {
  it('a ready review shows what the form never asked: the topic, level, currency, the outline as it will be written, the counts, the status', () => {
    const r = reviewFromTemplate(T());
    expect(r.ready).toBe(true); expect(r.entityType).toBe('course'); expect(r.diff).toBeNull();
    expect(row(r, 'templateCode')).toBe('clean_milk · Clean Milk Production'); expect(row(r, 'title')).toBe('Clean Milk Production');
    expect(r.fields.find((f) => f.name === 'title')!.normalised).toBe(true);   // blank → the template's own title, shown as normalised
    expect(row(r, 'topic')).toBe('safety · Farm safety'); expect(row(r, 'level')).toBe('basic'); expect(row(r, 'currency')).toBe('INR'); expect(row(r, 'status')).toBe('draft');
    expect(row(r, 'outline')).toBe('1·1 Why clean milk — What spoils milk · video\n1·2 Why clean milk — Check yourself · quiz\n2·1 At the animal — Udder hygiene · article');
    expect(row(r, 'counts')).toBe('2 · 3 · 1');
    expect(storedFromTemplate(T({ entered: { templateCode: 'clean_milk', title: ' Clean Milk — Anand ' } }))).toEqual({ templateId: 'tp1', defaultTitle: 'Clean Milk — Anand', topicId: 'tid', level: 'basic', currencyCode: 'INR', outline: OUTLINE });
  });
  it('refuses by name: no author, no profile, no template, an unknown one, an inactive one, a broken outline, a topic the registry lost, a currency with no scale', () => {
    expect(codes(reviewFromTemplate(T({ canAuthor: false })))).toEqual(['NO_AUTHOR']);
    expect(codes(reviewFromTemplate(T({ hasInstructorProfile: false })))).toEqual(['NO_INSTRUCTOR_PROFILE']);
    expect(codes(reviewFromTemplate(T({ template: undefined, topic: null, entered: { templateCode: '' } })))).toEqual(['templateCode/TEMPLATE_REQUIRED']);   // the missing template is the whole answer
    expect(codes(reviewFromTemplate(T({ template: { ...TPL, title: '  ' } })))).toEqual(['title/TITLE_REQUIRED']);
    expect(codes(reviewFromTemplate(T({ template: null, topic: null, entered: { templateCode: 'nope', title: 'x' } })))).toEqual(['templateCode/TEMPLATE_UNKNOWN']);
    expect(codes(reviewFromTemplate(T({ template: { ...TPL, isActive: false } })))).toEqual(['templateCode/TEMPLATE_INACTIVE']);
    expect(codes(reviewFromTemplate(T({ template: { ...TPL, outline: [{ title: 'm', lessons: [{ title: 'l', kind: 'live' }] }] } })))).toEqual(['templateCode/TEMPLATE_INVALID']);
    expect(codes(reviewFromTemplate(T({ topic: null })))).toEqual(['templateCode/TOPIC_UNKNOWN']);
    expect(codes(reviewFromTemplate(T({ money: null })))).toEqual(['CURRENCY_UNKNOWN']);
    expect(storedFromTemplate(T({ money: null }))).toBeNull(); expect(storedFromTemplate(T({ topic: null }))).toBeNull();
    expect(TEMPLATE_REVIEW_REFUSALS).toContain('TEMPLATE_INVALID');
  });
  it('the outline parser accepts modules of lessons of known kinds and refuses everything else — a platform data defect is refused, never written half-way', () => {
    expect(parseOutline(OUTLINE)).toEqual(OUTLINE);
    expect(parseOutline([])).toBeNull(); expect(parseOutline('x')).toBeNull(); expect(parseOutline([{ title: 'm', lessons: [] }])).toBeNull();
    expect(parseOutline([{ title: '', lessons: [{ title: 'l', kind: 'video' }] }])).toBeNull();
    expect(parseOutline([{ title: 'm', lessons: [{ title: '', kind: 'video' }] }])).toBeNull();
    expect(parseOutline([{ title: 'm', lessons: [{ title: 'l', kind: 'reel' }] }])).toBeNull();
    expect(parseOutline([{ title: 'm', lessons: [{ title: 'l', kind: 'live' }] }])).toBeNull();
    expect(parseOutline([{ title: ' m ', lessons: [{ title: ' l ', kind: 'pdf' }] }])).toEqual([{ title: 'm', lessons: [{ title: 'l', kind: 'pdf' }] }]);
    expect(parseOutline(Array.from({ length: 21 }, () => ({ title: 'm', lessons: [{ title: 'l', kind: 'video' }] })))).toBeNull();
    expect(parseOutline([{ title: 'm', lessons: Array.from({ length: 31 }, () => ({ title: 'l', kind: 'video' })) }])).toBeNull();
    expect(parseOutline([null])).toBeNull(); expect(parseOutline([{ title: 'm', lessons: [null] }])).toBeNull();
  });
});
