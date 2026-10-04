// @krishalaya/sdk-js · unit tests with an injected fake fetch (no network). Pins the contract every frontend
// relies on: URL/version building, header attachment (bearer/tenant/idempotency), {data,meta} envelope
// unwrap, typed error mapping (code/status/requestId), token NOT leaking into errors, idempotent-GET retry vs
// no-retry on mutations, timeout, and money staying a string.
import { createClient } from '../client';
import { SdkError, SdkTimeoutError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call, n: number) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    const call = { url: String(url), init: init ?? {} }; calls.push(call);
    const r = handler(call, calls.length);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status,
      headers: { get: (k: string) => (r.headers ?? {})[k.toLowerCase()] ?? null },
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const base = { baseUrl: 'https://api.test', fetchImpl: undefined as any };

describe('HttpClient via resources', () => {
  it('builds /v1 URL + query, unwraps {data,meta}, returns string money', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'l1', title: 'Tomato', priceMinor: '999999999999', currencyCode: 'INR', unitCode: 'kg', quantityAvailable: 5, organicClaim: true, saleType: 'fixed', regionId: null, sellerUserId: 'u1', boosted: false }], meta: { nextCursor: 'c1' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const page = await c.listings.browse({ q: 'tomato', limit: 10 });
    expect(calls[0].url).toBe('https://api.test/v1/listings?q=tomato&limit=10');
    expect(calls[0].init.method).toBe('GET');
    expect(page.items[0].priceMinor).toBe('999999999999');
    expect(typeof page.items[0].priceMinor).toBe('string');
    expect(page.nextCursor).toBe('c1');
  });

  it('attaches bearer + tenant + idempotency headers; never on anonymous calls', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { requested: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, tenantSlug: 'acme', getToken: () => 'tok-123' });
    await c.auth.requestOtp('+919812345678', 'idem-1');                 // anonymous → no bearer, but idempotency-key
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBeUndefined();
    expect(h['idempotency-key']).toBe('idem-1');
    expect(h['x-tenant-slug']).toBe('acme');
    await c.auth.me();                                                   // authed → bearer present
    const h2 = calls[1].init.headers as Record<string, string>;
    expect(h2.authorization).toBe('Bearer tok-123');
  });

  it('maps a non-2xx to a typed SdkError (code/status/requestId) and never leaks the token', async () => {
    const { fn } = fakeFetch(() => ({ status: 409, body: { code: 'WALLET_INSUFFICIENT_BALANCE', message: 'no funds', requestId: 'req-9' } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'super-secret-token' });
    await expect(c.auth.me()).rejects.toMatchObject({ code: 'WALLET_INSUFFICIENT_BALANCE', status: 409, requestId: 'req-9' });
    try { await c.auth.me(); } catch (e) { expect(JSON.stringify(e)).not.toContain('super-secret-token'); expect(e).toBeInstanceOf(SdkError); }
  });

  it('retries an idempotent GET on 5xx, then succeeds', async () => {
    const { fn, calls } = fakeFetch((_c, n) => (n < 3 ? { status: 503, body: { code: 'X' } } : { body: { data: [], meta: {} } }));
    const c = createClient({ ...base, fetchImpl: fn, retries: 2 });
    const page = await c.listings.browse();
    expect(calls.length).toBe(3);                                       // 2 failures + 1 success
    expect(page.items).toEqual([]);
  });

  it('NEVER retries a mutation (POST) — fails on the first error', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 503, body: { code: 'X' } }));
    const c = createClient({ ...base, fetchImpl: fn, retries: 2 });
    await expect(c.auth.requestOtp('+919812345678', 'k')).rejects.toBeInstanceOf(SdkError);
    expect(calls.length).toBe(1);
  });

  it('times out a slow request', async () => {
    // model real fetch: it REJECTS when its AbortSignal fires (that's how the timeout surfaces).
    const slow = ((_u: any, init: any) => new Promise((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))); })) as unknown as typeof fetch;
    const c = createClient({ ...base, fetchImpl: slow, timeoutMs: 20, retries: 0 });
    await expect(c.auth.me()).rejects.toBeInstanceOf(SdkTimeoutError);
  });

  it('the public trace scan hits /v1/traceability/scan/:token anonymously', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { qrToken: 'QR1', listingId: null, declaredInputs: [], certificateIds: [], anchored: false, createdAt: '2026-01-01', events: [] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const prov = await c.traceability.scan('QR1');
    expect(calls[0].url).toBe('https://api.test/v1/traceability/scan/QR1');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(prov.qrToken).toBe('QR1');
  });

  it('ambassadors.createReferral POSTs /v1/ambassadors/referrals with an idempotency key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'r1', referrerUserId: 'u1', refereeUserId: null, code: 'RAMESH24', status: 'invited', createdAt: '2026-01-01' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.ambassadors.createReferral('RAMESH24', 'idem-amb-1');
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/referrals');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-amb-1');
    expect(r.code).toBe('RAMESH24');
    expect(r.status).toBe('invited');
  });

  it('ambassadors.myEarnings unwraps the page and keeps money a string', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'e1', ambassadorId: 'a1', eventCode: 'referral_activated', referenceType: null, referenceId: null, amountMinor: '250000', payoutId: null, createdAt: '2026-01-01' }], meta: { nextCursor: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.ambassadors.myEarnings({ unpaidOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/me/earnings?unpaidOnly=true&limit=50');
    expect(page.items[0].amountMinor).toBe('250000');
    expect(typeof page.items[0].amountMinor).toBe('string');
  });

  it('enrollments.enroll POSTs /v1/education/enrollments with an idempotency key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'en1', courseId: 'c1', learnerUserId: 'u1', paymentId: null, progressPct: 0, completedAt: null, certificateMediaId: null, createdAt: '2026-01-01' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const e = await c.enrollments.enroll('c1', 'idem-enroll-1');
    expect(calls[0].url).toBe('https://api.test/v1/education/enrollments');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-enroll-1');
    expect(e.courseId).toBe('c1');
  });

  it('enrollments.markProgress POSTs the lesson progress path', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { lessonId: 'l1', completedAt: '2026-01-02', secondsWatched: 120, quizScore: 80 } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const p = await c.enrollments.markProgress('en1', 'l1', { secondsWatched: 120, quizScore: 80, completed: true });
    expect(calls[0].url).toBe('https://api.test/v1/education/enrollments/en1/lessons/l1/progress');
    expect(calls[0].init.method).toBe('POST');
    expect(p.quizScore).toBe(80);
  });

  it('rbac.assignments(pendingOnly) GETs the approval queue + approve POSTs', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? ({ body: { data: [{ id: 'utr1', userId: 'u1', roleCode: 'farmer', kycStatus: 'pending', isActive: false, approvedAt: null }] } })
      : ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const list = await c.rbac.assignments({ pendingOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/rbac/assignments?pendingOnly=true');
    expect(list[0].roleCode).toBe('farmer');
    const r = await c.rbac.approveAssignment('utr1');
    expect(calls[1].url).toBe('https://api.test/v1/rbac/assignments/utr1/approve');
    expect(calls[1].init.method).toBe('POST');
    expect(r.ok).toBe(true);
  });

  it('disputes.resolve POSTs bigint-minor amount as a string', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'd1', orderId: 'o1', raisedBy: 'r', againstUser: null, reasonId: null, description: null, status: 'resolved', sellerRespondBy: null, resolutionType: 'refund_partial', resolutionAmountMinor: '50000', resolvedBy: 'm', resolvedAt: '2026-01-02', slaDueAt: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const d = await c.disputes.resolve('d1', { resolutionType: 'refund_partial', resolutionAmountMinor: '50000' });
    expect(calls[0].url).toBe('https://api.test/v1/disputes/d1/resolve');
    expect(typeof d.resolutionAmountMinor).toBe('string');
    expect(d.resolutionAmountMinor).toBe('50000');
  });

  it('courses (PC-56 TENANT-7a): the form body travels as typed, the key rides every write, the act carries its reason', async () => {
    const course = { id: 'c1', instructorId: 'i1', defaultTitle: 'Drip irrigation basics', topicId: null, audienceRoleIds: [], level: 'basic', priceMinor: '0', currencyCode: 'INR', certEnabled: false, coverMediaId: null, status: 'draft' };
    const { fn, calls } = fakeFetch(() => ({ body: { data: course, meta: { nextCursor: null, stats: { c1: { courseId: 'c1', learners: 3, completed: 1, certificates: 0 } } } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.courses.preview({ defaultTitle: 'Drip irrigation basics', priceMajor: '149', id: 'c1' });
    await c.courses.create({ defaultTitle: 'Drip irrigation basics', topicCode: 'crop_care', priceMajor: '' }, 'idem-c');
    await c.courses.update('c1', { defaultTitle: 'Drip' }, 'idem-u');
    await c.courses.acts('c1');
    await c.courses.act('c1', 'archive', 'superseded', 'idem-a');
    await c.courses.createLesson('c1', { defaultTitle: 'Why drip', contentKind: 'video', mediaId: 'm1', duration: '8:20' }, 'idem-l');
    const desk = await c.courses.listDesk({ status: 'review', cursor: 'abc' });
    await c.courses.desk();
    await c.courses.topics();
    const hdr = (i: number) => (calls[i].init?.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toBe('https://api.test/v1/education/courses/preview'); expect(hdr(0)).toBeUndefined();   // a review writes nothing
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ defaultTitle: 'Drip irrigation basics', priceMajor: '149', id: 'c1' });
    expect(calls[1].url).toBe('https://api.test/v1/education/courses'); expect(hdr(1)).toBe('idem-c');
    expect(JSON.parse(String(calls[1].init?.body)).priceMajor).toBe('');                                        // the blank travels: FREE is the server's word
    expect(calls[2].url).toBe('https://api.test/v1/education/courses/c1'); expect(calls[2].init?.method).toBe('PATCH'); expect(hdr(2)).toBe('idem-u');
    expect(calls[3].url).toBe('https://api.test/v1/education/courses/c1/acts');
    expect(calls[4].url).toBe('https://api.test/v1/education/courses/c1/acts/archive'); expect(hdr(4)).toBe('idem-a');
    expect(JSON.parse(String(calls[4].init?.body))).toEqual({ reason: 'superseded' });
    expect(calls[5].url).toBe('https://api.test/v1/education/courses/c1/lessons'); expect(hdr(5)).toBe('idem-l');
    expect(calls[6].url).toContain('education/courses?'); expect(calls[6].url).toContain('box=all'); expect(calls[6].url).toContain('withStats=true'); expect(calls[6].url).toContain('status=review'); expect(calls[6].url).toContain('cursor=abc');
    expect(desk.stats.c1.learners).toBe(3);
    expect(calls[7].url).toBe('https://api.test/v1/education/courses/desk');
    expect(calls[8].url).toBe('https://api.test/v1/education/courses/topics');
  });

  it('lessons (PC-56 TENANT-7b): the outline, the record, three reviews without a key, five writes with one, the act with its reason', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'l1', courseId: 'c1', moduleNo: 1, lessonNo: 2, defaultTitle: 'Colostrum', contentKind: 'video', mediaId: 'm1', body: null, durationSecs: 405, quiz: null, status: 'draft' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.courses.outline('c1');
    await c.courses.lesson('c1', 'l1');
    await c.courses.previewLesson('c1', { defaultTitle: 'Colostrum', contentKind: 'video', duration: '6:45', lessonId: 'l1' });
    await c.courses.updateLesson('c1', 'l1', { defaultTitle: 'Colostrum', contentKind: 'video', duration: '6:45' }, 'idem-u');
    await c.courses.previewSubtitle('c1', 'l1', { languageCode: 'gu', body: 'WEBVTT', reviewed: '1' });
    await c.courses.saveSubtitle('c1', 'l1', { languageCode: 'gu', body: 'WEBVTT', reviewed: '1' }, 'idem-s');
    await c.courses.previewQuestion('c1', 'l1', 2, { q: 'How soon?', opt1: '1h', expl1: 'right', opt2: '6h', expl2: 'late', answer: '1', passingPct: '70%' });
    await c.courses.saveQuestion('c1', 'l1', 2, { q: 'How soon?', opt1: '1h', expl1: 'right', opt2: '6h', expl2: 'late', answer: '1', passingPct: '70%' }, 'idem-q');
    const moved = await c.courses.lessonAct('c1', 'l1', 'move_up', 'the quiz follows its video', 'idem-a');
    const hdr = (i: number) => (calls[i].init?.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toBe('https://api.test/v1/education/courses/c1/outline');
    expect(calls[1].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1');
    expect(calls[2].url).toBe('https://api.test/v1/education/courses/c1/lessons/preview'); expect(hdr(2)).toBeUndefined();
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ defaultTitle: 'Colostrum', contentKind: 'video', duration: '6:45', lessonId: 'l1' });   // the clock travels as typed: the server keeps seconds
    expect(calls[3].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1'); expect(calls[3].init?.method).toBe('PATCH'); expect(hdr(3)).toBe('idem-u');
    expect(calls[4].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1/subtitles/preview'); expect(hdr(4)).toBeUndefined();
    expect(calls[5].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1/subtitles'); expect(calls[5].init?.method).toBe('PUT'); expect(hdr(5)).toBe('idem-s');
    expect(calls[6].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1/questions/2/preview'); expect(hdr(6)).toBeUndefined();
    expect(calls[7].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1/questions/2'); expect(calls[7].init?.method).toBe('PUT'); expect(hdr(7)).toBe('idem-q');
    expect(JSON.parse(String(calls[7].init?.body)).answer).toBe('1');   // the option NUMBER as a person picked it; 0-based is the server's business
    expect(calls[8].url).toBe('https://api.test/v1/education/courses/c1/lessons/l1/acts/move_up'); expect(hdr(8)).toBe('idem-a');
    expect(JSON.parse(String(calls[8].init?.body))).toEqual({ reason: 'the quiz follows its video' });
    expect(moved.durationSecs).toBe(405);
  });

  it('live classes (PC-56 TENANT-7c): the schedule by (scheduled_at, id), the class, one review without a key, two writes and the acts with one, a member\'s registration', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 's1', hostUserId: 'h', courseId: 'c1', title: 'Mastitis', scheduledAt: '2026-07-16T15:00:00.000Z', durationMins: 90, capacity: 500, joinUrl: null, clashAccepted: false, remind: true, status: 'scheduled', recordingMediaId: null, recordingLessonId: null, attendanceCount: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.liveClasses.list({ box: 'past', courseId: 'c1', status: 'ended', cursor: 'abc', limit: 20 });
    await c.liveClasses.get('s1');
    // the wall-clock travels as typed — a date and a time in the COOPERATIVE's zone; the server resolves the instant
    await c.liveClasses.preview({ courseId: 'c1', title: 'Mastitis', date: '2026-07-16', time: '20:30', durationMins: '90', capacity: '500', remind: '1', id: 's1' });
    await c.liveClasses.create({ courseId: 'c1', title: 'Mastitis', date: '2026-07-16', time: '20:30' }, 'idem-c');
    await c.liveClasses.update('s1', { title: 'Mastitis II', date: '2026-07-17', time: '20:30' }, 'idem-u');
    const ended = await c.liveClasses.act('s1', 'end', { reason: 'held on the meet link' }, 'idem-e');
    await c.liveClasses.act('s1', 'attendance', { reason: 'counted', count: '342' }, 'idem-a');
    await c.liveClasses.act('s1', 'recording', { reason: 'uploaded', mediaId: 'm1' }, 'idem-r');
    await c.liveClasses.register('s1', 'idem-g');
    const hdr = (i: number) => (calls[i].init?.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toContain('education/live-sessions?'); expect(calls[0].url).toContain('box=past'); expect(calls[0].url).toContain('courseId=c1'); expect(calls[0].url).toContain('status=ended'); expect(calls[0].url).toContain('cursor=abc'); expect(calls[0].url).toContain('limit=20');
    expect(calls[1].url).toBe('https://api.test/v1/education/live-sessions/s1');
    expect(calls[2].url).toBe('https://api.test/v1/education/live-sessions/preview'); expect(hdr(2)).toBeUndefined();
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({ date: '2026-07-16', time: '20:30', id: 's1' });
    expect(calls[3].url).toBe('https://api.test/v1/education/live-sessions'); expect(calls[3].init?.method).toBe('POST'); expect(hdr(3)).toBe('idem-c');
    expect(calls[4].url).toBe('https://api.test/v1/education/live-sessions/s1'); expect(calls[4].init?.method).toBe('PATCH'); expect(hdr(4)).toBe('idem-u');
    expect(calls[5].url).toBe('https://api.test/v1/education/live-sessions/s1/acts/end'); expect(hdr(5)).toBe('idem-e'); expect(JSON.parse(String(calls[5].init?.body))).toEqual({ reason: 'held on the meet link' });
    expect(calls[6].url).toBe('https://api.test/v1/education/live-sessions/s1/acts/attendance'); expect(JSON.parse(String(calls[6].init?.body))).toEqual({ reason: 'counted', count: '342' });
    expect(calls[7].url).toBe('https://api.test/v1/education/live-sessions/s1/acts/recording'); expect(JSON.parse(String(calls[7].init?.body))).toEqual({ reason: 'uploaded', mediaId: 'm1' });
    expect(calls[8].url).toBe('https://api.test/v1/education/live-sessions/s1/register'); expect(hdr(8)).toBe('idem-g');
    expect(ended.durationMins).toBe(90);
    // PC-26b's channel-gated live methods are gone with their routes
    expect((c.liveStudio as unknown as Record<string, unknown>).schedule).toBeUndefined(); expect((c.liveStudio as unknown as Record<string, unknown>).start).toBeUndefined();
  });

  it('the earnings (PC-56 TENANT-7d-money): W418\'s view and statement, the payout review without a key and the request with one, the export, the rule and the agreement', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'x', tiles: [], payoutId: 'p1', status: 'queued' }, meta: { nextCursor: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.instructorEarnings.view();
    await c.instructorEarnings.view('i9');
    await c.instructorEarnings.statement({ cursor: 'abc', limit: 25 });
    await c.instructorEarnings.payoutReview({ amountMinor: '10000', currencyCode: 'INR', bankAccountId: 'b1' });
    await c.instructorEarnings.requestPayout({ amountMinor: '10000', currencyCode: 'INR', bankAccountId: 'b1' }, 'idem-w');
    await c.instructorEarnings.enqueueExport('idem-x');
    await c.instructorEarnings.rule();
    await c.instructorEarnings.proposeRule({ instructorShareBps: 7500, note: 'we host' }, 'idem-r');
    await c.instructorEarnings.decideRule('r1', { act: 'reject', note: 'too generous' }, 'idem-d');
    await c.instructorEarnings.offerAgreement({ instructorId: 'i1' }, 'idem-o');
    await c.instructorEarnings.actAgreement('a1', 'accept', 'idem-a');
    const hdr = (i: number) => (calls[i].init?.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toBe('https://api.test/v1/education/earnings');
    expect(calls[1].url).toBe('https://api.test/v1/education/earnings?instructor=i9');
    expect(calls[2].url).toContain('education/earnings/statement?'); expect(calls[2].url).toContain('cursor=abc'); expect(calls[2].url).toContain('limit=25');
    expect(calls[3].url).toBe('https://api.test/v1/education/earnings/payouts/review'); expect(hdr(3)).toBeUndefined();
    expect(calls[4].url).toBe('https://api.test/v1/education/earnings/payouts'); expect(hdr(4)).toBe('idem-w'); expect(JSON.parse(String(calls[4].init?.body))).toEqual({ amountMinor: '10000', currencyCode: 'INR', bankAccountId: 'b1' });
    expect(calls[5].url).toBe('https://api.test/v1/education/earnings/export'); expect(hdr(5)).toBe('idem-x'); expect(JSON.parse(String(calls[5].init?.body))).toEqual({});
    expect(calls[6].url).toBe('https://api.test/v1/education/earnings/rule'); expect(calls[6].init?.method).toBe('GET');
    expect(calls[7].url).toBe('https://api.test/v1/education/earnings/rule'); expect(calls[7].init?.method).toBe('POST'); expect(hdr(7)).toBe('idem-r');
    expect(calls[8].url).toBe('https://api.test/v1/education/earnings/rule/r1/decide'); expect(JSON.parse(String(calls[8].init?.body))).toEqual({ act: 'reject', note: 'too generous' });
    expect(calls[9].url).toBe('https://api.test/v1/education/earnings/agreements'); expect(hdr(9)).toBe('idem-o');
    expect(calls[10].url).toBe('https://api.test/v1/education/earnings/agreements/a1/accept'); expect(hdr(10)).toBe('idem-a');
  });

  it('the instructor (PC-56 TENANT-7d): the studio, the profile, two reviews without a key, the writes and the acts with one, the desk\'s list, the templates', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'i1', userId: 'u1', isVerified: false, displayName: 'Dr. Kalpana Joshi', languages: ['gu', 'hi'], visibility: 'public', instructor: { id: 'i1' }, credential: null, lessons: 7 } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.instructors.studio();
    await c.instructors.languages();
    await c.instructors.me();
    await c.instructors.get('i1');
    await c.instructors.list({ verified: false, cursor: 'abc', limit: 20 });
    await c.instructors.preview({ form: 'profile', displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist', languages: 'gu,hi,en', visibility: 'public' });
    await c.instructors.preview({ form: 'credential', credentialId: 'k1', title: 'BVSc & AH', documentMediaId: 'm1' });
    await c.instructors.saveProfile({ displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist', languages: 'gu,hi,en', visibility: 'public' }, 'idem-p');
    await c.instructors.fileCredential({ title: 'BVSc & AH', issuer: 'GAU', yearAwarded: '2009', documentMediaId: 'm1' }, 'idem-f');
    await c.instructors.credentialForm('k1');
    await c.instructors.refileCredential('k1', { title: 'BVSc & AH', documentMediaId: 'm2' }, 'idem-r');
    await c.instructors.act('i1', 'accept', { reason: 'certificate checked', credentialId: 'k1' }, 'idem-a');
    await c.instructors.act('i1', 'verify', { reason: 'two accepted credentials' }, 'idem-v');
    await c.courses.templates();
    await c.courses.previewFromTemplate({ templateCode: 'clean_milk', title: 'Clean Milk — Anand' });
    const made = await c.courses.createFromTemplate({ templateCode: 'clean_milk' }, 'idem-t');
    const hdr = (i: number) => (calls[i].init?.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toBe('https://api.test/v1/education/instructors/studio');
    expect(calls[1].url).toBe('https://api.test/v1/education/instructors/languages');
    expect(calls[2].url).toBe('https://api.test/v1/education/instructors/me');
    expect(calls[3].url).toBe('https://api.test/v1/education/instructors/i1');
    expect(calls[4].url).toContain('education/instructors?'); expect(calls[4].url).toContain('verified=false'); expect(calls[4].url).toContain('cursor=abc'); expect(calls[4].url).toContain('limit=20');
    expect(calls[5].url).toBe('https://api.test/v1/education/instructors/preview'); expect(hdr(5)).toBeUndefined(); expect(JSON.parse(String(calls[5].init?.body))).toMatchObject({ form: 'profile', languages: 'gu,hi,en' });
    expect(JSON.parse(String(calls[6].init?.body))).toMatchObject({ form: 'credential', credentialId: 'k1' }); expect(hdr(6)).toBeUndefined();
    expect(calls[7].url).toBe('https://api.test/v1/education/instructors/me'); expect(calls[7].init?.method).toBe('PUT'); expect(hdr(7)).toBe('idem-p');
    expect(calls[8].url).toBe('https://api.test/v1/education/instructors/me/credentials'); expect(calls[8].init?.method).toBe('POST'); expect(hdr(8)).toBe('idem-f');
    expect(calls[9].url).toBe('https://api.test/v1/education/instructors/me/credentials/k1/form');
    expect(calls[10].url).toBe('https://api.test/v1/education/instructors/me/credentials/k1'); expect(calls[10].init?.method).toBe('PATCH'); expect(hdr(10)).toBe('idem-r');
    expect(calls[11].url).toBe('https://api.test/v1/education/instructors/i1/acts/accept'); expect(hdr(11)).toBe('idem-a'); expect(JSON.parse(String(calls[11].init?.body))).toEqual({ reason: 'certificate checked', credentialId: 'k1' });
    expect(calls[12].url).toBe('https://api.test/v1/education/instructors/i1/acts/verify'); expect(JSON.parse(String(calls[12].init?.body))).toEqual({ reason: 'two accepted credentials' });
    expect(calls[13].url).toBe('https://api.test/v1/education/courses/templates');
    expect(calls[14].url).toBe('https://api.test/v1/education/courses/from-template/preview'); expect(hdr(14)).toBeUndefined();
    expect(calls[15].url).toBe('https://api.test/v1/education/courses/from-template'); expect(hdr(15)).toBe('idem-t');
    expect(made.lessons).toBe(7);
    // PC-26b's unkeyed, unaudited self-profile methods are gone with the studio's inline form
    expect((c.liveStudio as unknown as Record<string, unknown>).myInstructor).toBeUndefined(); expect((c.liveStudio as unknown as Record<string, unknown>).upsertInstructor).toBeUndefined();
  });

  it('disputes.raise POSTs with Idempotency-Key + reason enum', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'd9', orderId: 'o1', raisedBy: 'b1', againstUser: 's1', reasonId: null, description: 'late by 3 days', status: 'open', sellerRespondBy: null, resolutionType: null, resolutionAmountMinor: null, resolvedBy: null, resolvedAt: null, slaDueAt: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const d = await c.disputes.raise({ orderId: 'o1', reasonCode: 'late', description: 'late by 3 days' }, 'idem-1');
    expect(calls[0].url).toBe('https://api.test/v1/disputes');
    expect((calls[0].init?.headers as Record<string, string>)['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(String(calls[0].init?.body)).reasonCode).toBe('late');
    expect(d.status).toBe('open');
  });

  it('disputes.respond POSTs the party respond transition (no body)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'd1', orderId: 'o1', raisedBy: 'r', againstUser: 's', reasonId: null, description: null, status: 'seller_responded', sellerRespondBy: null, resolutionType: null, resolutionAmountMinor: null, resolvedBy: null, resolvedAt: null, slaDueAt: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const d = await c.disputes.respond('d1');
    expect(calls[0].url).toBe('https://api.test/v1/disputes/d1/respond');
    expect(calls[0].init?.method).toBe('POST');
    expect(d.status).toBe('seller_responded');
  });

  it('disputes.postMessage POSTs one thread message', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'm1', disputeId: 'd1', authorUserId: 'u1', body: 'evidence text', createdAt: '2026-01-02' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const m = await c.disputes.postMessage('d1', 'evidence text');
    expect(calls[0].url).toBe('https://api.test/v1/disputes/d1/messages');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ body: 'evidence text' });
    expect(m.body).toBe('evidence text');
  });

  it('market.pulse GETs /v1/market/pulse and returns bigint-minor money as strings', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: {
      latest: { id: 'mp1', mandiId: 'm1', productId: 'p1', regionId: 'r1', minMinor: '90000', maxMinor: '110000', modalMinor: '100000', unitCode: 'qtl', priceDate: '2026-06-20' },
      band: { productId: 'p1', regionId: 'r1', p10Minor: '95000', p50Minor: '100000', p90Minor: '105000', forDate: '2026-06-21' },
      history: [],
    } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const pulse = await c.market.pulse('p1', 'r1');
    expect(calls[0].url).toBe('https://api.test/v1/market/pulse?productId=p1&regionId=r1');
    expect(calls[0].init.method).toBe('GET');
    expect(typeof pulse.latest!.modalMinor).toBe('string');
    expect(pulse.band!.p50Minor).toBe('100000');
  });

  it('market.createAlert POSTs /v1/market/alerts with an idempotency key + bigint-minor threshold', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'al1', productId: 'p1', regionId: 'r1', direction: 'above', thresholdMinor: '12000000', isActive: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const a = await c.market.createAlert({ productId: 'p1', regionId: 'r1', direction: 'above', thresholdMinor: '12000000' }, 'idem-alert-1');
    expect(calls[0].url).toBe('https://api.test/v1/market/alerts');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-alert-1');
    expect(typeof a.thresholdMinor).toBe('string');
    expect(a.isActive).toBe(true);
  });

  it('weather.alerts GETs /v1/land/weather-alerts for a region', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'w1', regionId: 'r1', severity: 'severe', validFrom: '2026-06-20T00:00:00Z', validTo: '2026-06-22T00:00:00Z', advisoryTextKey: 'weather.adv.heat' }] } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const list = await c.weather.alerts('r1', { activeOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/land/weather-alerts?regionId=r1&activeOnly=true&limit=50');
    expect(list[0].severity).toBe('severe');
  });

  it('weather.forecast GETs /v1/land/weather-forecast with lat/lng (+ regionId fallback)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { degraded: false, source: 'forecast', providerCode: 'open-meteo', forecast: { lat: 19.076, lng: 72.877, providerCode: 'open-meteo', fetchedAt: 'now', days: [{ date: '2026-06-25', tempMinC: 26, tempMaxC: 33, precipMm: 1, precipProbPct: 20, windKph: 10, code: 'clouds' }] }, advisories: [] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.weather.forecast({ lat: 19.076, lng: 72.877, regionId: 'r1' });
    expect(calls[0].url).toBe('https://api.test/v1/land/weather-forecast?lat=19.076&lng=72.877&regionId=r1');
    expect(r.source).toBe('forecast');
    expect(r.forecast!.days[0].code).toBe('clouds');
  });

  it('resources.list GETs /v1/education/resources with box=browse (approved only)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'res1', channelId: null, ownerUserId: 'u1', kind: 'article', title: 'Drip irrigation', externalUrl: null, mediaId: null, topicId: null, languageCode: 'hi', body: 'Save water', status: 'approved' }], meta: { nextCursor: 'c2' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.resources.list({ kind: 'article' });
    expect(calls[0].url).toBe('https://api.test/v1/education/resources?box=browse&kind=article&limit=50');
    expect(calls[0].init.method).toBe('GET');
    expect(page.items[0].kind).toBe('article');
    expect(page.nextCursor).toBe('c2');
  });

  it('assistant.ask POSTs /v1/ai/assistant/messages with an idempotency key + language', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { reply: 'Use neem oil.', sessionId: 'sess1' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.assistant.ask({ message: 'pest on tomato?', languageCode: 'hi' }, 'idem-ai-1');
    expect(calls[0].url).toBe('https://api.test/v1/ai/assistant/messages');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ai-1');
    expect(r.sessionId).toBe('sess1');
  });

  it('schemes.list GETs /v1/schemes and returns processingFee as a bigint-minor string', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 's1', code: 'PM-KISAN', name: 'PM Kisan', authorityId: 'a1', categoryId: 'c1', benefitSummary: {}, eligibilityRules: {}, requiredDocTypeIds: ['d1'], applicationWindow: null, applicableRegionIds: [], processingFeeMinor: '0', version: 1, isActive: true }] } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const list = await c.schemes.list({ activeOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/schemes?activeOnly=true');
    expect(typeof list[0].processingFeeMinor).toBe('string');
    expect(list[0].requiredDocTypeIds).toEqual(['d1']);
  });

  it('schemes.checkEligibility POSTs /v1/schemes/:id/eligibility and returns explainable reasons', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { eligible: false, reasons: ['minimum age 18'] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.schemes.checkEligibility('s1', { age: 16 });
    expect(calls[0].url).toBe('https://api.test/v1/schemes/s1/eligibility');
    expect(calls[0].init.method).toBe('POST');
    expect(r.eligible).toBe(false);
    expect(r.reasons[0]).toContain('age');
  });

  it('schemes.apply POSTs /v1/schemes/applications with an idempotency key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'app1', schemeId: 's1', schemeVersion: 1, applicantUserId: 'u1', assistedBy: null, status: 'draft', formData: { documents: [] }, govtAppRef: null, eligibilityCheck: null, submittedAt: null, decidedAt: null, rejectionReason: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const app = await c.schemes.apply({ schemeId: 's1', formData: { documents: [] } }, 'idem-apply-1');
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-apply-1');
    expect(app.status).toBe('draft');
  });

  it('schemes.dbtTransfers GETs the application DBT credits as bigint-minor strings', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'dbt1', applicationId: 'app1', userId: 'u1', schemeId: 's1', amountMinor: '600000', instalmentNo: 1, creditedOn: '2026-04-01', pfmsRef: 'PFMS123' }] } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const list = await c.schemes.dbtTransfers('app1');
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/app1/dbt');
    expect(typeof list[0].amountMinor).toBe('string');
    expect(list[0].amountMinor).toBe('600000');
  });

  it('users.me GETs /v1/users/me and updateMe PATCHes it', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'u1', displayName: 'Ram', roles: ['farmer'], locale: 'hi' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const me = await c.users.me();
    expect(calls[0].url).toBe('https://api.test/v1/users/me');
    expect(me.displayName).toBe('Ram');
    await c.users.updateMe({ fullName: 'Ram Kumar', email: 'ram@x.com' });
    expect(calls[1].url).toBe('https://api.test/v1/users/me');
    expect(calls[1].init.method).toBe('PATCH');
  });

  it('support.open POSTs /v1/support/tickets with an idempotency key + channel=app', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'tk1', ticketNo: 'T-1', requesterUserId: 'u1', channel: 'app', categoryId: null, severity: 'P2', subject: 'help', status: 'open', assigneeUserId: null, conversationId: null, slaFirstResponseDue: null, slaResolutionDue: '2026-06-22T00:00:00Z', firstRespondedAt: null, resolvedAt: null, csatScore: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const tk = await c.support.open({ subject: 'help', severity: 'P2' }, 'idem-tk-1');
    expect(calls[0].url).toBe('https://api.test/v1/support/tickets');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-tk-1');
    expect(tk.status).toBe('open');
  });

  it('support.myTickets GETs box=mine; submitCsat POSTs the score', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? ({ body: { data: [{ id: 'tk1', ticketNo: 'T-1', requesterUserId: 'u1', channel: 'app', categoryId: null, severity: 'P2', subject: 's', status: 'resolved', assigneeUserId: null, conversationId: null, slaFirstResponseDue: null, slaResolutionDue: null, firstRespondedAt: null, resolvedAt: '2026-06-21', csatScore: null }], meta: { nextCursor: null } } })
      : ({ body: { data: { id: 'tk1', ticketNo: 'T-1', requesterUserId: 'u1', channel: 'app', categoryId: null, severity: 'P2', subject: 's', status: 'resolved', assigneeUserId: null, conversationId: null, slaFirstResponseDue: null, slaResolutionDue: null, firstRespondedAt: null, resolvedAt: '2026-06-21', csatScore: 5 } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.support.myTickets();
    expect(calls[0].url).toBe('https://api.test/v1/support/tickets?box=mine&limit=50');
    expect(page.items.map((t) => t.id)).toEqual(['tk1']);
    const rated = await c.support.submitCsat('tk1', 5);
    expect(calls[1].url).toBe('https://api.test/v1/support/tickets/tk1/csat');
    expect(rated.csatScore).toBe(5);
  });

  it('freight.list maps the desk meta — cursor, cycle count and the PER-CURRENCY recovery (TENANT-5c)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: {
      data: [{ id: 'f1', invoiceNo: 'DLV-1', carrierId: 'c1', carrierName: 'Delhivery', carrierKind: '3pl',
               sourceKind: 'carrier_invoice', periodStart: '2026-06-01', periodEnd: '2026-06-30', shipmentCount: 86,
               billedMinor: '9644000', expectedMinor: '9412000', varianceMinor: '232000', varianceDirection: 'over',
               varianceBps: 240, currencyCode: 'INR', reconStatus: 'variance_open', disputedLines: 4,
               paymentHold: true, receivedAt: '2026-07-12T00:00:00Z', reconciledAt: null, expectedApplies: true }],
      meta: { nextCursor: null, cycle: { from: '2026-06-01', to: '2026-06-30', total: 3, byStatus: { pending: 1 } },
              recovered: [{ currencyCode: 'INR', recoveredMinor: '1184000' }] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.freight.list({ reconStatus: 'variance_open', cycleFrom: '2026-06-01', cycleTo: '2026-06-30' });
    expect(calls[0].url).toContain('logistics/freight-invoices?');
    expect(calls[0].url).toContain('reconStatus=variance_open');
    expect(page.items[0].varianceBps).toBe(240);
    expect(page.cycle?.total).toBe(3);
    // One figure per currency: a single total would add paise to cents the first time a carrier bills in USD.
    expect(page.recovered).toEqual([{ currencyCode: 'INR', recoveredMinor: '1184000' }]);
  });

  it('freight.list defaults the recovery to an empty list, never to a zero (TENANT-5c)', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [] } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.freight.list();
    expect(page.recovered).toEqual([]);
    expect(page.cycle).toBeNull();
  });

  it('freight.record carries the Idempotency-Key and the lines; recon GETs the verdicts (TENANT-5c)', async () => {
    const { fn, calls } = fakeFetch((_c, n) => (n === 1
      ? ({ body: { data: { id: 'f1', lines: [{ id: 'l1' }] } } })
      : ({ body: { data: { invoice: { id: 'f1' }, expected: { kind: 'unpriced', unpricedLines: 2 },
            payment: { kind: 'ready_no_rail', cleanMinor: '0', needsChecker: null, missing: ['carrier_payee_bank_account'] },
            pack: null, cleanMinor: '0', disputedMinor: '0', duplicates: [], lines: [] } } })));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.freight.record({ carrierId: 'c1', invoiceNo: 'DLV-1', periodStart: '2026-06-01', periodEnd: '2026-06-30',
      billedMinor: '9644000', lines: [{ awbNo: 'AWB1', billedMinor: '9644000' }] }, 'idem-fr-1');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-fr-1');
    const recon = await c.freight.recon('f1');
    expect(calls[1].url).toBe('https://api.test/v1/logistics/freight-invoices/f1/recon');
    expect(recon.payment.kind).toBe('ready_no_rail');
    expect(recon.expected.kind).toBe('unpriced');
  });

  it('logisticsDesk.overview GETs the desk and keeps every verdict intact (TENANT-5d)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: {
      activeShipments: 24, pickupsToday: 2, byStatus: { in_transit: 20, assigned: 4 },
      attention: [{ kind: 'cold_chain_live', shipmentId: 's1', orderId: 'o1', lastTempC: '4.2', lastAt: 'x', breaches: 0 }],
      onTime: { kind: 'not_promised', missing: ['shipment_promised_delivery_at'] },
      firstAttempt: { kind: 'measured', bps: 9510, of: 118 },
      transit: { kind: 'measured', medianHours: 6.5, of: 45, missingPickupStamp: 5 },
      transitLoss: { kind: 'not_recorded', missing: ['shipment_loss_record'], nearest: 'buyer_disputes_damaged' },
      coldChain: { breaches7d: 0, liveReeferShipments: 1 },
      mechanisms: [{ key: 'weighbridge', state: 'absent' }],
      nextRun: { routeId: 'rt', routeName: 'Saturday Run', runWeekday: 6, daysAway: 5, villages: 32 },
      windowDays: 30,
    } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const ov = await c.logisticsDesk.overview();
    expect(calls[0].url).toBe('https://api.test/v1/logistics/desk/overview');
    // The refusals must survive the wire: a client that flattened them to nulls would let a screen print a zero.
    expect(ov.onTime.kind).toBe('not_promised');
    expect(ov.transitLoss.nearest).toBe('buyer_disputes_damaged');
    expect(ov.mechanisms[0]).toEqual({ key: 'weighbridge', state: 'absent' });
    expect(ov.firstAttempt).toEqual({ kind: 'measured', bps: 9510, of: 118 });
  });

  it('logisticsDesk.insights sends the window and returns the coded failure breakdown (TENANT-5d)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: {
      window: 30, windowFrom: '2026-07-20', windowTo: '2026-08-19',
      history: { kind: 'ready', days: 200 },
      firstAttempt: { kind: 'no_deliveries' },
      transit: { kind: 'not_measurable', missingPickupStamp: 0 },
      failures: { total: 118, slices: [{ code: 'gate_closed', events: 40, shareBps: 8000 }], unclassified: 68, mostlyUnclassified: true },
      reasonNames: [{ code: 'gate_closed', name: 'Gate closed' }],
      callAhead: false,
      lanes: { lanes: [], totalShipments: 0, basis: 'shipments' },
      costPerQtlKm: { kind: 'not_computable', missing: ['shipment_distance_km', 'consignment_weight', 'shipment_charge_minor'] },
      transitLoss: { kind: 'not_recorded', missing: [], nearest: 'buyer_disputes_damaged' },
      freightRecovered: [],
    } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const ins = await c.logisticsDesk.insights({ window: 30 });
    expect(calls[0].url).toBe('https://api.test/v1/logistics/desk/insights?window=30');
    expect(ins.failures.unclassified).toBe(68);
    expect(ins.failures.mostlyUnclassified).toBe(true);
    expect(ins.costPerQtlKm.missing).toHaveLength(3);
    expect(ins.lanes.basis).toBe('shipments');
  });

  it('listings.extend POSTs :id/extend with an idempotency key + days body, returns the new expiresAt', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'l1', expiresAt: '2026-08-09T00:00:00Z' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.listings.extend('l1', 14, 'idem-ext-1');
    expect(calls[0].url).toBe('https://api.test/v1/listings/l1/extend');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ days: 14 });
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ext-1');
    expect(r.expiresAt).toBe('2026-08-09T00:00:00Z');
  });

  it('listings.inquiries GETs :id/inquiries (owner-only), keyset paginated', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ conversationId: 'c1', buyerUserId: 'u2', lastMessagePreview: 'Moisture content?', unreadCount: 1 }], meta: { nextCursor: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.listings.inquiries('l1');
    expect(calls[0].url).toBe('https://api.test/v1/listings/l1/inquiries?limit=20');
    expect(page.items[0].conversationId).toBe('c1');
    expect(page.items[0].buyerUserId).toBe('u2');
  });

  it('onboarding.selectRole POSTs /v1/onboarding/roles with an idempotency key + role body', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { roleCode: 'farmer', alreadyGranted: false, roles: ['farmer'] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.onboarding.selectRole('farmer', 'idem-role-1');
    expect(calls[0].url).toBe('https://api.test/v1/onboarding/roles');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ role: 'farmer' });
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-role-1');
    expect(r).toEqual({ roleCode: 'farmer', alreadyGranted: false, roles: ['farmer'] });
  });

  it('onboarding.selectRole surfaces a 403 SELFSERVE_ROLE_NOT_ELIGIBLE with the reason in details (real API error envelope: {error:{code,message,details}, meta:{request_id}})', async () => {
    const { fn } = fakeFetch(() => ({
      status: 403,
      body: { error: { code: 'SELFSERVE_ROLE_NOT_ELIGIBLE', message: "'ambassador' is invite-only", details: { role: 'ambassador', reason: 'invite_only' } }, meta: { request_id: 'req-42', timestamp: '2026-07-10T00:00:00Z' } },
    }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await expect(c.onboarding.selectRole('ambassador', 'idem-role-2')).rejects.toMatchObject({
      code: 'SELFSERVE_ROLE_NOT_ELIGIBLE', status: 403, requestId: 'req-42', details: { role: 'ambassador', reason: 'invite_only' },
    });
  });

  it('support.thread GETs :id/thread and returns the linked conversationId', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { conversationId: 'c9' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.support.thread('tk1');
    expect(calls[0].url).toBe('https://api.test/v1/support/tickets/tk1/thread');
    expect(calls[0].init.method).toBe('GET');
    expect(r.conversationId).toBe('c9');
  });

  it('parcels.register POSTs /v1/land/parcels with an idempotency key + areaValue string', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'p1', ownerUserId: 'u1', regionId: null, surveyNo: '12/3', bhulekhRef: null, area: '2.5000', areaUnit: 'acre', irrigationTypeId: null, boundaryGeojson: null, verificationStatus: 'pending', isTenantFarmed: false } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const p = await c.parcels.register({ areaValue: '2.5', surveyNo: '12/3' }, 'idem-parcel-1');
    expect(calls[0].url).toBe('https://api.test/v1/land/parcels');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-parcel-1');
    expect(typeof p.area).toBe('string');
    expect(p.verificationStatus).toBe('pending');
  });

  it('privacy.requestDataExport POSTs /v1/privacy/export-requests with an idempotency key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'req1', kind: 'export', status: 'pending' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.privacy.requestDataExport('idem-exp-1');
    expect(calls[0].url).toBe('https://api.test/v1/privacy/export-requests');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-exp-1');
    expect(r.kind).toBe('export');
  });

  it('privacy.requestAccountDeletion POSTs /v1/privacy/deletion-requests (idempotent)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'req2', kind: 'deletion', status: 'pending' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.privacy.requestAccountDeletion({ reason: 'moving on' }, 'idem-del-1');
    expect(calls[0].url).toBe('https://api.test/v1/privacy/deletion-requests');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-del-1');
    expect(r.kind).toBe('deletion');
  });

  it('privacy.startPhoneChange POSTs /v1/auth/change-phone/start with an idempotency key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.privacy.startPhoneChange('+919812345678', 'idem-ph-1');
    expect(calls[0].url).toBe('https://api.test/v1/auth/change-phone/start');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ph-1');
    expect(r.ok).toBe(true);
  });

  it('getHeaders injects extra headers but can NEVER override reserved ones (auth/idempotency/tenant)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({
      ...base, fetchImpl: fn, getToken: () => 'real-tok', tenantSlug: 'acme',
      getHeaders: async () => ({ 'x-device-integrity': 'posture=unknown;root=0;emu=0', authorization: 'Bearer SPOOF', 'idempotency-key': 'spoof', 'x-tenant-slug': 'evil' }),
    });
    await c.schemes.submitApplication('app1', 'real-idem');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['x-device-integrity']).toBe('posture=unknown;root=0;emu=0'); // extra header applied
    expect(h.authorization).toBe('Bearer real-tok');                       // reserved: real token wins
    expect(h['idempotency-key']).toBe('real-idem');                        // reserved: real key wins
    expect(h['x-tenant-slug']).toBe('acme');                               // reserved: real tenant wins
  });

  it('a throwing getHeaders never blocks the request (degrade)', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: [] } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok', getHeaders: async () => { throw new Error('attest failed'); } });
    await expect(c.schemes.list()).resolves.toEqual([]);
  });

  it('wallet.earnings / spendingInsights build the right GET URLs with window + currency, money stays string', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { fromIso: '2026-01-01T00:00:00.000Z', toIso: '2026-06-01T00:00:00.000Z', currencyCode: 'INR', totalMinor: '123456789012345', byMonth: [{ key: '2026-05', amountMinor: '1000', count: 2 }], byType: [] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const e = await c.wallet.earnings({ from: '2026-01-01', to: '2026-06-01' });
    expect(calls[0].url).toBe('https://api.test/v1/wallet/earnings?from=2026-01-01&to=2026-06-01&currency=INR');
    expect(calls[0].init.method).toBe('GET');
    expect(e.totalMinor).toBe('123456789012345');
    expect(typeof e.byMonth[0].amountMinor).toBe('string');
    await c.wallet.spendingInsights();
    expect(calls[1].url).toBe('https://api.test/v1/wallet/spending-insights?currency=INR');
  });

  it('autopay.register POSTs to wallet/autopay with an Idempotency-Key; cancel DELETEs by id', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'm1', status: 'pending', purpose: 'membership', vpaMasked: 'fa***@okhdfcbank', provider: 'razorpay', maxAmountMinor: '50000', currencyCode: 'INR', frequency: 'monthly', validUntil: null, createdAt: '2026-06-01T00:00:00.000Z' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const m = await c.autopay.register({ vpa: 'farmer.kumar@okhdfcbank', purpose: 'membership', maxAmountMinor: '50000', frequency: 'monthly' }, 'idem-ap-1');
    expect(calls[0].url).toBe('https://api.test/v1/wallet/autopay');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ap-1');
    expect(m.vpaMasked).toBe('fa***@okhdfcbank');
    await c.autopay.cancel('m1', 'no longer needed');
    expect(calls[1].url).toBe('https://api.test/v1/wallet/autopay/m1');
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('autopay.list builds the keyset GET URL and unwraps the page', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'm1', status: 'active', purpose: 'general', vpaMasked: 'ab***@upi', provider: 'razorpay', maxAmountMinor: '1000', currencyCode: 'INR', frequency: 'as_presented', validUntil: null, createdAt: 'x' }], meta: { nextCursor: 'c2' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.autopay.list(undefined, 50);
    expect(calls[0].url).toBe('https://api.test/v1/wallet/autopay?limit=50');
    expect(page.items[0].id).toBe('m1');
    expect(page.nextCursor).toBe('c2');
  });

  it('kyc.startEkyc / verifyEkyc POST the eKYC paths with an Idempotency-Key; only masked values returned', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 's1', docType: 'aadhaar', maskedId: 'XXXXXXXX0019', otpRequired: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const started = await c.kyc.startEkyc({ docType: 'aadhaar', idNumber: '999999990019' }, 'idem-ek-1');
    expect(calls[0].url).toBe('https://api.test/v1/kyc/ekyc/start');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ek-1');
    expect(started.maskedId).toBe('XXXXXXXX0019');
    // the raw id must never appear in the response surface
    expect(JSON.stringify(started)).not.toContain('999999990019');

    const { fn: fn2, calls: calls2 } = fakeFetch(() => ({ body: { data: { id: 's1', status: 'verified', docType: 'aadhaar', maskedId: 'XXXXXXXX0019', nameMatch: true } } }));
    const c2 = createClient({ ...base, fetchImpl: fn2, getToken: () => 'tok' });
    const v = await c2.kyc.verifyEkyc({ sessionId: 's1', otp: '123456' }, 'idem-ek-2');
    expect(calls2[0].url).toBe('https://api.test/v1/kyc/ekyc/verify');
    expect(calls2[0].init.method).toBe('POST');
    expect(v.status).toBe('verified');
  });

  it('payments.createIntent POSTs with Idempotency-Key; devCompleteSandbox POSTs the dev-complete path (no Idempotency-Key needed)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { paymentId: 'p1', gatewayOrderId: 'sbx_order_p1', provider: 'sandbox', amountMinor: '50000', status: 'initiated' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const intent = await c.payments.createIntent({ purpose: 'wallet_recharge', amountMinor: '50000' }, 'idem-pay-1');
    expect(calls[0].url).toBe('https://api.test/v1/payments');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-pay-1');
    expect(intent.provider).toBe('sandbox');
    expect(typeof intent.amountMinor).toBe('string');

    const { fn: fn2, calls: calls2 } = fakeFetch(() => ({ body: { data: { id: 'p1', status: 'success', amountMinor: '50000', currencyCode: 'INR', provider: 'sandbox' } } }));
    const c2 = createClient({ ...base, fetchImpl: fn2, getToken: () => 'tok' });
    const summary = await c2.payments.devCompleteSandbox(intent.paymentId);
    expect(calls2[0].url).toBe('https://api.test/v1/payments/p1/dev-complete-sandbox');
    expect(calls2[0].init.method).toBe('POST');
    expect(summary.status).toBe('success');
  });

  it('labour.clockOut POSTs the clock-out path with break + Idempotency-Key; hours come back as numbers', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'a1', assignmentId: 'as1', bookingId: 'b1', workDate: '2026-06-01', status: 'clocked_out', clockOutAt: '2026-06-01T16:00:00.000Z', hoursRegular: 8, hoursOvertime: 1.5 } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const a = await c.labour.clockOut('as1', 30, 'idem-co-1');
    expect(calls[0].url).toBe('https://api.test/v1/labour/assignments/as1/attendance/clock-out');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-co-1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ breakMinutes: 30 });
    expect(a.hoursOvertime).toBe(1.5);
  });

  it('labour.confirmAttendance POSTs the confirm path with the workDate body', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'a1', assignmentId: 'as1', bookingId: 'b1', workDate: '2026-06-01', status: 'confirmed' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const a = await c.labour.confirmAttendance('as1', '2026-06-01', 'idem-cf-1');
    expect(calls[0].url).toBe('https://api.test/v1/labour/assignments/as1/attendance/confirm');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ workDate: '2026-06-01' });
    expect(a.status).toBe('confirmed');
  });

  it('labour.workHistory GETs the keyset history path and unwraps the page', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'a1', assignmentId: 'as1', bookingId: 'b1', workDate: '2026-06-01', status: 'confirmed', hoursRegular: 8, hoursOvertime: 0 }], meta: { nextCursor: 'h2' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.labour.workHistory(undefined, 50);
    expect(calls[0].url).toBe('https://api.test/v1/labour/assignments/attendance/history?limit=50');
    expect(page.items[0].status).toBe('confirmed');
    expect(page.nextCursor).toBe('h2');
  });

  it('auctions.watch POSTs :id/watch; unwatch DELETEs; isWatching GETs the boolean (P1-7)', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 3
      ? ({ body: { data: { auctionId: 'au1', watching: true } } })
      : ({ body: { data: { ok: true, auctionId: 'au1', watching: n === 1 } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const w = await c.auctions.watch('au1');
    expect(calls[0].url).toBe('https://api.test/v1/auctions/au1/watch');
    expect(calls[0].init.method).toBe('POST');
    expect(w.watching).toBe(true);
    const u = await c.auctions.unwatch('au1');
    expect(calls[1].url).toBe('https://api.test/v1/auctions/au1/watch');
    expect(calls[1].init.method).toBe('DELETE');
    expect(u.watching).toBe(false);
    const is = await c.auctions.isWatching('au1');
    expect(calls[2].url).toBe('https://api.test/v1/auctions/au1/watch');
    expect(calls[2].init.method).toBe('GET');
    expect(is).toBe(true);
  });

  it('auctions.watching GETs the keyset watch-list and unwraps the page (P1-7)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ auctionId: 'au1', status: 'live', endsAt: '2026-07-01T00:00:00Z', watchedAt: '2026-06-20T00:00:00Z' }], meta: { nextCursor: 'w2' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.auctions.watching({ limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/auctions/watching?limit=20');
    expect(calls[0].init.method).toBe('GET');
    expect(page.items[0].auctionId).toBe('au1');
    expect(page.nextCursor).toBe('w2');
  });

  it('auctions.get exposes the EMD requirement (emdMinor/emdPctBps) as money-safe strings (P1-8)', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: { auctionId: 'au1', listingId: 'l1', kind: 'english_open', status: 'live', startPriceMinor: '100000', reservePriceMinor: null, minIncrementMinor: '10000', emdMinor: '50000', emdPctBps: null, startsAt: 's', endsAt: 'e', winningBidId: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const a = await c.auctions.get('au1');
    expect(typeof a.emdMinor).toBe('string');
    expect(a.emdMinor).toBe('50000');
    expect(a.emdPctBps).toBeNull();
  });

  it('lookups.categories / regions / values build the right anonymous GET URLs, locale-resolved server-side (P1-9)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? ({ body: { data: [{ id: 'c1', parentId: null, code: 'grains', defaultName: 'Grains', path: 'grains', depth: 1, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 }] } })
      : n === 2 ? ({ body: { data: [{ id: 'r1', code: 'GJ', level: 1, parentId: null, name: 'ગુજરાત', lat: 22.5, lng: 71.2 }] } })
      : ({ body: { data: [{ id: 'lv1', code: 'aadhaar', name: 'આધાર', sortOrder: 1, meta: {} }] } }));
    const c = createClient({ ...base, fetchImpl: fn, tenantSlug: 'acme', getToken: () => 'tok' });
    const cats = await c.lookups.categories();
    expect(calls[0].url).toBe('https://api.test/v1/categories?activeOnly=true');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined(); // anonymous public read
    expect(cats[0].defaultName).toBe('Grains');
    const regions = await c.lookups.regions();
    expect(calls[1].url).toBe('https://api.test/v1/lookups/regions');
    expect(regions[0].name).toBe('ગુજરાત');                                       // locale-resolved server-side
    const docTypes = await c.lookups.values('doc_type');
    expect(calls[2].url).toBe('https://api.test/v1/lookups/values?type=doc_type');
    expect(docTypes[0].name).toBe('આધાર');
  });

  it('auctions.myBids GETs the cross-auction keyset feed with the EMD hold per bid (P1-8)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ bidId: 'b1', auctionId: 'au1', listingId: 'l1', amountMinor: '120000', emdHeldMinor: '50000', auctionStatus: 'live', endsAt: 'e', isWinning: true, createdAt: 'c' }], meta: { nextCursor: 'm2' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.auctions.myBids({ limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/auctions/my-bids?limit=20');
    expect(page.items[0].emdHeldMinor).toBe('50000');
    expect(page.items[0].isWinning).toBe(true);
  });

  it('tenantConfig.commissionRules GETs /v1/commission-rules; a proposal POSTs with idempotency key, money stays string (P1-10, SW-a)', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: [{ id: 'cr1', scope: 'tenant', categoryId: null, source: null, sellerRoleId: null, rateBps: 250, fixedMinor: '0', capMinor: null, platformShareBps: 100, chargedTo: 'seller', priority: 100, effectiveFrom: '2026-06-01', effectiveTo: null, isActive: true }], meta: { nextCursor: 'crc' } } }
      : { body: { data: { id: 'cr2', scope: 'tenant', categoryId: null, source: 'auction', sellerRoleId: null, rateBps: 300, fixedMinor: '0', capMinor: null, platformShareBps: 150, chargedTo: 'seller', priority: 100, effectiveFrom: null, effectiveTo: null, isActive: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.tenantConfig.commissionRules({ activeOnly: true, includePlatformDefaults: false });
    expect(calls[0].url).toBe('https://api.test/v1/commission-rules?activeOnly=true&includePlatformDefaults=false');
    expect(calls[0].init.method).toBe('GET');
    expect(typeof page.items[0].fixedMinor).toBe('string');
    expect(page.nextCursor).toBe('crc');
    // PC-56 TENANT-SW-a: a tenant rule is PROPOSED (no platform share — the plan sets it; reason + an IST start ≥ 7 days out).
    const created = await c.tenantConfig.proposeCommissionRule({ rateBps: 300, source: 'auction', effectiveFrom: '2026-10-11', reason: 'Auction season rate for the mandi' }, 'idem-cr-1');
    expect(calls[1].url).toBe('https://api.test/v1/commission-rules/proposals');
    expect(calls[1].init.method).toBe('POST');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-cr-1');
    expect(JSON.parse(calls[1].init.body as string)).not.toHaveProperty('platformShareBps');
    expect(created.id).toBe('cr2');
  });

  it('tenantConfig delivery zones: list / propose / update / confirm hit the right logistics/zones paths (P1-10, SW-a)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'z1', defaultName: 'Pune metro', pincodes: ['411001'], regionIds: [], chargeDefinitionId: null, isActive: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.tenantConfig.deliveryZones({ activeOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/logistics/zones?activeOnly=true');
    // PC-56 TENANT-SW-a: "create" is a proposal a different tenant_admin confirms.
    await c.tenantConfig.createDeliveryZone({ defaultName: 'Pune metro', pincodes: ['411001'], reason: 'Covers the Pune metro pincodes' }, 'idem-z-1');
    expect(calls[1].url).toBe('https://api.test/v1/logistics/zones/proposals');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-z-1');
    expect(JSON.parse(calls[1].init.body as string)).toMatchObject({ kind: 'create', defaultName: 'Pune metro' });
    await c.tenantConfig.updateDeliveryZone('z1', { defaultName: 'Pune greater', reason: 'renamed by the FPO' });
    expect(calls[2].url).toBe('https://api.test/v1/logistics/zones/z1');
    expect(calls[2].init.method).toBe('PATCH');
    await c.tenantConfig.proposeZone({ kind: 'deactivate', zoneId: 'z1', reason: 'Monsoon road closure on the route' }, 'idem-z-2');
    expect(calls[3].url).toBe('https://api.test/v1/logistics/zones/proposals');
    expect(calls[3].init.method).toBe('POST');
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ kind: 'deactivate', zoneId: 'z1', reason: 'Monsoon road closure on the route' });
    await c.tenantConfig.confirmZoneProposal('zp1', 'idem-z-3');
    expect(calls[4].url).toBe('https://api.test/v1/logistics/zones/proposals/zp1/confirm');
  });

  it('tenantConfig.putSetting PUTs /v1/tenant-settings with key/value + idempotency key (branding/languages) (P1-10)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { key: 'branding.primary_color', value: '#1B5E20' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.tenantConfig.putSetting('branding.primary_color', '#1B5E20', 'idem-set-1');
    expect(calls[0].url).toBe('https://api.test/v1/tenant-settings');
    expect(calls[0].init.method).toBe('PUT');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-set-1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ key: 'branding.primary_color', value: '#1B5E20' });
    expect(r.key).toBe('branding.primary_color');
  });

  it('rbac matrix: roles/permissions GET, assign POST (idem), revoke DELETE, setOverride POST (P1-11)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: 'r1', code: 'manager', defaultName: 'Manager', scope: 'tenant', requiresKyc: false, requiresApproval: false, moduleCode: null, isActive: true }] } }
      : n === 2 ? { body: { data: [{ code: 'listing.publish', defaultName: 'Publish listing', moduleCode: 'catalogue' }] } }
      : n === 3 ? { body: { data: { id: 'utr1' } } }
      : n === 4 ? { body: { data: { ok: true } } }
      : { body: { data: { ok: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const roles = await c.rbac.roles({ activeOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/rbac/roles?activeOnly=true');
    expect(roles[0].scope).toBe('tenant');
    await c.rbac.permissions('catalogue');
    expect(calls[1].url).toBe('https://api.test/v1/rbac/permissions?moduleCode=catalogue');
    const a = await c.rbac.assign({ userId: 'u1', roleCode: 'manager' }, 'idem-rbac-1');
    expect(calls[2].url).toBe('https://api.test/v1/rbac/assignments');
    expect(calls[2].init.method).toBe('POST');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-rbac-1');
    expect(a.id).toBe('utr1');
    await c.rbac.revoke('utr1');
    expect(calls[3].url).toBe('https://api.test/v1/rbac/assignments/utr1');
    expect(calls[3].init.method).toBe('DELETE');
    await c.rbac.setOverride({ userTenantRoleId: 'utr1', permissionCode: 'listing.publish', isGranted: true });
    expect(calls[4].url).toBe('https://api.test/v1/rbac/overrides');
    expect(JSON.parse(calls[4].init.body as string)).toEqual({ userTenantRoleId: 'utr1', permissionCode: 'listing.publish', isGranted: true });
  });

  it('tenancy.changePlan / cancelSubscription hit the subscription sub-routes (P1-11 billing-config)', async () => {
    const sub = { id: 's1', tenantId: 't1', planId: 'p2', status: 'active', billingCycle: 'monthly', priceMinor: '990000', currencyCode: 'INR', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    const { fn, calls } = fakeFetch(() => ({ body: { data: sub } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.tenancy.changePlan('s1', 'p2');
    expect(calls[0].url).toBe('https://api.test/v1/subscriptions/s1/change-plan');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ planId: 'p2' });
    await c.tenancy.cancelSubscription('s1', true);
    expect(calls[1].url).toBe('https://api.test/v1/subscriptions/s1/cancel');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ atPeriodEnd: true });
  });

  it('integrations: providers/list GET return the 13c shapes — the one-call connect / disconnect are gone (proposals instead; see api-keys-integrations.spec)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ code: 'razorpay', name: 'Razorpay', category: 'payment', ownable: true, managed: false, verifyMethod: 'account_fetch', verifiable: true, credentialFields: [], consumers: [] }] } }
      : { body: { data: { items: [{ id: 'i1', providerCode: 'razorpay', status: 'verified', maskedRef: '…••41', consumers: [] }], providers: [], proposals: [], count: { providers: 1, ownable: 1, connected: 1 } } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const providers = await c.integrations.providers();
    expect(calls[0].url).toBe('https://api.test/v1/integrations/providers');
    expect(providers[0].ownable).toBe(true);
    const list = await c.integrations.list();
    expect(calls[1].url).toBe('https://api.test/v1/integrations');
    expect(list.items[0].status).toBe('verified');
    expect('secretRef' in (list.items[0] as unknown as Record<string, unknown>)).toBe(false);
    expect('connected' in (list.items[0] as unknown as Record<string, unknown>)).toBe(false);
  });

  it('webhooks: register returns the secret once (keyed); list masked; rotate/update/delete are keyed + reasoned (P1-11 → TENANT-13a)', async () => {
    const ep = { id: 'w1', url: 'https://hooks.acme.in/kv', eventTypes: ['order.created'], isActive: true };
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { ...ep, secret: 'whsec_ONCE', secretShown: true } } }
      : n === 2 ? { body: { data: { items: [ep], total: 1, contract: { ladder: ['1m'] } } } }
      : n === 3 ? { body: { data: { id: 'w1', secret: 'whsec_NEW', secretShown: true } } }
      : n === 4 ? { body: { data: { id: 'w1', eventTypes: ['order.created'] } } }
      : { body: { data: { id: 'w1', act: 'delete', moved: 0, status: 'deleted' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const created = await c.webhooks.register({ url: 'https://hooks.acme.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@acme.in' }, 'idem-wh-1');
    expect(calls[0].url).toBe('https://api.test/v1/webhooks');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-wh-1');
    expect(created.secret).toBe('whsec_ONCE');
    const list = await c.webhooks.list();
    expect(calls[1].url).toBe('https://api.test/v1/webhooks');
    expect('secret' in (list.items[0] as unknown as Record<string, unknown>)).toBe(false); // masked on reads
    const rot = await c.webhooks.rotateSecret('w1', 'quarterly', 'idem-wh-2');
    expect(calls[2].url).toBe('https://api.test/v1/webhooks/w1/rotate-secret');
    expect(rot.secret).toBe('whsec_NEW');
    await c.webhooks.update('w1', { eventTypes: ['order.created'], reason: 'narrow it' }, 'idem-wh-3');
    expect(calls[3].url).toBe('https://api.test/v1/webhooks/w1');
    expect(calls[3].init.method).toBe('PATCH');
    await c.webhooks.remove('w1', 'decommissioned', 'idem-wh-4');
    expect(calls[4].url).toBe('https://api.test/v1/webhooks/w1');
    expect(calls[4].init.method).toBe('DELETE');
    expect(JSON.parse(calls[4].init.body as string)).toEqual({ reason: 'decommissioned' });
  });

  it('dairy: MCC create (idem) + collection record + bill generate→preview→approve→pay hit the right paths (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { id: 'mcc1', code: 'M1', defaultName: 'Anand MCC', isActive: true } } }
      : n === 2 ? { body: { data: [{ id: 'mcc1' }], meta: { nextCursor: null } } }
      : n === 3 ? { body: { data: { id: 'col1', amountMinor: '12345' } } }
      : n === 4 ? { body: { data: { id: 'b1', status: 'draft', netMinor: '50000' } } }
      : n === 5 ? { body: { data: { id: 'b1', status: 'previewed' } } }
      : n === 6 ? { body: { data: { id: 'b1', status: 'approved' } } }
      : { body: { data: { id: 'b1', status: 'paid' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const mcc = await c.dairy.createMcc({ code: 'M1', defaultName: 'Anand MCC' }, 'idem-1');
    expect(calls[0].url).toBe('https://api.test/v1/dairy/mccs');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-1');
    expect(mcc.id).toBe('mcc1');

    await c.dairy.listMccs({ activeOnly: true });
    expect(calls[1].url).toBe('https://api.test/v1/dairy/mccs?activeOnly=true&limit=50');

    await c.dairy.recordCollection({ membershipId: 'm1', shift: 'morning', collectedOn: '2026-06-20', weightKg: '12.5', fatPct: '4.2', snfPct: '8.5' }, 'idem-2');
    expect(calls[2].url).toBe('https://api.test/v1/dairy/collections');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-2');

    await c.dairy.generateBill({ membershipId: 'm1', periodStart: '2026-06-01', periodEnd: '2026-06-15' }, 'idem-3');
    expect(calls[3].url).toBe('https://api.test/v1/dairy/milk-bills/generate');
    await c.dairy.previewBill('b1');
    expect(calls[4].url).toBe('https://api.test/v1/dairy/milk-bills/b1/preview');
    await c.dairy.approveBill('b1');
    expect(calls[5].url).toBe('https://api.test/v1/dairy/milk-bills/b1/approve');
    const paid = await c.dairy.payBill('b1', 'idem-4');
    expect(calls[6].url).toBe('https://api.test/v1/dairy/milk-bills/b1/pay');
    expect((calls[6].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-4');
    expect(paid.status).toBe('paid');
  });

  it('dairy: counterBoard is a GET with the day/shift/cycle in the QUERY, and omits what was not asked (PC-56 TENANT-6a)', async () => {
    const board = {
      day: '2026-07-13', shift: 'morning', shiftClock: { kind: 'not_recorded', missing: ['mcc_shift_open_at'] },
      centres: [], totals: { litres: '0.0', pours: 0, pourers: 0, amountMinor: '0', flags: 0, fatPct: null, snfPct: null },
      coverage: { kind: 'no_memberships' }, flagSummary: { total: 0, water: 0, other: 0, kinds: [], workflow: 'not_built' },
      accrual: { kind: 'accrued', amountMinor: '0', currencyCode: 'INR', window: { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly', basis: 'derived_from_membership_preference' }, bonusRulesIgnored: false, membersWithPours: 0, billsExisting: 0 },
      window: { from: '2026-07-01', to: '2026-07-15', cycle: 'fortnightly', basis: 'derived_from_membership_preference' },
      payday: { kind: 'not_recorded', closesOn: '2026-07-15', missing: ['dairy_cycle_calendar'] },
      cycleMix: [], pourUniqueness: 'unique_membership_day_shift',
    };
    const { fn, calls } = fakeFetch(() => ({ body: { data: board } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    // Everything omitted: the server resolves the day from its own calendar and the cycle from the membership mix.
    const b = await c.dairy.counterBoard();
    expect(calls[0].url).toBe('https://api.test/v1/dairy/counter/board');
    expect(calls[0].init.method).toBe('GET');
    expect(b.payday.kind).toBe('not_recorded');
    expect(b.pourUniqueness).toBe('unique_membership_day_shift');

    await c.dairy.counterBoard({ day: '2026-07-13', shift: 'evening', cycle: 'monthly' });
    expect(calls[1].url).toBe('https://api.test/v1/dairy/counter/board?day=2026-07-13&shift=evening&cycle=monthly');
  });

  it('dairy: the quality-review protocol hits the right paths and REQUIRES an idempotency key (PC-56 TENANT-6b-1)', async () => {
    const rev = {
      id: 'qr1', collectionId: 'c1', collectedOn: '2026-07-13', membershipId: 'mem1', mccId: 'm1', shift: 'morning',
      status: 'open', holdState: 'held', waterFlag: true, reasons: [], densityAtFlag: '1.024', fatPctAtFlag: '6.20',
      snfPctAtFlag: '8.40', amountWithheldMinor: '57100', currencyCode: 'INR', sampleSealed: false,
      openedAt: '2026-07-13T04:00:00.000Z', openedBy: 'op1', retestAt: null, retestBy: null, memberPresent: null,
      outcomeNote: null, decidedAt: null, decidedBy: null, priorReviews90d: 0, committeeReviewRequired: false,
    };
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [rev], meta: { nextCursor: null } } }
      : n === 2 ? { body: { data: rev } }
      : n === 3 ? { body: { data: { ...rev, status: 'retested', memberPresent: true } } }
      : { body: { data: { ...rev, status: 'cleared', holdState: 'released' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    // The working queue: open PLUS re-tested — the pours whose money is held right now.
    const page = await c.dairy.listQualityReviews({ status: 'open_any' });
    expect(calls[0].url).toBe('https://api.test/v1/dairy/quality-reviews?status=open_any&limit=50');
    expect(page.items[0].holdState).toBe('held');
    expect(page.items[0].amountWithheldMinor).toBe('57100');

    await c.dairy.getQualityReview('qr1');
    expect(calls[1].url).toBe('https://api.test/v1/dairy/quality-reviews/qr1');

    const retested = await c.dairy.retestQualityReview('qr1', { memberPresent: true, sampleSealed: true }, 'idem-r1');
    expect(calls[2].url).toBe('https://api.test/v1/dairy/quality-reviews/qr1/retest');
    expect(calls[2].init.method).toBe('POST');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-r1');
    expect(JSON.parse(String(calls[2].init.body)).memberPresent).toBe(true);
    expect(retested.status).toBe('retested');

    const decided = await c.dairy.decideQualityReview('qr1', { outcome: 'cleared', note: 'rain water' }, 'idem-d1');
    expect(calls[3].url).toBe('https://api.test/v1/dairy/quality-reviews/qr1/decide');
    expect((calls[3].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-d1');
    expect(decided.holdState).toBe('released');
  });

  it('dairy: a rate card carries its premium slabs, and a recorded pour carries its density (PC-56 TENANT-6b-1)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { id: 'rc1', bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }] } } }
      : { body: { data: { id: 'col1', amountMinor: '57084', bonusMinor: '355', bonusApplied: true, holdState: 'none', density: '1.028' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    await c.dairy.createRateCard({ defaultName: 'Buffalo v4', animalType: 'buffalo', pricingModel: 'two_axis',
      ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-07-01',
      bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }] }, 'idem-rc');
    // The slabs must reach the wire: the API service was DROPPING them, found by a live test, so the SDK pins it too.
    expect(JSON.parse(String(calls[0].init.body)).bonusSlabs).toEqual([{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }]);

    const col = await c.dairy.recordCollection({ membershipId: 'mem1', shift: 'morning', collectedOn: '2026-07-13',
      weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', density: '1.028' }, 'idem-c');
    expect(JSON.parse(String(calls[1].init.body)).density).toBe('1.028');
    expect(col.bonusMinor).toBe('355');            // W168's "+ bonus ≈ ₹571" broken out, line by line
    expect(col.bonusApplied).toBe(true);
    expect(col.holdState).toBe('none');
  });

  it('labour employer flow: createBooking (idem) → assign → start → complete → pay; bookingAssignments uses box=booking (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { id: 'b1', bookingNo: 'LB-1', status: 'open' } } }
      : n === 2 ? { body: { data: { id: 'a1', bookingId: 'b1', workerId: 'w1', status: 'pending_worker', wageMinor: '50000' } } }
      : n === 3 ? { body: { data: { id: 'b1', status: 'in_progress' } } }
      : n === 4 ? { body: { data: { id: 'b1', status: 'completed' } } }
      : n === 5 ? { body: { data: { id: 'b1', status: 'paid', totalPaidMinor: '50000', workersPaid: 1 } } }
      : { body: { data: [{ id: 'a1', bookingId: 'b1', workerId: 'w1', status: 'accepted', wageMinor: '50000' }] } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    await c.labour.createBooking({ demandTypeCode: 'harvest', taskSkillId: 's1', regionId: 'r1', skillLevel: 'unskilled', workersNeeded: 2, startDate: '2026-07-01', endDate: '2026-07-03', wageOfferedMinor: '50000', farmLat: 22.3, farmLng: 70.8 }, 'idem-b1');
    expect(calls[0].url).toBe('https://api.test/v1/labour/bookings');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-b1');

    await c.labour.assignWorker('b1', { workerId: 'w1', wageMinor: '50000' }, 'idem-a1');
    expect(calls[1].url).toBe('https://api.test/v1/labour/bookings/b1/assignments');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-a1');

    await c.labour.startBooking('b1');
    expect(calls[2].url).toBe('https://api.test/v1/labour/bookings/b1/start');
    await c.labour.completeBooking('b1');
    expect(calls[3].url).toBe('https://api.test/v1/labour/bookings/b1/complete');
    const paid = await c.labour.payWages('b1', 'idem-pay');
    expect(calls[4].url).toBe('https://api.test/v1/labour/bookings/b1/pay');
    expect((calls[4].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-pay');
    expect(paid.workersPaid).toBe(1);

    await c.labour.bookingAssignments('b1', { status: 'accepted' });
    expect(calls[5].url).toBe('https://api.test/v1/labour/assignments?box=booking&bookingId=b1&status=accepted&limit=50');
  });

  it('ambassadors admin: enroll (idem) → list → suspend (reason) → reinstate → earnings → payout (reason + idem) → activateReferral (reason) → setTarget (P1-12 · TENANT-10a)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { id: 'amb1', userId: 'u1', isActive: true } } }
      : n === 2 ? { body: { data: [{ id: 'amb1', userId: 'u1', isActive: true }], meta: { nextCursor: null, total: 1 } } }
      : n === 3 ? { body: { data: { id: 'amb1', isActive: false } } }
      : n === 4 ? { body: { data: { id: 'amb1', isActive: true } } }
      : n === 5 ? { body: { data: [{ id: 'e1', ambassadorId: 'amb1', amountMinor: '12000', payoutId: null }], meta: { nextCursor: null } } }
      : n === 6 ? { body: { data: { id: 'run1', kind: 'exception', status: 'prepared', periodEnd: '2026-10-01T17:30:00.000Z', payDate: '2026-10-02', lineCount: 1, totalCommissionMinor: '12000', totalStipendMinor: '0', fundingCheck: { mainBalanceMinor: '50000', totalMinor: '12000', covers: true, shortfallMinor: '0', readAt: '2026-10-01T17:30:00.000Z' } } } }
      : n === 7 ? { body: { data: { id: 'r1', code: 'KV-ABC', status: 'activated' } } }
      : { body: { data: { id: 't1', ambassadorId: 'amb1', metric: 'onboardings', periodStart: '2026-07-01', periodEnd: '2026-07-31', targetValue: '25' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const hdr = (i: number) => calls[i].init.headers as Record<string, string>;
    const body = (i: number) => JSON.parse(String(calls[i].init.body ?? 'null'));

    await c.ambassadors.enroll({ phone: '9876543210', monthlyStipendMinor: '0' }, 'idem-en');
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors');
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(0)['idempotency-key']).toBe('idem-en');
    const page = await c.ambassadors.list({ activeOnly: true, tier: 'senior', sort: 'owed' });
    expect(calls[1].url).toBe('https://api.test/v1/ambassadors?activeOnly=true&tier=senior&sort=owed&limit=50');
    expect(page.total).toBe(1);
    await c.ambassadors.suspend('amb1', 'not visiting villages');
    expect(calls[2].url).toBe('https://api.test/v1/ambassadors/amb1/suspend');
    expect(body(2)).toEqual({ reason: 'not visiting villages' });
    await c.ambassadors.reinstate('amb1');
    expect(calls[3].url).toBe('https://api.test/v1/ambassadors/amb1/reinstate');
    expect(body(3)).toEqual({});
    const earn = await c.ambassadors.earnings('amb1', { unpaidOnly: true });
    expect(calls[4].url).toBe('https://api.test/v1/ambassadors/amb1/earnings?unpaidOnly=true&limit=50');
    expect(earn.items[0].amountMinor).toBe('12000');
    const po = await c.ambassadors.payout('amb1', 'weekly run', 'idem-po');
    expect(calls[5].url).toBe('https://api.test/v1/ambassadors/amb1/payout');
    expect(hdr(5)['idempotency-key']).toBe('idem-po');
    expect(body(5)).toEqual({ reason: 'weekly run' });
    expect([po.kind, po.status, po.totalCommissionMinor]).toEqual(['exception', 'prepared', '12000']);   // SW-b: the exception act PREPARES a run
    await c.ambassadors.activateReferral('r1', 'first sale confirmed');
    expect(calls[6].url).toBe('https://api.test/v1/ambassadors/referrals/r1/activate');
    expect(body(6)).toEqual({ reason: 'first sale confirmed' });
    await c.ambassadors.setTarget({ ambassadorId: 'amb1', metric: 'onboardings', periodStart: '2026-07-01', periodEnd: '2026-07-31', targetValue: '25' });
    expect(calls[7].url).toBe('https://api.test/v1/ambassadors/targets');
    expect(calls[7].init.method).toBe('POST');
  });

  it('PC-56 TENANT-10a · ambassadors: summary · candidate · reviews · weekly run (reason + idem) · referral desk + summary', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { activeCount: 2, owedThisWeekMinor: '684000', uncoveredVillages: null, uncoveredReason: 'tenant_village_set_not_recorded' } } }
      : n === 2 ? { body: { data: { userId: 'u1', displayName: 'Dinesh Bhai M.', phoneMasked: '+91 99••• ••205', isMember: true, ambassadorId: null } } }
      : n === 3 || n === 4 ? { body: { data: { ready: true, fields: [], refusals: [], diff: null, entityType: 'ambassador_profile', member: null } } }
      : n === 5 ? { body: { data: { id: 'run1', kind: 'weekly', status: 'prepared', periodEnd: '2026-10-01T17:30:00.000Z', payDate: '2026-10-02', lineCount: 1, totalCommissionMinor: '12000', totalStipendMinor: '0', fundingCheck: { mainBalanceMinor: '0', totalMinor: '12000', covers: false, shortfallMinor: '12000', readAt: '2026-10-01T17:30:00.000Z' } } } }
      : n === 6 ? { body: { data: [{ id: 'r1', code: 'MEERA88', status: 'invited', referee: null, reward: { state: 'not_configured' } }], meta: { nextCursor: 'c2', total: 148 } } }
      : { body: { data: { invites30d: 148, rewardsPaid30dMinor: null, rewardsPaidReason: 'reward_rule_not_configured' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    expect((await c.ambassadors.summary()).uncoveredVillages).toBeNull();
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/summary');
    expect((await c.ambassadors.candidate('+91 99123 45205'))?.phoneMasked).toBe('+91 99••• ••205');
    expect(calls[1].url).toBe('https://api.test/v1/ambassadors/candidates?phone=%2B91+99123+45205');
    await c.ambassadors.reviewRecruit({ phone: '9876543210', clusterRegionIds: ['x'] });
    expect([calls[2].url, calls[2].init.method]).toEqual(['https://api.test/v1/ambassadors/review', 'POST']);
    await c.ambassadors.reviewEdit('amb1', { kioskEnabled: true });
    expect(calls[3].url).toBe('https://api.test/v1/ambassadors/amb1/review');
    const run = await c.ambassadors.runPayouts('weekly run', 'idem-run');
    expect(calls[4].url).toBe('https://api.test/v1/ambassadors/payouts/run');
    expect((calls[4].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-run');
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ reason: 'weekly run' });
    expect([run.status, run.fundingCheck.covers]).toEqual(['prepared', false]);
    const desk = await c.ambassadors.referralDesk({ status: 'invited' });
    expect(calls[5].url).toBe('https://api.test/v1/ambassadors/referrals/all?status=invited&limit=50');
    expect([desk.total, desk.nextCursor, desk.items[0].referee]).toEqual([148, 'c2', null]);
    expect((await c.ambassadors.referralSummary()).rewardsPaid30dMinor).toBeNull();
    expect(calls[6].url).toBe('https://api.test/v1/ambassadors/referrals/summary');
  });

  it('PC-56 TENANT-SW-b · ambassador runs (current · prepare · confirm · pay · refuse · message) — reason + idem on every money act', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { run: null, nextAutoPrepareAt: '2026-10-08T17:30:00.000Z', nextPayDate: '2026-10-09' } } }
      : n === 2 ? { body: { data: [{ id: 'run0', status: 'paid', maker: 'job' }], meta: { nextCursor: 'cx' } } }
      : n === 3 ? { body: { data: { id: 'run1', kind: 'weekly', status: 'prepared', lineCount: 2, totalCommissionMinor: '10', totalStipendMinor: '5', fundingCheck: { covers: true } } } }
      : n === 4 || n === 5 ? { body: { data: { runId: 'run1', paid: 2, unfunded: 0, failed: 0, paidMinor: '15', status: 'paid' } } }
      : n === 6 ? { body: { data: { runId: 'run1', status: 'refused' } } }
      : { body: { data: { ambassadorId: 'amb1', queued: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    expect((await c.ambassadors.currentRun()).run).toBeNull();
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/payout-runs/current');
    expect((await c.ambassadors.runs()).nextCursor).toBe('cx');
    expect(calls[1].url).toBe('https://api.test/v1/ambassadors/payout-runs?limit=20');
    await c.ambassadors.prepareRun('weekly run, Thursday', 'k-prep');
    expect([calls[2].url, (calls[2].init.headers as Record<string, string>)['idempotency-key']]).toEqual(['https://api.test/v1/ambassadors/payout-runs/prepare', 'k-prep']);
    expect((await c.ambassadors.confirmRun('run1', 'checked the lines', 'k-conf')).status).toBe('paid');
    expect([calls[3].url, (calls[3].init.headers as Record<string, string>)['idempotency-key'], JSON.parse(String(calls[3].init.body))]).toEqual(['https://api.test/v1/ambassadors/payout-runs/run1/confirm', 'k-conf', { reason: 'checked the lines' }]);
    await c.ambassadors.payRun('run1', 'tenant wallet topped up', 'k-pay');
    expect(calls[4].url).toBe('https://api.test/v1/ambassadors/payout-runs/run1/pay');
    await c.ambassadors.refuseRun('run1', 'wrong period');
    expect([calls[5].url, JSON.parse(String(calls[5].init.body))]).toEqual(['https://api.test/v1/ambassadors/payout-runs/run1/refuse', { reason: 'wrong period' }]);
    await c.ambassadors.message('amb1', { message: 'Meeting at 10', reason: 'camp tomorrow' }, 'k-msg');
    expect([calls[6].url, (calls[6].init.headers as Record<string, string>)['idempotency-key']]).toEqual(['https://api.test/v1/ambassadors/amb1/message', 'k-msg']);
  });

  it('PC-56 TENANT-SW-b · attendance review desk, wage runs, advances — the right paths, keys and bodies', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: 'd1', workerPhoneMasked: '+91 98••• ••412' }], meta: { nextCursor: 'c2' } } }
      : n === 9 ? { body: { data: [{ id: 'w1', runDate: '2026-10-03' }], meta: { nextBefore: '2026-10-03' } } }
      : n === 11 ? { body: { data: [{ id: 'a1', status: 'recovering' }], meta: { nextCursor: null, totals: { outstandingMinor: '5000', workers: 1, advances: 1 } } } }
      : { body: { data: { ok: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const hdr = (i: number) => calls[i].init.headers as Record<string, string>;
    const body = (i: number) => JSON.parse(String(calls[i].init.body));
    expect((await c.labour.attendanceReview({ status: 'needs_review' })).nextCursor).toBe('c2');
    expect(calls[0].url).toBe('https://api.test/v1/labour/attendance?status=needs_review&limit=50');
    await c.labour.attendanceSummary();
    expect(calls[1].url).toBe('https://api.test/v1/labour/attendance/summary');
    await c.labour.confirmAllClean(undefined, 'k-clean');
    expect([calls[2].url, hdr(2)['idempotency-key'], body(2)]).toEqual(['https://api.test/v1/labour/attendance/confirm-clean', 'k-clean', {}]);
    await c.labour.backfillAttendance({ assignmentId: 'as1', workDate: '2026-10-01', hoursRegular: 8, mediaId: 'm1', reason: 'signed muster sheet' }, 'k-bf');
    expect([calls[3].url, hdr(3)['idempotency-key']]).toEqual(['https://api.test/v1/labour/attendance/backfill', 'k-bf']);
    await c.labour.reviewAttendance('d1', 'vouch', 'I saw her on the field');
    expect([calls[4].url, body(4)]).toEqual(['https://api.test/v1/labour/attendance/d1/vouch', { reason: 'I saw her on the field' }]);
    await c.labour.reviewAttendance('d1', 'refuse', 'nobody was on the field');
    expect(calls[5].url).toBe('https://api.test/v1/labour/attendance/d1/refuse');
    await c.labour.confirmAttendanceDay('d1', 'ok', 'k-c');
    expect([calls[6].url, hdr(6)['idempotency-key']]).toEqual(['https://api.test/v1/labour/attendance/d1/confirm', 'k-c']);
    await c.labour.wagesToday();
    expect(calls[7].url).toBe('https://api.test/v1/labour/wages/today');
    expect((await c.labour.wageRuns()).nextBefore).toBe('2026-10-03');
    expect(calls[8].url).toBe('https://api.test/v1/labour/wages/runs?limit=14');
    await c.labour.wageRun('w1');
    expect(calls[9].url).toBe('https://api.test/v1/labour/wages/runs/w1');
    expect((await c.labour.advances({ status: 'outstanding' })).totals?.outstandingMinor).toBe('5000');
    expect(calls[10].url).toBe('https://api.test/v1/labour/advances?status=outstanding&limit=50');
    await c.labour.advanceCap('as1');
    expect(calls[11].url).toBe('https://api.test/v1/labour/advances/cap/as1');
    await c.labour.requestAdvance({ assignmentId: 'as1', amountMinor: '20000', reason: 'school fees' }, 'k-adv');
    expect([calls[12].url, hdr(12)['idempotency-key'], body(12).amountMinor]).toEqual(['https://api.test/v1/labour/advances', 'k-adv', '20000']);
    await c.labour.approveAdvance('a1', { reason: 'employer agreed', consent: { channel: 'otp' } }, 'k-ap');
    expect([calls[13].url, hdr(13)['idempotency-key'], body(13).consent]).toEqual(['https://api.test/v1/labour/advances/a1/approve', 'k-ap', { channel: 'otp' }]);
    await c.labour.rejectAdvance('a1', 'over the cap');
    expect(calls[14].url).toBe('https://api.test/v1/labour/advances/a1/reject');
  });

  it('PC-56 TENANT-SW-b · the schemes desk — summary, table, pipeline tab, sweep (keyed), call list, one-field reveal', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.schemes.deskSummary();
    expect(calls[0].url).toBe('https://api.test/v1/schemes/desk/summary');
    await c.schemes.deskSchemes();
    expect(calls[1].url).toBe('https://api.test/v1/schemes/desk/schemes');
    await c.schemes.deskPipeline('PM-KISAN', { group: 'rejected_appealed' });
    expect(calls[2].url).toBe('https://api.test/v1/schemes/desk/pipeline/PM-KISAN?group=rejected_appealed&limit=50');
    await c.schemes.runSweep('PM-KISAN', 'camp call list', 'k-sw');
    expect([calls[3].url, (calls[3].init.headers as Record<string, string>)['idempotency-key'], JSON.parse(String(calls[3].init.body))]).toEqual(['https://api.test/v1/schemes/desk/sweeps', 'k-sw', { schemeCode: 'PM-KISAN', reason: 'camp call list' }]);
    await c.schemes.sweep('sw1', { all: true });
    expect(calls[4].url).toBe('https://api.test/v1/schemes/desk/sweeps/sw1?all=true&limit=50');
    await c.schemes.revealFormField('ap1', 'bank_ifsc', 'member asked to check the IFSC on file');
    expect([calls[5].url, JSON.parse(String(calls[5].init.body))]).toEqual(['https://api.test/v1/schemes/desk/applications/ap1/reveal', { field: 'bank_ifsc', reason: 'member asked to check the IFSC on file' }]);
  });

  it('schemes operator: queue → verify → clarify → approve → recordDbt hit the right paths (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: 'ap1', schemeId: 's1', status: 'submitted' }], meta: { nextCursor: null } } }
      : n === 2 ? { body: { data: { id: 'ap1', status: 'under_verification' } } }
      : n === 3 ? { body: { data: { id: 'ap1', status: 'clarification_needed' } } }
      : n === 4 ? { body: { data: { id: 'ap1', status: 'approved', govtAppRef: 'GOV-99' } } }
      : n === 5 ? { body: { data: { id: 'ap1', status: 'rejected', rejectionReason: 'ineligible' } } }
      : { body: { data: { id: 'dbt1', applicationId: 'ap1', amountMinor: '600000', creditedOn: '2026-07-10' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const q = await c.schemes.listApplications({ box: 'queue', status: 'submitted' });
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications?box=queue&status=submitted&limit=50');
    expect(q.items[0].id).toBe('ap1');
    await c.schemes.verifyApplication('ap1');
    expect(calls[1].url).toBe('https://api.test/v1/schemes/applications/ap1/verify');
    await c.schemes.requestClarification('ap1', 'need land record');
    expect(calls[2].url).toBe('https://api.test/v1/schemes/applications/ap1/clarify');
    const ap = await c.schemes.approveApplication('ap1', 'GOV-99');
    expect(calls[3].url).toBe('https://api.test/v1/schemes/applications/ap1/approve');
    expect(ap.govtAppRef).toBe('GOV-99');
    await c.schemes.rejectApplication('ap1', 'ineligible');
    expect(calls[4].url).toBe('https://api.test/v1/schemes/applications/ap1/reject');
    const dbt = await c.schemes.recordDbt('ap1', { amountMinor: '600000', creditedOn: '2026-07-10', instalmentNo: 1, pfmsRef: 'PFMS-1' });
    expect(calls[5].url).toBe('https://api.test/v1/schemes/applications/ap1/dbt');
    expect(calls[5].init.method).toBe('POST');
    expect(dbt.amountMinor).toBe('600000');
  });

  // PC-56 TENANT-11c: the group-lots resource is pinned against the 11c API in test/group-lots.spec.ts (the old typed-gross
  // `settle` and the `{farmerUserId, quantity}`-only pledge it asserted no longer exist).

  it('audit: list (filtered, keyset) + get hit the right read-only paths (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: '42', action: 'kyc.approved', actorUserId: 'u1', createdAt: '2026-06-24T10:00:00.000Z' }], meta: { nextCursor: 'CUR' } } }
      : { body: { data: { id: '42', action: 'kyc.approved', entityType: 'user', entityId: 'u9', oldValue: null, newValue: { status: 'approved' }, createdAt: '2026-06-24T10:00:00.000Z' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const page = await c.audit.list({ action: 'kyc.approved', entityType: 'user', from: '2026-06-01T00:00:00.000Z' });
    expect(calls[0].url).toBe('https://api.test/v1/audit/entries?action=kyc.approved&entityType=user&from=2026-06-01T00%3A00%3A00.000Z&limit=50');
    expect(calls[0].init.method).toBe('GET');
    expect(page.items[0].id).toBe('42');
    expect(page.nextCursor).toBe('CUR');
    const e = await c.audit.get('42');
    expect(calls[1].url).toBe('https://api.test/v1/audit/entries/42');
    expect((e.newValue as { status: string }).status).toBe('approved');
  });

  it('ai-review: list (open) → get → claim → resolve hit the right paths (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: 'r1', queueKind: 'low_confidence_grade', status: 'pending', priority: 100 }], meta: { nextCursor: 'CUR' } } }
      : n === 2 ? { body: { data: { id: 'r1', queueKind: 'low_confidence_grade', status: 'pending', inferenceId: 'inf1' } } }
      : n === 3 ? { body: { data: { id: 'r1', status: 'in_review', reviewerUserId: 'u1' } } }
      : { body: { data: { id: 'r1', status: 'rejected', decisionNote: 'bad grade', resolvedAt: '2026-06-24T10:00:00.000Z' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const q = await c.aiReview.list({ box: 'open', queueKind: 'low_confidence_grade' });
    expect(calls[0].url).toBe('https://api.test/v1/ai/review-queue?box=open&queueKind=low_confidence_grade&limit=50');
    expect(q.items[0].id).toBe('r1');
    expect(q.nextCursor).toBe('CUR');
    await c.aiReview.get('r1');
    expect(calls[1].url).toBe('https://api.test/v1/ai/review-queue/r1');
    await c.aiReview.claim('r1');
    expect(calls[2].url).toBe('https://api.test/v1/ai/review-queue/r1/claim');
    expect(calls[2].init.method).toBe('POST');
    const res = await c.aiReview.resolve('r1', { decision: 'rejected', note: 'bad grade' });
    expect(calls[3].url).toBe('https://api.test/v1/ai/review-queue/r1/resolve');
    expect(res.status).toBe('rejected');
  });

  it('assistant: ask posts an idempotent governed turn + returns the logged reply (P1-13)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { reply: 'Use neem oil for aphids.', sessionId: 's1', status: 'answered', citations: [{ title: 'ICAR pest guide' }] } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const r = await c.assistant.ask({ message: 'How do I treat aphids on okra?', languageCode: 'en' }, 'idem-asst-1');
    expect(calls[0].url).toBe('https://api.test/v1/ai/assistant/messages');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-asst-1');
    expect(r.status).toBe('answered');
    expect(r.sessionId).toBe('s1');
    expect(r.reply).toContain('neem');
  });

  it('search: unified query returns ranked cross-entity hits + engine + cursor (P1-14)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: {
      data: [{ type: 'listings', id: 'l1', title: 'Tomato', createdAt: '2026-06-01T00:00:00.000Z', score: 3 }],
      meta: { engine: 'opensearch', nextCursor: 'CUR' },
    } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const page = await c.search.query({ q: 'tomato', types: 'listings,products' });
    expect(calls[0].url).toBe('https://api.test/v1/search?q=tomato&types=listings%2Cproducts&limit=20');
    expect(calls[0].init.method).toBe('GET');
    expect(page.items[0].id).toBe('l1');
    expect(page.engine).toBe('opensearch');
    expect(page.nextCursor).toBe('CUR');
  });

  it('listings.recordView POSTs /v1/listings/:id/view (fire-and-forget, no idempotency key)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.listings.recordView('l1');
    expect(calls[0].url).toBe('https://api.test/v1/listings/l1/view');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('listings.analytics unwraps the real view count (P1-15)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: {
      listingId: 'l1', status: 'published', publishedAt: '2026-06-01T00:00:00.000Z',
      offers: 2, priceChanges: 1, boostsPurchased: 0, views: 42, lastViewedAt: '2026-06-25T10:00:00.000Z', activeBoost: null,
    } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const a = await c.listings.analytics('l1');
    expect(calls[0].url).toBe('https://api.test/v1/listings/l1/analytics');
    expect(a.views).toBe(42);
    expect(a.lastViewedAt).toBe('2026-06-25T10:00:00.000Z');
  });

  it('schemes.attachDocument POSTs the application documents path (P1-16)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'd1', applicationId: 'app1', mediaId: 'm1', docTypeId: 'aadhaar', note: null, uploadedBy: 'u1', createdAt: '2026-06-26T00:00:00.000Z' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const d = await c.schemes.attachDocument('app1', { mediaId: 'm1', docTypeId: 'aadhaar' });
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/app1/documents');
    expect(calls[0].init.method).toBe('POST');
    expect(d.mediaId).toBe('m1');
    expect(d.docTypeId).toBe('aadhaar');
  });

  it('schemes.detachDocument DELETEs the specific document (P1-16)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.schemes.detachDocument('app1', 'd1');
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/app1/documents/d1');
    expect(calls[0].init.method).toBe('DELETE');
    expect(r.ok).toBe(true);
  });

  it('bankAccounts.addFull POSTs /v1/bank-accounts/tokenise with an idempotency key (P1-16)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'ba1' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.bankAccounts.addFull({ accountNumber: '000111222333', ifsc: 'HDFC0001234', holderName: 'Ramesh' }, 'idem-bank-1');
    expect(calls[0].url).toBe('https://api.test/v1/bank-accounts/tokenise');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-bank-1');
    expect(r.id).toBe('ba1');
  });

  it('ambassadors.createListingOnBehalf POSTs the on-behalf path with an idempotency key (P1-16)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'lst1' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.ambassadors.createListingOnBehalf('farmer-1', { productId: 'p1', categoryId: 'c1', title: 'Tomatoes', quantityTotal: 100, unitCode: 'kg', priceMinor: '4500' } as any, 'idem-ob-1');
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/on-behalf/listings');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ob-1');
    expect(JSON.parse(calls[0].init.body as string).farmerUserId).toBe('farmer-1');
    expect(r.id).toBe('lst1');
  });

  it('ambassadors.suggestListingFromDocs POSTs the suggest path; advisory draft + needsReview (P1-16-AI)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { draft: { crop_name: 'Tomato', price_minor: '4500' }, confidence: 0.72, needsReview: false, modelCode: 'doc_listing_extract', modelId: 'm1', degraded: false } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const r = await c.ambassadors.suggestListingFromDocs({ farmerUserId: 'farmer-1', docText: 'Tomato 100kg @ 45/kg', locale: 'en' });
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/on-behalf/listings/suggest');
    expect(calls[0].init.method).toBe('POST');
    expect(r.draft.crop_name).toBe('Tomato');
    expect(r.confidence).toBe(0.72);
    expect(r.needsReview).toBe(false);
  });
});

// REACTIVE token refresh (refresh-on-401 + retry). Access tokens expire in 900s; without this, once a token
// expires mid-session every request 401s until app restart. These tests pin the SDK-level contract the mobile
// app's auth store wires up: single-flight refresh, retry-once semantics, Idempotency-Key reuse, and the
// anonymous/no-callback escape hatches that must never engage the recovery path.
describe('HttpClient reactive 401 refresh (onUnauthorized)', () => {
  it('401 → onUnauthorized resolves true → retries the ORIGINAL request ONCE with the fresh token, reusing the same Idempotency-Key', async () => {
    let token = 'stale-tok';
    const { fn, calls } = fakeFetch((_c, n) => (n === 1 ? { status: 401, body: { code: 'UNAUTHENTICATED', message: 'expired' } } : { body: { data: { ok: true } } }));
    let refreshCalls = 0;
    const onUnauthorized = async () => { refreshCalls += 1; token = 'fresh-tok'; return true; };
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => token, onUnauthorized });
    const r = await c.request<{ ok: boolean }>('POST', 'schemes/applications/app1/submit', { idempotencyKey: 'idem-refresh-1' });
    expect(refreshCalls).toBe(1);                                                          // exactly one refresh
    expect(calls.length).toBe(2);                                                           // original + one retry
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer stale-tok');
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe('Bearer fresh-tok'); // fresh token on retry
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-refresh-1');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-refresh-1'); // SAME key, not re-minted
    expect(r.data).toEqual({ ok: true });
  });

  it('401 → onUnauthorized resolves false → the ORIGINAL 401 is rethrown, no retry fired', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401, body: { code: 'UNAUTHENTICATED', message: 'expired' } }));
    let refreshCalls = 0;
    const onUnauthorized = async () => { refreshCalls += 1; return false; };
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'stale-tok', onUnauthorized });
    await expect(c.request('POST', 'schemes/applications/app1/submit', { idempotencyKey: 'idem-1' }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(refreshCalls).toBe(1);
    expect(calls.length).toBe(1);                                                          // no retry attempted
  });

  it('401 → onUnauthorized THROWS → treated as a failed refresh: the ORIGINAL 401 is rethrown (not the refresh error)', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401, body: { code: 'UNAUTHENTICATED', message: 'expired' } }));
    const onUnauthorized = async () => { throw new Error('refresh network error'); };
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'stale-tok', onUnauthorized });
    await expect(c.request('GET', 'users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(calls.length).toBe(1);
  });

  it('a second 401 AFTER the single retry is surfaced as-is (no infinite loop — retry happens at most once per request)', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401, body: { code: 'UNAUTHENTICATED', message: 'still expired' } }));
    let refreshCalls = 0;
    const onUnauthorized = async () => { refreshCalls += 1; return true; }; // "succeeds" but the token is still bad
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok', onUnauthorized });
    await expect(c.request('GET', 'users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(refreshCalls).toBe(1);                                                          // only the first 401 triggers a refresh
    expect(calls.length).toBe(2);                                                           // original + the one bounded retry
  });

  it('concurrent 401s (3 parallel requests) share a SINGLE in-flight refresh — refresh tokens rotate, so a second concurrent call would invalidate the session', async () => {
    let deferredResolve!: (v: boolean) => void;
    const deferred = new Promise<boolean>((res) => { deferredResolve = res; });
    let refreshCalls = 0;
    const onUnauthorized = async () => { refreshCalls += 1; return deferred; };
    // first 3 calls (one per parallel request) 401; everything after (the post-refresh retries) succeeds.
    const { fn, calls } = fakeFetch((_c, n) => (n <= 3 ? { status: 401, body: { code: 'UNAUTHENTICATED' } } : { body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok', onUnauthorized });
    const results = Promise.all([
      c.request<{ ok: boolean }>('GET', 'a'),
      c.request<{ ok: boolean }>('GET', 'b'),
      c.request<{ ok: boolean }>('GET', 'c'),
    ]);
    // let all three requests reach + suspend on the in-flight refresh before it settles (a macrotask tick
    // flushes every pending microtask, however many header/fetch/parse hops each request is mid-way through).
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls).toBe(1);                                                          // single-flight: exactly ONE refresh call
    deferredResolve(true);
    const [a, b, cc] = await results;
    expect([a.data, b.data, cc.data]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(calls.length).toBe(6);                                                           // 3 original 401s + 3 retries
    expect(refreshCalls).toBe(1);
  });

  it('an ANONYMOUS request 401 never invokes onUnauthorized (prevents auth/refresh from trying to refresh on its own 401)', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401, body: { code: 'INVALID_REFRESH_TOKEN' } }));
    let refreshCalls = 0;
    const onUnauthorized = async () => { refreshCalls += 1; return true; };
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok', onUnauthorized });
    await expect(c.request('POST', 'auth/refresh', { anonymous: true, body: { refreshToken: 'r1' } }))
      .rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN', status: 401 });
    expect(refreshCalls).toBe(0);                                                          // never engaged for anonymous calls
    expect(calls.length).toBe(1);
  });

  it('no onUnauthorized configured → a 401 behaves exactly as before (rethrown immediately, no retry)', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 401, body: { code: 'UNAUTHENTICATED' } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' }); // no onUnauthorized
    await expect(c.request('GET', 'users/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(calls.length).toBe(1);
  });
});

// --- livestock (PC-50 W10-1 Pashupalak) ---
describe('livestock resource', () => {
  it('registers an animal with an Idempotency-Key and lists box=mine by default', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 'a1', ownerUserId: 'u1', speciesId: 's1', status: 'active' } } }
      : { body: { data: [], meta: { nextCursor: null } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.livestock.registerAnimal({ speciesId: 's1', name: 'Gauri' }, 'idem-an-1');
    expect(calls[0].url).toBe('https://api.test/v1/livestock/animals');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-an-1');
    await c.livestock.animals();
    expect(calls[1].url).toContain('box=mine');
  });
  it('books a vet (fee NEVER client-supplied) and completes idempotently (the money leg)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'b1', farmerUserId: 'u1', vetId: 'v1', serviceId: 'sv1', urgency: 'routine', mode: 'visit', status: 'requested', feeMinor: '50000' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const b = await c.livestock.bookVet({ vetId: 'v1', serviceId: 'sv1', urgency: 'urgent' }, 'idem-vb-1');
    expect(calls[0].url).toBe('https://api.test/v1/livestock/vet-bookings');
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('feeMinor');
    expect(typeof b.feeMinor).toBe('string');
    await c.livestock.completeVetBooking('b1', 'idem-vb-2');
    expect(calls[1].url).toBe('https://api.test/v1/livestock/vet-bookings/b1/complete');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-vb-2');
  });
});

// --- livestock vet-side (PC-50 W10-3) ---
describe('livestock vet-side', () => {
  it('registers the practice idempotently, lists box=vet, and progresses with a bare action', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 2
      ? { body: { data: [], meta: { nextCursor: null } } }
      : { body: { data: { id: 'v1', status: 'accepted' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.livestock.registerVet({ registrationNo: 'GUJ-1234' }, 'idem-vp-1');
    expect(calls[0].url).toBe('https://api.test/v1/livestock/vets');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-vp-1');
    await c.livestock.vetBookings({ box: 'vet' });
    expect(calls[1].url).toContain('box=vet');
    await c.livestock.progressVetBooking('b1', 'accept');
    expect(calls[2].url).toBe('https://api.test/v1/livestock/vet-bookings/b1/progress');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ action: 'accept' });
  });
});

// --- product batches (PC-50 W10-4) ---
describe('catalogue product batches', () => {
  it('goods-inward is Idempotency-Keyed; MRP stays a minor string; recall carries the audited reason', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1 ? { body: { data: { id: 'b1' } } } : { body: { data: { ok: true } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.catalogue.createBatch({ productId: 'p1', batchNo: 'B-01', mrpMinor: '45000', qtyReceived: 20, unitCode: 'bag', expiryDate: '2027-01-31' }, 'idem-pb-1');
    expect(calls[0].url).toBe('https://api.test/v1/product-batches');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-pb-1');
    expect(JSON.parse(String(calls[0].init.body)).mrpMinor).toBe('45000');
    await c.catalogue.recallBatch('b1', 'expired stock');
    expect(calls[1].url).toBe('https://api.test/v1/product-batches/b1/recall');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: 'expired stock' });
  });
});

// --- rider shipment lifecycle (PC-50 W10-5) ---
describe('logistics rider lifecycle', () => {
  it('walks the milestones, fails with an audited reason, and delivers with OTP idempotently', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 's1', orderId: 'o1', status: 'in_transit', requiresOtp: true } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.shipments.markPickedUp('s1');
    await c.shipments.fail('s1', 'buyer not reachable');
    await c.shipments.deliver('s1', { otp: '4321', podMediaId: 'm1' }, 'idem-dl-1');
    expect(calls[0].url).toBe('https://api.test/v1/shipments/s1/picked-up');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reason: 'buyer not reachable' });
    expect(calls[2].url).toBe('https://api.test/v1/shipments/s1/deliver');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-dl-1');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ otp: '4321', podMediaId: 'm1' });
  });
});

// --- equipment owner-side (PC-50 W10-6) ---
describe('equipment owner-side', () => {
  it('registers an asset idempotently, lists box=owner rentals, quotes a float-free advance', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 2
      ? { body: { data: [], meta: { nextCursor: null } } }
      : { body: { data: { id: 'a1', defaultName: 'Tractor', status: 'active' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.equipment.registerAsset({ categoryId: 'cat1', regNo: 'GJ-01-AB-1234' }, 'idem-eq-1');
    expect(calls[0].url).toBe('https://api.test/v1/equipment/assets');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-eq-1');
    await c.equipment.rentals({ box: 'owner' });
    expect(calls[1].url).toContain('box=owner');
    await c.equipment.quoteRental('r1', '250000');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ advanceMinor: '250000' });
  });
});

// --- kyc reviewer read-models (PC-54 W54-1) ---
describe('kyc review reads', () => {
  it('queue defaults to pending with keyset paging; case read hits review/:id', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.kyc.reviewQueue({ status: 'pending' });
    expect(calls[0].url).toContain('kyc/review/queue');
    expect(calls[0].url).toContain('status=pending');
    await c.kyc.reviewCase('k1');
    expect(calls[1].url).toBe('https://api.test/v1/kyc/review/k1');
  });
});

// --- returns + cod-recon (PC-54 W54-2, the commerce-trust pair) ---
describe('returns + cod-recon', () => {
  it('files a return idempotently, walks the lifecycle, and reads the COD worksheet', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 3
      ? { body: { data: [{ riderUserId: 'r1', shipments: 3, codMinor: '450000', oldestDeliveredAt: '2026-08-01T00:00:00Z' }] } }
      : { body: { data: { id: 'ret1', orderId: 'o1', status: 'requested' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.returns.request({ orderId: 'o1', reasonCode: 'damaged' }, 'idem-ret-1');
    expect(calls[0].url).toBe('https://api.test/v1/returns');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ret-1');
    await c.returns.refund('ret1');
    expect(calls[1].url).toBe('https://api.test/v1/returns/ret1/refund');
    const rows = await c.shipments.codOutstanding();
    expect(calls[2].url).toBe('https://api.test/v1/shipments/cod/outstanding');
    expect(rows[0].codMinor).toBe('450000');
    expect(typeof rows[0].codMinor).toBe('string');
  });
});

// --- field-visits + mgnrega (PC-54 W54-3, unblocks gov GW-5) ---
describe('field visits + mgnrega job cards', () => {
  it('schedules/submits a visit (media-id evidence) and registers a job card idempotently', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n <= 2
      ? { body: { data: { id: 'v1', status: n === 1 ? 'scheduled' : 'submitted' } } }
      : { body: { data: { id: 'jc1', jobCardNo: 'GJ-05-001234' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.schemes.scheduleFieldVisit('app1', '2026-08-10');
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/app1/field-visits');
    await c.schemes.submitFieldVisit('v1', { geotag: [{ mediaId: '00000000-0000-7000-8000-000000000001', lat: 22.3, lng: 73.2, capturedAt: '2026-08-10T09:00:00Z' }] });
    expect(calls[1].url).toContain('field-visits/v1/submit');
    expect(JSON.parse(String(calls[1].init.body)).geotag[0].mediaId).toBeDefined();
    await c.labour.registerJobCard({ jobCardNo: 'GJ-05-001234' }, 'idem-jc-1');
    expect(calls[2].url).toBe('https://api.test/v1/labour/mgnrega/job-cards');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-jc-1');
  });
});

// --- livestock depth (PC-54 W54-4) ---
describe('livestock depth', () => {
  it('records a health event, writes the vet pad, and looks up by ear tag', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 3
      ? { body: { data: [], meta: { nextCursor: null } } }
      : { body: { data: { id: 'x1' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.livestock.recordHealthEvent('a1', { eventTypeCode: 'vaccination', nextDueDate: '2026-11-05' });
    expect(calls[0].url).toBe('https://api.test/v1/livestock/animals/a1/health-events');
    await c.livestock.writePrescription('b1', { items: [{ drugName: 'Oxytetracycline', dosage: '10ml IM OD', durationDays: 3, isScheduleH: true }] });
    expect(calls[1].url).toBe('https://api.test/v1/livestock/vet-bookings/b1/prescription');
    expect(JSON.parse(String(calls[1].init.body)).items[0].isScheduleH).toBe(true);
    await c.livestock.animals({ box: 'all', pashuAadhaar: '123456789012' });
    expect(calls[2].url).toContain('pashuAadhaar=123456789012');
  });
});

// --- dairy read-models (PC-54 W54-5) ---
describe('d2c + mcc day sheet', () => {
  it('subscribes idempotently and reads the per-shift aggregate as minor strings', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 2
      ? { body: { data: [{ shift: 'morning', slips: 42, weightKg: '512.500', amountMinor: '1845000', waterFlags: 1 }] } }
      : { body: { data: { id: 's1', status: 'active' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.dairy.subscribeD2c({ planId: 'p1', addressId: 'a1', startsOn: '2026-08-10' }, 'idem-d2c-1');
    expect(calls[0].url).toBe('https://api.test/v1/dairy/d2c/subscriptions');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-d2c-1');
    const rows = await c.dairy.mccDaySummary('m1', '2026-08-05');
    expect(calls[1].url).toContain('mccs/m1/day-summary');
    expect(typeof rows[0].amountMinor).toBe('string');
  });
});

// --- payout batches (PC-54 W54-6) ---
describe('payout batches', () => {
  it('reads the batch register + detail', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.payouts.payoutBatches({ status: 'executed' });
    expect(calls[0].url).toContain('payouts/batches?status=executed');
  });
});

// --- governance-agm (PC-54 W54-7) · the resolutions (PC-56 TENANT-9b) ---
describe('governance', () => {
  it('creates a resolution with the REVIEW page\'s key, and casts one ballot', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'r1', status: 'draft' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.memberships.createResolution({ title: 'FY26 dividend 8%', resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '8' }, 'idem-gov-1');
    expect(calls[0].url).toBe('https://api.test/v1/governance/resolutions');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-gov-1');
    await c.memberships.castVote('r1', 'for');
    expect(calls[1].url).toBe('https://api.test/v1/governance/resolutions/r1/vote');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ choice: 'for' });
  });
  it('[9b] reads keyless (page, catalogue, previews, results); writes keyed (edit, act) — one act route', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: 'c2', zone: 'Asia/Kolkata' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const page = await c.memberships.resolutionsPage({ status: 'closed', type: 'dividend', year: 2025, cursor: 'c1', limit: 20 });
    expect(page).toEqual({ items: [], nextCursor: 'c2', zone: 'Asia/Kolkata' });
    expect(calls[0].url).toBe('https://api.test/v1/governance/resolutions?status=closed&type=dividend&year=2025&cursor=c1&limit=20');
    await c.memberships.resolutionCatalogue();
    await c.memberships.previewResolution({ title: 'x' }, 'r1');
    await c.memberships.previewResolutionAct('r1', 'close', { reasonCode: 'agm_declared', note: 'minuted' });
    await c.memberships.resolutionResults('r1');
    await c.memberships.resolutionDraft('r1');
    for (const i of [1, 2, 3, 4, 5]) expect((calls[i].init.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
    expect([calls[1].url, calls[2].url, calls[3].url, calls[5].url]).toEqual([
      'https://api.test/v1/governance/resolutions/catalogue', 'https://api.test/v1/governance/resolutions/preview',
      'https://api.test/v1/governance/resolutions/r1/acts/close/preview', 'https://api.test/v1/governance/resolutions/r1/draft']);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ title: 'x', id: 'r1' });
    await c.memberships.updateResolution('r1', { title: 'y' }, 'k-edit');
    expect([calls[6].init.method, calls[6].url, (calls[6].init.headers as Record<string, string>)['idempotency-key']]).toEqual(['PATCH', 'https://api.test/v1/governance/resolutions/r1', 'k-edit']);
    for (const [i, a] of (['open', 'close', 'withdraw'] as const).entries()) {
      await c.memberships.resolutionAct('r1', a, { note: 'n' }, `k-${a}`);
      expect([calls[7 + i].url, (calls[7 + i].init.headers as Record<string, string>)['idempotency-key']]).toEqual([`https://api.test/v1/governance/resolutions/r1/acts/${a}`, `k-${a}`]);
    }
    expect('openResolution' in c.memberships || 'closeResolution' in c.memberships).toBe(false);
  });
});

// --- fintech servicing (PC-54 W54-8) ---
describe('fintech servicing', () => {
  it('reads DPD, posts a signed KCC entry, and drives maker-checker restructures', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: [{ bucket: '1-30', loans: 4, outstandingMinor: '1200000' }] } }
      : { body: { data: { loanId: 'l1', balanceAfterMinor: '350000' } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const dpd = await c.fintech.dpdBuckets();
    expect(calls[0].url).toBe('https://api.test/v1/fintech/servicing/dpd');
    expect(typeof dpd[0].outstandingMinor).toBe('string');
    await c.fintech.kccEntry('l1', { entryKind: 'drawl', amountMinor: '350000', narrative: 'Drawl — kharif kit' });
    expect(JSON.parse(String(calls[1].init.body)).amountMinor).toBe('350000');
    await c.fintech.transitionRestructure('r1', 'checker_approved');
    expect(calls[2].url).toContain('restructures/r1/transition');
  });
});

// --- insurance authoring (PC-54 W54-9) ---
describe('insurance authoring', () => {
  it('creates a product idempotently and issues a policy with its number', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'p1', status: 'active', policyNo: 'PMFBY-26-001' } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.insuranceAuthoring.createProduct({ partnerId: 'pt1', productKindId: 'k1', defaultName: 'PMFBY Kharif', premiumCalc: { pct_of_sum_insured: 2 } }, 'idem-ia-1');
    expect(calls[0].url).toBe('https://api.test/v1/insurance/authoring/products');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-ia-1');
    await c.insuranceAuthoring.issuePolicy('p1', { policyNo: 'PMFBY-26-001' });
    expect(calls[1].url).toContain('policies/p1/issue');
  });
});

// --- gov exports + dbt read-models (PC-54 W54-10) ---
describe('gov exports', () => {
  it('reads the monitor and gets an audit-stamped receipt with export rows', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: [{ schemeId: 's1', transfers: 12, amountMinor: '7200000', lastCreditedOn: '2026-08-01' }] } }
      : { body: { data: { receipt: { id: 'rcpt1', report: 'dbt_monitor', generatedAt: 'x', generatedBy: 'u1', rowCount: 1 }, rows: [{}] } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const m = await c.schemes.dbtMonitor();
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/dbt/monitor');
    expect(typeof m[0].amountMinor).toBe('string');
    const e = await c.schemes.exportReport({ report: 'dbt_monitor' });
    expect(calls[1].url).toContain('applications/exports');
    expect(e.receipt.id).toBe('rcpt1');
  });
});

// --- iot fleet + alerts + maintenance (PC-54 W54-12) ---
describe('iot fleet + maintenance', () => {
  it('reads the device fleet/breach feed and records a maintenance log', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [] } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.shipments.coldChainDevices();
    expect(calls[0].url).toBe('https://api.test/v1/logistics/cold-chain/devices');
    await c.shipments.coldChainBreaches({ hours: 48 });
    expect(calls[1].url).toContain('breaches?hours=48');
    await c.equipment.recordMaintenance('a1', { logType: 'service', performedOn: '2026-08-05', costMinor: '250000' });
    expect(calls[2].url).toContain('assets/a1/maintenance-logs');
    await c.equipment.maintenanceAlerts();
    expect(calls[3].url).toContain('maintenance/alerts');
  });
});

// --- aeps service events (PC-54 W54-13) ---
describe('aeps events', () => {
  it('records the log idempotently and never carries money-moving fields', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { recorded: true } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.ambassadors.recordAepsEvent({ serviceKind: 'cash_withdrawal', amountMinor: '500000', status: 'success', attemptNo: 1, deviceCertified: true, aadhaarLast4: '1234' }, 'idem-aeps-1');
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors/aeps/events');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-aeps-1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.aadhaarLast4).toHaveLength(4);          // masked-only doctrine
    expect(body).not.toHaveProperty('walletTxnId');     // a LOG, never a ledger primitive
  });
});

// --- licence reminders (PC-54 W54-14) ---
describe('expiring documents', () => {
  it('reads the self reminder feed', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [] } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.kyc.expiringDocuments(60);
    expect(calls[0].url).toBe('https://api.test/v1/kyc/expiring?days=60');
  });
});

// --- public tenant application (PC-55 A1) ---
describe('tenant-registration-public', () => {
  it('posts anonymously with an Idempotency-Key and never sends a bearer', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { reference: 'A1B2C3D4', status: 'submitted' } } }));
    // getToken IS the real token source (http.ts) — so a configured token here PROVES `anonymous: true` works.
    const c = createClient({ ...base, fetchImpl: fn, getToken: async () => 'must-not-be-sent' });
    const r = await c.tenancy.applyAsTenant({ orgName: 'Anand Farmer Producer Co', orgTypeOther: 'FPO', contactName: 'S Patel', contactPhone: '+919800000001' }, 'idem-ta-1');
    expect(calls[0].url).toBe('https://api.test/v1/tenant-applications');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h['idempotency-key']).toBe('idem-ta-1');
    expect(h['authorization']).toBeUndefined();          // anonymous: the public door carries no token
    expect(JSON.stringify(calls[0].init)).not.toContain('must-not-be-sent');
    expect(r.reference).toBe('A1B2C3D4');
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('tenantId');  // an applicant HAS no tenant
  });
});

// --- cod remittance ledger (PC-55 A2) ---
describe('cod-remittance-ledger', () => {
  it('creates idempotently, never types the total, and walks deposit→reconcile', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'rm1', status: 'collected', amountMinor: '450000', shipmentCount: 3 } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    const r = await c.shipments.createCodRemittance({ riderUserId: 'u1', expectedAmountMinor: '450000', reason: 'end of route banking' }, 'idem-cod-1'); // SW-a C2: audited with a reason
    expect(calls[0].url).toBe('https://api.test/v1/shipments/cod/remittances');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-cod-1');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty('amountMinor');       // the total is SERVER-computed, never sent
    expect(body.expectedAmountMinor).toBe('450000');      // only an optimistic check may be sent
    expect(typeof r.amountMinor).toBe('string');          // money stays a minor STRING (Law 2)
    await c.shipments.depositCodRemittance('rm1', { depositRef: 'UTR12345', depositMethod: 'bank_branch' });
    expect(calls[1].url).toContain('remittances/rm1/deposit');
    await c.shipments.reconcileCodRemittance('rm1', 'matched bank statement');
    expect(calls[2].url).toContain('remittances/rm1/reconcile');
    await c.shipments.cancelCodRemittance('rm1', 'mis-keyed batch');
    expect(JSON.parse(String(calls[3].init.body)).reason).toBe('mis-keyed batch');
  });
});

// --- dbt bounce ledger (PC-55 A3) ---
describe('dbt-bounce-ledger', () => {
  it('records a bounce idempotently without ever sending the amount, and reads the honest PFMS state', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 'b1', transferId: 't1', amountMinor: '600000', resolution: 'open' } } }
      : { body: { data: { byScheme: [], pfms: { provider: 'noop', available: false, note: 'PFMS provider integration is pending', fetchedAt: 'x', pulledRecords: 0 } } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const b = await c.schemes.recordDbtBounce('t1', { reasonCode: 'account_closed', bouncedOn: '2026-08-05' }, 'idem-bnc-1');
    expect(calls[0].url).toBe('https://api.test/v1/schemes/applications/dbt/t1/bounce');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-bnc-1');
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('amountMinor');  // the credit's own amount
    expect(typeof b.amountMinor).toBe('string');
    const desk = await c.schemes.dbtBounceDesk();
    expect(desk.pfms.available).toBe(false);          // never claims a recon that did not happen
    expect(desk.pfms.provider).toBe('noop');
  });
});

// --- mgnrega works & the 100-day ledger (PC-55 A4) ---
describe('mgnrega-works', () => {
  it('records a muster idempotently and reads a ledger that names the state as authoritative', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 'm1', observedDays: 12.5 } } }
      : { body: { data: { guaranteeDays: 100, observedByPlatform: { days: 12.5, musterCount: 13 }, daysRemaining: 88, authoritative: 'state_ledger', stateLedger: { provider: 'noop', available: false, note: 'NREGASoft state-ledger sync is pending', daysUsedFy: null } } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.labour.recordMgnregaMuster({ workId: 'w1', jobCardId: 'jc1', attendedOn: '2026-08-05', dayFraction: 0.5 }, 'idem-mus-1');
    expect(calls[0].url).toBe('https://api.test/v1/labour/mgnrega/musters');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-mus-1');
    const led = await c.labour.mgnregaCardLedger('jc1');
    expect(led.guaranteeDays).toBe(100);
    expect(led.authoritative).toBe('state_ledger');     // the platform never claims to be the source of truth
    expect(led.stateLedger.available).toBe(false);      // and never fakes a sync
  });
});

// --- d2c delivery runs & statement (PC-55 A5) ---
describe('d2c-delivery-runs', () => {
  it('settles a drop by (id,date) and reads a statement that says it is NOT an invoice', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 'd1', dueOn: '2026-08-05', status: 'delivered', billable: true } } }
      : { body: { data: { period: { from: '2026-08-01', to: '2026-08-31' }, lines: [], grandTotalMinor: '186000', billing: { mode: 'monthly_postpaid', charged: false, note: 'This is a statement of delivered drops, not an invoice.' } } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.dairy.markD2cDelivered('d1', { dueOn: '2026-08-05', qty: '1.000' });
    expect(calls[0].url).toBe('https://api.test/v1/dairy/d2c/deliveries/d1/delivered');
    expect(JSON.parse(String(calls[0].init.body)).dueOn).toBe('2026-08-05');   // partition key always sent
    const st = await c.dairy.d2cStatement({ box: 'customer' });
    expect(st.billing.charged).toBe(false);            // never claims money was taken
    expect(typeof st.grandTotalMinor).toBe('string');  // Law 2 — minor-unit string
  });
});

// --- ops alert rules (PC-55 A6) ---
describe('ops-alert-rules', () => {
  it('creates a rule with recipients and reads the fired feed', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 'r1', kind: 'cold_chain_breach', threshold: { windowHours: 6, minBreaches: 1 } } } }
      : { body: { data: [] } });
    const c = createClient({ ...base, fetchImpl: fn });
    const r = await c.shipments.createAlertRule({ kind: 'cold_chain_breach', ruleName: 'Reefer breaches', recipientUserIds: ['00000000-0000-7000-8000-000000000001'] });
    expect(calls[0].url).toBe('https://api.test/v1/logistics/cold-chain/alert-rules');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.recipientUserIds).toHaveLength(1);        // a rule always names humans, never "everyone"
    expect(r.threshold.windowHours).toBe(6);              // server applied its defaults
    await c.shipments.alertFeed({ unacknowledgedOnly: true });
    expect(calls[1].url).toContain('alerts/feed?unacknowledgedOnly=true');
  });
});

// --- rider payout terms & statement (PC-55 A7) ---
describe('rider-payout-terms', () => {
  it('refuses to imply payment, exposes minor strings, and never lets a client price its own pay', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { id: 't1', effectiveFrom: '2026-08-06', scope: 'tenant_default' } } }
      : { body: { data: { riderUserId: 'u1', period: { from: '2026-08-01', to: '2026-08-31' }, currencyCode: 'INR', activeTerms: { id: 't1', termsName: 'Standard', effectiveFrom: '2026-08-01', perDropMinor: '2000', pctOfChargeBps: 0, codHandlingMinor: '500', failedAttemptMinor: '500', scope: 'tenant_default' }, lines: [], deliveredCount: 12, failedCount: 1, totalMinor: '25500', unpriced: [], settlement: { paid: false, note: 'Nothing here has been paid yet' } } } });
    const c = createClient({ ...base, fetchImpl: fn });
    await c.shipments.createRiderPayoutTerms({ termsName: 'Standard', perDropMinor: '2000', effectiveFrom: '2026-08-06' });
    expect(calls[0].url).toBe('https://api.test/v1/shipments/rider-payout-terms');
    const st = await c.shipments.myRiderPayoutStatement();
    expect(calls[1].url).toContain('riders/me/payout-statement');
    expect(st.settlement.paid).toBe(false);            // never claims money moved
    expect(typeof st.totalMinor).toBe('string');       // Law 2 — minor-unit string
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).not.toHaveProperty('totalMinor');     // a client never supplies an earned figure
  });
});

// --- coop payout runs (PC-55 A8) · two acts (PC-56 TENANT-9b) ---
describe('coop-payout-runs', () => {
  it('the MAKER prepares and a DIFFERENT caller confirms — no checker uuid in anybody\'s body, no amounts sent', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'run1', batchId: 'b1', status: 'queued', purpose: 'dividend', queuedTotalMinor: '9800000', queuedCount: 98, skipped: [{ userId: 'u9', reason: 'skipped_no_bank_account' }], execution: { executed: false, note: 'Payouts are QUEUED' } } } }));
    const c = createClient({ ...base, fetchImpl: fn });
    await c.memberships.coopPayoutPrepare('res1', 'idem-coop-1');
    expect(calls[0].url).toBe('https://api.test/v1/governance/resolutions/res1/payout-run');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-coop-1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({});        // no confirmedBy, no potMinor — the vote decides
    const r = await c.memberships.coopPayoutConfirm('run1', 'idem-coop-2');
    expect(calls[1].url).toBe('https://api.test/v1/governance/resolutions/payout-runs/run1/confirm');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({});
    expect(r.execution.executed).toBe(false);             // never claims money moved
    expect(r.skipped[0].reason).toBe('skipped_no_bank_account');  // a skipped member is named, not dropped
    await c.memberships.coopPayoutCancel('run1', 'roll changed before confirm', 'idem-coop-3');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ reason: 'roll changed before confirm' });
    expect('coopPayoutRun' in c.memberships).toBe(false);
  });
});

// --- loan disbursement batches (PC-55 A9) ---
describe('loan-disbursement-batches', () => {
  it('holds back cooling-off loans, needs a second human, and never claims a borrower was paid', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { candidates: 5, queued: 3, totalMinor: '15000000', skipped: [{ applicationId: 'a4', reason: 'cooling_off', coolingOffUntil: '2026-08-07T10:00:00.000Z' }, { applicationId: 'a5', reason: 'no_bank_account' }], lines: [], note: 'Preview only' } } }
      : n === 2
      ? { body: { data: { id: 'run1', batchId: 'b1', queuedTotalMinor: '15000000', queuedCount: 3, skipped: [], execution: { executed: false, note: 'Loans are QUEUED' } } } }
      : { body: { data: { executed: false, reason: 'Payout rail is not configured', itemsProcessed: 0 } } });
    const c = createClient({ ...base, fetchImpl: fn });
    const prev = await c.fintech.disbursementPreview();
    expect(calls[0].url).toContain('disbursement-preview');
    expect(prev.skipped[0].reason).toBe('cooling_off');
    expect(prev.skipped[0].coolingOffUntil).toBeDefined();   // the borrower's protection is visible, with its clock
    const run = await c.fintech.createDisbursementRun({ confirmedBy: '00000000-0000-7000-8000-000000000002' }, 'idem-disb-1');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-disb-1');
    expect(JSON.parse(String(calls[1].init.body)).confirmedBy).toBeDefined();  // maker-checker in the contract
    expect(run.execution.executed).toBe(false);
    const ex = await c.fintech.executeDisbursementRun('run1');
    expect(ex.executed).toBe(false);                          // refuses honestly without the payout rail
    expect(ex.reason.toLowerCase()).toContain('not configured');
  });
});

// --- partner API realm (PC-55 A10) ---
describe('partner-api realm', () => {
  it('never sends a user bearer token, carries the API key from getHeaders, and parses the cursor page', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'loan-1', tenantId: 't1', borrowerUserId: 'u1', principalMinor: '5000000', interestAprBps: 900, disbursedAt: '2026-07-01', maturityDate: null, status: 'active', outstandingMinor: '4200000', nextDueDate: '2026-09-01' }], meta: { nextCursor: 'loan-1', limit: 1 } } }));
    const c = createClient({
      ...base, fetchImpl: fn,
      // A real user token EXISTS on this client; the partner realm must still not attach it (a partner call has no
      // user session — sending one would let a leaked token authenticate a machine route).
      getToken: async () => 'must-not-be-sent',
      getHeaders: () => ({ 'X-Partner-Key': 'kv_pk_test_abcdef0123456789.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' }),
    });
    const page = await c.partnerApi.loans({ status: 'active', limit: 1 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe('https://api.test/v1/partner-api/lending/loans?status=active&limit=1');
    expect(headers.authorization).toBeUndefined();                       // no bearer on a partner call
    // The SDK normalises extra header names to lower case (http.ts headers()); Express does the same on the API
    // side, so the guard reads req.headers['x-partner-key'] — the two ends agree by construction.
    expect(headers['x-partner-key']).toContain('kv_pk_test_');           // the credential the guard reads
    expect(page.rows[0].outstandingMinor).toBe('4200000');
    expect(typeof page.rows[0].outstandingMinor).toBe('string');         // money stays a minor-unit string (Law 2)
    expect(page.nextCursor).toBe('loan-1');
    expect(page.limit).toBe(1);
  });

  it('me() proves a credential without reading a farmer record; a short page ends the cursor loop', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: { partnerId: 'p1', keyId: 'k1', scopes: ['partner:identity:read', 'insurance:book:read'], rateLimitPerHour: 1000, capabilities: 'read-only' } } }
      : { body: { data: [{ id: 'pol-1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: 'P/1', subjectType: 'animal', subjectId: 'a1', status: 'active', sumInsuredMinor: '3000000', premiumMinor: '90000', validFrom: '2026-04-01', validUntil: '2027-03-31' }], meta: { nextCursor: null, limit: 50 } } });
    const c = createClient({ ...base, fetchImpl: fn, getHeaders: () => ({ 'X-Partner-Key': 'kv_pk_live_abcdef0123456789.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy' }) });
    const me = await c.partnerApi.me();
    expect(calls[0].url).toBe('https://api.test/v1/partner-api/me');
    expect(me.capabilities).toBe('read-only');                            // the realm advertises no write power
    const page = await c.partnerApi.policies();
    expect(calls[1].url).toBe('https://api.test/v1/partner-api/insurance/policies');
    expect(page.nextCursor).toBeNull();                                    // stop condition, no fake total
  });
});

// PC-56 TENANT-8a · THE OVERRIDE — every route has its method (F-14's discipline), keyed writes carry the key.
describe('notification template overrides (TENANT-8a)', () => {
  it('reads W180 with its live summary from meta, and W181 by template id', async () => {
    const summary = { eventsTotal: 68, lockedEvents: 31, eventsWithoutTemplate: ['bid.won'], whatsappServing: 0, whatsappEvents: 5, platformRows: 224, platformServing: 200, overrideRows: 0, overridesServing: 0, versionsOpen: 0, versionsAtProvider: 0 };
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/templates?') ? { body: { data: [], meta: { nextCursor: null, summary, canAuthor: true, canApprove: false } } } : { body: { data: { slot: {} } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const idx = await c.notifications.templateIndex({ eventCode: 'order.', only: 'overrides', limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/notifications/templates?eventCode=order.&only=overrides&limit=20');
    expect(idx).toEqual({ items: [], nextCursor: null, summary, canAuthor: true, canApprove: false });
    await c.notifications.templateView('t 1');
    expect(calls[1].url).toBe('https://api.test/v1/notifications/templates/t%201');
  });
  it('previews without a key, saves a draft and acts WITH one', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.notifications.previewTemplate({ eventCode: 'order.confirmed', channel: 'push' });
    await c.notifications.saveTemplateDraft({ eventCode: 'order.confirmed', channel: 'push', languageCode: 'gu', body: 'b', reason: 'why' }, 'idem-d');
    await c.notifications.templateActs('t1', 'a reason');
    await c.notifications.templateAct('t1', 'approve', { reason: 'reads well', versionId: 'v1' }, 'idem-a');
    await c.notifications.templateCatalogue(); await c.notifications.templateLanguages();
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    expect(calls[0].url).toBe('https://api.test/v1/notifications/templates/preview'); expect(h(0)).toBeUndefined();
    expect(calls[1].init.method).toBe('POST'); expect(calls[1].url).toBe('https://api.test/v1/notifications/templates'); expect(h(1)).toBe('idem-d');
    expect(calls[2].url).toBe('https://api.test/v1/notifications/templates/t1/acts?reason=a+reason');
    expect(calls[3].url).toBe('https://api.test/v1/notifications/templates/t1/acts/approve'); expect(h(3)).toBe('idem-a');
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ reason: 'reads well', versionId: 'v1' });
    expect(calls[4].url).toBe('https://api.test/v1/notifications/templates/catalogue');
    expect(calls[5].url).toBe('https://api.test/v1/notifications/templates/languages');
    // PC-27's inert writer is gone from the surface.
    expect((c.notifications as unknown as Record<string, unknown>).upsertTemplate).toBeUndefined();
    expect((c.notifications as unknown as Record<string, unknown>).listTemplates).toBeUndefined();
  });
});

// PC-56 TENANT-8b · THE INBOX — every route has its method; the acts carry the FORM's key; `at` rides exact.
describe('the inbox (TENANT-8b)', () => {
  it('reads the inbox with its GET-form filters, the zone and today from meta; the bell, the ladder, the matrix, the filters', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/notifications?') ? { body: { data: [{ id: 'n1' }], meta: { nextCursor: 'c2', zone: 'Asia/Kolkata', today: '2026-10-01' } } } : { body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const p = await c.notifications.inboxPage({ state: 'unread', tier: 'critical', module: 'dispute', channel: 'sms', limit: 25 });
    expect(calls[0].url).toBe('https://api.test/v1/notifications?state=unread&tier=critical&module=dispute&channel=sms&limit=25');
    expect(p).toEqual({ items: [{ id: 'n1' }], nextCursor: 'c2', zone: 'Asia/Kolkata', today: '2026-10-01' });
    expect(await c.notifications.inbox({ unreadOnly: true })).toEqual({ items: [{ id: 'n1' }], nextCursor: 'c2' });   // the older callers' shape
    await c.notifications.bell(); await c.notifications.ladder('n 1', '2026-10-01T02:10:00.123456Z'); await c.notifications.matrix();
    await c.notifications.inboxFilters(); await c.notifications.deliveryHealth(); await c.notifications.readAllPreview();
    expect(calls.slice(2).map((x) => x.url)).toEqual([
      'https://api.test/v1/notifications/bell',
      'https://api.test/v1/notifications/n%201/ladder?at=2026-10-01T02%3A10%3A00.123456Z',
      'https://api.test/v1/notifications/matrix',
      'https://api.test/v1/notifications/filters',
      'https://api.test/v1/notifications/delivery-health',
      'https://api.test/v1/notifications/read-all',
    ]);
  });
  it('previews without a key; marks read / all read and writes preferences + quiet hours WITH the form\'s key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.notifications.previewQuietHours({ starts: '22:00', ends: '05:30' });
    await c.notifications.previewPreferences([{ eventCode: 'order.packed', channel: 'sms', isEnabled: false }]);
    await c.notifications.previewLanguage('gu');
    await c.notifications.markAllRead('idem-all');
    await c.notifications.markRead('n1', { at: '2026-10-01T02:10:00.123456Z', idempotencyKey: 'idem-one' });
    await c.notifications.setQuietHours({ starts: '22:00', ends: '05:30' }, 'idem-qh');
    await c.notifications.setPreferences([{ eventCode: 'order.packed', channel: 'sms', isEnabled: false }], 'idem-pr');
    await c.notifications.markRead('n2');
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'POST notifications/quiet-hours/preview', 'POST notifications/preferences/preview', 'POST notifications/language/preview',
      'POST notifications/read-all', 'POST notifications/n1/read', 'PUT notifications/quiet-hours', 'PUT notifications/preferences', 'POST notifications/n2/read',
    ]);
    expect([h(0), h(1), h(2)]).toEqual([undefined, undefined, undefined]);
    expect([h(3), h(4), h(5), h(6), h(7)]).toEqual(['idem-all', 'idem-one', 'idem-qh', 'idem-pr', undefined]);
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ at: '2026-10-01T02:10:00.123456Z' });
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ starts: '22:00', ends: '05:30' });   // no zone literal: blank → the cooperative's
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ languageCode: 'gu' });
  });
});

// PC-56 TENANT-8c · THE PAGES — every cms route has its method (F-14); reads carry no key, writes carry the FORM's.
describe('cms pages + FAQ (TENANT-8c)', () => {
  it('reads W175 (meta: counts, verbs, the reader fact), W176 by slug, one version, by-slug, the vocabulary, the FAQ', async () => {
    const meta = { nextCursor: 'about', counts: { byKind: { static: 1 }, byState: { published: 1 }, slugs: 1, platformOnly: 0 }, canAuthor: true, canPublish: false, reader: { surfaces: [], route: 'GET /v1/cms/pages/by-slug/:slug', gap: ['web-storefront', 'mobile'] } };
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/cms/pages?') ? { body: { data: [], meta } } : c.url.includes('/cms/faq?') || c.url.endsWith('/cms/faq') ? { body: { data: [{ slug: 'q' }], meta: { topics: [], tiles: { entries: 1 }, truncated: false, canAuthor: true, canPublish: true, reader: meta.reader } } } : { body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const idx = await c.cms.pages.list({ pageKind: 'policy', state: 'draft', languageCode: 'gu', limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/cms/pages?pageKind=policy&state=draft&languageCode=gu&limit=20');
    expect(idx).toEqual({ items: [], ...meta });
    await c.cms.pages.view('how to'); await c.cms.pages.get('p 1'); await c.cms.pages.bySlug('about'); await c.cms.pages.vocabulary();
    expect(calls.slice(1, 5).map((x) => x.url)).toEqual(['https://api.test/v1/cms/pages/slug/how%20to', 'https://api.test/v1/cms/pages/p%201', 'https://api.test/v1/cms/pages/by-slug/about', 'https://api.test/v1/cms/pages/vocabulary']);
    const faq = await c.cms.faq.list({ topic: 'payments' });
    expect(calls[5].url).toBe('https://api.test/v1/cms/faq?topic=payments');
    expect(faq.items).toEqual([{ slug: 'q' }]); expect(faq.tiles).toEqual({ entries: 1 });
    await c.cms.faq.get('q');
    expect(calls[6].url).toBe('https://api.test/v1/cms/pages/slug/q');
    expect(calls.every((x) => (x.init.headers as Record<string, string>)['idempotency-key'] === undefined)).toBe(true);
  });
  it('previews and judges without a key; every write and act WITH the form\'s key; the FAQ fixes its kind', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    await c.cms.pages.preview({ slug: 'about', intent: 'new' });
    await c.cms.pages.create({ slug: 'about', pageKind: 'static', expect: 'new_page:1' }, 'idem-c');
    await c.cms.pages.update('d1', { slug: 'about', body: '# x' }, 'idem-u');
    await c.cms.pages.acts('d1', { reason: 'a reason', archiveReason: 'outdated' });
    await c.cms.pages.publish('d1', { reason: 'ok' }, 'idem-p');
    await c.cms.pages.archive('d1', { reason: 'old', archiveReason: 'outdated' }, 'idem-a');
    await c.cms.pages.restore('d1', { reason: 'back' }, 'idem-r');
    await c.cms.faq.create({ slug: 'q', topic: 'payments' }, 'idem-f');
    await c.cms.faq.update('d2', { slug: 'q', topic: 'payments' }, 'idem-fu');
    await c.cms.faq.publish('d2', { reason: 'ok' }, 'idem-fp');
    await c.cms.faq.reorderPreview('q', 'up', 'why');
    await c.cms.faq.reorder({ slug: 'q', direction: 'down', reason: 'why' }, 'idem-m');
    expect(calls[0].url).toBe('https://api.test/v1/cms/pages/preview'); expect(h(0)).toBeUndefined();
    expect([calls[1].init.method, calls[1].url, h(1)]).toEqual(['POST', 'https://api.test/v1/cms/pages', 'idem-c']);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ slug: 'about', pageKind: 'static', expect: 'new_page:1' });
    expect([calls[2].init.method, calls[2].url, h(2)]).toEqual(['PATCH', 'https://api.test/v1/cms/pages/d1', 'idem-u']);
    expect(calls[3].url).toBe('https://api.test/v1/cms/pages/d1/acts?reason=a+reason&archiveReason=outdated'); expect(h(3)).toBeUndefined();
    expect([calls[4].url, h(4)]).toEqual(['https://api.test/v1/cms/pages/d1/publish', 'idem-p']);
    expect([calls[5].url, h(5)]).toEqual(['https://api.test/v1/cms/pages/d1/archive', 'idem-a']);
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ reason: 'old', archiveReason: 'outdated' });
    expect([calls[6].url, h(6)]).toEqual(['https://api.test/v1/cms/pages/d1/restore', 'idem-r']);
    expect(JSON.parse(String(calls[7].init.body))).toEqual({ slug: 'q', topic: 'payments', pageKind: 'faq', intent: 'new' });
    expect([calls[8].init.method, JSON.parse(String(calls[8].init.body)).pageKind, h(8)]).toEqual(['PATCH', 'faq', 'idem-fu']);
    expect([calls[9].url, h(9)]).toEqual(['https://api.test/v1/cms/pages/d2/publish', 'idem-fp']);
    expect(calls[10].url).toBe('https://api.test/v1/cms/faq/reorder?slug=q&direction=up&reason=why'); expect(h(10)).toBeUndefined();
    expect([calls[11].init.method, calls[11].url, h(11)]).toEqual(['POST', 'https://api.test/v1/cms/faq/reorder', 'idem-m']);
  });
});

// PC-56 TENANT-8d · THE BANNERS — every cms/banners route has its method (F-14); reads carry no key, writes the FORM's.
describe('cms banners (TENANT-8d)', () => {
  it('reads W173 (meta: counts, placements, the verb, the reader fact), W174, the vocabulary, the live box, the confirm steps — no key', async () => {
    const meta = { nextCursor: 'c1', counts: { byPhase: { live: 1 }, byPlacement: { home_hero: 1 }, total: 1 }, placements: [], canManage: true, reader: { surfaces: [], route: 'GET /v1/cms/banners/live', gap: ['mobile', 'web-storefront'] }, requiredLanguages: ['en', 'hi', 'gu'] };
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/cms/banners?') ? { body: { data: [], meta } } : c.url.includes('/cms/banners/live') ? { body: { data: [{ id: 'b' }], meta: { languageCode: 'gu', reader: meta.reader } } } : { body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const idx = await c.cms.banners.list({ phase: 'live', placement: 'home_hero', languageCode: 'gu', limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/cms/banners?phase=live&placement=home_hero&languageCode=gu&limit=20');
    expect(idx).toEqual({ items: [], ...meta });
    await c.cms.banners.get('b 1'); await c.cms.banners.vocabulary();
    const live = await c.cms.banners.live({ placement: 'home_hero' });
    expect(live).toEqual({ items: [{ id: 'b' }], languageCode: 'gu', reader: meta.reader });
    await c.cms.banners.acts('b1', 'a reason'); await c.cms.banners.slotPreview('b1', 'up', 'why');
    expect(calls.slice(1).map((x) => x.url)).toEqual([
      'https://api.test/v1/cms/banners/b%201', 'https://api.test/v1/cms/banners/vocabulary', 'https://api.test/v1/cms/banners/live?placement=home_hero',
      'https://api.test/v1/cms/banners/b1/acts?reason=a+reason', 'https://api.test/v1/cms/banners/slot?id=b1&direction=up&reason=why',
    ]);
    expect(calls.every((x) => (x.init.headers as Record<string, string>)['idempotency-key'] === undefined)).toBe(true);
  });
  it('previews without a key; every write and act WITH the form\'s key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    await c.cms.banners.preview({ placement: 'home_hero', headline_gu: 'શબ્દ' });
    await c.cms.banners.preview({ placement: 'wallet' }, 'b1');
    await c.cms.banners.create({ placement: 'home_hero', headline_gu: 'શબ્દ' }, 'idem-c');
    await c.cms.banners.update('b1', { placement: 'home_hero', expect: 'tok' }, 'idem-u');
    await c.cms.banners.activate('b1', { reason: 'goes live' }, 'idem-a');
    await c.cms.banners.pause('b1', { reason: 'stock out' }, 'idem-p');
    await c.cms.banners.resume('b1', { reason: 'back' }, 'idem-r');
    await c.cms.banners.archive('b1', { reason: 'season over' }, 'idem-x');
    await c.cms.banners.slotMove({ id: 'b1', direction: 'down', reason: 'why' }, 'idem-s');
    await c.cms.banners.click('b1');
    expect([calls[0].url, h(0)]).toEqual(['https://api.test/v1/cms/banners/preview', undefined]);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ placement: 'home_hero', headline_gu: 'શબ્દ' });
    expect([calls[1].url, h(1)]).toEqual(['https://api.test/v1/cms/banners/preview?id=b1', undefined]);
    expect([calls[2].init.method, calls[2].url, h(2)]).toEqual(['POST', 'https://api.test/v1/cms/banners', 'idem-c']);
    expect([calls[3].init.method, calls[3].url, h(3)]).toEqual(['PATCH', 'https://api.test/v1/cms/banners/b1', 'idem-u']);
    expect([4, 5, 6, 7].map((i) => [calls[i].url, h(i)])).toEqual([
      ['https://api.test/v1/cms/banners/b1/activate', 'idem-a'], ['https://api.test/v1/cms/banners/b1/pause', 'idem-p'],
      ['https://api.test/v1/cms/banners/b1/resume', 'idem-r'], ['https://api.test/v1/cms/banners/b1/archive', 'idem-x'],
    ]);
    expect(JSON.parse(String(calls[5].init.body))).toEqual({ reason: 'stock out' });
    expect([calls[8].init.method, calls[8].url, h(8)]).toEqual(['POST', 'https://api.test/v1/cms/banners/slot', 'idem-s']);
    expect([calls[9].init.method, calls[9].url, h(9)]).toEqual(['POST', 'https://api.test/v1/cms/banners/b1/click', undefined]);
  });
});

// PC-56 TENANT-8e · THE BROADCAST PLANE + WHATSAPP — every route has its method; reads carry no key, every write the FORM's
// (F-17); the list's meta is read as the API sends it (F-14: PC-27 typed a `recipients` field the API never returned).
describe('broadcasts + whatsapp (TENANT-8e)', () => {
  it('reads: the history with its meta, roles, receipt, acts, the hub, the policy — no key on any', async () => {
    const meta = { nextCursor: 'b9', byStatus: { sent: 2 }, zone: 'Asia/Kolkata', canSend: false };
    const { fn, calls } = fakeFetch((c) => (c.url.includes('/communication/broadcasts?') ? { body: { data: [{ id: 'b1', counts: { sent: 5 } }], meta } } : { body: { data: { ok: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.notifications.broadcasts({ status: 'sent', limit: 20 });
    expect(calls[0].url).toBe('https://api.test/v1/communication/broadcasts?status=sent&limit=20');
    expect(page).toEqual({ items: [{ id: 'b1', counts: { sent: 5 } }], nextCursor: 'b9', byStatus: { sent: 2 }, zone: 'Asia/Kolkata', canSend: false });
    expect('recipients' in page.items[0]).toBe(false);
    await c.notifications.broadcastRoles(); await c.notifications.broadcast('b 1'); await c.notifications.broadcastActs('b1', 'why'); await c.notifications.broadcastActs('b1');
    await c.notifications.whatsappHub(); await c.notifications.whatsappOptinPolicy();
    expect(calls.slice(1).map((x) => x.url)).toEqual([
      'https://api.test/v1/communication/broadcasts/roles', 'https://api.test/v1/communication/broadcasts/b%201',
      'https://api.test/v1/communication/broadcasts/b1/acts?reason=why', 'https://api.test/v1/communication/broadcasts/b1/acts',
      'https://api.test/v1/channels/whatsapp', 'https://api.test/v1/channels/whatsapp/optin-policy',
    ]);
    expect(calls.every((x) => (x.init.headers as Record<string, string>)['idempotency-key'] === undefined)).toBe(true);
  });
  it('previews without a key; draft, edit, send, cancel, export and the policy WITH the form\'s key; mobile\'s compose is draft-then-send on derived keys', async () => {
    const { fn, calls } = fakeFetch((c) => ({ body: { data: c.url.endsWith('/communication/broadcasts') ? { broadcast: { id: 'd1' } } : { broadcast: { id: 'd1', status: 'queued' } } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    await c.notifications.previewBroadcast({ title: 'T', body: 'B' });
    await c.notifications.previewBroadcast({ title: 'T' }, 'd1');
    await c.notifications.saveBroadcastDraft({ title: 'T', body: 'B' }, 'k-d');
    await c.notifications.saveBroadcastDraft({ title: 'T2' }, 'k-e', 'd1');
    await c.notifications.broadcastAct('d1', 'send', 'monday notice', 'k-s');
    await c.notifications.broadcastAct('d1', 'cancel', 'wrong day', 'k-c');
    await c.notifications.enqueueBroadcastsExport('k-x');
    await c.notifications.previewWhatsAppOptinPolicy({ sources: ['qr_till_card'] });
    await c.notifications.saveWhatsAppOptinPolicy({ sources: ['qr_till_card'], consentStatement: 'I agree to messages' }, 'k-p');
    expect([0, 1].map((i) => [calls[i].init.method, calls[i].url, h(i)])).toEqual([
      ['POST', 'https://api.test/v1/communication/broadcasts/preview', undefined], ['POST', 'https://api.test/v1/communication/broadcasts/d1/preview', undefined]]);
    expect([2, 3, 4, 5, 6].map((i) => [calls[i].init.method, calls[i].url, h(i)])).toEqual([
      ['POST', 'https://api.test/v1/communication/broadcasts', 'k-d'], ['PATCH', 'https://api.test/v1/communication/broadcasts/d1', 'k-e'],
      ['POST', 'https://api.test/v1/communication/broadcasts/d1/send', 'k-s'], ['POST', 'https://api.test/v1/communication/broadcasts/d1/cancel', 'k-c'],
      ['POST', 'https://api.test/v1/communication/broadcasts/export', 'k-x']]);
    expect(JSON.parse(String(calls[4].init.body))).toEqual({ reason: 'monday notice' });
    expect([calls[7].url, h(7)]).toEqual(['https://api.test/v1/channels/whatsapp/optin-policy/preview', undefined]);
    expect([calls[8].init.method, calls[8].url, h(8)]).toEqual(['PUT', 'https://api.test/v1/channels/whatsapp/optin-policy', 'k-p']);
    const n = calls.length;
    const sent = await c.tenancy.broadcast({ title: 'T', body: 'B', audienceRoleCode: 'farmer' }, 'k-m');
    expect([calls[n].url, h(n), calls[n + 1].url, h(n + 1)]).toEqual([
      'https://api.test/v1/communication/broadcasts', 'k-m:draft', 'https://api.test/v1/communication/broadcasts/d1/send', 'k-m:send']);
    expect(sent).toEqual({ id: 'd1', status: 'queued' });
  });
});

// --- PC-56 TENANT-9a · the KYC desk: every route has a method; reads keyless, writes with the page's key ---
describe('kyc desk (TENANT-9a)', () => {
  it('reads are keyless GETs/POST-previews; writes carry the Idempotency-Key the page minted', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: 'n1' } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.kyc.desk();
    const q = await c.kyc.deskQueue({ subjectKind: 'organisation', status: 'pending', expiringWithin: 30 });
    await c.kyc.deskCatalogue('u1');
    await c.kyc.deskPreview({ subjectKind: 'organisation', docTypeCode: 'pan_org', mediaId: 'm1' });
    await c.kyc.deskSubmit({ subjectKind: 'organisation', docTypeCode: 'pan_org', mediaId: 'm1' }, 'k-submit');
    await c.kyc.deskDocument('d1');
    await c.kyc.deskActPreview('d1', 'reject', { reasonCode: 'blurry_image' });
    await c.kyc.deskAct('d1', 'reveal', { note: 'reading the certificate before deciding' }, 'k-reveal');
    await c.kyc.review('d1', { decision: 'reject', reasonCode: 'blurry_image' }, 'k-legacy');
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'GET kyc/desk',
      'GET kyc/desk/queue?subjectKind=organisation&status=pending&expiringWithin=30&limit=25',
      'GET kyc/desk/catalogue?userId=u1',
      'POST kyc/desk/preview',
      'POST kyc/desk/documents',
      'GET kyc/desk/documents/d1',
      'POST kyc/desk/documents/d1/acts/reject/preview',
      'POST kyc/desk/documents/d1/acts/reveal',
      'POST kyc/d1/review',
    ]);
    expect([h(0), h(3), h(4), h(6), h(7), h(8)]).toEqual([undefined, undefined, 'k-submit', undefined, 'k-reveal', 'k-legacy']);
    expect(q.nextCursor).toBe('n1');
  });
});

describe('esg (TENANT-9d)', () => {
  it('reads are keyless; the review and the act verdict are keyless POSTs; every write carries the page\'s Idempotency-Key', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'd1', status: 'draft', rows: [], fact: null } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.esg.dashboard();
    await c.esg.method('one_member_one_vote');
    await c.esg.report();
    await c.esg.enqueueReport({ lang: 'gu' }, 'k-export');
    await c.esg.disclosureCatalogue();
    await c.esg.previewDisclosure({ metricCode: 'adulteration', texts: { en: 'words' } });
    await c.esg.previewDisclosure({ texts: { en: 'words' } }, 'd1');
    await c.esg.createDisclosure({ metricCode: 'adulteration', texts: { en: 'words' } }, 'k-create');
    await c.esg.disclosure('d1');
    await c.esg.updateDisclosure('d1', { texts: { en: 'more words' } }, 'k-edit');
    await c.esg.previewDisclosureAct('d1', 'publish', { note: 'board' });
    await c.esg.disclosureAct('d1', 'withdraw', { reasonCode: 'inaccurate', note: 'board' }, 'k-act');
    const h = (i: number) => (calls[i].init.headers as Record<string, string>)['idempotency-key'];
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'GET esg/dashboard', 'GET esg/methods/one_member_one_vote', 'GET esg/report', 'POST esg/report/exports', 'GET esg/disclosures/catalogue',
      'POST esg/disclosures/preview', 'POST esg/disclosures/preview', 'POST esg/disclosures', 'GET esg/disclosures/d1', 'PATCH esg/disclosures/d1',
      'POST esg/disclosures/d1/acts/publish/preview', 'POST esg/disclosures/d1/acts/withdraw',
    ]);
    expect(calls.map((_, i) => h(i))).toEqual([undefined, undefined, undefined, 'k-export', undefined, undefined, undefined, 'k-create', undefined, 'k-edit', undefined, 'k-act']);
    expect(JSON.parse(String(calls[6].init.body))).toEqual({ texts: { en: 'words' }, id: 'd1' });
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ lang: 'gu' });
  });
});
