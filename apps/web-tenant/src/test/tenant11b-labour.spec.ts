// apps/web-tenant/src/test/tenant11b-labour.spec.ts · PC-56 TENANT-11b — the console's labour logic (pure) and the page rules that
// must not drift: W163 / W164, the post-job chain W2657–W2660, the cancel chain W2650–W2653 and the job-act chain W2654–W2656 /
// W2661–W2663.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_CODES, ASSIGNMENT_STATUSES, BOOKING_STATUSES, CONSENT_CHANNELS, DECLARATIONS, FORM_REFUSALS, JOB_ACTS, SKILL_LEVELS, UNREACHABLE_STATUSES, WAGE_KINDS,
  actHref, codeKey, consentFrom, consentRefusal, consoleState, createBody, detailActs, escrowPreview, failureCodesFrom, jobEntries, plannedDays, retryIsMutation,
  reviewCancel, reviewJob, rupeesToMinor, shortfallFrom, statusKey, tabs, typeKeys,
} from '../features/labour/console';

const U = '0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';
const ok = { demandTypeCode: 'daily_multi', taskSkillId: U, regionId: U, skillLevel: 'unskilled', workersNeeded: '12', startDate: '2026-07-14', endDate: '2026-07-16',
  dailyHours: '8', wageKind: 'per_day', wage: '420', farmLat: '22.3', farmLng: '71.1' };
const cats = { en, hi, gu } as Record<string, Record<string, string>>;
const all = (key: string) => { for (const [l, c] of Object.entries(cats)) expect([l, key, typeof c[key]]).toEqual([l, key, 'string']); };

describe('W163 · tabs, rows and states', () => {
  it('tabs are the 7 reachable statuses with the API counts; the 5 unreachable are never drawn', () => {
    expect(tabs({ open: 7, paid: 296 }).map((x) => [x.status, x.count])).toEqual([['open', 7], ['accepted', 0], ['in_progress', 0], ['completed', 0], ['paid', 296], ['cancelled', 0], ['expired', 0]]);
    for (const s of UNREACHABLE_STATUSES) expect(tabs(null).some((x) => x.status === (s as string))).toBe(false);
  });
  it('flagged off is the API\'s 404; a missing job names itself; 403 is restricted', () => {
    expect(consoleState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(consoleState('BOOKING_NOT_FOUND', 404, true)).toBe('notFound');
    expect(consoleState('LABOUR_FORBIDDEN', 403)).toBe('restricted');
    expect(consoleState('X', 500)).toBe('error');
  });
  it('the type column reads the declarations; the detail offers only what viewerCan says', () => {
    expect(typeKeys({ womenOnly: true, declarations: { transport: true, meals: true, toilet: true, drinkingWater: false, womanSupervisor: false } }))
      .toEqual(['lab.type.womenOnly', 'lab.type.transport', 'lab.type.toilet', 'lab.type.meals']);
    expect(detailActs({ assign: true, confirmRoster: true, start: false, complete: false, pay: false })).toEqual(['confirmRoster']);
    expect(detailActs(null)).toEqual([]);
    expect(actHref('b', 'confirmDay', { assignmentId: 'a', workDate: '2026-07-14' })).toBe('/ops/labour/b/act?step=confirm&act=confirmDay&assignmentId=a&workDate=2026-07-14');
  });
});

describe('W2657 · the post-job review', () => {
  it('a full job passes against its floor; below the floor is refused; no floor is refused by name', () => {
    expect(reviewJob(jobEntries(ok), '38200')).toEqual([]);
    expect(reviewJob(jobEntries({ ...ok, wage: '380' }), '38200').map((r) => r.code)).toEqual(['WAGE_BELOW_FLOOR']);
    expect(reviewJob(jobEntries(ok), null).map((r) => r.code)).toEqual(['FLOOR_UNKNOWN']);
  });
  it('every invalid field is listed at once (not the first)', () => {
    const codes = reviewJob(jobEntries({ wage: 'x', dailyHours: '30', transportPickupTime: '06:30' }), undefined).map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['DEMAND_TYPE_REQUIRED', 'SKILL_REQUIRED', 'REGION_REQUIRED', 'SKILL_LEVEL_REQUIRED', 'WORKERS_INVALID', 'DATES_INVALID', 'HOURS_INVALID', 'WAGE_INVALID', 'LOCATION_INVALID', 'PICKUP_NEEDS_POINT']));
  });
  it('the desk needs the employer and a consent with evidence (otp is the check)', () => {
    expect(reviewJob(jobEntries({ ...ok, onBehalf: '1' }), '38200').map((r) => r.code)).toEqual(['EMPLOYER_REQUIRED', 'CONSENT_CHANNEL_REQUIRED']);
    expect(reviewJob(jobEntries({ ...ok, onBehalf: '1', employerUserId: U, consentChannel: 'voice' }), '38200').map((r) => r.code)).toEqual(['CONSENT_EVIDENCE_REQUIRED']);
    expect(reviewJob(jobEntries({ ...ok, onBehalf: '1', employerUserId: U, consentChannel: 'otp' }), '38200')).toEqual([]);
  });
  it('the create body: paise, declarations, the on-behalf consent', () => {
    const b = createBody(jobEntries({ ...ok, transportProvided: 'on', transportPickupPoint: 'Vanthali chowk', transportPickupTime: '06:30', toiletConfirmed: 'on', onBehalf: '1', employerUserId: U, consentChannel: 'otp' }));
    expect(b).toMatchObject({ wageOfferedMinor: '42000', workersNeeded: 12, dailyHours: 8, transportProvided: true, transportPickupPoint: 'Vanthali chowk', toiletConfirmed: true, onBehalf: { employerUserId: U, consent: { channel: 'otp' } } });
    expect(rupeesToMinor('4,840.50')).toBe('484050'); expect(rupeesToMinor('1.234')).toBe('invalid');
  });
  it('the escrow PREVIEW is the server\'s arithmetic — canon W164: 12 × 3 days × ₹420 + ₹20 = ₹15,140', () => {
    expect(escrowPreview({ workers: 12, startDate: '2026-07-14', endDate: '2026-07-16', dailyHours: '8', wageKind: 'per_day', rateMinor: '42000', feeMinor: '2000' }))
      .toEqual({ days: 3, wagesMinor: '1512000', feeMinor: '2000', totalMinor: '1514000' });
    expect(escrowPreview({ workers: 1, startDate: '2026-07-14', endDate: '2026-07-15', dailyHours: '7.5', wageKind: 'per_hour', rateMinor: '5000', feeMinor: null })?.wagesMinor).toBe('75000');
    expect(plannedDays('2026-02-27', '2026-03-01')).toBe(3);
  });
});

describe('W2650 · the cancel review', () => {
  const reasons = [{ code: 'rain_reschedule', textRequired: false }, { code: 'other', textRequired: true }];
  it('a listed reason passes; other needs words; the desk needs consent', () => {
    expect(reviewCancel({ reasonCode: 'rain_reschedule' }, reasons, false, {})).toEqual([]);
    expect(reviewCancel({ reasonCode: 'other' }, reasons, false, {}).map((r) => r.code)).toEqual(['CANCEL_TEXT_REQUIRED']);
    expect(reviewCancel({}, reasons, false, {}).map((r) => r.code)).toEqual(['CANCEL_REASON_REQUIRED']);
    expect(reviewCancel({ reasonCode: 'rain_reschedule' }, reasons, true, {}).map((r) => r.code)).toEqual(['CONSENT_CHANNEL_REQUIRED']);
  });
});

describe('W2654–W2656 · acts, failures and the shortfall', () => {
  it('codes map to sentences; the funds refusal carries the shortfall; retry is a page load', () => {
    expect(codeKey('EMPLOYER_FUNDS_UNAVAILABLE')).toBe('lab.code.EMPLOYER_FUNDS_UNAVAILABLE');
    expect(codeKey('WAGE_BELOW_FLOOR')).toBe('lab.refusal.WAGE_BELOW_FLOOR');
    expect(codeKey('nope')).toBe('lab.code.unknown');
    expect(failureCodesFrom(undefined, 403)).toEqual(['FORBIDDEN']); expect(failureCodesFrom('LABOUR_FORBIDDEN', 403)).toEqual(['LABOUR_FORBIDDEN']);
    expect(shortfallFrom({ shortMinor: '78000' })).toBe('78000'); expect(shortfallFrom({})).toBeNull();
    expect(retryIsMutation()).toBe(false);
    expect(consentRefusal({ consentChannel: 'otp' })).toBeNull(); expect(consentFrom({ consentChannel: 'written', consentMediaId: U })).toEqual({ channel: 'written', mediaId: U });
    expect(statusKey('accepted')).toBe('lab.status.accepted'); expect(statusKey('draft')).toBe('lab.status.unknown');
  });
});

describe('i18n · every dynamic family exists ×3', () => {
  it('statuses, kinds, levels, consents, fields, refusals, codes, acts, states', () => {
    for (const s of [...BOOKING_STATUSES, 'unknown']) all(`lab.status.${s}`);
    for (const s of ASSIGNMENT_STATUSES) all(`lab.astatus.${s}`);
    for (const k of [...WAGE_KINDS, 'unknown']) all(`lab.kind.${k}`);
    for (const l of SKILL_LEVELS) all(`lab.level.${l}`);
    for (const c of CONSENT_CHANNELS) all(`lab.consent.${c}`);
    for (const c of FORM_REFUSALS) all(`lab.refusal.${c}`);
    for (const c of ACT_CODES) all(`lab.code.${c}`);
    for (const a of JOB_ACTS) for (const f of ['', 'rule.', 'notOffered.', 'foot.', 'done.']) all(`lab.act.${f}${a}`);
    for (const s of ['flaggedOff', 'restricted', 'notFound', 'error']) for (const p of ['lab.state', 'lab.detail.state']) { all(`${p}.${s}.title`); all(`${p}.${s}.body`); }
    for (const d of DECLARATIONS.filter((x) => x !== 'womanSupervisor')) { all(`lab.dignity.${d}`); all(`lab.dignity.${d}Not`); }
    for (const r of ['rain_reschedule', 'not_needed', 'filled_offline', 'other', 'none']) all(`lab.reason.${r}`);
    for (const z of ['no_confirmed_attendance', 'task_paid_once']) all(`lab.zero.${z}`);
    for (const m of ['no_jobs_in_30d', 'no_job_fully_filled_in_30d']) all(`lab.kpi.median.${m}`);
    for (const f of ['demandTypeCode', 'taskSkillId', 'villageLabel', 'regionId', 'skillLevel', 'workersNeeded', 'startDate', 'endDate', 'startTime', 'dailyHours', 'wageKind', 'wage',
      'womenOnly', 'transportProvided', 'transportPickupPoint', 'transportPickupTime', 'mealsProvided', 'toiletConfirmed', 'drinkingWater', 'womanSupervisor', 'farmLat', 'farmLng',
      'respondByHours', 'notes', 'employerUserId', 'consentChannel', 'consentMediaId', 'reasonCode', 'reasonText']) all(`lab.field.${f}`);
  });
});

describe('the pages say what is true', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', 'app', p), 'utf8');
  it('/labour redirects to /ops/labour; the detail prints the refusals by name', () => {
    expect(read('labour/page.tsx')).toMatch(/redirect\(/);
    const detail = read('ops/labour/[id]/page.tsx');
    for (const k of ['lab.broadcast.refused', 'lab.roster.matchRefused', 'lab.fairnessFee.refused', 'lab.retention.refused', 'lab.dignity.payRule', 'lab.cost.capNotSet']) expect(detail).toContain(k);
    expect(read('ops/labour/page.tsx')).toContain("aria-disabled=\"true\"");
  });
  it('the canon\'s same-day fairness fee is refused, never computed; the escrow figures are the API\'s', () => {
    expect(en['lab.fairnessFee.refused']).toMatch(/no fairness fee today/);
    expect(read('ops/labour/[id]/cancel/page.tsx')).toContain('lab.fairnessFee.refused');
    expect(read('ops/labour/[id]/page.tsx')).not.toMatch(/BigInt\(/);
  });
});
