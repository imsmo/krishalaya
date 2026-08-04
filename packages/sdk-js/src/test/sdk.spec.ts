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
    const rated = await c.support.submitCsat('tk1', 5);
    expect(calls[1].url).toBe('https://api.test/v1/support/tickets/tk1/csat');
    expect(rated.csatScore).toBe(5);
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

  it('tenantConfig.commissionRules GETs /v1/commission-rules; create POSTs with idempotency key, money stays string (P1-10)', async () => {
    const { fn, calls } = fakeFetch((_c, n) => n === 1
      ? { body: { data: [{ id: 'cr1', scope: 'tenant', categoryId: null, source: null, sellerRoleId: null, rateBps: 250, fixedMinor: '0', capMinor: null, platformShareBps: 100, chargedTo: 'seller', priority: 100, effectiveFrom: '2026-06-01', effectiveTo: null, isActive: true }], meta: { nextCursor: 'crc' } } }
      : { body: { data: { id: 'cr2', scope: 'tenant', categoryId: null, source: 'auction', sellerRoleId: null, rateBps: 300, fixedMinor: '0', capMinor: null, platformShareBps: 150, chargedTo: 'seller', priority: 100, effectiveFrom: null, effectiveTo: null, isActive: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const page = await c.tenantConfig.commissionRules({ activeOnly: true, includePlatformDefaults: false });
    expect(calls[0].url).toBe('https://api.test/v1/commission-rules?activeOnly=true&includePlatformDefaults=false');
    expect(calls[0].init.method).toBe('GET');
    expect(typeof page.items[0].fixedMinor).toBe('string');
    expect(page.nextCursor).toBe('crc');
    const created = await c.tenantConfig.createCommissionRule({ rateBps: 300, platformShareBps: 150, source: 'auction' }, 'idem-cr-1');
    expect(calls[1].url).toBe('https://api.test/v1/commission-rules');
    expect(calls[1].init.method).toBe('POST');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-cr-1');
    expect(created.scope).toBe('tenant');
  });

  it('tenantConfig delivery zones: list/create/update/setActive hit the right logistics/zones paths (P1-10)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { id: 'z1', defaultName: 'Pune metro', pincodes: ['411001'], regionIds: [], chargeDefinitionId: null, isActive: true } } }));
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.tenantConfig.deliveryZones({ activeOnly: true });
    expect(calls[0].url).toBe('https://api.test/v1/logistics/zones?activeOnly=true');
    await c.tenantConfig.createDeliveryZone({ defaultName: 'Pune metro', pincodes: ['411001'] }, 'idem-z-1');
    expect(calls[1].url).toBe('https://api.test/v1/logistics/zones');
    expect((calls[1].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-z-1');
    await c.tenantConfig.updateDeliveryZone('z1', { defaultName: 'Pune greater' });
    expect(calls[2].url).toBe('https://api.test/v1/logistics/zones/z1');
    expect(calls[2].init.method).toBe('PATCH');
    await c.tenantConfig.setDeliveryZoneActive('z1', false);
    expect(calls[3].url).toBe('https://api.test/v1/logistics/zones/z1/active');
    expect(calls[3].init.method).toBe('POST');
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ isActive: false });
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

  it('integrations: providers/list GET; connect POST (idem) sends the credential; disconnect DELETE (P1-11)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ code: 'razorpay', defaultName: 'Razorpay', category: 'payment', isActive: true }] } }
      : n === 2 ? { body: { data: [{ id: 'i1', providerCode: 'razorpay', providerName: 'Razorpay', category: 'payment', config: {}, connected: true, isActive: true }] } }
      : n === 3 ? { body: { data: { id: 'i2', providerCode: 'msg91', connected: true } } }
      : { body: { data: { providerCode: 'msg91', connected: false } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    await c.integrations.providers();
    expect(calls[0].url).toBe('https://api.test/v1/integrations/providers');
    const list = await c.integrations.list();
    expect(calls[1].url).toBe('https://api.test/v1/integrations');
    expect(list[0].connected).toBe(true);
    expect('secretRef' in (list[0] as unknown as Record<string, unknown>)).toBe(false);
    await c.integrations.connect({ providerCode: 'msg91', credential: 'rzp_live_secret', config: { sandbox: false } }, 'idem-int-1');
    expect(calls[2].url).toBe('https://api.test/v1/integrations');
    expect(calls[2].init.method).toBe('POST');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-int-1');
    expect(JSON.parse(calls[2].init.body as string).credential).toBe('rzp_live_secret');
    await c.integrations.disconnect('msg91');
    expect(calls[3].url).toBe('https://api.test/v1/integrations/msg91');
    expect(calls[3].init.method).toBe('DELETE');
  });

  it('webhooks: register returns the secret once; list masked; rotate/update/delete hit the right paths (P1-11)', async () => {
    const ep = { id: 'w1', url: 'https://hooks.acme.in/kv', eventTypes: ['order.created'], isActive: true };
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { ...ep, secret: 'whsec_ONCE' } } }
      : n === 2 ? { body: { data: [ep] } }
      : n === 3 ? { body: { data: { id: 'w1', secret: 'whsec_NEW' } } }
      : n === 4 ? { body: { data: { id: 'w1', ok: true } } }
      : { body: { data: { id: 'w1', ok: true } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });
    const created = await c.webhooks.register({ url: 'https://hooks.acme.in/kv', eventTypes: ['order.created'] });
    expect(calls[0].url).toBe('https://api.test/v1/webhooks');
    expect(calls[0].init.method).toBe('POST');
    expect(created.secret).toBe('whsec_ONCE');
    const list = await c.webhooks.list();
    expect(calls[1].url).toBe('https://api.test/v1/webhooks');
    expect('secret' in (list[0] as unknown as Record<string, unknown>)).toBe(false); // masked on reads
    const rot = await c.webhooks.rotateSecret('w1');
    expect(calls[2].url).toBe('https://api.test/v1/webhooks/w1/rotate-secret');
    expect(rot.secret).toBe('whsec_NEW');
    await c.webhooks.update('w1', { isActive: false });
    expect(calls[3].url).toBe('https://api.test/v1/webhooks/w1');
    expect(calls[3].init.method).toBe('PATCH');
    await c.webhooks.remove('w1');
    expect(calls[4].url).toBe('https://api.test/v1/webhooks/w1');
    expect(calls[4].init.method).toBe('DELETE');
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

  it('ambassadors admin: enroll → list → suspend → reinstate → earnings → payout (idem) → activateReferral → setTarget (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: { id: 'amb1', userId: 'u1', isActive: true } } }
      : n === 2 ? { body: { data: [{ id: 'amb1', userId: 'u1', isActive: true }], meta: { nextCursor: null } } }
      : n === 3 ? { body: { data: { id: 'amb1', isActive: false } } }
      : n === 4 ? { body: { data: { id: 'amb1', isActive: true } } }
      : n === 5 ? { body: { data: [{ id: 'e1', ambassadorId: 'amb1', amountMinor: '12000', payoutId: null }], meta: { nextCursor: null } } }
      : n === 6 ? { body: { data: { payoutId: 'po1', ambassadorId: 'amb1', paidMinor: '12000', earningCount: 1 } } }
      : n === 7 ? { body: { data: { id: 'r1', code: 'KV-ABC', status: 'activated' } } }
      : { body: { data: { id: 't1', ambassadorId: 'amb1', metric: 'onboardings', periodStart: '2026-07-01', periodEnd: '2026-07-31', targetValue: '25' } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    await c.ambassadors.enroll({ userId: 'u1', monthlyStipendMinor: '0' });
    expect(calls[0].url).toBe('https://api.test/v1/ambassadors');
    expect(calls[0].init.method).toBe('POST');
    await c.ambassadors.list({ activeOnly: true });
    expect(calls[1].url).toBe('https://api.test/v1/ambassadors?activeOnly=true&limit=50');
    await c.ambassadors.suspend('amb1');
    expect(calls[2].url).toBe('https://api.test/v1/ambassadors/amb1/suspend');
    await c.ambassadors.reinstate('amb1');
    expect(calls[3].url).toBe('https://api.test/v1/ambassadors/amb1/reinstate');
    const earn = await c.ambassadors.earnings('amb1', { unpaidOnly: true });
    expect(calls[4].url).toBe('https://api.test/v1/ambassadors/amb1/earnings?unpaidOnly=true&limit=50');
    expect(earn.items[0].amountMinor).toBe('12000');
    const po = await c.ambassadors.payout('amb1', 'idem-po');
    expect(calls[5].url).toBe('https://api.test/v1/ambassadors/amb1/payout');
    expect((calls[5].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-po');
    expect(po.paidMinor).toBe('12000');
    await c.ambassadors.activateReferral('r1');
    expect(calls[6].url).toBe('https://api.test/v1/ambassadors/referrals/r1/activate');
    await c.ambassadors.setTarget({ ambassadorId: 'amb1', metric: 'onboardings', periodStart: '2026-07-01', periodEnd: '2026-07-31', targetValue: '25' });
    expect(calls[7].url).toBe('https://api.test/v1/ambassadors/targets');
    expect(calls[7].init.method).toBe('POST');
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

  it('group-lots: create(idem) → pledge(idem) → ready → settle hit the right paths (P1-12)', async () => {
    const { fn, calls } = fakeFetch((_c, n) =>
      n === 1 ? { body: { data: [{ id: 'g1', status: 'pledging', productId: 'p1' }], meta: { nextCursor: null } } }
      : n === 2 ? { body: { data: { id: 'g1', status: 'pledging', pledges: [] } } }
      : n === 3 ? { body: { data: { id: 'g1', status: 'pledging', pledgedQuantity: '0.000' } } }
      : n === 4 ? { body: { data: { id: 'g1', status: 'pledging', pledgedQuantity: '25.000', progressBps: 2500 } } }
      : n === 5 ? { body: { data: { id: 'g1', status: 'ready' } } }
      : { body: { data: { id: 'g1', status: 'settled', settlement: { grossMinor: '100000', coordinationFeeMinor: '5000', netMinor: '95000', shares: [{ pledgeId: 'pl1', shareMinor: '95000' }] } } } });
    const c = createClient({ ...base, fetchImpl: fn, getToken: () => 'tok' });

    const lots = await c.groupLots.list({ box: 'mine', status: 'pledging' });
    expect(calls[0].url).toBe('https://api.test/v1/group-lots?box=mine&status=pledging&limit=50');
    expect(lots.items[0].id).toBe('g1');
    await c.groupLots.get('g1');
    expect(calls[1].url).toBe('https://api.test/v1/group-lots/g1');
    await c.groupLots.create({ productId: 'p1', targetQuantity: '100.000', unitCode: 'kg', pledgeDeadline: '2026-08-01T00:00:00.000Z', coordinationFeeBps: 500 }, 'idem-gl');
    expect(calls[2].url).toBe('https://api.test/v1/group-lots');
    expect(calls[2].init.method).toBe('POST');
    expect((calls[2].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-gl');
    const pledged = await c.groupLots.pledge('g1', { farmerUserId: 'f1', quantity: '25' }, 'idem-pl');
    expect(calls[3].url).toBe('https://api.test/v1/group-lots/g1/pledges');
    expect((calls[3].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-pl');
    expect(pledged.progressBps).toBe(2500);
    await c.groupLots.markReady('g1');
    expect(calls[4].url).toBe('https://api.test/v1/group-lots/g1/ready');
    const s = await c.groupLots.settle('g1', '100000');
    expect(calls[5].url).toBe('https://api.test/v1/group-lots/g1/settle');
    expect(calls[5].init.method).toBe('POST');
    expect(s.settlement.netMinor).toBe('95000');
    expect(s.settlement.shares[0].shareMinor).toBe('95000');
  });

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
