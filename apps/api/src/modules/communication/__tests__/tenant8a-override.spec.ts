// modules/communication/__tests__/tenant8a-override.spec.ts · PC-56 TENANT-8a · THE OVERRIDE — the pure logic, pinned:
// the lifecycle (state machine + act verdicts), the form's review, the SMS segment arithmetic (the tenant realm's port
// of ADMIN-11b's), the fallback-language order (F-22) and the serving source (F-1).
import {
  OVERRIDE_ACTS, allOverrideVerdicts, approvalTarget, ignoringReason, isOverrideAct, isSecurityCopy, isServingLifecycle, needsProvider,
  nextLifecycle, overrideActVerdict, servingSource, OverrideActInput,
} from '../domain/template-override';
import {
  OVERRIDE_FORM_FIELDS, OverrideReviewInput, bodyTokens, missingRequired, providerOf, renderPreview, reviewOverride, samplesOf, storedOverride, unknownTokens,
} from '../domain/template-override-review';
import { SEGMENT_BUDGET, encodingOf, exceedsSegmentBudget, segmentsFor, unitsOf } from '../domain/sms-segments';
import { LAST_RESORT_LANGUAGE, fallbackChain } from '../domain/fallback-languages';

/* ============================================================================================================ */
/* THE LIFECYCLE                                                                                                */
/* ============================================================================================================ */

describe('8a · the override lifecycle (Law 5 — one place)', () => {
  it('names its five acts and only those', () => {
    expect(OVERRIDE_ACTS).toEqual(['submit', 'approve', 'reject', 'withdraw', 'retire']);
    expect(isOverrideAct('approve')).toBe(true);
    expect(isOverrideAct('publish')).toBe(false);
  });
  it('draft → submitted by submit; draft → rejected by withdraw; nothing else from draft', () => {
    expect(nextLifecycle('draft', 'submit', 'push')).toBe('submitted');
    expect(nextLifecycle('draft', 'withdraw', 'push')).toBe('rejected');
    expect(nextLifecycle('draft', 'approve', 'push')).toBeNull();   // a checker decides a SUBMITTED version, never a draft
    expect(nextLifecycle('draft', 'reject', 'push')).toBeNull();
  });
  it('submitted → approved on push / in-app / email; → submitted_to_provider on SMS / WhatsApp', () => {
    for (const ch of ['push', 'inapp', 'email']) expect(nextLifecycle('submitted', 'approve', ch)).toBe('approved');
    expect(nextLifecycle('submitted', 'approve', 'sms')).toBe('submitted_to_provider');
    expect(nextLifecycle('submitted', 'approve', 'whatsapp')).toBe('submitted_to_provider');
    expect(nextLifecycle('submitted', 'reject', 'sms')).toBe('rejected');
    expect(nextLifecycle('submitted', 'withdraw', 'push')).toBe('rejected');
    expect(nextLifecycle('submitted', 'submit', 'push')).toBeNull();
  });
  it('approved, submitted_to_provider, rejected and superseded are terminal in the tenant realm', () => {
    for (const from of ['approved', 'submitted_to_provider', 'rejected', 'superseded', 'paused', 'nonsense']) {
      for (const act of ['submit', 'approve', 'reject', 'withdraw'] as const) expect(nextLifecycle(from, act, 'push')).toBeNull();
    }
  });
  it('only `approved` is sendable; SMS and WhatsApp need a provider', () => {
    expect(isServingLifecycle('approved')).toBe(true);
    for (const l of ['submitted_to_provider', 'submitted', 'draft', 'rejected', 'superseded', '']) expect(isServingLifecycle(l)).toBe(false);
    expect(needsProvider('sms')).toBe(true); expect(needsProvider('whatsapp')).toBe(true);
    expect(needsProvider('push')).toBe(false); expect(needsProvider('email')).toBe(false); expect(needsProvider('inapp')).toBe(false);
    expect(approvalTarget('sms')).toBe('submitted_to_provider'); expect(approvalTarget('email')).toBe('approved');
  });
  it('security copy is either half: opt-out-locked OR critical', () => {
    expect(isSecurityCopy({ priority: 'critical', userCanOptOut: true })).toBe(true);
    expect(isSecurityCopy({ priority: 'important', userCanOptOut: false })).toBe(true);
    expect(isSecurityCopy({ priority: 'important', userCanOptOut: true })).toBe(false);
    expect(isSecurityCopy({ priority: 'promotional', userCanOptOut: true })).toBe(false);
  });
});

const AUTHOR = 'user-author'; const CHECKER = 'user-checker';
const base = (over: Partial<OverrideActInput> = {}): OverrideActInput => ({
  act: 'approve', canAuthor: true, canApprove: true, event: { priority: 'important', userCanOptOut: true }, channelIsDefault: true, channel: 'push',
  open: { id: 'v2', lifecycle: 'submitted', authoredByUserId: AUTHOR }, actorUserId: CHECKER, serving: false, reason: 'reads well in Gujarati', ...over,
});

describe('8a · the act verdicts (maker ≠ checker, every refusal listed)', () => {
  it('a second person with the approve verb approves a submitted push version → approved', () => {
    const v = overrideActVerdict(base());
    expect(v).toEqual({ act: 'approve', allowed: true, refusals: [], to: 'approved' });
  });
  it('the SMS approval goes to the provider, not to serving', () => {
    expect(overrideActVerdict(base({ channel: 'sms' })).to).toBe('submitted_to_provider');
  });
  it('the author cannot approve or reject their own words — MAKER_IS_CHECKER', () => {
    expect(overrideActVerdict(base({ actorUserId: AUTHOR })).refusals).toEqual(['MAKER_IS_CHECKER']);
    expect(overrideActVerdict(base({ act: 'reject', actorUserId: AUTHOR })).refusals).toEqual(['MAKER_IS_CHECKER']);
    // A version with no recorded author is nobody's: a checker is not refused on a null match.
    expect(overrideActVerdict(base({ open: { id: 'v2', lifecycle: 'submitted', authoredByUserId: null } })).allowed).toBe(true);
  });
  it('approve / reject / retire need the approve verb; submit / withdraw need the author verb', () => {
    expect(overrideActVerdict(base({ canApprove: false })).refusals).toContain('NO_PERMISSION');
    expect(overrideActVerdict(base({ act: 'reject', canApprove: false })).refusals).toContain('NO_PERMISSION');
    expect(overrideActVerdict(base({ act: 'retire', canApprove: false, serving: true })).refusals).toContain('NO_PERMISSION');
    expect(overrideActVerdict(base({ act: 'submit', canAuthor: false, open: { id: 'v2', lifecycle: 'draft', authoredByUserId: AUTHOR } })).refusals).toContain('NO_PERMISSION');
    expect(overrideActVerdict(base({ act: 'submit', canApprove: false, open: { id: 'v2', lifecycle: 'draft', authoredByUserId: AUTHOR } })).allowed).toBe(true);
    expect(overrideActVerdict(base({ act: 'approve', canAuthor: false })).allowed).toBe(true);
  });
  it('withdraw is the author\'s alone', () => {
    expect(overrideActVerdict(base({ act: 'withdraw', actorUserId: AUTHOR })).allowed).toBe(true);
    expect(overrideActVerdict(base({ act: 'withdraw', actorUserId: CHECKER })).refusals).toEqual(['NOT_AUTHOR']);
  });
  it('a version act with nothing open is NO_OPEN_VERSION; the wrong state is ILLEGAL_FROM_STATUS', () => {
    const v = overrideActVerdict(base({ open: null }));
    expect(v.refusals).toEqual(['NO_OPEN_VERSION']); expect(v.to).toBeNull();
    expect(overrideActVerdict(base({ open: { id: 'v2', lifecycle: 'draft', authoredByUserId: AUTHOR } })).refusals).toEqual(['ILLEGAL_FROM_STATUS']);
  });
  it('the confirm screen\'s version must still be the open one', () => {
    expect(overrideActVerdict(base({ expectedVersionId: 'v1' })).refusals).toEqual(['VERSION_CHANGED']);
    expect(overrideActVerdict(base({ expectedVersionId: 'v2' })).allowed).toBe(true);
    expect(overrideActVerdict(base({ expectedVersionId: null })).allowed).toBe(true);
  });
  it('security copy and a channel outside the event\'s defaults are refused by name', () => {
    expect(overrideActVerdict(base({ event: { priority: 'critical', userCanOptOut: false } })).refusals).toEqual(['SECURITY_COPY_PLATFORM_ONLY']);
    expect(overrideActVerdict(base({ channelIsDefault: false })).refusals).toEqual(['CHANNEL_NOT_DEFAULT']);
    expect(overrideActVerdict(base({ act: 'submit', channelIsDefault: false, actorUserId: AUTHOR, open: { id: 'v2', lifecycle: 'draft', authoredByUserId: AUTHOR } })).refusals).toEqual(['CHANNEL_NOT_DEFAULT']);
    // Neither blocks taking the words DOWN: retiring an override that should not exist is exactly the remedy.
    expect(overrideActVerdict(base({ act: 'retire', serving: true, event: { priority: 'critical', userCanOptOut: false }, channelIsDefault: false })).allowed).toBe(true);
    expect(overrideActVerdict(base({ act: 'withdraw', actorUserId: AUTHOR, channelIsDefault: false })).allowed).toBe(true);
    expect(overrideActVerdict(base({ act: 'reject', channelIsDefault: false })).allowed).toBe(true);
  });
  it('retire needs something serving, and lands on "retired"', () => {
    expect(overrideActVerdict(base({ act: 'retire', serving: false })).refusals).toEqual(['NOTHING_SERVING']);
    const v = overrideActVerdict(base({ act: 'retire', serving: true, open: null }));
    expect(v).toEqual({ act: 'retire', allowed: true, refusals: [], to: 'retired' });
  });
  it('the reason is mandatory (3–300) and never pre-judged away', () => {
    expect(overrideActVerdict(base({ reason: '' })).refusals).toEqual(['REASON_REQUIRED']);
    expect(overrideActVerdict(base({ reason: '  ok ' })).refusals).toEqual(['REASON_REQUIRED']);
    expect(overrideActVerdict(base({ reason: 'abc' })).allowed).toBe(true);
    expect(overrideActVerdict(base({ reason: null })).refusals).toEqual(['REASON_REQUIRED']);
    expect(overrideActVerdict(base({ reason: 'x'.repeat(300) })).allowed).toBe(true);
    expect(overrideActVerdict(base({ reason: 'x'.repeat(301) })).refusals).toEqual(['REASON_TOO_LONG']);
  });
  it('lists EVERY refusal, not the first', () => {
    const v = overrideActVerdict(base({ canApprove: false, actorUserId: AUTHOR, reason: '', expectedVersionId: 'v9' }));
    expect(v.refusals).toEqual(['NO_PERMISSION', 'VERSION_CHANGED', 'MAKER_IS_CHECKER', 'REASON_REQUIRED']);
    expect(v.allowed).toBe(false);
  });
  it('allOverrideVerdicts answers the five acts in order; ignoringReason sets only the reason aside', () => {
    const all = allOverrideVerdicts({ ...base(), reason: null });
    expect(all.map((v) => v.act)).toEqual([...OVERRIDE_ACTS]);
    const approve = all.find((v) => v.act === 'approve')!;
    expect(approve.allowed).toBe(false);
    expect(ignoringReason(approve)).toEqual({ act: 'approve', allowed: true, refusals: [], to: 'approved' });
    const tooLong = overrideActVerdict(base({ reason: 'x'.repeat(301) }));
    expect(ignoringReason(tooLong).allowed).toBe(true);
    const maker = overrideActVerdict(base({ actorUserId: AUTHOR, reason: '' }));
    expect(ignoringReason(maker)).toMatchObject({ allowed: false, refusals: ['MAKER_IS_CHECKER'] });
  });
});

describe('8a · who serves (F-1: an unserved tenant row is never "active")', () => {
  it('override only when it serves; else platform; else none', () => {
    expect(servingSource({ overrideServes: true, platformServes: true })).toBe('override');
    expect(servingSource({ overrideServes: true, platformServes: false })).toBe('override');
    expect(servingSource({ overrideServes: false, platformServes: true })).toBe('platform');
    expect(servingSource({ overrideServes: false, platformServes: false })).toBe('none');
  });
});

/* ============================================================================================================ */
/* THE REVIEW                                                                                                   */
/* ============================================================================================================ */

const ORDER_VARS = [
  { name: 'order_id', sourceRef: 'orders.order_no', sampleValue: 'ORD-2026-088412', isRequired: true },
  { name: 'amount', sourceRef: 'orders.total', sampleValue: '₹12,450', isRequired: false },
];
const review = (over: Partial<OverrideReviewInput> = {}, entered: OverrideReviewInput['entered'] = {}) => reviewOverride({
  canAuthor: true,
  event: { code: 'order.delivered', priority: 'important', userCanOptOut: true, defaultChannels: ['push', 'sms', 'whatsapp'] },
  declared: ORDER_VARS, tenantLanguages: ['gu', 'hi', 'en'],
  entered: { eventCode: 'order.delivered', channel: 'push', languageCode: 'gu', body: 'Order {{order_id}} delivered · {{amount}}', reason: 'pickup point line', ...entered },
  servingToday: { source: 'platform', versionNo: 1, subject: null, body: 'Order {{order_id}} delivered' },
  override: null, ...over,
});
const codes = (r: ReturnType<typeof reviewOverride>) => r.refusals.map((x) => `${x.field ?? '-'}/${x.code}`);

describe('8a · the form review (the API computes it; W2779/W2786)', () => {
  it('a clean push override is ready, born draft v1, with the diff against what serves today', () => {
    const r = review();
    expect(r.ready).toBe(true);
    expect(r.entityType).toBe('notification_template');
    expect(r.fields.map((f) => f.name)).toEqual([...OVERRIDE_FORM_FIELDS, 'version', 'lifecycle']);
    expect(r.fields.find((f) => f.name === 'version')).toEqual({ name: 'version', entered: null, stored: 'v1', normalised: false });
    expect(r.fields.find((f) => f.name === 'lifecycle')?.stored).toBe('draft');
    expect(r.diff).toEqual([{ field: 'body', before: 'Order {{order_id}} delivered', after: 'Order {{order_id}} delivered · {{amount}}' }]);
    expect(r.preview.servesAfterApproval).toBe(true);
    expect(r.preview.provider).toBe('none');
    expect(r.preview.rendered).toEqual({ subject: null, body: 'Order ORD-2026-088412 delivered · ₹12,450' });
    expect(r.preview.segments).toBeNull(); expect(r.preview.segmentBudget).toBeNull();
    expect(r.preview.variables).toEqual([
      { name: 'order_id', sampleValue: 'ORD-2026-088412', isRequired: true, used: true },
      { name: 'amount', sampleValue: '₹12,450', isRequired: false, used: true },
    ]);
    expect(r.preview.variablesDeclared).toBe(true);
  });
  it('diff is null when nothing serves today (a create with nothing to differ from); subject changes are diffed', () => {
    expect(review({ servingToday: { source: 'none', versionNo: null, subject: null, body: null } }).diff).toBeNull();
    const r = review({}, { subject: 'Delivered' });
    expect(r.diff).toEqual([{ field: 'subject', before: null, after: 'Delivered' }, { field: 'body', before: 'Order {{order_id}} delivered', after: 'Order {{order_id}} delivered · {{amount}}' }]);
    expect(review({}, { body: 'Order {{order_id}} delivered' }).diff).toEqual([]);
  });
  it('refuses a member without the author verb, and an open version awaiting its checker', () => {
    expect(codes(review({ canAuthor: false }))).toEqual(['-/NO_PERMISSION']);
    expect(codes(review({ override: { templateId: 't', nextVersionNo: 3, open: { versionNo: 2, lifecycle: 'submitted' }, servingBody: null, servingSubject: null } }))).toEqual(['-/OPEN_VERSION_EXISTS']);
    const next = review({ override: { templateId: 't', nextVersionNo: 3, open: null, servingBody: 'x', servingSubject: null } });
    expect(next.ready).toBe(true); expect(next.preview.nextVersionNo).toBe(3);
    expect(next.fields.find((f) => f.name === 'version')?.stored).toBe('v3');
  });
  it('the event: required, catalogued, never security copy', () => {
    expect(codes(review({ event: null }, { eventCode: '' }))).toContain('eventCode/EVENT_REQUIRED');
    expect(codes(review({ event: null }, { eventCode: 'made.up' }))).toContain('eventCode/EVENT_UNKNOWN');
    expect(codes(review({ event: { code: 'auth.otp', priority: 'critical', userCanOptOut: false, defaultChannels: ['sms'] } }, { channel: 'sms' })))
      .toContain('eventCode/SECURITY_COPY_PLATFORM_ONLY');
  });
  it('the channel: required, one of the six, and one the event is SENT on (F-11)', () => {
    expect(codes(review({}, { channel: '' }))).toContain('channel/CHANNEL_REQUIRED');
    expect(codes(review({}, { channel: 'fax' }))).toContain('channel/CHANNEL_UNKNOWN');
    expect(codes(review({}, { channel: 'email' }))).toEqual(['channel/CHANNEL_NOT_DEFAULT']);
    expect(review({}, { channel: 'PUSH' }).ready).toBe(true);   // normalised to lower case, as the writer stores it
    expect(codes(review({ event: null }, { eventCode: 'x', channel: 'email' }))).not.toContain('channel/CHANNEL_NOT_DEFAULT');
  });
  it('the language: required, and one THIS tenant speaks', () => {
    expect(codes(review({}, { languageCode: '' }))).toContain('languageCode/LANGUAGE_REQUIRED');
    expect(codes(review({}, { languageCode: 'mr' }))).toEqual(['languageCode/LANGUAGE_NOT_TENANT']);
    expect(review({}, { languageCode: 'GU' }).ready).toBe(true);
  });
  it('the body: required; an undeclared token refused (it renders as a silent gap); a required one missing refused', () => {
    expect(codes(review({}, { body: '   ' }))).toContain('body/BODY_REQUIRED');
    expect(review({}, { body: '   ' }).preview.rendered).toBeNull();
    const typo = review({}, { body: 'Order {{order_no}} delivered' });
    expect(codes(typo)).toEqual(['body/UNKNOWN_VARIABLES', 'body/MISSING_REQUIRED_VARIABLES']);
    expect(typo.preview.unknownTokens).toEqual(['order_no']);
    expect(typo.preview.missingRequired).toEqual(['order_id']);
    expect(typo.preview.rendered?.body).toBe('Order  delivered');   // exactly what a member would have received
    expect(codes(review({}, { body: 'Your order is here' }))).toEqual(['body/MISSING_REQUIRED_VARIABLES']);
    // A token in the SUBJECT counts too, both ways.
    expect(codes(review({}, { subject: 'Order {{order_id}}', body: 'Delivered today' }))).toEqual([]);
    expect(codes(review({}, { subject: '{{pickup_point}}' }))).toEqual(['body/UNKNOWN_VARIABLES']);
  });
  it('the variables table says which declared variables the words actually use (first-run survivor, pinned)', () => {
    const r = review({}, { body: 'Order {{order_id}} delivered' });
    expect(r.preview.variables.map((v) => [v.name, v.used])).toEqual([['order_id', true], ['amount', false]]);
  });
  it('an event with NO declared variables refuses no token and says it cannot check', () => {
    const r = review({ declared: [] }, { body: 'anything {{whatever}}' });
    expect(r.ready).toBe(true);
    expect(r.preview.variablesDeclared).toBe(false);
    expect(r.preview.variables).toEqual([]);
    expect(r.preview.rendered?.body).toBe('anything ');
  });
  it('SMS: segments of the RENDERED text, the ≤2 budget, never served after approval (DLT)', () => {
    const gu = 'તમારો ઓર્ડર {{order_id}} પહોંચી ગયો છે. કુલ {{amount}}';
    const r = review({}, { channel: 'sms', body: gu });
    expect(r.preview.segments?.encoding).toBe('ucs2');
    expect(r.preview.segments?.segments).toBe(1);
    expect(r.preview.segmentBudget).toBe(SEGMENT_BUDGET);
    expect(r.preview.servesAfterApproval).toBe(false);
    expect(r.preview.provider).toBe('dlt');
    const long = review({}, { channel: 'sms', body: `{{order_id}} ${'ક'.repeat(190)}` });
    expect(long.preview.segments?.segments).toBe(4);
    expect(codes(long)).toEqual(['body/SEGMENT_BUDGET']);
    // counted AFTER render: 3 segments of template text can be fewer, or more, once the samples are in
    expect(review({}, { channel: 'sms', body: `{{order_id}} ${'a'.repeat(290)}` }).preview.segments?.segments).toBe(2);
  });
  it('WhatsApp is the provider\'s too (and no provider exists — F-15)', () => {
    const r = review({}, { channel: 'whatsapp' });
    expect(r.preview.servesAfterApproval).toBe(false);
    expect(r.preview.provider).toBe('whatsapp');
    // A WhatsApp message is not billed in SMS segments: no count, no budget, however long (first-run survivor, pinned).
    const long = review({}, { channel: 'whatsapp', body: `{{order_id}} ${'ક'.repeat(400)}` });
    expect(long.preview.segments).toBeNull(); expect(long.preview.segmentBudget).toBeNull();
    expect(long.ready).toBe(true);
  });
  it('the same words as the serving override are BODY_UNCHANGED — a version with no change is noise', () => {
    const own = { templateId: 't', nextVersionNo: 2, open: null, servingBody: 'Order {{order_id}} delivered · {{amount}}', servingSubject: null };
    expect(codes(review({ override: own }))).toEqual(['body/BODY_UNCHANGED']);
    expect(review({ override: { ...own, servingSubject: 'S' } }).ready).toBe(true);
    expect(review({ override: { ...own, servingBody: null } }).ready).toBe(true);
  });
  it('the reason is the version\'s audit sentence: three characters at least', () => {
    expect(codes(review({}, { reason: 'ok' }))).toEqual(['reason/REASON_REQUIRED']);
    expect(review({}, { reason: 'why' }).ready).toBe(true);
  });
  it('the writer\'s own refusals are reported, never on top of a precise one', () => {
    const r = review({ writerIssues: [{ path: 'subject', tooLong: true }, { path: 'body', tooLong: false }] }, { body: 'Order {{order_no}}' });
    expect(codes(r)).toContain('subject/TOO_LONG');
    expect(codes(r)).not.toContain('body/VALUE_REJECTED');
  });
  it('stores what the writer stores', () => {
    expect(storedOverride({ eventCode: ' order.delivered ', channel: ' SMS ', languageCode: 'GU', subject: '  ', body: '  hi  ', reason: ' r ' }))
      .toEqual({ eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', subject: null, body: 'hi', reason: 'r' });
    expect(storedOverride({})).toEqual({ eventCode: '', channel: '', languageCode: '', subject: null, body: '', reason: '' });
  });
});

describe('8a · variables and the real render', () => {
  it('tokens in order of first appearance, deduplicated, tolerant of spaces', () => {
    expect(bodyTokens('{{ a }} {{b}} {{a}} {{c.d}}')).toEqual(['a', 'b', 'c.d']);
    expect(unknownTokens('{{a}} {{z}}', [{ name: 'a', sourceRef: '', sampleValue: '', isRequired: false }])).toEqual(['z']);
    expect(missingRequired('{{a}}', [{ name: 'a', sourceRef: '', sampleValue: '', isRequired: true }, { name: 'b', sourceRef: '', sampleValue: '', isRequired: true }, { name: 'c', sourceRef: '', sampleValue: '', isRequired: false }])).toEqual(['b']);
    expect(samplesOf(ORDER_VARS)).toEqual({ order_id: 'ORD-2026-088412', amount: '₹12,450' });
  });
  it('renderPreview is NotificationTemplate.render over the samples (subject too)', () => {
    expect(renderPreview('email', 'en', 'Re {{order_id}}', 'Paid {{amount}} for {{order_id}} {{x}}', ORDER_VARS))
      .toEqual({ subject: 'Re ORD-2026-088412', body: 'Paid ₹12,450 for ORD-2026-088412 ' });
    expect(providerOf('sms')).toBe('dlt'); expect(providerOf('whatsapp')).toBe('whatsapp'); expect(providerOf('push')).toBe('none');
  });
});

/* ============================================================================================================ */
/* SMS SEGMENTS (GSM 03.38) — the same boundary cases ADMIN-11b's spec pins                                     */
/* ============================================================================================================ */

describe('8a · SMS segment arithmetic (the tenant realm\'s port)', () => {
  it('GSM-7: 160 in one, 153 per concatenated segment', () => {
    expect(segmentsFor('a'.repeat(160))).toEqual({ encoding: 'gsm7', units: 160, segments: 1, perSegment: 160, characters: 160 });
    expect(segmentsFor('a'.repeat(161))).toEqual({ encoding: 'gsm7', units: 161, segments: 2, perSegment: 153, characters: 161 });
    expect(segmentsFor('a'.repeat(306)).segments).toBe(2);
    expect(segmentsFor('a'.repeat(307)).segments).toBe(3);
  });
  it('UCS-2: 70 in one, 67 per concatenated segment — one non-GSM character decides it', () => {
    expect(segmentsFor('ક'.repeat(70))).toMatchObject({ encoding: 'ucs2', segments: 1, perSegment: 70 });
    expect(segmentsFor('ક'.repeat(71))).toMatchObject({ encoding: 'ucs2', segments: 2, perSegment: 67 });
    expect(segmentsFor('ક'.repeat(134)).segments).toBe(2);
    expect(segmentsFor('ક'.repeat(135)).segments).toBe(3);
    expect(encodingOf(`${'a'.repeat(100)}’`)).toBe('ucs2');   // a curly quote triples an English template's cost
    expect(encodingOf('Hello @ £ é')).toBe('gsm7');
  });
  it('the extended set costs two septets; an emoji two UCS-2 units', () => {
    expect(unitsOf('{}', 'gsm7')).toBe(4);
    expect(unitsOf('a€', 'gsm7')).toBe(3);
    expect(segmentsFor('{'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 });
    expect(segmentsFor('{'.repeat(81)).segments).toBe(2);
    expect(unitsOf('😀', 'ucs2')).toBe(2);
    expect(unitsOf('ક', 'ucs2')).toBe(1);
    expect(segmentsFor('😀')).toMatchObject({ encoding: 'ucs2', units: 2, characters: 1 });
  });
  it('an empty body is zero segments, not one', () => {
    expect(segmentsFor('')).toEqual({ encoding: 'gsm7', units: 0, segments: 0, perSegment: 160, characters: 0 });
  });
  it('the budget is two, and a critical event is exempt', () => {
    expect(SEGMENT_BUDGET).toBe(2);
    expect(exceedsSegmentBudget(2, 'important')).toBe(false);
    expect(exceedsSegmentBudget(3, 'important')).toBe(true);
    expect(exceedsSegmentBudget(9, 'critical')).toBe(false);
  });
});

/* ============================================================================================================ */
/* F-22 · THE FALLBACK ORDER                                                                                    */
/* ============================================================================================================ */

describe('8a · the fallback-language order (F-22: never a hardcoded Hindi rung)', () => {
  it('reader → emitter → the tenant\'s languages in order → English, deduplicated', () => {
    expect(fallbackChain('mr', 'hi', ['gu', 'hi'])).toEqual(['mr', 'hi', 'gu', 'en']);
    expect(fallbackChain('gu', null, ['gu', 'hi'])).toEqual(['gu', 'hi', 'en']);
    expect(fallbackChain('en', undefined, ['gu'])).toEqual(['en', 'gu']);
  });
  it('a tenant that declared no languages gets no guessed rung — [reader, emitter, en]', () => {
    expect(fallbackChain('gu', null, [])).toEqual(['gu', 'en']);
    expect(fallbackChain('gu', null, [])).not.toContain('hi');
    expect(fallbackChain(null, null, [])).toEqual([LAST_RESORT_LANGUAGE]);
    expect(fallbackChain('  ', '', ['', ' gu '])).toEqual(['gu', 'en']);
  });
});
