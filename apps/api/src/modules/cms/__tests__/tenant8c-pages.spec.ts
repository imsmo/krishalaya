// modules/cms/__tests__/tenant8c-pages.spec.ts · PC-56 TENANT-8c · THE PAGES — the pure rules, every branch pinned:
// slug / title / body / version (page-rules), the acts and their verdicts (page-acts), the review (page-review), the FAQ
// order (faq-order) and what serves (page-serving). The mutation pass plants against this file.
import {
  BODY_MAX, RESERVED_SLUGS, SLUG_MAX, bodyIsMarkdown, nextVersion, normaliseBody, normaliseSlug, normaliseTitle, rawHtmlTags, slugIssue, unsafeLinkSchemes, versionsContiguous,
} from '../domain/page-rules';
import { PAGE_ACTS, PAGE_ACT_REFUSALS, actPermitted, actTarget, allPageVerdicts, ignoringInput, isMaker, isPageAct, needsChecker, pageActVerdict, PageActInput } from '../domain/page-acts';
import { PAGE_FORM_FIELDS, PAGE_REVIEW_REFUSALS, expectToken, reviewPage, storedPage, writeMode, PageReviewInput, OwnVersionFact } from '../domain/page-review';
import { FAQ_ACT_REFUSALS, faqMoveVerdict, faqPosition, nextFaqPlace, orderedFaq, planFaqMove, renumberFaq } from '../domain/faq-order';
import { SLUG_STATES, servingAfter, servingFor, slugState } from '../domain/page-serving';
import { canTransition } from '../domain/cms-page.state';

describe('page-rules · the slug', () => {
  it('normalises what a person means and nothing else', () => {
    expect(normaliseSlug('  How To_List  ')).toBe('how-to-list');
    expect(normaliseSlug('a -- b')).toBe('a-b');
    expect(normaliseSlug('--x--')).toBe('x');
    expect(normaliseSlug('A\tB')).toBe('a-b');
    expect(normaliseSlug('   ')).toBeNull(); expect(normaliseSlug(null)).toBeNull(); expect(normaliseSlug(undefined)).toBeNull();
    expect(normaliseSlug('ફોટા')).toBe('ફોટા');                 // not stripped: refused by name below
    expect(normaliseSlug('payout!')).toBe('payout!');
  });
  it('refuses by name, in order: blank · too long · shape · reserved', () => {
    expect(slugIssue(null)).toBe('SLUG_REQUIRED'); expect(slugIssue('')).toBe('SLUG_REQUIRED');
    expect(slugIssue('a'.repeat(SLUG_MAX))).toBeNull();
    expect(slugIssue('a'.repeat(SLUG_MAX + 1))).toBe('SLUG_TOO_LONG');
    expect(slugIssue('ફોટા')).toBe('SLUG_INVALID'); expect(slugIssue('payout!')).toBe('SLUG_INVALID'); expect(slugIssue('a--b')).toBe('SLUG_INVALID'); expect(slugIssue('-a')).toBe('SLUG_INVALID');
    expect(RESERVED_SLUGS).toEqual(['new']); expect(slugIssue('new')).toBe('SLUG_RESERVED'); expect(slugIssue('new-page')).toBeNull();
    expect(slugIssue('how-to-list')).toBeNull(); expect(slugIssue('faq-2026')).toBeNull();
  });
  it('a title is trimmed with its inner runs collapsed; blank is null', () => {
    expect(normaliseTitle('  About   Anand\nFPO ')).toBe('About Anand FPO'); expect(normaliseTitle(' \n ')).toBeNull(); expect(normaliseTitle(undefined)).toBeNull();
  });
});

describe('page-rules · the body is markdown', () => {
  it('normalises line endings, control characters and trailing blanks — never the words', () => {
    expect(normaliseBody('# a\r\nb\rc')).toBe('# a\nb\nc');
    expect(normaliseBody('a\u0000b\u0007c\td')).toBe('abc\td');
    expect(normaliseBody('line  \nnext\t\n\n\n')).toBe('line\nnext');
    expect(normaliseBody('  indented')).toBe('  indented');          // leading space is markdown (a code block)
    expect(normaliseBody('\n\n')).toBeNull(); expect(normaliseBody(null)).toBeNull(); expect(normaliseBody(' \u0001 ')).toBeNull();
  });
  it('finds raw HTML tags (unique, lower-cased) and comments; an autolink is not a tag', () => {
    expect(rawHtmlTags('<b>x</b> <B>y</B> <script src="x"></script>')).toEqual(['b', 'script']);
    expect(rawHtmlTags('<br/> and <img src=x onerror=1>')).toEqual(['br', 'img']);
    expect(rawHtmlTags('see <https://krishi.example/x> and a < b > c')).toEqual([]);
    expect(rawHtmlTags('2 < 3 and <3')).toEqual([]);
    expect(rawHtmlTags('<!-- hidden -->')).toEqual(['!--']);
    expect(rawHtmlTags('< div >')).toEqual([]);                    // a browser reads that as text
    expect(rawHtmlTags('</p>')).toEqual(['p']);
    expect(rawHtmlTags('<DIV>shout</DIV>')).toEqual(['div']);           // an upper-case tag is a tag
  });
  it('finds script / data / vbscript link targets, unique, and nothing else', () => {
    expect(unsafeLinkSchemes('[a](javascript:alert(1)) [b]( JavaScript:x) [c](<data:text/html,x>) [d](vbscript:x)')).toEqual(['javascript', 'data', 'vbscript']);
    expect(unsafeLinkSchemes('[a](https://x) [b](mailto:x) javascript: in prose')).toEqual([]);
    expect(unsafeLinkSchemes('[x](JAVASCRIPT:alert(1))')).toEqual(['javascript']);
    expect(bodyIsMarkdown('# ok [x](https://x)')).toBe(true);
    expect(bodyIsMarkdown('<p>x</p>')).toBe(false); expect(bodyIsMarkdown('[x](javascript:1)')).toBe(false); expect(bodyIsMarkdown('a <!-- b')).toBe(false);
  });
  it('versions: next is max + 1 (1 when none); contiguous means 1..n', () => {
    expect(nextVersion([])).toBe(1); expect(nextVersion([1, 3, 2])).toBe(4); expect(nextVersion([7])).toBe(8);
    expect(versionsContiguous([])).toBe(true); expect(versionsContiguous([2, 1, 3])).toBe(true);
    expect(versionsContiguous([1, 3])).toBe(false); expect(versionsContiguous([1, 1])).toBe(false); expect(versionsContiguous([2])).toBe(false);
    expect(BODY_MAX).toBe(200_000);
  });
});

describe('page-acts · the state machine (Law 5) and the verdicts', () => {
  const page = (o: Partial<PageActInput['page']> = {}): PageActInput['page'] => ({ tenantOwned: true, status: 'draft', pageKind: 'static', createdBy: 'a', lastEditedBy: 'a', body: '# x', ...o });
  const v = (o: Partial<PageActInput> = {}) => pageActVerdict({ act: 'publish', canAuthor: true, canPublish: true, page: page(), openDraftExists: false, actorUserId: 'a', reason: 'goes live', archiveReason: null, archiveReasons: ['outdated'], ...o });
  it('the transitions, as the trigger has them', () => {
    expect(canTransition('draft', 'published')).toBe(true); expect(canTransition('draft', 'archived')).toBe(true); expect(canTransition('published', 'archived')).toBe(true);
    expect(canTransition('published', 'draft')).toBe(false); expect(canTransition('archived', 'published')).toBe(false); expect(canTransition('archived', 'draft')).toBe(false);
    expect(actTarget('draft', 'publish')).toBe('published'); expect(actTarget('published', 'publish')).toBeNull(); expect(actTarget('archived', 'publish')).toBeNull();
    expect(actTarget('draft', 'archive')).toBe('archived'); expect(actTarget('published', 'archive')).toBe('archived'); expect(actTarget('archived', 'archive')).toBeNull();
    expect(actTarget('archived', 'restore')).toBe('draft'); expect(actTarget('draft', 'restore')).toBeNull(); expect(actTarget('published', 'restore')).toBeNull();
    expect(PAGE_ACTS).toEqual(['publish', 'archive', 'restore']); expect(isPageAct('archive')).toBe(true); expect(isPageAct('unpublish')).toBe(false);
  });
  it('who may: publish and taking a live page down are the checker\'s; restore the author\'s; a draft\'s withdrawal either\'s', () => {
    expect(actPermitted('publish', 'draft', true, false)).toBe(false); expect(actPermitted('publish', 'draft', false, true)).toBe(true);
    expect(actPermitted('archive', 'published', true, false)).toBe(false); expect(actPermitted('archive', 'published', false, true)).toBe(true);
    expect(actPermitted('archive', 'draft', true, false)).toBe(true); expect(actPermitted('archive', 'draft', false, true)).toBe(true); expect(actPermitted('archive', 'draft', false, false)).toBe(false);
    expect(actPermitted('restore', 'archived', true, false)).toBe(true); expect(actPermitted('restore', 'archived', false, true)).toBe(false);
  });
  it('maker is the author OR the last editor; only a policy page needs a checker', () => {
    expect(isMaker({ createdBy: 'a', lastEditedBy: 'b' }, 'a')).toBe(true); expect(isMaker({ createdBy: 'a', lastEditedBy: 'b' }, 'b')).toBe(true);
    expect(isMaker({ createdBy: 'a', lastEditedBy: 'b' }, 'c')).toBe(false); expect(isMaker({ createdBy: null, lastEditedBy: null }, 'c')).toBe(false);
    expect(needsChecker('policy')).toBe(true); for (const k of ['static', 'faq', 'help_article']) expect(needsChecker(k)).toBe(false);
  });
  it('publish: a static page by its own author is fine; a POLICY page by its author or last editor is MAKER_IS_CHECKER', () => {
    expect(v()).toEqual({ act: 'publish', allowed: true, refusals: [], to: 'published' });
    expect(v({ page: page({ pageKind: 'policy' }) }).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(v({ page: page({ pageKind: 'policy', createdBy: 'z', lastEditedBy: 'a' }) }).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(v({ page: page({ pageKind: 'policy', createdBy: 'z', lastEditedBy: 'y' }) }).allowed).toBe(true);
    expect(v({ canPublish: false }).refusals).toEqual(['NO_PERMISSION']);
    expect(v({ page: page({ status: 'published' }) }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(v({ page: page({ status: 'published', pageKind: 'policy' }) }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);   // no MAKER noise on an illegal act
    expect(v({ page: page({ body: '<b>x</b>' }) }).refusals).toEqual(['BODY_NOT_MARKDOWN']);
    expect(v({ page: page({ tenantOwned: false }) }).refusals).toEqual(['PLATFORM_PAGE']);
  });
  it('archive: a vocabulary reason a person may choose, and a sentence', () => {
    const a = (o: Partial<PageActInput> = {}) => v({ act: 'archive', archiveReason: 'outdated', ...o });
    expect(a()).toEqual({ act: 'archive', allowed: true, refusals: [], to: 'archived' });
    expect(a({ archiveReason: '' }).refusals).toEqual(['ARCHIVE_REASON_REQUIRED']);
    expect(a({ archiveReason: '  ' }).refusals).toEqual(['ARCHIVE_REASON_REQUIRED']);
    expect(a({ archiveReason: null }).refusals).toEqual(['ARCHIVE_REASON_REQUIRED']);
    expect(a({ archiveReason: 'superseded' }).refusals).toEqual(['ARCHIVE_REASON_UNKNOWN']);
    expect(a({ archiveReason: 'outdated', archiveReasons: undefined }).refusals).toEqual(['ARCHIVE_REASON_UNKNOWN']);
    expect(a({ archiveReason: ' outdated ' }).allowed).toBe(true);
    expect(a({ page: page({ status: 'archived' }) }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(a({ page: page({ status: 'published' }), canPublish: false }).refusals).toEqual(['NO_PERMISSION']);
    expect(a({ page: page({ pageKind: 'policy', status: 'published' }) }).allowed).toBe(true);   // no maker rule on archive
  });
  it('restore: archived only, never beside an open draft, the author\'s verb, markdown only', () => {
    const r = (o: Partial<PageActInput> = {}) => v({ act: 'restore', page: page({ status: 'archived' }), ...o });
    expect(r()).toEqual({ act: 'restore', allowed: true, refusals: [], to: 'draft' });
    expect(r({ openDraftExists: true }).refusals).toEqual(['DRAFT_OPEN']);
    expect(r({ canAuthor: false }).refusals).toEqual(['NO_PERMISSION']);
    expect(r({ page: page({ status: 'published' }) }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(r({ page: page({ status: 'published' }), openDraftExists: true }).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(r({ page: page({ status: 'archived', body: '<i>x</i>' }) }).refusals).toEqual(['BODY_NOT_MARKDOWN']);
  });
  it('the reason: 3..300 trimmed; every refusal at once', () => {
    expect(v({ reason: 'ab' }).refusals).toEqual(['REASON_REQUIRED']); expect(v({ reason: '  abc ' }).allowed).toBe(true);
    expect(v({ reason: '  ab  ' }).refusals).toEqual(['REASON_REQUIRED']); expect(v({ reason: ` ${'x'.repeat(300)} ` }).allowed).toBe(true);
    expect(v({ reason: null }).refusals).toEqual(['REASON_REQUIRED']); expect(v({ reason: undefined }).refusals).toEqual(['REASON_REQUIRED']);
    expect(v({ reason: 'x'.repeat(300) }).allowed).toBe(true); expect(v({ reason: 'x'.repeat(301) }).refusals).toEqual(['REASON_TOO_LONG']);
    expect(v({ canPublish: false, page: page({ tenantOwned: false, pageKind: 'policy' }), reason: '' }).refusals).toEqual(['NO_PERMISSION', 'PLATFORM_PAGE', 'MAKER_IS_CHECKER', 'REASON_REQUIRED']);
  });
  it('the buttons ignore what is typed; every act in the canon\'s order', () => {
    const all = allPageVerdicts({ canAuthor: true, canPublish: true, page: page(), openDraftExists: false, actorUserId: 'a', reason: '', archiveReason: '', archiveReasons: [] });
    expect(all.map((x) => x.act)).toEqual(['publish', 'archive', 'restore']);
    expect(all.map((x) => x.refusals)).toEqual([['REASON_REQUIRED'], ['ARCHIVE_REASON_REQUIRED', 'REASON_REQUIRED'], ['ILLEGAL_FROM_STATUS', 'REASON_REQUIRED']]);
    expect(all.map(ignoringInput).map((x) => x.allowed)).toEqual([true, true, false]);
    expect(ignoringInput(v({ act: 'archive', archiveReason: 'nope', reason: 'x'.repeat(301) })).refusals).toEqual([]);
    expect(PAGE_ACT_REFUSALS).toContain('REFUSED_BY_DATABASE');
  });
});

describe('page-review · what the platform will write', () => {
  const own = (o: Partial<OwnVersionFact> = {}): OwnVersionFact => ({ id: 'v1', version: 1, status: 'published', pageKind: 'static', defaultTitle: 'About', body: '# About', languageCode: 'gu', topic: null, sortOrder: 0, ...o });
  const base = (o: Partial<PageReviewInput> = {}): PageReviewInput => ({
    canAuthor: true, intent: 'new', entered: { slug: 'about', pageKind: 'static', defaultTitle: 'About', body: '# About', languageCode: 'gu', reason: 'our story' },
    topics: ['payments', 'general'], tenantLanguages: ['gu', 'en'], own: [], platform: null, ...o,
  });
  const codes = (r: { refusals: Array<{ field: string | null; code: string }> }) => r.refusals.map((x) => `${x.field ?? '-'}/${x.code}`);
  it('a new page: v1, a draft, no diff, the fields as stored', () => {
    const r = reviewPage(base({ entered: { slug: ' About ', pageKind: 'static', defaultTitle: ' About  us ', body: '# About\r\nus', languageCode: 'gu', reason: ' our story ' } }));
    expect(r.ready).toBe(true); expect(r.diff).toBeNull(); expect(r.entityType).toBe('cms_page');
    expect(r.fields.map((f) => [f.name, f.stored, f.normalised])).toEqual([
      ['slug', 'about', true], ['pageKind', 'static', false], ['defaultTitle', 'About us', true], ['body', '# About\nus', true],
      ['languageCode', 'gu', false], ['topic', null, false], ['reason', 'our story', false], ['version', 'v1', false], ['status', 'draft', false],
    ]);
    expect(r.preview).toEqual({ mode: 'new_page', version: 1, draftId: null, expect: 'new_page:1', kind: 'static', needsChecker: false, servingToday: { source: 'none', version: null },
      replacesPlatformVersion: null, historyVersions: [], faqPlace: null, rawHtmlTags: [], unsafeLinkSchemes: [] });
    expect(PAGE_FORM_FIELDS).toEqual(['slug', 'pageKind', 'defaultTitle', 'body', 'languageCode', 'topic', 'reason']);
  });
  it('a slug only the PLATFORM has is yours to write: it says which platform version it replaces (F-14)', () => {
    const r = reviewPage(base({ platform: { version: 5, pageKind: 'static', defaultTitle: 'About Krishalaya' } }));
    expect(r.ready).toBe(true);
    expect(r.preview).toMatchObject({ mode: 'new_page', version: 1, servingToday: { source: 'platform', version: 5 }, replacesPlatformVersion: 5 });
  });
  it('the New-page chain refuses a slug the cooperative already holds; the editor chain writes its next version', () => {
    expect(codes(reviewPage(base({ own: [own()] })))).toEqual(['slug/SLUG_TAKEN']);
    expect(reviewPage(base({ own: [own()] })).preview).toMatchObject({ mode: null, version: null, expect: null });
    const r = reviewPage(base({ intent: 'version', own: [own({ version: 2 }), own({ id: 'v0', version: 1, status: 'archived' })], entered: { ...base().entered, body: '# About v3' }, platform: { version: 9, pageKind: 'static', defaultTitle: 'x' } }));
    expect(r.ready).toBe(true);
    expect(r.preview).toMatchObject({ mode: 'new_version', version: 3, expect: 'new_version:3', historyVersions: [1, 2], servingToday: { source: 'own', version: 2 }, replacesPlatformVersion: null });
    expect(r.diff).toEqual([{ field: 'body', before: '# About', after: '# About v3' }]);
  });
  it('an open draft is EDITED (its id and version); nothing changed is refused', () => {
    const d = own({ id: 'd2', version: 2, status: 'draft', body: '# draft' });
    const r = reviewPage(base({ intent: 'version', own: [d, own()], entered: { ...base().entered, body: '# draft edited', defaultTitle: 'About us', languageCode: 'en', reason: 'fix' } }));
    expect(r.preview).toMatchObject({ mode: 'edit_draft', version: 2, draftId: 'd2', expect: 'edit_draft:2', historyVersions: [1] });   // the draft is not history
    expect(r.diff).toEqual([{ field: 'defaultTitle', before: 'About', after: 'About us' }, { field: 'body', before: '# draft', after: '# draft edited' }, { field: 'languageCode', before: 'gu', after: 'en' }]);
    expect(codes(reviewPage(base({ intent: 'version', own: [d], entered: { ...base().entered, body: '# draft' } })))).toEqual(['-/NOTHING_CHANGED']);
    expect(codes(reviewPage(base({ intent: 'version', own: [own()] })))).toEqual(['-/NOTHING_CHANGED']);
  });
  it('the kind is the slug\'s once it has a version; a POLICY page needs a checker', () => {
    expect(codes(reviewPage(base({ intent: 'version', own: [own({ pageKind: 'policy' })], entered: { ...base().entered, pageKind: 'static', body: '# new' } })))).toEqual(['pageKind/KIND_FIXED']);
    expect(codes(reviewPage(base({ entered: { ...base().entered, pageKind: '' } })))).toEqual(['pageKind/KIND_REQUIRED']);
    expect(codes(reviewPage(base({ entered: { ...base().entered, pageKind: 'blog' } })))).toEqual(['pageKind/KIND_UNKNOWN']);
    expect(reviewPage(base({ entered: { ...base().entered, pageKind: 'policy' } })).preview.needsChecker).toBe(true);
    expect(reviewPage(base({ intent: 'version', own: [own({ pageKind: 'policy' })], entered: { ...base().entered, pageKind: 'static' } })).preview).toMatchObject({ kind: 'policy', needsChecker: true });
    expect(reviewPage(base({ entered: { ...base().entered, pageKind: '' } })).preview.needsChecker).toBe(false);
  });
  it('slug, title, body, language, reason — each refused by name; every refusal at once', () => {
    const r = reviewPage(base({ canAuthor: false, entered: { slug: 'new', pageKind: 'static', defaultTitle: ' ', body: '<div>x</div> [a](javascript:1)', languageCode: 'hi', reason: 'no' } }));
    expect(codes(r)).toEqual(['-/NO_PERMISSION', 'slug/SLUG_RESERVED', 'defaultTitle/TITLE_REQUIRED', 'body/BODY_RAW_HTML', 'body/BODY_UNSAFE_LINK', 'languageCode/LANGUAGE_NOT_TENANT', 'reason/REASON_REQUIRED']);
    expect(r.preview).toMatchObject({ mode: null, version: null, expect: null, rawHtmlTags: ['div'], unsafeLinkSchemes: ['javascript'] });
    expect(r.fields.find((f) => f.name === 'version')?.stored).toBeNull();
    expect(codes(reviewPage(base({ entered: {} })))).toEqual(['slug/SLUG_REQUIRED', 'pageKind/KIND_REQUIRED', 'defaultTitle/TITLE_REQUIRED', 'body/BODY_REQUIRED', 'languageCode/LANGUAGE_REQUIRED', 'reason/REASON_REQUIRED']);
    expect(codes(reviewPage(base({ entered: { ...base().entered, slug: 'ફોટા' } })))).toEqual(['slug/SLUG_INVALID']);
    // a slug that is not an address reads no versions at all, whatever it was handed
    expect(reviewPage(base({ entered: { ...base().entered, slug: 'ફોટા' }, own: [own()] })).preview).toMatchObject({ servingToday: { source: 'none', version: null }, historyVersions: [], mode: null });
    expect(codes(reviewPage(base({ entered: { ...base().entered, reason: 'abc' } })))).toEqual([]);
  });
  it('the FAQ topic: required on faq, refused elsewhere, from the vocabulary; a new entry takes the next place', () => {
    const faq = { ...base().entered, slug: 'payout-when', pageKind: 'faq', defaultTitle: 'મારા પૈસા ક્યારે આવશે?', topic: 'payments' };
    expect(reviewPage(base({ entered: faq, topicEntries: 4 })).preview.faqPlace).toBe(5);
    expect(reviewPage(base({ entered: faq })).preview.faqPlace).toBe(1);
    expect(reviewPage(base({ intent: 'version', own: [own({ pageKind: 'faq', topic: 'payments' })], entered: { ...faq, body: '# v2' }, topicEntries: 4 })).preview.faqPlace).toBeNull();
    expect(codes(reviewPage(base({ entered: { ...faq, topic: '' } })))).toEqual(['topic/TOPIC_REQUIRED']);
    expect(codes(reviewPage(base({ entered: { ...faq, topic: 'weather' } })))).toEqual(['topic/TOPIC_UNKNOWN']);
    expect(codes(reviewPage(base({ entered: { ...base().entered, topic: 'payments' } })))).toEqual(['topic/TOPIC_NOT_FAQ']);
    expect(reviewPage(base({ entered: { ...base().entered } })).preview.faqPlace).toBeNull();
    const moved = reviewPage(base({ intent: 'version', own: [own({ pageKind: 'faq', topic: 'payments', status: 'draft' })], entered: { ...faq, topic: 'general', body: '# About' } }));
    expect(moved.diff).toEqual([{ field: 'defaultTitle', before: 'About', after: 'મારા પૈસા ક્યારે આવશે?' }, { field: 'topic', before: 'payments', after: 'general' }]);
    expect(reviewPage(base({ intent: 'version', own: [own({ pageKind: 'faq', topic: 'payments', status: 'draft' })], entered: { ...faq, pageKind: 'static', topic: '' } })).diff).toEqual([
      { field: 'pageKind', before: 'faq', after: 'static' }, { field: 'defaultTitle', before: 'About', after: 'મારા પૈસા ક્યારે આવશે?' }, { field: 'topic', before: 'payments', after: null }]);
  });
  it('whatever the writer refuses, the review refuses first — and never twice on a field that has its own reason', () => {
    const r = reviewPage(base({ writerIssues: [{ path: 'defaultTitle', tooLong: true }, { path: 'reason', tooLong: false }, { path: 'nope', tooLong: false }], entered: { ...base().entered, reason: 'x' } }));
    expect(codes(r)).toEqual(['reason/REASON_REQUIRED', 'defaultTitle/TOO_LONG', '-/VALUE_REJECTED']);
    expect(PAGE_REVIEW_REFUSALS).toEqual(expect.arrayContaining(['TOO_LONG', 'VALUE_REJECTED', 'SLUG_TAKEN', 'KIND_FIXED']));
  });
  it('writeMode and the expect token', () => {
    expect(writeMode([])).toEqual({ mode: 'new_page', version: 1 });
    expect(writeMode([{ version: 1, status: 'archived' }, { version: 2, status: 'published' }])).toEqual({ mode: 'new_version', version: 3 });
    expect(writeMode([{ version: 1, status: 'published' }, { version: 2, status: 'draft' }])).toEqual({ mode: 'edit_draft', version: 2 });
    expect(expectToken('new_version', 3)).toBe('new_version:3');
    expect(storedPage({ topic: ' payments ', languageCode: ' gu ' })).toMatchObject({ topic: 'payments', languageCode: 'gu', slug: null, body: null, reason: null });
  });
});

describe('faq-order · the reorder act\'s arithmetic', () => {
  const e = [{ slug: 'c', sortOrder: 3 }, { slug: 'a', sortOrder: 1 }, { slug: 'b', sortOrder: 2 }];
  it('orders by place then slug; a tie reads by slug', () => {
    expect(orderedFaq(e).map((x) => x.slug)).toEqual(['a', 'b', 'c']);
    expect(orderedFaq([{ slug: 'z', sortOrder: 0 }, { slug: 'm', sortOrder: 0 }, { slug: 'm', sortOrder: 0 }]).map((x) => x.slug)).toEqual(['m', 'm', 'z']);
    expect(orderedFaq([{ slug: 'b', sortOrder: 1 }, { slug: 'a', sortOrder: 2 }]).map((x) => x.slug)).toEqual(['b', 'a']);
  });
  it('moves one place, renumbering only what changes; refuses the edges and a stranger', () => {
    expect(planFaqMove(e, 'b', 'up')).toEqual({ ok: true, order: ['b', 'a', 'c'], steps: [{ slug: 'b', from: 2, to: 1 }, { slug: 'a', from: 1, to: 2 }] });
    expect(planFaqMove(e, 'b', 'down')).toEqual({ ok: true, order: ['a', 'c', 'b'], steps: [{ slug: 'c', from: 3, to: 2 }, { slug: 'b', from: 2, to: 3 }] });
    expect(planFaqMove(e, 'a', 'up')).toEqual({ ok: false, refusal: 'AT_TOP' });
    expect(planFaqMove(e, 'c', 'down')).toEqual({ ok: false, refusal: 'AT_BOTTOM' });
    expect(planFaqMove(e, 'x', 'up')).toEqual({ ok: false, refusal: 'ENTRY_NOT_IN_TOPIC' });
    // pre-0177 entries are all 0: a move tidies the whole topic to 1..n
    expect(planFaqMove([{ slug: 'q', sortOrder: 0 }, { slug: 'p', sortOrder: 0 }], 'q', 'up')).toEqual({ ok: true, order: ['q', 'p'], steps: [{ slug: 'q', from: 0, to: 1 }, { slug: 'p', from: 0, to: 2 }] });
    expect(renumberFaq(e, ['a', 'b', 'c'])).toEqual([]);
    expect(renumberFaq(e, ['a', 'zz', 'b'])).toEqual([{ slug: 'b', from: 2, to: 3 }]);
  });
  it('a new entry goes last; positions are 1-based', () => {
    expect(nextFaqPlace([])).toBe(1); expect(nextFaqPlace(e)).toBe(4); expect(nextFaqPlace([{ slug: 'a', sortOrder: 1 }, { slug: 'b', sortOrder: 5 }])).toBe(6);
    expect(faqPosition(e, 'c')).toBe(3); expect(faqPosition(e, 'a')).toBe(1); expect(faqPosition(e, 'x')).toBeNull();
  });
  it('the verdict: every reason at once', () => {
    const ok = faqMoveVerdict({ canAuthor: true, topic: 'payments', entries: e, slug: 'b', direction: 'up', reason: 'asked most' });
    expect(ok.allowed).toBe(true); expect(ok.refusals).toEqual([]); expect(ok.topic).toBe('payments');
    expect(faqMoveVerdict({ canAuthor: false, topic: null, entries: [], slug: 'b', direction: 'up', reason: '' })).toEqual({ allowed: false, refusals: ['NO_PERMISSION', 'NOT_FAQ', 'REASON_REQUIRED'], plan: null, topic: null });
    expect(faqMoveVerdict({ canAuthor: true, topic: 'p', entries: e, slug: 'a', direction: 'up', reason: 'x'.repeat(301) }).refusals).toEqual(['AT_TOP', 'REASON_TOO_LONG']);
    expect(faqMoveVerdict({ canAuthor: true, topic: 'p', entries: e, slug: 'a', direction: 'down', reason: '  ab ' }).refusals).toEqual(['REASON_REQUIRED']);
    expect(faqMoveVerdict({ canAuthor: true, topic: 'p', entries: e, slug: 'a', direction: 'down', reason: 'x'.repeat(300) }).allowed).toBe(true);
    expect(faqMoveVerdict({ canAuthor: true, topic: 'p', entries: e, slug: 'a', direction: 'down', reason: null }).refusals).toEqual(['REASON_REQUIRED']);
    expect(FAQ_ACT_REFUSALS).toEqual(['NO_PERMISSION', 'NOT_FAQ', 'ENTRY_NOT_IN_TOPIC', 'AT_TOP', 'AT_BOTTOM', 'REASON_REQUIRED', 'REASON_TOO_LONG']);
  });
});

describe('page-serving · what a member would be served (F-14)', () => {
  it('your own live version wins whatever its number; the platform\'s only when you have none', () => {
    expect(servingFor(1, 5)).toEqual({ source: 'own', version: 1 });
    expect(servingFor(null, 5)).toEqual({ source: 'platform', version: 5 });
    expect(servingFor(null, null)).toEqual({ source: 'none', version: null });
    expect(servingFor(3, null)).toEqual({ source: 'own', version: 3 });
  });
  it('the one-word state', () => {
    expect(slugState({ ownRows: 0, ownPublished: null, openDraft: null })).toBe('platform');
    expect(slugState({ ownRows: 2, ownPublished: 1, openDraft: 2 })).toBe('published');
    expect(slugState({ ownRows: 1, ownPublished: null, openDraft: 1 })).toBe('draft');
    expect(slugState({ ownRows: 1, ownPublished: null, openDraft: null })).toBe('archived');
    expect(SLUG_STATES).toEqual(['published', 'draft', 'archived', 'platform']);
  });
  it('after an act: publishing makes yours the answer; archiving the live one hands it to the platform or to nothing', () => {
    expect(servingAfter('publish', { version: 4, wasLive: false, platformPublished: 5, ownPublished: 3 })).toEqual({ source: 'own', version: 4 });
    expect(servingAfter('archive', { version: 3, wasLive: true, platformPublished: 5, ownPublished: 3 })).toEqual({ source: 'platform', version: 5 });
    expect(servingAfter('archive', { version: 3, wasLive: true, platformPublished: null, ownPublished: 3 })).toEqual({ source: 'none', version: null });
    expect(servingAfter('archive', { version: 4, wasLive: false, platformPublished: 5, ownPublished: 3 })).toEqual({ source: 'own', version: 3 });
  });
});
