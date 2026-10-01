// apps/web-tenant/src/test/tenant9a-kyc-desk.spec.ts · PC-56 TENANT-9a · THE KYC DESK, in the console.
// The helpers; the pages' own promises read from their source (no client JS beyond the house uploader, the key in the FORM,
// every canon screen has a route); every list mirrored from the API's OWN source (a second copy would agree exactly once);
// and every key a page can ask for exists ×3 — the literal ones and every dynamic family.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_REFUSALS, DECISION_REASONS, DESK_ACTS, DESK_STATUSES, EXPIRING_WINDOWS, KYC_DESK_HREF, KYC_ME_HREF, KYC_REFUSED_BY_NAME, KYC_SUBMIT_HREF,
  MAX_NOTE, MIN_REVEAL_REASON, RENEWING_SOON_DAYS, SUBMIT_FIELDS, SUBMIT_REFUSALS, actHref, actKey, deskState, docHref, failureCodeKey, fieldKey,
  historyActKey, isDeskAct, isDeskStatus, orgStateKey, percentOf, queueFilters, queueHref, reasonKey, refusalCodesFrom, refusalKey, renewingSoon,
  statusKey, statusTone, subjectKindKey, submitHref, viaKey,
} from '../features/kyc/desk';

const three = (k: string) => { for (const [n, cat] of [['en', en], ['hi', hi], ['gu', gu]] as const) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/identity', rel), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]); };
const PAGES = ['app/kyc/page.tsx', 'app/kyc/loading.tsx', 'app/kyc/[docId]/page.tsx', 'app/kyc/submit/page.tsx', 'app/kyc/submit/actions.ts', 'app/kyc/[docId]/act/page.tsx', 'app/kyc/[docId]/act/actions.ts', 'app/kyc/me/page.tsx', 'app/kyc/me/actions.ts', 'app/kyc/me/loading.tsx'];

describe('routes (W121, W122, W2319–W2322, W2323–W2325) and the staff member\'s own page', () => {
  it('every canon screen has a route; the old self page lives at /kyc/me', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect([KYC_DESK_HREF, KYC_ME_HREF, KYC_SUBMIT_HREF]).toEqual(['/kyc', '/kyc/me', '/kyc/submit']);
    expect(docHref('a b')).toBe('/kyc/a%20b');
    expect(actHref('d1', 'reveal')).toBe('/kyc/d1/act?step=confirm&act=reveal');
    expect(submitHref()).toBe('/kyc/submit?step=edit');
    expect(submitHref({ subjectKind: 'organisation', docTypeCode: 'fssai_licence' })).toBe('/kyc/submit?step=edit&subjectKind=organisation&docTypeCode=fssai_licence');
    expect(submitHref({ subjectKind: 'user', userId: 'u1', docTypeCode: 'aadhaar' })).toBe('/kyc/submit?step=edit&subjectKind=user&userId=u1&docTypeCode=aadhaar');
  });
  it('the GET-form filters: unknown values are no filter, the cursor rides along', () => {
    expect(queueFilters({})).toEqual({});
    expect(queueFilters({ subjectKind: 'organisation', status: 'pending', docTypeCode: 'pan_org', roleCode: 'farmer', expiringWithin: '30', cursor: 'c1' }))
      .toEqual({ subjectKind: 'organisation', status: 'pending', docTypeCode: 'pan_org', roleCode: 'farmer', expiringWithin: 30, cursor: 'c1' });
    expect(queueFilters({ subjectKind: 'cow', status: 'approved', docTypeCode: 'DROP TABLE', roleCode: 'x;y', expiringWithin: '45', cursor: 'x'.repeat(401) })).toEqual({});
    expect(queueFilters({ status: ['pending', 'verified'] })).toEqual({});
    expect(queueHref({})).toBe('/kyc');
    expect(queueHref({ status: 'expired', expiringWithin: 60 }, 'n1')).toBe('/kyc?status=expired&expiringWithin=60&cursor=n1');
    expect(queueHref({ subjectKind: 'user', docTypeCode: 'aadhaar', roleCode: 'worker' })).toBe('/kyc?subjectKind=user&docTypeCode=aadhaar&roleCode=worker');
    expect(EXPIRING_WINDOWS).toEqual([30, 60, 90]);
  });
});

describe('the lists are the API\'s own', () => {
  it('statuses, acts, submit fields, refusals and the reason vocabulary', () => {
    expect([...DESK_STATUSES]).toEqual(['pending', 'verified', 'rejected', 'expired']);
    expect([...DESK_ACTS]).toEqual(listOf(api('domain/kyc-acts.ts'), 'KYC_ACTS = [', '] as const'));
    expect([...SUBMIT_FIELDS]).toEqual(listOf(api('domain/kyc-submit-review.ts'), 'SUBMIT_FIELDS = [', '] as const'));
    expect([...SUBMIT_REFUSALS]).toEqual(listOf(api('domain/kyc-submit-review.ts'), 'export type SubmitRefusalCode', ';'));
    expect([...ACT_REFUSALS]).toEqual(listOf(api('domain/kyc-acts.ts'), 'export type ActRefusal', ';'));
    const mig = fs.readFileSync(path.join(__dirname, '../../../../db/migrations/0180_kyc_desk.sql'), 'utf8');
    const block = mig.slice(mig.indexOf("SELECT 'kyc_decision_reason'"), mig.indexOf('AS v(code, name, meta, ord)', mig.indexOf("SELECT 'kyc_decision_reason'")));
    const vocab = [...block.matchAll(/\('([a-z_]+)',\s+'/g)].map((m) => m[1]);
    expect([...DECISION_REASONS]).toEqual(vocab);
    expect(MIN_REVEAL_REASON).toBe(Number(/MIN_REVEAL_REASON = (\d+)/.exec(api('domain/kyc-acts.ts'))![1]));
    expect(MAX_NOTE).toBe(Number(/MAX_NOTE = (\d+)/.exec(api('domain/kyc-acts.ts'))![1]));
  });
  it('type guards', () => {
    expect(isDeskStatus('pending')).toBe(true); expect(isDeskStatus('none')).toBe(false); expect(isDeskStatus(3)).toBe(false);
    expect(isDeskAct('reveal')).toBe(true); expect(isDeskAct('retry')).toBe(false);
  });
});

describe('what the desk says', () => {
  it('keys and tones; an unknown value is named "unknown", never a missing key', () => {
    expect(statusKey('verified')).toBe('kyc.desk.status.verified'); expect(statusKey('none')).toBe('kyc.desk.status.other');
    expect(orgStateKey('missing')).toBe('kyc.desk.org.state.missing'); expect(orgStateKey('weird')).toBe('kyc.desk.status.other');
    expect(actKey('request_more')).toBe('kyc.desk.act.request_more'); expect(actKey('retry')).toBe('kyc.desk.act.other');
    expect(historyActKey('expire')).toBe('kyc.desk.history.expire'); expect(historyActKey('x')).toBe('kyc.desk.act.other');
    expect(viaKey('expiry_job')).toBe('kyc.desk.via.expiry_job'); expect(viaKey('x')).toBe('kyc.desk.act.other');
    expect(subjectKindKey('organisation')).toBe('kyc.desk.subject.organisation'); expect(subjectKindKey('user')).toBe('kyc.desk.subject.user'); expect(subjectKindKey('x')).toBe('kyc.desk.subject.user');
    expect(failureCodeKey('MAKER_IS_CHECKER')).toBe('kyc.desk.refusal.MAKER_IS_CHECKER');
    expect(failureCodeKey('IDEMPOTENCY_IN_PROGRESS')).toBe('kyc.desk.refusal.unknown');
    expect(['verified', 'pending', 'rejected', 'expired', 'none'].map(statusTone)).toEqual(['ok', 'warn', 'bad', 'bad', 'muted']);
  });
  it('renewing soon = verified and lapsing within 90 days; the percentage floors and refuses a zero denominator', () => {
    expect(RENEWING_SOON_DAYS).toBe(90);
    expect(renewingSoon('verified', 79)).toBe(true); expect(renewingSoon('verified', 90)).toBe(true); expect(renewingSoon('verified', 91)).toBe(false);
    expect(renewingSoon('verified', 0)).toBe(true); expect(renewingSoon('verified', -1)).toBe(false); expect(renewingSoon('pending', 10)).toBe(false); expect(renewingSoon('verified', null)).toBe(false);
    expect(percentOf(1146, 1284)).toBe(89); expect(percentOf(0, 0)).toBeNull(); expect(percentOf(1, 3)).toBe(33); expect(percentOf(3, 3)).toBe(100); expect(percentOf(NaN, 3)).toBeNull();
  });
  it('the transport states and the refusal codes a failed write carries', () => {
    expect(deskState('KYC_NOT_FOUND', 404)).toBe('notFound'); expect(deskState(undefined, 404)).toBe('notEnabled');
    expect(deskState('KYC_DESK_RESTRICTED', 403)).toBe('restricted'); expect(deskState('KYC_DESK_RESTRICTED')).toBe('restricted'); expect(deskState('X', 500)).toBe('error');
    expect(refusalCodesFrom({ refusals: [{ code: 'MAKER_IS_CHECKER' }, { code: 'evil<script>' }, {}] }, 'x')).toEqual(['MAKER_IS_CHECKER']);
    expect(refusalCodesFrom(null, 'KYC_DESK_REFUSED')).toEqual(['KYC_DESK_REFUSED']);
    expect(refusalCodesFrom({ refusals: 'no' }, 'act')).toEqual(['act']);
  });
});

describe('the pages keep their promises', () => {
  const pages = PAGES.filter((p) => p.endsWith('.tsx'));
  it('server components only (the uploader is the one client component, by import), no inline handlers, logical CSS', () => {
    for (const p of pages) {
      const s = src(p);
      expect(s.includes("'use client'")).toBe(false);
      expect(/\son[A-Z][a-zA-Z]+=\{/.test(s)).toBe(false);
      expect(/(margin|padding)-(left|right)|text-align:\s*(left|right)|\bleft:|\bright:/.test(s)).toBe(false);
    }
  });
  it('every write carries the key the page minted (the review page, the confirm page, the self form)', () => {
    expect(src('app/kyc/submit/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(src('app/kyc/[docId]/act/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    expect(src('app/kyc/me/page.tsx')).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    for (const a of ['app/kyc/submit/actions.ts', 'app/kyc/[docId]/act/actions.ts', 'app/kyc/me/actions.ts']) expect(src(a)).toMatch(/formData\.get\('idempotencyKey'\)/);
  });
  it('the reviewer\'s words never travel in a success URL; Retry is a page load, never the chain', () => {
    expect(src('app/kyc/[docId]/act/actions.ts')).not.toMatch(/done\.set\('note'/);
    expect(src('app/kyc/page.tsx')).toMatch(/kyc\.desk\.refused\.retry/);
    expect(src('app/kyc/page.tsx')).not.toMatch(/act\?step=confirm&act=retry/);
  });
  it('the canon\'s unbacked promises are refused by name, each on the page that draws it', () => {
    for (const r of KYC_REFUSED_BY_NAME) three(`kyc.desk.refused.${r}`);
    const all = pages.map(src).join('\n');
    for (const r of KYC_REFUSED_BY_NAME) expect(all.includes(`kyc.desk.refused.${r}`)).toBe(true);
  });
});

describe('i18n — every key a page can ask for, ×3', () => {
  it('the literal keys', () => {
    for (const p of PAGES) for (const m of src(p).matchAll(/t\.t\('([a-zA-Z0-9_.]+)'/g)) three(m[1]);
  });
  it('every dynamic family', () => {
    for (const s of [...DESK_STATUSES, 'other']) three(`kyc.desk.status.${s}`);
    for (const s of ['verified', 'pending', 'rejected', 'expired', 'missing']) three(orgStateKey(s));
    for (const a of [...DESK_ACTS, 'other']) three(`kyc.desk.act.${a}`);
    for (const a of ['submit', 'verify', 'reject', 'request_more', 'expire', 'reveal']) three(historyActKey(a));
    for (const v of ['desk', 'submitter', 'ekyc', 'expiry_job']) three(viaKey(v));
    for (const f of SUBMIT_FIELDS) three(fieldKey(f));
    for (const r of DECISION_REASONS) three(reasonKey(r));
    for (const c of [...SUBMIT_REFUSALS, ...ACT_REFUSALS, 'KYC_DESK_RESTRICTED', 'KYC_NOT_FOUND', 'unknown']) three(refusalKey(c));
    for (const st of ['notEnabled', 'restricted', 'error', 'notFound']) { three(`kyc.desk.state.${st}.title`); three(`kyc.desk.state.${st}.body`); }
    for (const s of ['clean', 'pending', 'infected', 'failed', 'unknown']) three(`kyc.doc.scan.${s}`);
    for (const a of DESK_ACTS) three(`kyc.act.done.${a}`);
  });
});
