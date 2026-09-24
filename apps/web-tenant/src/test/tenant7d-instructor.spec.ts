// apps/web-tenant/src/test/tenant7d-instructor.spec.ts · PC-56 TENANT-7d · the instructor's console helpers, and the
// catalogue promise that every key a page can ask for exists ×3 — for every state, tile, completeness check, credential
// status, document state, act, act refusal, refused-by-name sentence, form field and every refusal code the API's three
// reviewers can emit.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { InstructorActVerdict, InstructorView, StudioView } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CREDENTIAL_FIELDS, CREDENTIAL_FORM, CREDENTIAL_STATUS_VALUES, INSTRUCTOR_ACT_VALUES, INSTRUCTOR_MUTATE_FIELDS, MAX_CARRIED_LENGTH_PROFILE, PROFILE_FIELDS, PROFILE_FORM, REFUSED_BY_NAME,
  STUDIO_TILES, TEMPLATE_FIELDS, TEMPLATE_FORM, actDoneKey, actLabelKey, actNeedsCredential, addCredentialHref, backFromChain, completenessDone, completenessKey, coursesByState, credentialStatusKey,
  documentState, documentStateKey, editProfileHref, formDoneKey, fromTemplateHref, instructorActHref, instructorForm, instructorsHref, joinLanguages, languageChecked, offeredActs, profileHref,
  refusedKey, reuploadHref, studioHref, studioState, studioStateKey, tileKey, tileMeasured, verdictFor, verifiedBadge, visibilityKey, watchHoursText,
} from '../features/studio/instructor';
import { fieldLabelKey, refusalKey, readCarried, carryValues } from '../features/forms/chain';
import { mutateRefusalKey } from '../features/mutate/chain';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/education/domain', rel), 'utf8');
function apiList(file: string, constName: string): string[] {
  const src = api(file);
  const i = src.indexOf(`${constName} = [`);
  if (i < 0) throw new Error(`${constName} not in ${file}`);
  return [...src.slice(i, src.indexOf('] as const', i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
}
const V = (o: Partial<InstructorView> = {}): InstructorView => ({
  instructor: { id: 'i1', userId: 'u1', bio: 'x', royaltyBps: 8000, isVerified: false, displayName: 'Dr K', languages: ['gu'], visibility: 'public', verifiedAt: null, verifiedBy: null, verificationNote: null },
  name: 'Dr K', isSelf: true, privileged: false, credentials: [], completeness: [{ check: 'bio', done: true }, { check: 'languages', done: true }, { check: 'credentialFiled', done: false }, { check: 'credentialAccepted', done: false }, { check: 'verified', done: false }],
  acts: [], languages: [], form: {}, rating: null, ...o,
});
const verdict = (act: InstructorActVerdict['act'], refusals: InstructorActVerdict['refusals'] = [], credentialId: string | null = null): InstructorActVerdict => ({ act, allowed: refusals.length === 0, refusals, to: null, credentialId });

describe('PC-56 TENANT-7d · routes', () => {
  it('every canon clickable has an href; the desk reaches another instructor by id; the chains carry their meta in the URL', () => {
    expect(studioHref()).toBe('/studio'); expect(profileHref()).toBe('/studio/profile'); expect(profileHref('a b')).toBe('/studio/profile?instructor=a%20b');
    expect(editProfileHref()).toBe('/studio/profile/edit'); expect(addCredentialHref()).toBe('/studio/profile/edit?form=credential'); expect(reuploadHref('k1')).toBe('/studio/profile/edit?form=credential&credential=k1');
    expect(instructorActHref('i1', 'verify')).toBe('/studio/profile/act?step=confirm&instructor=i1&act=verify');
    expect(instructorActHref('i1', 'accept', 'k1')).toBe('/studio/profile/act?step=confirm&instructor=i1&act=accept&credentialId=k1');
    expect(fromTemplateHref()).toBe('/studio/from-template'); expect(fromTemplateHref('clean_milk')).toBe('/studio/from-template?templateCode=clean_milk');
    expect(instructorsHref()).toBe('/studio/instructors'); expect(instructorsHref({ verified: 'false', cursor: 'c' })).toBe('/studio/instructors?verified=false&cursor=c'); expect(instructorsHref({ verified: 'bogus' })).toBe('/studio/instructors');
    expect(backFromChain(null, false)).toBe('/studio/profile'); expect(backFromChain('i2', false)).toBe('/studio/profile?instructor=i2'); expect(backFromChain('i1', true)).toBe('/studio/profile');
    expect(instructorForm('credential')).toBe('credential'); expect(instructorForm('bogus')).toBe('profile'); expect(instructorForm(undefined)).toBe('profile');
  });
});

describe('PC-56 TENANT-7d · W410 the studio home', () => {
  it('six states: ready · noProfile · restricted · notEnabled · error, each with a sentence ×3', () => {
    const view = { instructor: V(), windowDays: 30, facts: null, courses: [], byStatus: {}, templates: [] } as unknown as StudioView;
    expect(studioState(null, undefined, view)).toBe('ready'); expect(studioState(null, undefined, { ...view, instructor: null })).toBe('noProfile');
    expect(studioState('EDUCATION_FORBIDDEN', 403, null)).toBe('restricted'); expect(studioState(null, 403, null)).toBe('restricted');
    expect(studioState('NOT_FOUND', 404, null)).toBe('notEnabled'); expect(studioState('FEATURE_DISABLED', undefined, null)).toBe('notEnabled');
    expect(studioState('boom', 500, null)).toBe('error'); expect(studioState(null, undefined, null)).toBe('error');
    for (const s of ['noProfile', 'restricted', 'notEnabled', 'error'] as const) three(studioStateKey(s));
  });
  it('watch-hours are whole hours of a bigint-as-text of seconds — rounded down, never averaged, never a decimal', () => {
    expect(watchHoursText('1800')).toBe('0'); expect(watchHoursText('3600')).toBe('1'); expect(watchHoursText('14832000')).toBe('4120');
    expect(watchHoursText('99999999999999999999')).toBe('27777777777777777'); expect(watchHoursText('abc')).toBe('0'); expect(watchHoursText('')).toBe('0'); expect(watchHoursText('-3600')).toBe('0');
  });
  it('the tiles: three measured, earnings refused by name; each with a label and a sub ×3', () => {
    expect(STUDIO_TILES).toEqual(['learners', 'watchHours', 'certificates', 'earnings']);
    expect(STUDIO_TILES.map(tileMeasured)).toEqual([true, true, true, false]);
    for (const t of STUDIO_TILES) { three(tileKey(t, 'label')); three(tileKey(t, 'sub')); }
    expect(en['studio.tile.learners.sub']).toContain('{days}'); expect(en['studio.tile.earnings.sub']).toContain('{share}');
    three('studio.notMeasured');
  });
  it('courses by state list every state in order, zeros included; completeness is a count of facts, not a percentage', () => {
    expect(coursesByState({ published: 2, draft: 1 })).toEqual([{ status: 'draft', n: 1 }, { status: 'review', n: 0 }, { status: 'published', n: 2 }, { status: 'paused', n: 0 }, { status: 'archived', n: 0 }]);
    expect(completenessDone(V())).toEqual({ done: 2, of: 5 });
    for (const c of ['bio', 'languages', 'credentialFiled', 'credentialAccepted', 'verified'] as const) three(completenessKey(c));
    expect(apiList('instructor-review.ts', 'COMPLETENESS_CHECKS')).toEqual(['bio', 'languages', 'credentialFiled', 'credentialAccepted', 'verified']);
  });
  it('everything refused by name has its sentence ×3', () => {
    expect(REFUSED_BY_NAME).toEqual(['watchMonth', 'rating', 'faceMatch', 'retry', 'learnerInsights', 'tenantTemplates', 'deactivate']);   // 7d-money: earnings is W418's, linked — no longer refused
    for (const n of REFUSED_BY_NAME) three(refusedKey(n));
    for (const k of ['studio.lead', 'studio.createProfile', 'studio.templatesAfterProfile', 'studio.unnamed', 'studio.verified', 'studio.notVerified', 'studio.profileLink', 'studio.completeness', 'studio.deskList', 'studio.myCourses', 'studio.empty', 'studio.emptyTemplate', 'studio.startFromTemplate', 'studio.noTemplates', 'studio.colTopic', 'studio.colLearners', 'studio.colCompletion', 'studio.openBuilder', 'studio.classes', 'studio.upcomingClasses', 'studio.noClasses']) three(k);
  });
});

describe('PC-56 TENANT-7d · W419 the profile', () => {
  it('the badge is drawn from the API\'s fact alone', () => {
    expect(verifiedBadge(V())).toBe(false);
    expect(verifiedBadge(V({ instructor: { ...V().instructor, isVerified: true } }))).toBe(true);
    // a checker and an instant without the flag do not draw it: the flag IS the fact (0173's CHECK keeps the three together)
    expect(verifiedBadge(V({ instructor: { ...V().instructor, isVerified: false, verifiedAt: '2026-09-24T00:00:00Z', verifiedBy: 'd' } }))).toBe(false);
  });
  it('credential statuses, document states and visibilities each have a sentence ×3; the statuses mirror the API', () => {
    expect([...CREDENTIAL_STATUS_VALUES]).toEqual(apiList('instructor-credential.entity.ts', 'CREDENTIAL_STATUSES'));
    for (const s of CREDENTIAL_STATUS_VALUES) three(credentialStatusKey(s));
    expect(documentState({ document: null })).toBe('unknown'); expect(documentState({ document: { kind: 'document', scanStatus: 'clean', mimeType: 'application/pdf' } })).toBe('clean');
    expect(documentState({ document: { kind: 'image', scanStatus: 'weird', mimeType: 'image/jpeg' } })).toBe('unknown'); expect(documentState({ document: { kind: 'image', scanStatus: 'infected', mimeType: 'image/jpeg' } })).toBe('infected');
    for (const d of ['pending', 'clean', 'infected', 'failed', 'unknown'] as const) three(documentStateKey(d));
    for (const v of ['public', 'private']) three(visibilityKey(v));
    for (const k of ['profile.title', 'profile.lead', 'profile.save', 'profile.verifiedBadge', 'profile.state.noProfile', 'profile.nameFallback', 'profile.noBio', 'profile.languages', 'profile.noLanguages', 'profile.readOnlyNote', 'profile.verificationTitle', 'profile.verifiedOn', 'profile.notVerified', 'profile.verificationRule', 'profile.credentialsTitle', 'profile.addCredential', 'profile.credentialsEmpty', 'profile.credentialsEmptyHint', 'profile.filedOn', 'profile.acceptedOn', 'profile.rejectedTitle', 'profile.rejectedReason', 'profile.reupload', 'profile.ratingTitle']) three(k);
    expect(en['profile.rejectedReason']).toContain('{reason}'); expect(en['profile.verifiedOn']).toContain('{at}');
  });
  it('the acts mirror the API; each has a label, a done sentence and every refusal a sentence ×3', () => {
    expect([...INSTRUCTOR_ACT_VALUES]).toEqual(apiList('instructor-acts.ts', 'INSTRUCTOR_ACTS'));
    for (const a of INSTRUCTOR_ACT_VALUES) { three(actLabelKey(a)); three(actDoneKey(a)); three(`mutate.instructor.note.${a}`); }
    for (const code of apiList('instructor-acts.ts', 'INSTRUCTOR_ACT_REFUSALS')) three(mutateRefusalKey('instructor', code));
    for (const to of ['verified', 'unverified', 'accepted', 'rejected', 'withdrawn']) three(`mutate.instructor.to.${to}`);
    for (const k of ['mutate.instructor.title', 'mutate.instructor.noAct', 'mutate.instructor.object', 'mutate.instructor.transition', 'mutate.instructor.reasonLabel', 'mutate.instructor.noteLabel', 'mutate.instructor.noteRecorded']) three(k);
    expect(INSTRUCTOR_ACT_VALUES.map(actNeedsCredential)).toEqual([false, false, true, true, true]);
  });
  it('the acts offered: allowed, or refused with the first reason; the stage alone hides the button; REASON_REQUIRED is the confirm step\'s question; per credential', () => {
    const acts = [verdict('verify', ['NOT_DESK', 'MAKER_IS_CHECKER', 'REASON_REQUIRED']), verdict('unverify', ['NOT_VERIFIED', 'REASON_REQUIRED']), verdict('accept', ['NOT_DESK', 'REASON_REQUIRED'], 'k1'), verdict('reject', ['ILLEGAL_FROM_STATUS'], 'k1'), verdict('withdraw', ['REASON_REQUIRED'], 'k1'), verdict('withdraw', ['LAST_ACCEPTED_CREDENTIAL'], 'k2')];
    expect(offeredActs(acts, null)).toEqual([{ act: 'verify', allowed: false, why: 'NOT_DESK' }, { act: 'unverify', allowed: false, why: 'NOT_VERIFIED' }]);
    expect(offeredActs(acts, 'k1')).toEqual([{ act: 'accept', allowed: false, why: 'NOT_DESK' }, { act: 'withdraw', allowed: true, why: null }]);
    expect(offeredActs(acts, 'k2')).toEqual([{ act: 'withdraw', allowed: false, why: 'LAST_ACCEPTED_CREDENTIAL' }]);
    expect(offeredActs(acts, 'k9')).toEqual([]);
    expect(verdictFor(acts, 'withdraw', 'k2')?.refusals).toEqual(['LAST_ACCEPTED_CREDENTIAL']); expect(verdictFor(acts, 'withdraw', null)).toBeNull(); expect(verdictFor(acts, 'verify', null)?.act).toBe('verify');
  });
});

describe('PC-56 TENANT-7d · the chains', () => {
  it('the profile and credential forms: every field labelled ×3 (including the rows the form never asked), every API refusal a sentence ×3', () => {
    expect([...PROFILE_FIELDS]).toEqual(apiList('instructor-review.ts', 'PROFILE_FORM_FIELDS')); expect([...CREDENTIAL_FIELDS]).toEqual(apiList('instructor-review.ts', 'CREDENTIAL_FORM_FIELDS'));
    for (const f of PROFILE_FIELDS) three(fieldLabelKey(PROFILE_FORM, f));
    for (const f of [...CREDENTIAL_FIELDS, 'status', 'answersNote']) three(fieldLabelKey(CREDENTIAL_FORM, f));
    const codes = apiList('instructor-review.ts', 'INSTRUCTOR_REVIEW_REFUSALS');
    const profileCodes = ['NO_AUTHOR', 'DISPLAY_NAME_INVALID', 'BIO_REQUIRED', 'LANGUAGE_UNKNOWN', 'LANGUAGE_INACTIVE', 'LANGUAGES_TOO_MANY', 'VISIBILITY_INVALID', 'TOO_LONG', 'VALUE_REJECTED'];
    const credentialCodes = ['NO_AUTHOR', 'NO_INSTRUCTOR_PROFILE', 'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_NOT_REJECTED', 'TITLE_REQUIRED', 'YEAR_INVALID', 'DOCUMENT_REQUIRED', 'MEDIA_UNKNOWN', 'MEDIA_KIND_MISMATCH', 'MEDIA_INFECTED', 'TOO_LONG', 'VALUE_REJECTED'];
    for (const c of profileCodes) three(refusalKey(PROFILE_FORM, c));
    for (const c of credentialCodes) three(refusalKey(CREDENTIAL_FORM, c));
    // every code the API can emit is covered by one form or the other (NOT_OWNER is reserved; the reviewers never emit it today)
    for (const c of codes.filter((x) => x !== 'NOT_OWNER')) expect(profileCodes.includes(c) || credentialCodes.includes(c) ? 'ok' : `uncovered ${c}`).toBe('ok');
    for (const k of ['form.profile.title', 'form.profile.done', 'form.profile.nameHint', 'form.profile.bioHint', 'form.profile.languagesHint', 'form.profile.registryUnavailable', 'form.credential.title', 'form.credential.refileTitle', 'form.credential.done', 'form.credential.doneRefile', 'form.credential.needsProfile', 'form.credential.documentHint', 'form.credential.upload.add', 'form.credential.upload.hint']) three(k);
    expect(formDoneKey('profile', false)).toBe('form.profile.done'); expect(formDoneKey('credential', false)).toBe('form.credential.done'); expect(formDoneKey('credential', true)).toBe('form.credential.doneRefile');
  });
  it('the studio form (from a template): every field labelled ×3, every API refusal a sentence ×3', () => {
    expect([...TEMPLATE_FIELDS]).toEqual(apiList('course-template.ts', 'TEMPLATE_FORM_FIELDS'));
    for (const f of [...TEMPLATE_FIELDS, 'topic', 'level', 'currency', 'outline', 'counts', 'status']) three(fieldLabelKey(TEMPLATE_FORM, f));
    for (const c of apiList('course-template.ts', 'TEMPLATE_REVIEW_REFUSALS')) three(refusalKey(TEMPLATE_FORM, c));
    for (const k of ['form.template.title', 'form.template.lead', 'form.template.registryUnavailable', 'form.template.tenantOwn', 'form.template.titleHint', 'form.template.countsHint', 'form.template.create', 'form.template.done', 'form.template.openRecord']) three(k);
    expect(en['form.template.done']).toContain('{n}');
  });
  it('the languages come off the form as repeated checkboxes and travel as one comma-joined value; the bio\'s ceiling is the chain\'s own', () => {
    expect(joinLanguages(['gu', 'hi'])).toBe('gu,hi'); expect(joinLanguages('gu,hi,en')).toBe('gu,hi,en'); expect(joinLanguages([' GU ', 'gu', ''])).toBe('gu'); expect(joinLanguages(undefined)).toBeUndefined(); expect(joinLanguages([])).toBeUndefined();
    expect(languageChecked({ languages: 'gu,hi' }, 'hi')).toBe(true); expect(languageChecked({ languages: 'gu,hi' }, 'en')).toBe(false); expect(languageChecked({}, 'gu')).toBe(false);
    expect(MAX_CARRIED_LENGTH_PROFILE).toBe(3000);
    const long = { bio: 'x'.repeat(2000), displayName: 'Dr K', languages: 'gu,hi,en', visibility: 'public', form: 'profile' };
    expect(carryValues('review', long, MAX_CARRIED_LENGTH_PROFILE).preserved).toBe(true);
    expect(carryValues('review', long).preserved).toBe(false);   // the default ceiling would lose it
    expect(readCarried({ act: 'verify', reason: 'r', instructor: 'i1', credentialId: ['', 'k1'] }, INSTRUCTOR_MUTATE_FIELDS)).toEqual({ act: 'verify', reason: 'r', instructor: 'i1', credentialId: 'k1' });
  });
  it('the desk\'s list has its words ×3', () => {
    for (const k of ['instructors.title', 'instructors.lead', 'instructors.filterVerified', 'instructors.filterAll', 'instructors.empty', 'instructors.colName', 'instructors.colVerified', 'instructors.colPending', 'instructors.colAccepted', 'instructors.colCourses', 'common.apply']) three(k);
  });
  it('PC-26\'s inline bio form is gone with its keys', () => {
    for (const k of ['studio.bio', 'studio.bioSave', 'studio.ok.instructor', 'studio.error.instructor', 'studio.instructor', 'studio.instructorHint', 'studio.liveLink']) expect((en as Record<string, string>)[k]).toBeUndefined();
    const actions = fs.readFileSync(path.join(__dirname, '../app/studio/actions.ts'), 'utf8');
    expect(actions).not.toMatch(/export async function upsertInstructorAction/);
  });
});
