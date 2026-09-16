// apps/web-tenant/src/test/tenant7a-courses.spec.ts · PC-56 TENANT-7a · W178 / W179 / W416 + the course chains, as words.
//
// The API computes every verdict, gate and review; this suite is about the console not undoing that — a helper that
// printed `0%` for a course nobody opened, a refusal code with no sentence in Gujarati, a gate check with no name, or a
// rupee figure on the royalties tile — and about the two packages staying in step: every refusal, act and gate code the
// API can emit has a sentence here in three languages, read from the API's own source (6d-4's method).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CourseActVerdict, CourseGateCheck } from '@krishalaya/sdk-js';
import {
  COURSES_HREF, COURSE_FORM_FIELDS, DESK_ACTS, DETAIL_ROW_ACTS, NEW_COURSE_HREF, STATUS_TABS, actDoneKey, actHref, actLabelKey, actRefusalKey,
  completionPct, courseHref, courseTransportState, editCourseHref, formDoneKey, gateCheckKey, gateMeasuredText, gateStateKey, gateUnmeasuredKey,
  learnersOf, lessonsHref, levelKey, libraryHref, offeredActs, originKey, pageStateKey, publishHref, publishScreenKey, publishScreenState,
  refusedActs, royaltiesTileIsMoney, royaltiesTileKey, statusKey, statusTab, verdictFor,
} from '../features/courses/desk';
import { fieldLabelKey, refusalKey } from '../features/forms/chain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CAT = { en, hi, gu } as Record<string, Record<string, string>>;
const has = (key: string) => Object.keys(CAT).filter((l) => typeof CAT[l][key] === 'string' && CAT[l][key].length > 0);
const three = (key: string) => expect(has(key)).toEqual(['en', 'hi', 'gu']);
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/education/domain', rel), 'utf8');
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/** An `export const NAME = [ … ] as const` list, read from the API's own source so the two packages cannot drift. */
function apiList(file: string, constName: string): string[] {
  const s = api(file);
  const at = s.indexOf(`export const ${constName} = [`);
  if (at < 0) throw new Error(`no list ${constName} in ${file}`);
  const block = s.slice(at);
  const list = block.slice(block.indexOf('['), block.indexOf('] as const'));
  const own = [...list.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);
  return list.includes('WRITER_REFUSALS') ? [...own, 'TOO_LONG', 'VALUE_REJECTED'] : own;
}

describe('PC-56 TENANT-7a · routes', () => {
  it('the desk\'s library is /courses, the record /courses/[id], the two chains beside it; the lessons stay with the studio until 7b', () => {
    expect(COURSES_HREF).toBe('/courses'); expect(NEW_COURSE_HREF).toBe('/courses/new');
    expect(courseHref('a b')).toBe('/courses/a%20b');
    expect(editCourseHref('x')).toBe('/courses/new?id=x');
    expect(publishHref('x')).toBe('/courses/x/publish');
    expect(actHref('x', 'archive')).toBe('/courses/x/act?step=confirm&act=archive');
    expect(lessonsHref('x')).toBe('/studio/x');
  });
  it('a status chip is a GET filter that RESETS the cursor; page 3 of published is not page 3 of draft', () => {
    expect(libraryHref(null)).toBe('/courses');
    expect(libraryHref('draft')).toBe('/courses?status=draft');
    expect(libraryHref('draft', 'c1')).toBe('/courses?status=draft&cursor=c1');
    expect(statusTab('published')).toBe('published'); expect(statusTab('deleted')).toBeNull(); expect(statusTab(undefined)).toBeNull();
    // the canon's four chips plus the fifth status the machine has
    expect([...STATUS_TABS]).toEqual(['published', 'review', 'draft', 'paused', 'archived']);
    for (const s of STATUS_TABS) three(statusKey(s));
    for (const l of ['basic', 'intermediate', 'advanced']) three(levelKey(l));
  });
});

describe('PC-56 TENANT-7a · no number the console invents', () => {
  it('completion is integer arithmetic, and NOTHING for a course nobody has opened', () => {
    expect(completionPct(null)).toBeNull(); expect(completionPct(undefined)).toBeNull();
    expect(completionPct({ courseId: 'c', learners: 0, completed: 0, certificates: 0 })).toBeNull();   // never 0%
    expect(completionPct({ courseId: 'c', learners: 3, completed: 1, certificates: 0 })).toBe(33);
    expect(completionPct({ courseId: 'c', learners: 3, completed: 2, certificates: 0 })).toBe(66);      // floor, never 67
    expect(completionPct({ courseId: 'c', learners: 186, completed: 119, certificates: 119 })).toBe(63);
    expect(learnersOf(null)).toBeNull(); expect(learnersOf({ courseId: 'c', learners: 0, completed: 0, certificates: 0 })).toBe(0);
  });
  it('the royalties tile is refused by name in three languages and is not money', () => {
    three(royaltiesTileKey());
    expect(royaltiesTileIsMoney()).toBe(false);
    expect(en[royaltiesTileKey()]).toMatch(/Not shown/);
    expect(en[royaltiesTileKey()]).not.toMatch(/₹|\d[\d,]*\.\d\d/);   // no rupee sign, no amount — W418 is a screen reference, not a figure
    // and the page never formats a rupee figure into that tile
    const page = src('app/courses/page.tsx');
    expect(page).toMatch(/royaltiesTileKey\(\)/);
    expect(page).not.toMatch(/royalt[^\n]*formatMoneyMinor/);
  });
  it('origin: the tenant\'s own course or the platform library, never a blank', () => {
    expect(originKey({ isPlatformLibrary: true })).toBe('courses.origin.library');
    expect(originKey({ isPlatformLibrary: false })).toBe('courses.origin.own');
    expect(originKey({})).toBe('courses.origin.own');
    three('courses.origin.library'); three('courses.origin.own');
  });
});

describe('PC-56 TENANT-7a · page states', () => {
  it('OFF is not "no courses", a foreign id is not OFF, the desk key is restricted', () => {
    expect(courseTransportState('NOT_FOUND', 404)).toBe('notEnabled');
    expect(courseTransportState('COURSE_NOT_FOUND', 404)).toBe('notFound');
    expect(courseTransportState('FORBIDDEN', 403)).toBe('restricted');
    expect(courseTransportState('EDUCATION_FORBIDDEN', 403)).toBe('restricted');
    expect(courseTransportState('EDUCATION_FORBIDDEN')).toBe('restricted');   // the domain's own 403 code, status unknown
    expect(courseTransportState('X', 500)).toBe('error');
    expect(courseTransportState(undefined)).toBe('error');
    for (const s of ['notEnabled', 'restricted', 'notFound', 'error', 'editRestricted'] as const) three(pageStateKey(s));
    expect(en[pageStateKey('notEnabled')]).toMatch(/switched off/); expect(en[pageStateKey('notEnabled')]).not.toMatch(/\b0\b/);
    expect(en[pageStateKey('restricted')]).toMatch(/course\.publish/);
  });
});

describe('PC-56 TENANT-7a · the acts and the gate, in step with the API', () => {
  const v = (act: CourseActVerdict['act'], allowed: boolean, refusals: CourseActVerdict['refusals'] = []): CourseActVerdict => ({ act, allowed, refusals, to: 'review' });
  it('every act the API knows has a label and a done-sentence ×3; every refusal a sentence ×3', () => {
    const acts = apiList('course-acts.ts', 'COURSE_ACTS');
    expect(acts).toEqual(['submit', 'publish', 'return', 'pause', 'resume', 'archive']);
    for (const a of acts) { three(actLabelKey(a as never)); three(actDoneKey(a as never)); }
    const refusals = apiList('course-acts.ts', 'ACT_REFUSALS');
    expect(refusals).toContain('MAKER_IS_CHECKER'); expect(refusals).toContain('GATE_NOT_PASSED');
    for (const r of refusals) three(actRefusalKey(r));
    expect(en[actRefusalKey('MAKER_IS_CHECKER')]).toMatch(/Maker-checker/);
    // the detail row and the publish screen partition the six acts with archive on its own
    expect([...DETAIL_ROW_ACTS, ...DESK_ACTS, 'archive'].sort()).toEqual([...acts].sort());
  });
  it('offers only what the server allowed, and never prints a refused act as a button', () => {
    const all = [v('submit', true), v('publish', false, ['NO_PERMISSION', 'MAKER_IS_CHECKER']), v('archive', true)];
    expect(offeredActs(all).map((a) => a.act)).toEqual(['submit', 'archive']);
    expect(refusedActs(all).map((a) => a.act)).toEqual(['publish']);
    expect(verdictFor(all, 'publish')?.refusals).toEqual(['NO_PERMISSION', 'MAKER_IS_CHECKER']);
    expect(verdictFor(all, 'pause')).toBeNull();
  });
  it('every gate check has a name ×3, every state a word ×3, and every UNMEASURED check a reason ×3 naming what is missing', () => {
    const checks = apiList('course-publish-gate.ts', 'GATE_CHECKS');
    expect(checks.length).toBe(12);
    for (const c of checks) three(gateCheckKey(c));
    for (const s of ['pass', 'fail', 'not_measured'] as const) three(gateStateKey(s));
    const unmeasured = api('course-publish-gate.ts');
    const block = unmeasured.slice(unmeasured.indexOf('UNMEASURED_CHECKS: ReadonlySet<GateCheck> = new Set<GateCheck>(['));
    const codes = [...block.slice(0, block.indexOf('])')).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes).toEqual(['AUDIO_SIBLINGS', 'SUBTITLES_GU', 'SUBTITLES_HI', 'SUBTITLES_EN', 'QUIZ_EXPLANATIONS', 'THUMBNAILS_REAL']);
    for (const c of codes) { three(gateUnmeasuredKey(c)); expect(en[gateUnmeasuredKey(c)]).toMatch(/No .*(column|table|field|frame)|has no|is stored/i); }
    const m = (c: Partial<CourseGateCheck>): CourseGateCheck => ({ code: 'HAS_LESSONS', state: 'pass', measured: null, named: [], declared: null, ...c });
    expect(gateMeasuredText(m({ measured: { met: 10, of: 12 } }))).toBe('10/12');
    expect(gateMeasuredText(m({}))).toBeNull();
  });
  it('W416\'s screen state: a note on a draft is RETURNED, a bare draft is nothing-submitted', () => {
    expect(publishScreenState({ status: 'draft', reviewNote: 'Lesson 6 needs a source' })).toBe('returned');
    expect(publishScreenState({ status: 'draft', reviewNote: null })).toBe('nothingSubmitted');
    expect(publishScreenState({ status: 'review', reviewNote: null })).toBe('underReview');
    expect(publishScreenState({ status: 'published', reviewNote: null })).toBe('live');
    expect(publishScreenState({ status: 'paused', reviewNote: null })).toBe('paused');
    expect(publishScreenState({ status: 'archived', reviewNote: null })).toBe('archived');
    for (const s of ['returned', 'nothingSubmitted', 'underReview', 'live', 'paused', 'archived', 'deskOnly'] as const) three(publishScreenKey(s));
    expect(en[publishScreenKey('deskOnly')]).toMatch(/Publish stays with the desk/);
  });
});

describe('PC-56 TENANT-7a · the form chain\'s words', () => {
  it('every field the API reviews — including the currency row it adds — has a label ×3; every review refusal a sentence ×3', () => {
    const fields = apiList('course-review.ts', 'COURSE_FORM_FIELDS');
    expect(fields).toEqual([...COURSE_FORM_FIELDS]);
    for (const f of [...fields, 'currencyCode']) three(fieldLabelKey('course', f));
    const refusals = apiList('course-review.ts', 'COURSE_REVIEW_REFUSALS');
    expect(refusals).toContain('PAID_NEEDS_DESK'); expect(refusals).toContain('CURRENCY_UNKNOWN'); expect(refusals).toContain('TOO_LONG');
    for (const r of refusals) three(refusalKey('course', r));
    expect(en[refusalKey('course', 'PAID_NEEDS_DESK')]).toMatch(/course\.publish/);
    expect(en[refusalKey('course', 'CURRENCY_UNKNOWN')]).toMatch(/no price is invented/);
    three(formDoneKey(true)); three(formDoneKey(false));
    expect(formDoneKey(true)).toBe('form.course.updated'); expect(formDoneKey(false)).toBe('form.course.created');
    for (const k of ['form.col.before', 'form.col.after', 'form.diff.unchanged', 'form.course.title', 'form.course.editTitle']) three(k);
  });
});

describe('PC-56 TENANT-7a · the pages keep the house rules', () => {
  const pages = ['app/courses/page.tsx', 'app/courses/[id]/page.tsx', 'app/courses/[id]/act/page.tsx', 'app/courses/[id]/publish/page.tsx', 'app/courses/new/page.tsx'];
  it('no client JS, no physical CSS direction, no money arithmetic, every server action idempotent', () => {
    for (const p of pages) {
      const s = src(p);
      expect(s).not.toMatch(/'use client'/);
      expect(s).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align: ?left|text-align: ?right/);
      expect(s).not.toMatch(/priceMinor\s*[*\/]|\* *0\.8|royaltyBps/);   // no client-side money math, no 80% anywhere in the console
    }
    for (const a of ['app/courses/new/actions.ts', 'app/courses/[id]/act/actions.ts']) {
      const s = src(a);
      expect(s).toMatch(/'use server'/); expect(s).toMatch(/randomUUID\(\)/);
      expect(s).not.toMatch(/step=success[^\n]*reason=/);   // the reason never travels in the success URL
    }
  });
  it('the studio no longer posts a course create or a status change of its own — one write path', () => {
    expect(src('app/studio/actions.ts')).not.toMatch(/createCourseAction|courseLifecycleAction|courses\.(publish|pause|archive|submit)\(/);
    expect(src('app/studio/page.tsx')).toMatch(/NEW_COURSE_HREF/);
    expect(src('app/studio/[id]/page.tsx')).toMatch(/publishHref\(course\.id\)/);
    expect(src('components/Sidebar.tsx')).toMatch(/href: '\/courses'/);
    three('nav.courses');
  });
  it('W178\'s tiles: the three measured ones interpolate the window; the chips label is spoken', () => {
    for (const k of ['courses.tile.learners', 'courses.tile.completions']) { three(k); for (const l of ['en', 'hi', 'gu']) expect(CAT[l][k]).toMatch(/\{days\}/); }
    three('courses.chips.label'); three('courses.orderNote'); three('courses.libraryLearnersNote');
  });
});
