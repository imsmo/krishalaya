// apps/web-tenant/src/test/tenant-swc.spec.ts · PC-56 TENANT-SW-c · THE VERIFICATION DESK (W157/W158) AND THE TEAM (W183/W184), the
// person's own security page, the invite accept page and the 2FA step of /login, in the console. The pure helpers; every list mirrored
// from the API's OWN source (a second copy must agree); the pages' promises read from their source (one client component — the 2FA
// panel — and nothing else; the invite token never drawn; a reason on every access change; Retry a page load); every key ×3 with the
// same {vars}.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  CONFLICT_RELATIONS, INVITE_LANGUAGES, PAIR_CODES, PRIVILEGED_ACTION_PREFIXES, PURPOSES, REASON_MAX, REASON_MIN, SKIP_REASONS, STAFF_ACTS, SWC_CODES, TEAM_ACTS,
  TEAM_HREF, VERIFICATION_HREF, VERIFICATION_REFUSED_BY_NAME, ME_SECURITY_HREF, INVITE_ACCEPT_HREF, codesFrom, inviteStatusKey, isConflictRelation, isPrivilegedAction,
  isSkipReason, isStaffAct, isTeamAct, isUuid, knownPurposeKey, medianLabel, pairKey, parseCodes, reasonOk, recusalKey, relationKey, retryIsMutation, seatTile,
  sessionBoundVars, skipReasonKey, staffActHref, staffHref, swcCodeKey, swcPageState, teamActHref, twoFactorKey,
} from '../features/swc/console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules', rel), 'utf8');
const listOf = (s: string, start: string, end = '] as const') => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z0-9_.]+)'/g)].map((m) => m[1]); };
const VT = () => api('identity/domain/verification-team.ts');
const ID = '01a0c000-0000-7000-8000-0000000000a1';

const PAGES = [
  'app/people/verification/page.tsx', 'app/people/verification/actions.ts', 'app/people/verification/[id]/page.tsx', 'app/people/verification/[id]/claim-actions.ts',
  'app/settings/team/page.tsx', 'app/settings/team/team-actions.ts', 'app/settings/team/invite/page.tsx', 'app/settings/team/act/page.tsx',
  'app/settings/team/[id]/page.tsx', 'app/settings/team/[id]/act/page.tsx',
  'app/me/security/page.tsx', 'app/me/security/actions.ts', 'app/me/security/TwoFactorPanel.tsx', 'app/invite/page.tsx', 'app/login/page.tsx',
];
const TSX = PAGES.filter((p) => p.endsWith('.tsx'));

describe('routes (W157, W158, W183, W184, W2335–W2337) and the hrefs', () => {
  it('every screen has a route; the hrefs are canonical', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    expect([VERIFICATION_HREF, TEAM_HREF, ME_SECURITY_HREF, INVITE_ACCEPT_HREF]).toEqual(['/people/verification', '/settings/team', '/me/security', '/invite']);
    expect(staffHref('a b')).toBe('/settings/team/a%20b');
    expect(staffActHref(ID, 'remove', { assignmentId: 'x' })).toBe(`/settings/team/${ID}/act?act=remove&step=confirm&assignmentId=x`);
    expect(teamActHref('revoke_invite', { inviteId: 'i1' })).toBe('/settings/team/act?act=revoke_invite&step=confirm&inviteId=i1');
  });
  it('the sidebar links the desk at its new path, the team and my security', () => {
    const s = src('components/Sidebar.tsx');
    expect(s).toMatch(/href: '\/people\/verification'/);
    expect(s).toMatch(/nav\.staffTeam/);
    expect(s).toMatch(/href: '\/me\/security'/);
  });
  it('the two secret-bearing pages are no-store, no-referrer', () => {
    const h = src('features/webhooks/headers.ts');
    expect(h).toMatch(/'\/me\/security'/);
    expect(h).toMatch(/'\/invite'/);
  });
});

describe('the lists are the API\'s own', () => {
  it('skip reasons, relations, reason bounds, privileged prefixes, maker-checker pairs, refusal codes', () => {
    expect([...SKIP_REASONS]).toEqual(listOf(VT(), 'SKIP_REASONS = ['));
    expect([...CONFLICT_RELATIONS]).toEqual(listOf(VT(), 'CONFLICT_RELATIONS = ['));
    expect(REASON_MIN).toBe(Number(/REASON_MIN = (\d+)/.exec(VT())![1]));
    expect(REASON_MAX).toBe(Number(/REASON_MAX = (\d+)/.exec(VT())![1]));
    expect([...PRIVILEGED_ACTION_PREFIXES]).toEqual(listOf(VT(), 'PRIVILEGED_ACTION_PREFIXES = ['));
    const rules = VT().slice(VT().indexOf('MAKER_CHECKER_RULES'), VT().indexOf(']);', VT().indexOf('MAKER_CHECKER_RULES')));
    expect([...PAIR_CODES]).toEqual([...rules.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]));
    const errs = api('identity/domain/swc.errors.ts');
    const apiCodes = [...errs.slice(errs.indexOf('export const SWC_CODES'), errs.indexOf('});', errs.indexOf('export const SWC_CODES'))).matchAll(/^\s+([A-Z_]+): \{ status/gm)].map((m) => m[1]);
    expect(apiCodes.length).toBeGreaterThan(50);
    for (const c of apiCodes) expect(SWC_CODES as readonly string[]).toContain(c);
    // the desk's own refusal list carries the three SW-c codes, and the KYC flag gate stays the API's
    expect(src('features/kyc/desk.ts')).toMatch(/'KYC_RECUSED_DECLARED', 'KYC_RECUSED_ONBOARDER', 'CLAIMED_BY_OTHER'/);
  });
  it('the median rule is the API\'s, case for case', () => {
    const cases: Array<[number | null, ReturnType<typeof medianLabel>]> = [
      [null, null], [-1, null], [0, { value: 1, unit: 'minutes' }], [59, { value: 1, unit: 'minutes' }], [1800, { value: 30, unit: 'minutes' }],
      [3600, { value: 1, unit: 'hours' }], [86_400 * 2 - 1, { value: 48, unit: 'hours' }], [86_400 * 3, { value: 3, unit: 'days' }],
    ];
    for (const [s, want] of cases) expect(medianLabel(s)).toEqual(want);
    expect(VT()).toMatch(/seconds < 3600/);
    expect(VT()).toMatch(/86_?400 \* 2/);
  });
});

describe('the pure helpers', () => {
  it('guards and keys', () => {
    expect(isUuid(ID)).toBe(true); expect(isUuid('x')).toBe(false);
    expect(isSkipReason('language')).toBe(true); expect(isSkipReason('bored')).toBe(false);
    expect(isConflictRelation('household')).toBe(true); expect(isConflictRelation('surname')).toBe(false);
    expect(isTeamAct('retry')).toBe(true); expect(isTeamAct('delete')).toBe(false);
    expect(isStaffAct('confirm_proposal')).toBe(true); expect(isStaffAct('promote')).toBe(false);
    expect(recusalKey('KYC_RECUSED_ONBOARDER')).toBe('swc.recusal.onboarder'); expect(recusalKey('KYC_RECUSED_DECLARED')).toBe('swc.recusal.declared'); expect(recusalKey(null)).toBeNull();
    expect(knownPurposeKey('wage')).toBe('swc.purpose.wage'); expect(knownPurposeKey('bribe')).toBe('swc.purpose.other');
    expect(twoFactorKey('confirmed')).toBe('swc.tfa.confirmed'); expect(twoFactorKey('weird')).toBe('swc.tfa.not_enrolled');
    expect(pairKey('wage_advances')).toBe('swc.pair.wage_advances'); expect(pairKey('X!')).toBe('swc.pair.other');
    expect(inviteStatusKey('revoked')).toBe('swc.invite.status.revoked'); expect(inviteStatusKey('?')).toBe('swc.invite.status.pending');
    expect(relationKey('x')).toBe('swc.relation.other'); expect(skipReasonKey('x')).toBe('swc.skip.other');
    expect(swcCodeKey('LAST_ADMIN')).toBe('swc.code.LAST_ADMIN'); expect(swcCodeKey('DROP')).toBe('swc.code.unknown');
    expect(retryIsMutation()).toBe(false);
  });
  it('reasons: 10–500 characters after whitespace collapses', () => {
    expect(reasonOk('too short')).toBe(false);
    expect(reasonOk('  left the cooperative  ')).toBe(true);
    expect(reasonOk('x'.repeat(501))).toBe(false);
    expect(reasonOk(null)).toBe(false);
  });
  it('the seat tile is words, never a fabricated number', () => {
    expect(seatTile({ kind: 'limited', used: 2, seats: 3, full: false, planName: 'Starter' } as never)).toEqual({ key: 'swc.seats.limited', vars: { used: 2, seats: 3, plan: 'Starter' } });
    expect(seatTile({ kind: 'limited', used: 3, seats: 3, full: true, planName: 'Starter' } as never).key).toBe('swc.seats.full');
    expect(seatTile({ kind: 'unlimited', used: 40, planName: 'Enterprise' } as never)).toEqual({ key: 'swc.seats.unlimited', vars: { used: 40, plan: 'Enterprise' } });
    expect(seatTile({ kind: 'not_defined', used: 1, planName: 'Legacy' } as never).key).toBe('swc.seats.notDefined');
    expect(seatTile({ kind: 'no_plan', used: 1 } as never)).toEqual({ key: 'swc.seats.noPlan', vars: { used: 1 } });
  });
  it('the session sentence carries the API\'s bound, never a typed one', () => {
    expect(sessionBoundVars(30, 900)).toEqual({ sec: 30, ttlMin: 15 });
    expect(sessionBoundVars(0, 10)).toEqual({ sec: 0, ttlMin: 1 });
  });
  it('codes: refusals first, then the code, then the status', () => {
    expect(codesFrom('X', 409, { refusals: [{ code: 'KYC_RECUSED_ONBOARDER' }, 'CLAIMED_BY_OTHER', { code: 'bad code' }] })).toEqual(['KYC_RECUSED_ONBOARDER', 'CLAIMED_BY_OTHER', 'unknown']);
    expect(codesFrom('LAST_ADMIN', 409)).toEqual(['LAST_ADMIN']);
    expect(codesFrom(undefined, 403)).toEqual(['FORBIDDEN']);
    expect(codesFrom(undefined, 500)).toEqual(['unknown']);
    expect(parseCodes('A_B,<script>,CC')).toEqual(['A_B', 'CC']);
    expect(swcPageState('TEAM_RESTRICTED')).toBe('restricted');
    expect(swcPageState('AUDITOR_READ_ONLY', 403)).toBe('restricted');
    expect(swcPageState('STAFF_NOT_FOUND', 404, true)).toBe('notFound');
    expect(swcPageState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(swcPageState(undefined, 500)).toBe('error');
  });
  it('privileged actions are the prefixes', () => {
    expect(isPrivilegedAction('role.revoked')).toBe(true);
    expect(isPrivilegedAction('two_factor.enrolled')).toBe(true);
    expect(isPrivilegedAction('listing.created')).toBe(false);
  });
});

describe('the pages keep their promises', () => {
  it('server components — the 2FA panel is the ONE client component; no inline handlers in server pages; logical CSS', () => {
    for (const p of TSX) {
      const s = src(p);
      expect(`${p}:${s.includes("'use client'")}`).toBe(`${p}:${p === 'app/me/security/TwoFactorPanel.tsx'}`);
      if (p !== 'app/me/security/TwoFactorPanel.tsx') expect(/\son[A-Z][a-zA-Z]+=\{/.test(s)).toBe(false);
      expect(/(margin|padding)-(left|right)|text-align:\s*(left|right)|\bleft:|\bright:/.test(s)).toBe(false);
    }
  });
  it('the shown-once 2FA secret never touches a URL, a cookie or storage', () => {
    const panel = src('app/me/security/TwoFactorPanel.tsx');
    expect(panel).not.toMatch(/localStorage|sessionStorage|document\.cookie|router\.push|searchParams/);
    for (const fn of src('app/me/security/actions.ts').split('export async function ').filter((f) => /^(enrol|confirm|disable)TwoFactorAction/.test(f))) expect(fn).not.toMatch(/redirect\(/);
    // the 2FA step of /login rides an httpOnly cookie scoped to /login, five minutes
    const login = src('app/login/page.tsx');
    expect(login).toMatch(/kvt_2fa/);
    expect(login).toMatch(/httpOnly: true/);
    expect(login).toMatch(/path: '\/login'/);
    expect(login).toMatch(/maxAge: 300/);
  });
  it('the invite token is never drawn in the console; the accept page never echoes it back into a link', () => {
    const inv = src('app/settings/team/invite/page.tsx');
    expect(inv).not.toMatch(/(?<!rule)\.token\b/);
    expect(inv).toMatch(/swc\.inviteChain\.tokenNever/);
    expect(src('app/settings/team/team-actions.ts')).not.toMatch(/set\('token'/);
  });
  it('every write carries the key the page minted; access changes need a reason', () => {
    for (const p of ['app/people/verification/page.tsx', 'app/people/verification/[id]/page.tsx', 'app/settings/team/invite/page.tsx', 'app/settings/team/act/page.tsx', 'app/settings/team/[id]/act/page.tsx']) {
      expect(`${p}:${/name="idempotencyKey" value=\{randomUUID\(\)\}/.test(src(p))}`).toBe(`${p}:true`);
    }
    const act = src('app/settings/team/[id]/act/page.tsx');
    expect(act).toMatch(/name="reason"/);
    expect(act).toMatch(/minLength=\{REASON_MIN\}/);
  });
  it('Retry is a page load, never the chain', () => {
    for (const p of ['app/settings/team/page.tsx', 'app/settings/team/[id]/act/page.tsx']) expect(src(p)).toMatch(/swc\.refused\.retry/);
    for (const p of TSX) expect(src(p)).not.toMatch(/act=retry/);
  });
  it('raw phones never reach a page — only the API\'s masked phone', () => {
    for (const p of ['app/settings/team/page.tsx', 'app/settings/team/act/page.tsx', 'app/invite/page.tsx']) expect(src(p)).not.toMatch(/\b(?:i|s|r|m|a|invite|info|staff|row)\.phone\b/);
  });
  it('the canon\'s unbacked promises are refused by name, each on a page', () => {
    const all = TSX.map(src).join('\n');
    for (const r of VERIFICATION_REFUSED_BY_NAME) { three(`swc.refused.${r}`); }
    for (const r of VERIFICATION_REFUSED_BY_NAME.filter((x) => x !== 'kycCamp')) expect(all.includes(`swc.refused.${r}`) || all.includes('VERIFICATION_REFUSED_BY_NAME')).toBe(true);
    expect(all).toMatch(/swc\.refused\.whatsapp/);
  });
});

describe('i18n — every key a page can ask for, ×3, the same {vars}', () => {
  it('the literal keys', () => {
    for (const p of [...PAGES, 'components/Sidebar.tsx']) for (const m of src(p).matchAll(/\b(?:t\.t|L)\(\s*'((?:swc|nav|kyc)\.[a-zA-Z0-9_.]+)'/g)) three(m[1]);
  });
  it('every dynamic family', () => {
    for (const c of SWC_CODES) three(`swc.code.${c}`);
    for (const s of ['flaggedOff', 'restricted', 'notFound', 'error']) { three(`swc.state.${s}.title`); three(`swc.state.${s}.body`); }
    for (const u of ['minutes', 'hours', 'days']) three(`swc.desk.median.${u}`);
    for (const k of ['limited', 'full', 'unlimited', 'notDefined', 'noPlan']) three(`swc.seats.${k}`);
    for (const s of ['confirmed', 'pending', 'not_enrolled']) three(`swc.tfa.${s}`);
    for (const c of [...PAIR_CODES, 'other']) three(`swc.pair.${c}`);
    for (const s of ['pending', 'accepted', 'expired', 'revoked']) three(`swc.invite.status.${s}`);
    for (const r of CONFLICT_RELATIONS) three(`swc.relation.${r}`);
    for (const r of SKIP_REASONS) three(`swc.skip.${r}`);
    for (const p of [...PURPOSES, 'other']) three(`swc.purpose.${p}`);
    for (const c of ['money', 'pii']) three(`swc.class.${c}`);
    for (const l of INVITE_LANGUAGES) three(`swc.lang.${l}`);
    for (const a of TEAM_ACTS) { three(`swc.teamAct.${a}.title`); three(`swc.teamAct.${a}.done`); }
    for (const a of STAFF_ACTS) { three(`swc.staffAct.${a}.title`); three(`swc.staffAct.${a}.done`); three(`swc.staffAct.${a}.proceed`); }
    for (const r of ['onboarder', 'declared']) three(`swc.recusal.${r}`);
    for (const c of ['KYC_RECUSED_DECLARED', 'KYC_RECUSED_ONBOARDER', 'CLAIMED_BY_OTHER']) three(`kyc.desk.refusal.${c}`);
  });
  it('the 2FA panel is handed every label it reads', () => {
    const page = src('app/me/security/page.tsx');
    const handed = listOf(page, 'const PANEL_KEYS = [');
    for (const m of src('app/me/security/TwoFactorPanel.tsx').matchAll(/L\('([a-zA-Z0-9_.]+)'/g)) expect(handed).toContain(m[1]);
    for (const k of handed) three(k);
  });
  it('the same {vars} in en, hi and gu for every SW-c key', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('swc.'));
    expect(keys.length).toBeGreaterThan(300);
    for (const k of keys) {
      const want = vars(en[k as keyof typeof en] as string);
      expect(`${k} hi ${vars(hi[k as keyof typeof hi] as string).join(',')}`).toBe(`${k} hi ${want.join(',')}`);
      expect(`${k} gu ${vars(gu[k as keyof typeof gu] as string).join(',')}`).toBe(`${k} gu ${want.join(',')}`);
    }
  });
});
