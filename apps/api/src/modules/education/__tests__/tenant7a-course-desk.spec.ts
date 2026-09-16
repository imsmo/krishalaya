// modules/education/__tests__/tenant7a-course-desk.spec.ts · PC-56 TENANT-7a · the course record's pure logic.
//
// Four pure modules, one rule each:
//   • course-money      — digits move, nothing is multiplied; the scale is the currency's, never assumed to be two.
//   • course-review     — the form's review is a DECISION (what will be stored, every refusal) and a diff on an edit.
//   • course-acts       — six verdicts in the order permission → owner → stage → gate → maker-checker → reason.
//   • course-publish-gate — W416's checklist, honest about the four checks this platform cannot measure.
import { isFree, minorToMajorText, parseMajorToMinor } from '../domain/course-money';
import { COURSE_FORM_FIELDS, COURSE_REVIEW_REFUSALS, CourseReviewInput, reviewCourse, storedCourse } from '../domain/course-review';
import { ACT_REFUSALS, COURSE_ACTS, actVerdict, allVerdicts, isCourseAct, reasonUsable } from '../domain/course-acts';
import { GATE_CHECKS, UNMEASURED_CHECKS, computeGate, isHollow, quizQuestionsOk } from '../domain/course-publish-gate';
import { assertRefusalsPrintable, refusalsFor, generalRefusals } from '../../../shared/form-review';

const INR = { currencyCode: 'INR', minorUnits: 2 };
const JPY = { currencyCode: 'JPY', minorUnits: 0 };

describe('PC-56 TENANT-7a · course money — the digits move, nothing is scaled', () => {
  it('parses a major amount at the currency scale, by string', () => {
    expect(parseMajorToMinor('149', 2)).toBe('14900');
    expect(parseMajorToMinor('149.5', 2)).toBe('14950');
    expect(parseMajorToMinor('149.00', 2)).toBe('14900');
    expect(parseMajorToMinor('0', 2)).toBe('0');
    expect(parseMajorToMinor('0.05', 2)).toBe('5');
    expect(parseMajorToMinor('007', 2)).toBe('700');
    expect(parseMajorToMinor('149', 0)).toBe('149');
    expect(parseMajorToMinor('1.234', 3)).toBe('1234');
  });
  it('refuses a fraction longer than the scale, a sign, a blank, a comma, a float', () => {
    expect(parseMajorToMinor('149.005', 2)).toBeNull();
    expect(parseMajorToMinor('149.5', 0)).toBeNull();     // the yen has no minor unit
    expect(parseMajorToMinor('-1', 2)).toBeNull();
    expect(parseMajorToMinor('', 2)).toBeNull();
    expect(parseMajorToMinor('1,49', 2)).toBeNull();
    expect(parseMajorToMinor('1e3', 2)).toBeNull();
    expect(() => parseMajorToMinor('1', 7)).toThrow(/minor_units/);
  });
  it('prints minor as major at the scale, with no grouping and no invented decimals', () => {
    expect(minorToMajorText('14900', 2)).toBe('149.00');
    expect(minorToMajorText('5', 2)).toBe('0.05');
    expect(minorToMajorText('0', 2)).toBe('0.00');
    expect(minorToMajorText('5160', 0)).toBe('5160');
    expect(minorToMajorText('1234', 3)).toBe('1.234');
    expect(minorToMajorText('0014900', 2)).toBe('149.00');   // defensive: a padded input never grows a leading zero
    expect(() => minorToMajorText('12.5', 2)).toThrow();
    expect(isFree('0')).toBe(true); expect(isFree('000')).toBe(true); expect(isFree('10')).toBe(false);
  });
});

const base = (over: Partial<CourseReviewInput> = {}): CourseReviewInput => ({
  canAuthor: true, canPublish: false, hasInstructorProfile: true, actorUserId: 'u1',
  entered: { defaultTitle: 'Groundnut: sowing to storage', topicCode: 'crop_care', level: 'basic', priceMajor: '', certEnabled: '1' },
  topic: { code: 'crop_care', name: 'Crop care' }, cover: undefined, money: INR, ...over,
});
const codes = (i: CourseReviewInput) => reviewCourse(i).refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).sort();

describe('PC-56 TENANT-7a · the course form review is a decision, not an echo', () => {
  it('a free course by an author with a profile is ready; the currency row is shown though never typed; blank price is 0.00', () => {
    const r = reviewCourse(base());
    expect(r.ready).toBe(true); expect(r.entityType).toBe('course'); expect(r.diff).toBeNull();
    expect(r.fields.map((f) => f.name)).toEqual([...COURSE_FORM_FIELDS.slice(0, 4), 'currencyCode', ...COURSE_FORM_FIELDS.slice(4)]);
    const by = Object.fromEntries(r.fields.map((f) => [f.name, f]));
    expect(by.currencyCode).toEqual({ name: 'currencyCode', entered: null, stored: 'INR', normalised: true });
    expect(by.priceMajor).toEqual({ name: 'priceMajor', entered: null, stored: '0.00', normalised: true });
    expect(by.topicCode.stored).toBe('crop_care · Crop care');
    expect(by.certEnabled.stored).toBe('yes');
  });
  it('lists EVERY refusal against its field, and the general ones against none', () => {
    const r = reviewCourse(base({ canAuthor: false, hasInstructorProfile: false, money: null, entered: { defaultTitle: '  ', topicCode: 'dairy', level: 'expert', priceMajor: 'abc', coverMediaId: 'nope' }, topic: null, cover: null }));
    expect(r.ready).toBe(false);
    expect(generalRefusals(r).sort()).toEqual(['CURRENCY_UNKNOWN', 'NO_AUTHOR', 'NO_INSTRUCTOR_PROFILE']);
    expect(refusalsFor(r, 'defaultTitle')).toEqual(['TITLE_REQUIRED']);
    expect(refusalsFor(r, 'topicCode')).toEqual(['TOPIC_UNKNOWN']);        // DELTA-030: dairy is not in the registry — refused by name, never stored as NULL
    expect(refusalsFor(r, 'level')).toEqual(['LEVEL_INVALID']);
    expect(refusalsFor(r, 'priceMajor')).toEqual([]);                       // no currency → no price judgement; the general refusal says why
    expect(refusalsFor(r, 'coverMediaId')).toEqual(['COVER_UNKNOWN']);
    // no currency → no guessed currency on the review
    expect(r.fields.find((f) => f.name === 'currencyCode')).toEqual({ name: 'currencyCode', entered: null, stored: null, normalised: false });
    expect(r.fields.find((f) => f.name === 'priceMajor')?.stored).toBeNull();
    for (const x of r.refusals) expect(COURSE_REVIEW_REFUSALS).toContain(x.code);
    // every refusal printable: the invariant the shared module enforces
    expect(() => assertRefusalsPrintable('course', r.fields.map((f) => f.name), r.refusals)).not.toThrow();
  });
  it('price: invalid at scale is refused; the yen takes no decimals; a paid CREATE needs the desk key', () => {
    expect(codes(base({ entered: { ...base().entered, priceMajor: '149.005' } }))).toEqual(['priceMajor/PRICE_INVALID']);
    expect(codes(base({ money: JPY, entered: { ...base().entered, priceMajor: '149.5' } }))).toEqual(['priceMajor/PRICE_INVALID']);
    expect(codes(base({ money: JPY, entered: { ...base().entered, priceMajor: '149' } }))).toEqual(['priceMajor/PAID_NEEDS_DESK']);
    expect(codes(base({ entered: { ...base().entered, priceMajor: '149' } }))).toEqual(['priceMajor/PAID_NEEDS_DESK']);
    expect(codes(base({ canPublish: true, entered: { ...base().entered, priceMajor: '149' } }))).toEqual([]);
    // 0.00 typed is FREE, not paid
    expect(codes(base({ entered: { ...base().entered, priceMajor: '0.00' } }))).toEqual([]);
  });
  it('edit: a diff of changed fields only; a price CHANGE needs the desk key; unchanged price does not', () => {
    const current = { status: 'draft', instructorUserId: 'u1', defaultTitle: 'Old', topicCode: 'soil', level: 'basic', priceMinor: '14900', certEnabled: false, coverMediaId: null };
    const same = base({ current, entered: { defaultTitle: 'Old', topicCode: 'soil', level: 'basic', priceMajor: '149', certEnabled: '0' }, topic: { code: 'soil', name: 'Soil' } });
    const r0 = reviewCourse(same);
    expect(r0.ready).toBe(true); expect(r0.diff).toEqual([]);
    const changed = base({ current, entered: { defaultTitle: 'New', topicCode: 'soil', level: 'advanced', priceMajor: '199', certEnabled: '1' }, topic: { code: 'soil', name: 'Soil' } });
    const r1 = reviewCourse(changed);
    expect(refusalsFor(r1, 'priceMajor')).toEqual(['PAID_NEEDS_DESK']);
    expect(r1.diff).toEqual([
      { field: 'defaultTitle', before: 'Old', after: 'New' },
      { field: 'level', before: 'basic', after: 'advanced' },
      { field: 'priceMajor', before: '149.00', after: '199.00' },
      { field: 'certEnabled', before: 'no', after: 'yes' },
    ]);
    expect(reviewCourse({ ...changed, canPublish: true }).ready).toBe(true);
    // a price change DOWN to free is still a price change
    expect(codes(base({ current, entered: { ...same.entered, priceMajor: '' }, topic: { code: 'soil', name: 'Soil' } }))).toEqual(['priceMajor/PAID_NEEDS_DESK']);
  });
  it('edit: no such course, archived, not the owner (unless the desk); an edit needs no NEW instructor profile', () => {
    expect(codes(base({ current: null }))).toEqual(['COURSE_NOT_FOUND']);
    const cur = { status: 'archived', instructorUserId: 'u2', defaultTitle: 'x', topicCode: 'crop_care', level: 'basic', priceMinor: '0', certEnabled: true, coverMediaId: null };
    expect(codes(base({ current: cur }))).toEqual(['COURSE_ARCHIVED', 'NOT_OWNER']);
    expect(codes(base({ current: { ...cur, status: 'draft' }, canPublish: true }))).toEqual([]);
    expect(codes(base({ current: { ...cur, status: 'draft', instructorUserId: 'u1' }, hasInstructorProfile: false }))).toEqual([]);
    // the desk's key EDITS but does not CREATE — a desk member with no author key cannot author a course
    expect(codes(base({ canAuthor: false, canPublish: true }))).toEqual(['NO_AUTHOR']);
    // a topic typed and never looked up is unknown, not accepted
    expect(codes(base({ entered: { ...base().entered, topicCode: 'soil' }, topic: undefined }))).toEqual(['topicCode/TOPIC_UNKNOWN']);
  });
  it('the writer belt: a too-long title is TOO_LONG, and never doubled on a field with its own reason', () => {
    const r = reviewCourse(base({ writerIssues: [{ path: 'defaultTitle', tooLong: true }, { path: 'level', tooLong: false }], entered: { ...base().entered, level: 'zzz' } }));
    expect(refusalsFor(r, 'defaultTitle')).toEqual(['TOO_LONG']);
    expect(refusalsFor(r, 'level')).toEqual(['LEVEL_INVALID']);
  });
  it('storedCourse hands the writer the review\'s own digits and ids — and nothing when not ready', () => {
    const s = storedCourse(base({ canPublish: true, entered: { defaultTitle: ' T ', topicCode: 'crop_care', level: '', priceMajor: '149.5', certEnabled: 'true', coverMediaId: 'm1' }, cover: { id: 'm1' } }), 'topic-uuid');
    expect(s).toEqual({ defaultTitle: 'T', topicId: 'topic-uuid', level: 'basic', priceMinor: '14950', currencyCode: 'INR', certEnabled: true, coverMediaId: 'm1' });
    expect(storedCourse(base({ entered: { ...base().entered, topicCode: '' } }), 'ignored')?.topicId).toBeNull();
    expect(storedCourse(base({ canAuthor: false }), 'x')).toBeNull();
  });
});

describe('PC-56 TENANT-7a · six acts, verdicts in order', () => {
  const v = (over: Partial<Parameters<typeof actVerdict>[0]>) => actVerdict({ act: 'submit', status: 'draft', canAuthor: true, canPublish: false, isOwner: true, isSubmitter: false, gateReady: true, reason: 'ready for the desk', ...over });
  it('the author submits their own gated draft; the reason is required; the gate blocks', () => {
    expect(v({})).toEqual({ act: 'submit', allowed: true, refusals: [], to: 'review' });
    expect(v({ reason: 'ok' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(v({ reason: 'x'.repeat(301) }).refusals).toEqual(['REASON_REQUIRED']);
    expect(v({ gateReady: false }).refusals).toEqual(['GATE_NOT_PASSED']);
    expect(v({ gateReady: null }).refusals).toEqual(['GATE_NOT_PASSED']);   // an uncomputed gate is not a passed gate
    expect(v({ status: 'review' }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(v({ isOwner: false }).refusals).toEqual(['NOT_OWNER']);
    expect(v({ canAuthor: false }).refusals).toEqual(['NO_PERMISSION']);
  });
  it('publish is the desk\'s act, and never the maker\'s — owner or submitter', () => {
    const p = (o: Partial<Parameters<typeof actVerdict>[0]>) => v({ act: 'publish', status: 'review', canAuthor: false, canPublish: true, isOwner: false, ...o });
    expect(p({}).allowed).toBe(true);
    expect(p({ isOwner: true }).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(p({ isSubmitter: true }).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(p({ canPublish: false, canAuthor: true, isOwner: true }).refusals).toEqual(['NO_PERMISSION', 'MAKER_IS_CHECKER']);
    expect(p({ status: 'draft' }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('return needs the desk key and a course under review; pause/resume are the desk\'s; archive is the author\'s or the desk\'s', () => {
    expect(v({ act: 'return', status: 'review', canPublish: true, canAuthor: false, isOwner: false }).allowed).toBe(true);
    expect(v({ act: 'return', status: 'review' }).refusals).toEqual(['NO_PERMISSION']);
    expect(v({ act: 'pause', status: 'published' }).refusals).toEqual(['NO_PERMISSION']);
    expect(v({ act: 'pause', status: 'published', canPublish: true }).allowed).toBe(true);
    expect(v({ act: 'resume', status: 'paused', canPublish: true }).to).toBe('published');
    expect(v({ act: 'resume', status: 'published', canPublish: true }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(v({ act: 'archive', status: 'published' }).allowed).toBe(true);
    expect(v({ act: 'archive', status: 'published', isOwner: false, canPublish: true, canAuthor: false }).allowed).toBe(true);
    expect(v({ act: 'archive', status: 'archived' }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('allVerdicts covers every act and never refuses for the reason (the button\'s question, not the confirm\'s)', () => {
    const all = allVerdicts({ status: 'draft', canAuthor: true, canPublish: false, isOwner: true, isSubmitter: false, gateReady: true });
    expect(all.map((a) => a.act)).toEqual([...COURSE_ACTS]);
    expect(all.find((a) => a.act === 'submit')?.allowed).toBe(true);
    expect(all.find((a) => a.act === 'archive')?.allowed).toBe(true);
    for (const a of all) { expect(a.refusals).not.toContain('REASON_REQUIRED'); for (const r of a.refusals) expect(ACT_REFUSALS).toContain(r); }
    expect(isCourseAct('publish')).toBe(true); expect(isCourseAct('delete')).toBe(false);
    expect(reasonUsable('   ')).toBe(false); expect(reasonUsable('abc')).toBe(true);
  });
});

describe('PC-56 TENANT-7a · W416\'s gate, honest about what it cannot measure', () => {
  const L = (o: Partial<Parameters<typeof isHollow>[0]>) => ({ moduleNo: 1, lessonNo: 1, defaultTitle: 'x', contentKind: 'video' as const, mediaId: 'm', body: null, quiz: null, ...o });
  const G = (lessons: ReturnType<typeof L>[], o: Partial<Parameters<typeof computeGate>[0]> = {}) => computeGate({ lessons, topicCode: 'crop_care', priceMinor: '0', currencyCode: 'INR', certEnabled: true, hasInstructor: true, ...o });
  it('hollow: video/pdf/audio without media, article without body, quiz without questions; live needs a recording or a summary', () => {
    expect(isHollow(L({ mediaId: null }))).toBe(true);
    expect(isHollow(L({ contentKind: 'pdf', mediaId: null }))).toBe(true);
    expect(isHollow(L({ contentKind: 'audio' }))).toBe(false);
    expect(isHollow(L({ contentKind: 'audio', mediaId: null }))).toBe(true);
    expect(isHollow(L({ contentKind: 'article', mediaId: null, body: '  ' }))).toBe(true);
    expect(isHollow(L({ contentKind: 'article', mediaId: null, body: 'text' }))).toBe(false);
    expect(isHollow(L({ contentKind: 'quiz', mediaId: null, quiz: { questions: [] } }))).toBe(true);
    expect(isHollow(L({ contentKind: 'quiz', mediaId: null, quiz: { questions: [{ q: 'a', options: ['x', 'y'], answer: 1 }] } }))).toBe(false);
    expect(isHollow(L({ contentKind: 'live', mediaId: null, body: null }))).toBe(true);
    expect(isHollow(L({ contentKind: 'live', mediaId: null, body: 'recap' }))).toBe(false);
  });
  it('quiz well-formed: ≥ 2 options and an answer index inside them — the learner parser\'s rules', () => {
    expect(quizQuestionsOk(null)).toEqual({ ok: false, questions: 0 });
    expect(quizQuestionsOk({ questions: [{ q: 'a', options: ['x'], answer: 0 }] })).toEqual({ ok: false, questions: 1 });
    expect(quizQuestionsOk({ questions: [{ q: 'a', options: ['x', 'y'], answer: 2 }] })).toEqual({ ok: false, questions: 1 });
    expect(quizQuestionsOk({ questions: [{ q: 'a', options: ['x', 'y'], answer: -1 }] })).toEqual({ ok: false, questions: 1 });
    expect(quizQuestionsOk({ questions: [{ q: 'a', options: ['x', 'y'], answer: 1 }, { q: 'b', options: ['x', 'y', 'z'], answer: 0 }] })).toEqual({ ok: true, questions: 2 });
  });
  it('an empty course fails HAS_LESSONS; every check is present; the unmeasured six never block', () => {
    const g = G([]);
    expect(g.ready).toBe(false); expect(g.blocking).toEqual(['HAS_LESSONS']);
    expect(g.checks.map((c) => c.code)).toEqual([...GATE_CHECKS]);
    for (const c of g.checks) if (UNMEASURED_CHECKS.has(c.code)) { expect(c.state).toBe('not_measured'); expect(g.blocking).not.toContain(c.code); }
    expect(UNMEASURED_CHECKS.size).toBe(6);
  });
  it('names the hollow lessons by position (W416: "two lessons named above are the honest gap") and counts met/of', () => {
    const g = G([L({ lessonNo: 1 }), L({ lessonNo: 2, mediaId: null, defaultTitle: 'Season-wise ration planning' }), L({ moduleNo: 2, lessonNo: 1, contentKind: 'quiz', mediaId: null, quiz: { questions: [{ q: 'a', options: ['x'], answer: 0 }] }, defaultTitle: 'Quick check' })]);
    expect(g.ready).toBe(false);
    expect(g.blocking).toEqual(['NO_HOLLOW_LESSON', 'QUIZ_WELL_FORMED']);
    const hollow = g.checks.find((c) => c.code === 'NO_HOLLOW_LESSON')!;
    expect(hollow.measured).toEqual({ met: 1, of: 3 });
    expect(hollow.named).toEqual(['1·2 Season-wise ration planning', '2·1 Quick check']);
    const quiz = g.checks.find((c) => c.code === 'QUIZ_WELL_FORMED')!;
    expect(quiz.measured).toEqual({ met: 0, of: 1 }); expect(quiz.named).toEqual(['2·1 Quick check']);
    const audio = g.checks.find((c) => c.code === 'AUDIO_SIBLINGS')!;
    expect(audio.measured).toEqual({ met: 0, of: 2 });   // two video lessons, and no way to know which is paired
  });
  it('topic and instructor are declared or fail; price + certificate always pass as a declaration the desk co-signs', () => {
    const g = G([L({})], { topicCode: null, hasInstructor: false, priceMinor: '14900', certEnabled: false });
    expect(g.blocking).toEqual(['TOPIC_DECLARED', 'INSTRUCTOR_PROFILE']);
    expect(g.checks.find((c) => c.code === 'PRICE_CERT_DECLARED')).toMatchObject({ state: 'pass', declared: { priceMinor: '14900', currencyCode: 'INR', certEnabled: 'no' } });
    expect(G([L({})]).ready).toBe(true);
  });
});
