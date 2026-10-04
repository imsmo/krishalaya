// apps/web-tenant/src/test/tenant-swb.spec.ts · PC-56 TENANT-SW-b · AMBASSADOR PAY RUNS (W160/W161), ATTENDANCE REVIEW (W165), WAGE
// RUNS + ADVANCES (W166), THE SCHEMES DESK (W202/W203), in the console. The helpers; every list mirrored from the API's OWN source,
// the 0198 migration and the seeds (a second copy agrees exactly once); the pages' promises read from their source (no client JS
// beyond the shared RevealField, no raw phone, the key minted on the confirm page, the mutate chain imported, a reason required,
// flagged-off as words never a 404); every refused-by-name clause printed; every key ×3 with the same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ADVANCE_CAP_PCT, ADVANCE_RECOVERY_PCT, ADV_ACTS, ADV_CODES, ADV_FILTERS, ADV_STATUSES, ATTENDANCE_HREF, ATT_ACTS, ATT_CODES, ATT_FILTERS, ATT_METHODS, ATT_REFUSED_BY_NAME,
  BLOCKER_CODES, EARNINGS_HREF, PIPELINE_GROUPS, REJECTION_CODES, REVIEW_STATUSES, RUN_ACTS, RUN_CODES, RUN_LINE_STATUSES, RUN_REFUSED_BY_NAME, RUN_STATUSES, SCHEMES_DESK_HREF,
  SCHEME_CODES, SCHEME_REFUSED_BY_NAME, SWEEP_STATUSES, WAGES_HREF, WAGE_LINE_STATUSES, WAGE_REFUSED_BY_NAME, WAGE_RUN_STATUSES, advActHref, advActsFor, advStatusKey, attActHref,
  attActsFor, attFilterFrom, attHref, blockerKey, codesFromUrl, failureCodes, groupFrom, hoursFrom, isSchemeCode, methodKey, rejectionText, retryIsMutation, reviewStatusKey,
  runActHref, runActsFor, runLineStatusKey, runStatusKey, rupeesToPaise, schemeHref, sweepActHref, sweepStatusKey, swbCodeKey, swbState, wageLineKey, wageRunStatusKey,
} from '../features/swb/console';
import { AMB_ACTS, actsFor } from '../features/ambassadors/console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules', rel), 'utf8');
const repo = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../..', rel), 'utf8');
const listOf = (s: string, start: string, end = '] as const') => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]); };
const ID = '01a0c000-0000-7000-8000-0000000000a1';
const PAGES = [
  'app/people/ambassadors/earnings/page.tsx', 'app/people/ambassadors/earnings/act/page.tsx', 'app/people/ambassadors/earnings/act/actions.ts',
  'app/ops/labour/attendance/page.tsx', 'app/ops/labour/attendance/act/page.tsx', 'app/ops/labour/attendance/act/actions.ts',
  'app/ops/labour/wages/page.tsx', 'app/ops/labour/wages/act/page.tsx', 'app/ops/labour/wages/act/actions.ts',
  'app/ops/schemes/page.tsx', 'app/ops/schemes/actions.ts', 'app/ops/schemes/[code]/page.tsx', 'app/ops/schemes/[code]/act/page.tsx', 'app/ops/schemes/[code]/act/actions.ts',
];
const ACT_PAGES = ['app/people/ambassadors/earnings/act/page.tsx', 'app/ops/labour/attendance/act/page.tsx', 'app/ops/labour/wages/act/page.tsx', 'app/ops/schemes/[code]/act/page.tsx'];
const ACT_ACTIONS = ['app/people/ambassadors/earnings/act/actions.ts', 'app/ops/labour/attendance/act/actions.ts', 'app/ops/labour/wages/act/actions.ts', 'app/ops/schemes/[code]/act/actions.ts'];

describe('routes (W160, W161 + W2478–W2480, W165 + W2495–W2497, W166 + W2821–W2823, W202, W203 + W2751–W2753)', () => {
  it('every canon screen has a route; the hrefs are canonical', () => {
    for (const p of [...PAGES, 'app/people/ambassadors/[id]/page.tsx', 'app/people/ambassadors/[id]/act/page.tsx']) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect([EARNINGS_HREF, ATTENDANCE_HREF, WAGES_HREF, SCHEMES_DESK_HREF]).toEqual(['/people/ambassadors/earnings', '/ops/labour/attendance', '/ops/labour/wages', '/ops/schemes']);
    expect(runActHref('confirm', ID)).toBe(`/people/ambassadors/earnings/act?step=confirm&act=confirm&run=${ID}`);
    expect(runActHref('prepare')).toBe('/people/ambassadors/earnings/act?step=confirm&act=prepare');
    expect(attActHref('vouch', ID)).toBe(`/ops/labour/attendance/act?step=confirm&act=vouch&id=${ID}`);
    expect(attHref('needs_review', 'c2')).toBe('/ops/labour/attendance?status=needs_review&cursor=c2');
    expect(attHref('all')).toBe('/ops/labour/attendance');
    expect(advActHref('approve', ID)).toBe(`/ops/labour/wages/act?step=confirm&act=approve&id=${ID}`);
    expect(schemeHref('PM-KISAN')).toBe('/ops/schemes/PM-KISAN');
    expect(schemeHref('PM-KISAN', 'rejected_appealed', 'cx')).toBe('/ops/schemes/PM-KISAN?group=rejected_appealed&cursor=cx');
    expect(sweepActHref('PM-KISAN')).toBe('/ops/schemes/PM-KISAN/act?step=confirm&act=sweep');
  });
  it('the labour jobs screen now links Wage runs and Attendance (no longer drawn disabled); the sidebar carries the schemes desk', () => {
    const s = src('app/ops/labour/page.tsx');
    expect(s).toMatch(/<Link href=\{WAGES_HREF\}/);
    expect(s).toMatch(/<Link href=\{ATTENDANCE_HREF\}/);
    expect(s).not.toMatch(/aria-disabled="true"/);
    expect(src('components/Sidebar.tsx')).toContain(`key: 'schemes-desk', href: '/ops/schemes'`);
  });
});

describe('the lists are the API\'s own (and the migration\'s, and the seeds\')', () => {
  const mig = repo('db/migrations/0198_wages_ambassador_pay_schemes.sql');
  it('A · run + line statuses mirror domain/payout-run.ts; every run code is thrown by the trigger or the service', () => {
    const d = api('ambassadors/domain/payout-run.ts');
    expect([...RUN_STATUSES]).toEqual(listOf(d, 'export const RUN_STATUSES = ['));
    expect([...RUN_LINE_STATUSES]).toEqual(listOf(d, 'export const LINE_STATUSES = ['));
    const thrown = mig + api('ambassadors/domain/ambassadors.errors.ts') + api('ambassadors/services/payout-run.service.ts');
    for (const c of RUN_CODES.filter((x) => !['FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'].includes(x))) expect(`${c}:${thrown.includes(c)}`).toBe(`${c}:true`);
  });
  it('B · attendance filters mirror dto/swb.dto.ts; review statuses + methods mirror 0198; every code is the trigger\'s or the service\'s', () => {
    expect([...ATT_FILTERS]).toEqual(listOf(api('labour/dto/swb.dto.ts'), 'ATTENDANCE_REVIEW_FILTERS = ['));
    expect(mig).toMatch(/review_status[^\n]*'none', 'needs_review', 'vouched', 'refused'/);
    expect([...REVIEW_STATUSES]).toEqual(['none', 'needs_review', 'vouched', 'refused']);
    for (const m of ATT_METHODS) expect(mig).toContain(`'${m}'`);
    const thrown = mig + api('labour/domain/labour.errors.ts') + api('labour/services/attendance.service.ts');
    for (const c of ATT_CODES.filter((x) => !['FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'].includes(x))) expect(`${c}:${thrown.includes(c)}`).toBe(`${c}:true`);
  });
  it('C · wage line statuses mirror domain/wage-run.ts; run statuses + advance statuses mirror 0198; advance filters the DTO\'s; 25 % / 50 % the money module\'s', () => {
    expect([...WAGE_LINE_STATUSES]).toEqual(listOf(api('labour/domain/wage-run.ts'), 'export const WAGE_LINE_STATUSES = ['));
    expect(mig).toContain(`CHECK (status IN ('prepared', 'paid', 'partially_paid', 'failed'))`);
    expect([...WAGE_RUN_STATUSES]).toEqual(['prepared', 'paid', 'partially_paid', 'failed']);
    for (const s of ADV_STATUSES) expect(mig).toContain(`'${s}'`);
    expect([...ADV_FILTERS]).toEqual(listOf(api('labour/dto/swb.dto.ts'), 'ADVANCE_FILTERS = ['));
    const money = api('labour/domain/labour-money.ts');
    expect(money).toContain(`ADVANCE_RECOVERY_PCT = ${ADVANCE_RECOVERY_PCT}n`);
    expect(money).toContain(`ADVANCE_CAP_PCT = ${ADVANCE_CAP_PCT}n`);
    const thrown = mig + api('labour/domain/labour.errors.ts') + api('labour/services/worker-advance.service.ts');
    for (const c of ADV_CODES.filter((x) => !['FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'].includes(x))) expect(`${c}:${thrown.includes(c)}`).toBe(`${c}:true`);
  });
  it('D · pipeline groups + blockers mirror domain/scheme-desk.ts; rejection codes are seed 0026\'s eleven; sweep statuses 0198\'s; codes the desk\'s', () => {
    const d = api('schemes/domain/scheme-desk.ts');
    expect([...PIPELINE_GROUPS]).toEqual(listOf(d, 'export const PIPELINE_GROUPS = ['));
    for (const b of BLOCKER_CODES) expect(d).toContain(`code: '${b}'`);
    const seed = repo('db/seeds/core/0026_ui_messages_scheme_rejections.sql');
    expect([...REJECTION_CODES]).toEqual([...new Set([...seed.matchAll(/'scheme\.rejection\.label\.([a-z_]+)','en'/g)].map((m) => m[1]))]);
    for (const s of SWEEP_STATUSES) expect(mig).toContain(`'${s}'`);
    const thrown = api('schemes/services/scheme-desk.service.ts') + api('schemes/domain/schemes.errors.ts');
    for (const c of SCHEME_CODES.filter((x) => !['FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'].includes(x))) expect(`${c}:${thrown.includes(c)}`).toBe(`${c}:true`);
  });
});

describe('the helpers', () => {
  it('a run offers Prepare when none is open; Confirm/Refuse to a checker; only Refuse to its maker; Pay again on a partly paid / unfunded run, never to the maker', () => {
    expect(runActsFor(null)).toEqual(['prepare']);
    expect(runActsFor({ status: 'prepared', viewerIsMaker: false })).toEqual(['confirm', 'refuse']);
    expect(runActsFor({ status: 'prepared', viewerIsMaker: true })).toEqual(['refuse']);
    expect(runActsFor({ status: 'unfunded', viewerIsMaker: false })).toEqual(['pay']);
    expect(runActsFor({ status: 'partially_paid', viewerIsMaker: true })).toEqual([]);
    expect(runActsFor({ status: 'paid', viewerIsMaker: false })).toEqual([]);
    expect([...RUN_ACTS]).toEqual(['prepare', 'confirm', 'pay', 'refuse']);
    expect(retryIsMutation()).toBe(false);
  });
  it('W160: the roster offers Message to an active ambassador (and Pay out = prepare an exception run when owed)', () => {
    expect([...AMB_ACTS]).toContain('message');
    expect(actsFor({ isActive: true, owedMinor: '100' })).toEqual(['suspend', 'payout', 'message']);
  });
  it('an attendance row offers vouch/refuse when it needs review, confirm when clean or vouched, nothing when confirmed or refused', () => {
    const r = { confirmed: false, reviewStatus: 'none', clockOutAt: '2026-10-03T12:00:00Z', method: 'self' };
    expect(attActsFor(r)).toEqual(['confirm']);
    expect(attActsFor({ ...r, reviewStatus: 'needs_review' })).toEqual(['vouch', 'refuse']);
    expect(attActsFor({ ...r, reviewStatus: 'vouched' })).toEqual(['confirm']);
    expect(attActsFor({ ...r, reviewStatus: 'refused' })).toEqual([]);
    expect(attActsFor({ ...r, confirmed: true })).toEqual([]);
    expect(attActsFor({ ...r, clockOutAt: null })).toEqual([]);
    expect(attActsFor({ ...r, clockOutAt: null, method: 'paper_backfill', reviewStatus: 'vouched' })).toEqual(['confirm']);
    expect([...ATT_ACTS]).toEqual(['vouch', 'refuse', 'confirm', 'confirm_clean', 'backfill']);
    expect(attFilterFrom('nope')).toBe('all');
    expect(attFilterFrom('paper_backfill')).toBe('paper_backfill');
  });
  it('an advance offers approve/reject only while requested; acts are the three the API has (no write-off)', () => {
    expect(advActsFor({ status: 'requested' })).toEqual(['approve', 'reject']);
    expect(advActsFor({ status: 'recovering' })).toEqual([]);
    expect([...ADV_ACTS]).toEqual(['request', 'approve', 'reject']);
    expect(ADV_ACTS as readonly string[]).not.toContain('write_off');
  });
  it('money and hours: rupees → paise in integer arithmetic, zero refused; hours bounded', () => {
    expect(rupeesToPaise('250')).toBe('25000');
    expect(rupeesToPaise('1,250.5')).toBe('125050');
    expect(rupeesToPaise('0')).toBeNull();
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(hoursFrom('8', 0.5, 12)).toBe(8);
    expect(hoursFrom('7.5', 0.5, 12)).toBe(7.5);
    expect(hoursFrom('13', 0.5, 12)).toBeNull();
    expect(hoursFrom('x', 0, 8)).toBeNull();
  });
  it('codes: the API\'s refusal list when present, else its code; codes only; each chain\'s unknown is a sentence', () => {
    expect(failureCodes({ refusals: [{ code: 'ADVANCE_OVER_CAP' }, { code: 'ADVANCE_OVER_CAP' }] }, 'X')).toEqual(['ADVANCE_OVER_CAP']);
    expect(failureCodes(undefined, 'AMB_RUN_CHECKER_IS_MAKER')).toEqual(['AMB_RUN_CHECKER_IS_MAKER']);
    expect(failureCodes(undefined, 'bad code!')).toEqual(['unknown']);
    expect(codesFromUrl('A_B,<script>,C_D')).toEqual(['A_B', 'C_D']);
    expect(swbCodeKey('run', 'AMB_RUN_CHECKER_IS_MAKER')).toBe('swb.code.AMB_RUN_CHECKER_IS_MAKER');
    expect(swbCodeKey('att', 'AMB_RUN_CHECKER_IS_MAKER')).toBe('swb.code.unknown');
    expect(swbState('AUDITOR_READ_ONLY', 403)).toBe('restricted');
    expect(swbState(undefined, 404)).toBe('flaggedOff');
    expect(swbState('SCHEME_NOT_FOUND', 404)).toBe('notFound');
    expect(swbState(undefined, 500)).toBe('error');
  });
  it('schemes: groups default to the first tab; codes are plain; a rejection prints its label + fix in the console language, else English, else nothing', () => {
    expect(groupFrom('x')).toBe('under_verification');
    expect(isSchemeCode('PM-KISAN')).toBe(true);
    expect(isSchemeCode('../x')).toBe(false);
    expect(rejectionText({ code: 'window_missed', label: { en: 'L', gu: 'GL' }, fix: { en: 'F' } }, 'gu')).toEqual({ label: 'GL', fix: 'F' });
    expect(rejectionText({ code: 'other', label: {}, fix: {} }, 'hi')).toEqual({ label: null, fix: null });
  });
});

describe('the pages keep their promises (read from source)', () => {
  const all = () => [...PAGES, 'app/people/ambassadors/[id]/page.tsx', 'app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/[id]/act/actions.ts',
    'app/people/ambassadors/run/page.tsx', 'app/people/ambassadors/run/actions.ts'].map((p) => [p, src(p)] as const);
  it('no client JS, no inline handlers, no raw phone rendered, logical CSS only (the reveal is the shared RevealField)', () => {
    for (const [p, s] of all()) {
      expect(`${p}: ${/^'use client'/m.test(s)}`).toBe(`${p}: false`);
      expect(s).not.toMatch(/\bon(Click|Change|Submit)=/);
      expect(s).not.toMatch(/\{[A-Za-z.!]*\.phone\}/);
      expect(s).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/);
    }
    expect(src('app/ops/schemes/[code]/page.tsx')).toMatch(/import \{ RevealField \} from '..\/..\/..\/people\/RevealField'/);
  });
  it('the mutate chain is IMPORTED on every act page; THE KEY IS MINTED ON THE CONFIRM PAGE and read by the action', () => {
    for (const p of ACT_PAGES) {
      expect(src(p)).toMatch(/from '..\/(..\/)*features\/mutate\/chain'/);
      expect(src(p)).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    }
    for (const p of ACT_ACTIONS) expect(src(p)).toMatch(/formData\.get\('idempotencyKey'\)/);
  });
  it('a reason is required before Confirm is offered, on every chain', () => {
    expect(src('app/people/ambassadors/earnings/act/page.tsx')).toMatch(/offered && rs === 'ok' \?/);
    expect(src('app/ops/labour/attendance/act/page.tsx')).toMatch(/\{reasonOk && bfOk \?/);
    expect(src('app/ops/labour/wages/act/page.tsx')).toMatch(/rs === 'ok' && fieldsOk && !overCap \?/);
    expect(src('app/ops/schemes/[code]/act/page.tsx')).toMatch(/offered && rs === 'ok' \?/);
  });
  it('the run page does not offer Confirm to the maker, and says why (the database is the wall)', () => {
    const s = src('app/people/ambassadors/earnings/page.tsx');
    expect(s).toContain(`t.t('swb.run.makerCannotConfirm')`);
    expect(s).toMatch(/runActsFor\(run\)/);
    expect(en['swb.run.makerCannotConfirm']).toMatch(/database refuses/);
  });
  it('W160: "pays Friday" is printed from the run\'s own date, else "no run prepared"; the platform fee account is no longer the payer', () => {
    const s = src('app/people/ambassadors/[id]/page.tsx');
    expect(s).toContain(`row.pay.run.payDate`);
    expect(s).toContain(`t.t('swb.amb.pay.noRun')`);
    expect(en['amb.act.payoutFunding']).toMatch(/own Main wallet/);
    expect(en['amb.act.payoutFunding']).toMatch(/no longer pays/);
  });
  it('the reveal on the schemes desk returns the value and puts it nowhere else (no redirect, no revalidate)', () => {
    const s = src('app/ops/schemes/actions.ts');
    expect(s).not.toMatch(/redirect\(|revalidatePath\(/);
    expect(s).toMatch(/MIN_SCHEME_REVEAL_REASON/);
  });
  it('flagged off is WORDS on every route, never notFound()', () => {
    for (const [p, s] of all()) expect(`${p}: ${/notFound\(\)/.test(s)}`).toBe(`${p}: false`);
  });
  it('every refused-by-name clause is printed somewhere, in words', () => {
    const pages = all().map(([, s]) => s).join('\n');
    expect(pages).toContain('swb.run.refused.${k}'); for (const k of RUN_REFUSED_BY_NAME) three(`swb.run.refused.${k}`);
    expect(pages).toContain('swb.att.refused.${k}'); for (const k of ATT_REFUSED_BY_NAME) three(`swb.att.refused.${k}`);
    expect(pages).toContain('swb.wage.refused.${k}'); for (const k of WAGE_REFUSED_BY_NAME) three(`swb.wage.refused.${k}`);
    for (const k of SCHEME_REFUSED_BY_NAME) { three(`swb.scm.refused.${k}`); expect(pages).toContain(`swb.scm.refused.${k}`); }
  });
});

describe('i18n — every key a page can ask for exists ×3 with the same {vars}', () => {
  const literal = () => {
    const keys = new Set<string>();
    for (const [p, s] of [...PAGES, 'features/swb/console.ts', 'app/people/ambassadors/[id]/page.tsx', 'app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/run/page.tsx', 'app/ops/labour/page.tsx'].map((x) => [x, src(x)] as const)) {
      void p; for (const m of s.matchAll(/t\.t\(\s*'([^'$]+)'/g)) keys.add(m[1]);
    }
    return [...keys];
  };
  const families = (): string[] => [
    ...RUN_STATUSES.map(runStatusKey), runStatusKey('x'), ...RUN_LINE_STATUSES.map(runLineStatusKey), runLineStatusKey('x'),
    ...RUN_ACTS.flatMap((a) => [`swb.run.act.${a}`, `swb.run.rule.${a}`, `swb.run.notOffered.${a}`, `swb.run.done.${a}`]),
    'swb.run.kind.weekly', 'swb.run.kind.exception', 'swb.run.maker.job', 'swb.run.maker.person', 'swb.run.makerShort.job', 'swb.run.makerShort.person',
    'swb.run.funding.covers', 'swb.run.funding.short', 'swb.run.funding.coversShort', 'swb.run.funding.shortShort',
    ...ATT_FILTERS.map((f) => `swb.att.filter.${f}`), ...REVIEW_STATUSES.map(reviewStatusKey), reviewStatusKey('x'), ...ATT_METHODS.map(methodKey), methodKey('x'),
    ...ATT_ACTS.flatMap((a) => [`swb.att.act.${a}`, `swb.att.rule.${a}`, `swb.att.done.${a}`]), 'swb.att.fence.in', 'swb.att.fence.out', 'swb.att.confirmed', 'swb.att.unconfirmed',
    ...WAGE_LINE_STATUSES.map(wageLineKey), wageLineKey('x'), ...WAGE_RUN_STATUSES.map(wageRunStatusKey), wageRunStatusKey('x'),
    ...ADV_STATUSES.map(advStatusKey), advStatusKey('x'), ...ADV_FILTERS.map((f) => `swb.adv.filter.${f}`), ...ADV_ACTS.flatMap((a) => [`swb.adv.act.${a}`, `swb.adv.rule.${a}`, `swb.adv.done.${a}`]),
    'swb.adv.restricted', 'swb.adv.error',
    ...PIPELINE_GROUPS.map((g) => `swb.scm.group.${g}`), ...BLOCKER_CODES.map(blockerKey), blockerKey('x'), ...SWEEP_STATUSES.map(sweepStatusKey), sweepStatusKey('x'),
    ...['flaggedOff', 'restricted', 'notFound', 'error'].flatMap((s) => [`swb.scm.state.${s}.title`, `swb.scm.state.${s}.body`]),
    'swb.scm.active', 'swb.scm.inactive', 'swb.scm.eligibleApplied', 'swb.scm.eligibleCall', 'swb.scm.notEligible',
    'swb.scm.callList.title', 'swb.scm.callList.all', 'swb.scm.callList.onlyCalls', 'swb.scm.callList.showAll',
    ...RUN_CODES.map((c) => swbCodeKey('run', c)), ...ATT_CODES.map((c) => swbCodeKey('att', c)), ...ADV_CODES.map((c) => swbCodeKey('adv', c)), ...SCHEME_CODES.map((c) => swbCodeKey('scm', c)),
    ...AMB_ACTS.flatMap((a) => [`amb.act.${a}`, `amb.act.rule.${a}`, `amb.act.done.${a}`, `amb.act.notOffered.${a}`]), 'nav.schemesDesk',
  ];
  it('the literal keys', () => { for (const k of literal()) three(k); });
  it('every dynamic family', () => { for (const k of families()) three(k); });
  it('the {vars} agree in all three languages', () => {
    for (const k of [...literal(), ...families()]) {
      const want = vars(en[k as keyof typeof en] ?? '');
      for (const [, cat] of CATS) expect(`${k}:${vars(cat[k as keyof typeof cat] ?? '').join(',')}`).toBe(`${k}:${want.join(',')}`);
    }
  });
});
