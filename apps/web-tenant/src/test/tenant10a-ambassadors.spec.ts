// apps/web-tenant/src/test/tenant10a-ambassadors.spec.ts · PC-56 TENANT-10a · AMBASSADORS + REFERRALS, in the console.
// The helpers; the pages' own promises read from their source (no client JS, the key minted on the review / confirm page,
// the chains imported rather than copied, flagged-off as words never a 404, the reward rule a state card with no form);
// every list mirrored from the API's OWN source and the seeds (a second copy would agree exactly once); and every key a page
// can ask for exists ×3 with the same {vars} — the literal ones and every dynamic family.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  ACT_CODES, AMBASSADORS_HREF, AMB_ACTS, AMB_REFUSED_BY_NAME, AMB_TIERS, EDIT_FIELDS, NEW_AMBASSADOR_HREF, RECRUIT_FIELDS, RECRUIT_REFUSALS, REFERRALS_HREF,
  REFERRAL_STATUSES, REFERRAL_TABS, REF_REFUSED_BY_NAME, REWARD_RULE_HREF, RUN_HREF, actHref, actsFor, activateHref, codeKey, consoleState, detailHref, editHref,
  failureCodesFrom, formEntries, isUuid, lastActive, minorToRupees, personKey, recordFromForm, referralFilters, referralHref, retryIsMutation, rosterFilters,
  rosterHref, rupeesToMinor, statusKey, tabStatus, tierKey,
} from '../features/ambassadors/console';

const CATS = [['en', en], ['hi', hi], ['gu', gu]] as const;
const three = (k: string) => { for (const [n, cat] of CATS) expect(cat[k as keyof typeof cat] ? `${n}` : `${n} MISSING ${k}`).toBe(n); };
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const api = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../api/src/modules/ambassadors', rel), 'utf8');
const listOf = (s: string, start: string, end: string) => { const i = s.indexOf(start); if (i < 0) throw new Error(start); return [...s.slice(i, s.indexOf(end, i)).matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]); };
const ID = '01a0c000-0000-7000-8000-0000000000a1';
const PAGES = [
  'app/people/ambassadors/page.tsx', 'app/people/ambassadors/loading.tsx', 'app/people/ambassadors/new/page.tsx', 'app/people/ambassadors/new/actions.ts',
  'app/people/ambassadors/[id]/page.tsx', 'app/people/ambassadors/[id]/edit/page.tsx', 'app/people/ambassadors/[id]/edit/actions.ts',
  'app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/[id]/act/actions.ts', 'app/people/ambassadors/run/page.tsx', 'app/people/ambassadors/run/actions.ts',
  'app/people/ambassadors/ProfileForm.tsx', 'app/people/ambassadors/AuditEntryCard.tsx', 'app/people/ambassadors/formOptions.ts',
  'app/people/referrals/page.tsx', 'app/people/referrals/loading.tsx', 'app/people/referrals/reward-rule/page.tsx',
  'app/people/referrals/[id]/activate/page.tsx', 'app/people/referrals/[id]/activate/actions.ts',
  'app/ambassadors/page.tsx', 'app/ambassadors/actions.ts',
];

describe('routes (W159, W2481–W2487, W162, W2731–W2737)', () => {
  it('every canon screen has a route; /ambassadors redirects (a detail link to its detail); the sidebar entry stays', () => {
    for (const p of PAGES) expect(fs.existsSync(path.join(__dirname, '..', p))).toBe(true);
    const legacy = src('app/ambassadors/page.tsx');
    expect(legacy).toMatch(/redirect\(AMBASSADORS_HREF\)/);
    expect(legacy).toMatch(/redirect\(detailHref\(searchParams\.ambassador\)\)/);
    expect(src('components/Sidebar.tsx')).toContain(`key: 'ambassadors', href: '/ambassadors'`);
    expect([AMBASSADORS_HREF, NEW_AMBASSADOR_HREF, RUN_HREF, REFERRALS_HREF, REWARD_RULE_HREF]).toEqual(['/people/ambassadors', '/people/ambassadors/new', '/people/ambassadors/run', '/people/referrals', '/people/referrals/reward-rule']);
    expect(detailHref('a b')).toBe('/people/ambassadors/a%20b');
    expect(editHref(ID)).toBe(`/people/ambassadors/${ID}/edit?step=edit`);
    expect(actHref(ID, 'payout')).toBe(`/people/ambassadors/${ID}/act?step=confirm&act=payout`);
    expect(activateHref(ID)).toBe(`/people/referrals/${ID}/activate?step=confirm`);
  });
  it('the old write paths are gone: the legacy actions keep ONLY the target form; every money / lifecycle act is a chain', () => {
    const a = src('app/ambassadors/actions.ts');
    expect([...a.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(['setTargetAction']);
    expect(a).not.toMatch(/\.payout\(|\.suspend\(|\.reinstate\(|\.enroll\(|activateReferral/);
  });
});

describe('the lists are the API\'s own (and the seeds\')', () => {
  it('recruit / edit fields and refusals mirror domain/recruit.rules.ts', () => {
    const rules = api('domain/recruit.rules.ts');
    expect([...RECRUIT_FIELDS]).toEqual(listOf(rules, 'RECRUIT_FIELDS = [', '] as const'));
    expect([...EDIT_FIELDS]).toEqual(listOf(rules, 'EDIT_FIELDS = [', '] as const'));
    expect([...RECRUIT_REFUSALS]).toEqual(listOf(rules, 'RECRUIT_REFUSALS = [', '] as const'));
  });
  it('the tiers are seed 0005\'s ambassador_tier codes, in order; statuses the API\'s; sorts the read model\'s', () => {
    const seed = fs.readFileSync(path.join(__dirname, '../../../../db/seeds/core/0005_lookup_vocabularies.sql'), 'utf8');
    expect([...AMB_TIERS]).toEqual([...seed.matchAll(/\('ambassador_tier',NULL,'([a-z_]+)'/g)].map((m) => m[1]));
    expect([...REFERRAL_STATUSES]).toEqual(listOf(api('domain/ambassadors.events.ts'), 'REFERRAL_STATUSES = [', '] as const'));
    expect(listOf(api('read-models/ambassador-roster.read-model.ts'), 'ROSTER_SORTS = [', '] as const')).toEqual(['recent', 'owed']);
    expect(api('read-models/ambassador-roster.read-model.ts')).toMatch(/INACTIVE_DAYS = 60/);
  });
  it('every typed error the module throws is a code here', () => {
    const errs = api('domain/ambassadors.errors.ts');
    for (const code of ['REASON_REQUIRED', 'NOTHING_TO_PAYOUT', 'PAYOUT_MARK_MISMATCH', 'AMBASSADOR_NOT_FOUND', 'REFERRAL_NOT_FOUND', 'AMBASSADORS_FORBIDDEN']) {
      expect(errs).toContain(`'${code}'`);
      expect(ACT_CODES).toContain(code);
    }
    expect(api('domain/referral.state.ts')).toContain(`'REFERRAL_ILLEGAL_TRANSITION'`);
    expect(api('services/ambassador-profile.service.ts')).toContain(`'AMBASSADOR_REFUSED'`);
  });
});

describe('the helpers', () => {
  it('roster filters: unknown values are no filter; the cursor rides along; hrefs are canonical', () => {
    expect(rosterFilters({})).toEqual({ sort: 'recent' });
    expect(rosterFilters({ tier: 'senior', inactive: '1', sort: 'owed', cursor: 'abc_-1' })).toEqual({ tier: 'senior', inactive: true, sort: 'owed', cursor: 'abc_-1' });
    expect(rosterFilters({ tier: 'boss', inactive: 'yes', sort: 'name', cursor: 'a b' })).toEqual({ sort: 'recent' });
    expect(rosterHref({ sort: 'recent' })).toBe('/people/ambassadors');
    expect(rosterHref({ tier: 'trainee', inactive: true, sort: 'owed' }, 'c2')).toBe('/people/ambassadors?tier=trainee&inactive=1&sort=owed&cursor=c2');
  });
  it('referral tabs are real filters; all is no filter', () => {
    expect(referralFilters({})).toEqual({ tab: 'all' });
    expect(referralFilters({ status: 'signed_up', cursor: 'x1' })).toEqual({ tab: 'signed_up', cursor: 'x1' });
    expect(referralFilters({ status: 'rewarded' })).toEqual({ tab: 'all' });
    expect(referralHref('invited', 'c')).toBe('/people/referrals?status=invited&cursor=c');
    expect([tabStatus('all'), tabStatus('activated')]).toEqual([undefined, 'activated']);
    expect([...REFERRAL_TABS]).toEqual(['all', 'invited', 'signed_up', 'activated']);
  });
  it('a row offers suspend (+ pay out when owed) or reinstate; Retry is a page load', () => {
    expect(actsFor({ isActive: true, owedMinor: '684000' })).toEqual(['suspend', 'payout', 'message']);   // SW-b: + Message (W160)
    expect(actsFor({ isActive: true, owedMinor: '0' })).toEqual(['suspend', 'message']);
    expect(actsFor({ isActive: false, owedMinor: '5000' })).toEqual(['reinstate']);
    expect(retryIsMutation()).toBe(false);
    expect([...AMB_ACTS]).toEqual(['suspend', 'reinstate', 'payout', 'message']);
  });
  it('last active in words; never-recorded is its own sentence; 60 days is "inactive"', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(lastActive(null, now)).toEqual({ key: 'amb.lastActive.never', vars: {} });
    expect(lastActive('2026-10-02T01:00:00Z', now).key).toBe('amb.lastActive.today');
    expect(lastActive('2026-10-01T06:00:00Z', now).key).toBe('amb.lastActive.yesterday');
    expect(lastActive('2026-09-15T12:00:00Z', now)).toEqual({ key: 'amb.lastActive.daysAgo', vars: { n: '17' } });
    expect(lastActive('2026-08-01T12:00:00Z', now)).toEqual({ key: 'amb.lastActive.inactive', vars: { n: '62' } });
  });
  it('money: rupees typed → paise in integer arithmetic (never a float); back again', () => {
    expect(rupeesToMinor('1500')).toBe('150000');
    expect(rupeesToMinor('1,500.5')).toBe('150050');
    expect(rupeesToMinor('0.07')).toBe('7');
    expect(rupeesToMinor('')).toBe('0');
    expect(rupeesToMinor('12.345')).toBeNull();
    expect(rupeesToMinor('-5')).toBeNull();
    expect(minorToRupees('150050')).toBe('1500.50');
    expect(minorToRupees('150000')).toBe('1500');
  });
  it('the form entries travel in the URL; an empty select after a submit means "none", not "unchanged"', () => {
    expect(formEntries({ phone: ' 98765 43210 ', c1: ID, c3: 'x', kiosk: '1', aeps: '0', stipend: '1500', clustersTouched: '1' }, true)).toEqual({
      entries: { phone: '98765 43210', tierId: '', clusterRegionIds: [ID, 'x'], mentorAmbassadorId: '', kioskEnabled: true, aepsEnabled: false, monthlyStipendMinor: '150000' }, stipendInvalid: false });
    expect(formEntries({ stipend: 'abc' }, false).stipendInvalid).toBe(true);
    expect(formEntries({ phone: '1' }, false).entries.phone).toBeUndefined();
    const fd = new Map([['phone', '9'], ['bogus', 'x'], ['reason', ' r ']]);
    expect(recordFromForm((k) => fd.get(k) ?? null)).toEqual({ phone: '9', reason: 'r' });
  });
  it('failure codes: the API\'s refusal list when present, else its code; codes only; an unknown code has a sentence', () => {
    expect(failureCodesFrom({ refusals: [{ field: 'phone', code: 'NOT_A_MEMBER' }, { field: 'x', code: 'NOT_A_MEMBER' }, { code: '<b>' }] }, 'AMBASSADOR_REFUSED')).toEqual(['NOT_A_MEMBER']);
    expect(failureCodesFrom(null, 'NOTHING_TO_PAYOUT')).toEqual(['NOTHING_TO_PAYOUT']);
    expect(failureCodesFrom(undefined, '<script>')).toEqual(['unknown']);
    expect(codeKey('NOT_A_MEMBER')).toBe('amb.code.NOT_A_MEMBER');
    expect(codeKey('SOMETHING_NEW')).toBe('amb.code.unknown');
  });
  it('states, names, tiers, statuses', () => {
    expect([consoleState(undefined, 404, true), consoleState(undefined, 404), consoleState('AUDITOR_READ_ONLY', 409), consoleState(undefined, 403), consoleState(undefined, 500)])
      .toEqual(['flaggedOff', 'notFound', 'restricted', 'restricted', 'error']);
    expect(personKey(null)).toEqual({ key: 'amb.person.unnamed', vars: {} });
    expect(personKey('Dinesh Bhai M.')).toEqual({ key: 'amb.person.named', vars: { name: 'Dinesh Bhai M.' } });
    expect([tierKey('senior'), tierKey(null), tierKey('god')]).toEqual(['amb.tier.senior', 'amb.tier.none', 'amb.tier.none']);
    expect([statusKey('signed_up'), statusKey('x')]).toEqual(['ref.status.signed_up', 'ref.status.unknown']);
    expect([isUuid(ID), isUuid('x')]).toEqual([true, false]);
  });
});

describe('the pages keep their promises (read from source)', () => {
  const all = () => PAGES.map((p) => [p, src(p)] as const);
  it('no client JS, no inline handlers, no raw phone rendered, logical CSS only', () => {
    for (const [p, s] of all()) {
      expect(`${p}: ${/^'use client'/m.test(s)}`).toBe(`${p}: false`);
      expect(s).not.toMatch(/\bon(Click|Change|Submit)=/);
      expect(s).not.toMatch(/\{[A-Za-z.!]*\.phone\}/);   // only `phoneMasked` is ever rendered
      expect(s).not.toMatch(/margin-left|margin-right|padding-left|padding-right|text-align:\s*(left|right)/);
    }
  });
  it('the chains are IMPORTED (features/forms/chain, features/mutate/chain), never re-typed', () => {
    for (const p of ['app/people/ambassadors/new/page.tsx', 'app/people/ambassadors/[id]/edit/page.tsx']) expect(src(p)).toMatch(/from '..\/(..\/)*features\/forms\/chain'/);
    for (const p of ['app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/run/page.tsx', 'app/people/referrals/[id]/activate/page.tsx']) expect(src(p)).toMatch(/from '..\/(..\/)*features\/mutate\/chain'/);
  });
  it('THE KEY IS MINTED ON THE REVIEW / CONFIRM PAGE for every money or create act (a double click writes once)', () => {
    for (const p of ['app/people/ambassadors/new/page.tsx', 'app/people/ambassadors/[id]/act/page.tsx', 'app/people/ambassadors/run/page.tsx']) {
      expect(src(p)).toMatch(/name="idempotencyKey" value=\{randomUUID\(\)\}/);
    }
    for (const p of ['app/people/ambassadors/new/actions.ts', 'app/people/ambassadors/[id]/act/actions.ts', 'app/people/ambassadors/run/actions.ts']) {
      expect(src(p)).toMatch(/formData\.get\('idempotencyKey'\)/);
    }
  });
  it('the reason is mandatory on suspend, pay out, the weekly run and activation (the confirm button is not offered without it)', () => {
    expect(src('app/people/ambassadors/[id]/act/page.tsx')).toMatch(/const reasonRequired = act !== 'reinstate';/);
    for (const p of ['app/people/ambassadors/run/page.tsx', 'app/people/referrals/[id]/activate/page.tsx']) expect(src(p)).toMatch(/rs === 'ok' \?/);
  });
  it('flagged off is the canon\'s WORDS on every route, never notFound(); referrals say they ride the Ambassadors flag', () => {
    for (const [p, s] of all()) expect(`${p}: ${/notFound\(\)/.test(s)}`).toBe(`${p}: false`);
    expect(en['ref.state.flaggedOff.body']).toMatch(/ride the Ambassadors flag/);
    expect(src('app/people/ambassadors/page.tsx')).toContain(`t.t('amb.state.flaggedOff.title')`);
  });
  it('B · the reward rule is ONE state card: no form, no write; the canon\'s sentence word for word', () => {
    const s = src('app/people/referrals/reward-rule/page.tsx');
    expect(s).not.toMatch(/<form|action=|tenantClient/);
    expect(en['ref.rule.stateBody']).toBe('Reward rule not configured — rewards need a funding decision (who pays: tenant wallet or platform) before a rule can exist. No reward has ever been paid on this tenant.');
    expect(en['ref.reward.notConfigured']).toBe('not configured');
    expect(en['ref.notYetJoined']).toBe('not yet joined');
    expect(en['ref.refused.ringDetection']).toBe('Self-referral (the same account) is refused; ring detection is not yet run on this tenant.');
    expect(src('app/people/referrals/page.tsx')).toContain(`<strong>{t.t('common.dash')}</strong>`);   // "Rewards paid" prints —, never ₹0
  });
  it('B · every refused-by-name clause is printed somewhere, in words', () => {
    const pages = all().map(([, s]) => s).join('\n');
    for (const k of AMB_REFUSED_BY_NAME) { three(`amb.refused.${k}`); expect(pages).toContain(`amb.refused.${k}`); }
    for (const k of REF_REFUSED_BY_NAME.filter((x) => x !== 'retry' && x !== 'inviteePhone')) { three(`ref.refused.${k}`); expect(pages).toContain(`ref.refused.${k}`); }
    expect(pages).toContain(`t.t('ref.notYetJoined')`);   // the invitee phone, refused by name
  });
});

describe('i18n — every key a page can ask for exists ×3 with the same {vars}', () => {
  const literal = () => {
    const keys = new Set<string>();
    for (const p of [...PAGES, 'features/ambassadors/console.ts']) for (const m of src(p).matchAll(/t\.t\(\s*'([^']+)'/g)) keys.add(m[1]);
    return [...keys];
  };
  const families = (): string[] => [
    ...RECRUIT_REFUSALS.map(codeKey), ...ACT_CODES.map(codeKey),
    ...AMB_TIERS.map((c) => `amb.tier.${c}`), 'amb.tier.none',
    ...AMB_ACTS.flatMap((a) => [`amb.act.${a}`, `amb.act.rule.${a}`, `amb.act.done.${a}`, `amb.act.notOffered.${a}`]),
    ...['flaggedOff', 'restricted', 'notFound', 'error'].flatMap((s) => [`amb.state.${s}.title`, `amb.state.${s}.body`, `ref.state.${s}.title`, `ref.state.${s}.body`]),
    'ref.state.notActivatable.title', 'ref.state.notActivatable.body',
    ...REFERRAL_TABS.map((x) => `ref.tab.${x}`), ...REFERRAL_STATUSES.map(statusKey), 'ref.status.unknown',
    ...RECRUIT_FIELDS.map((f) => `amb.recruit.field.${f}`), ...EDIT_FIELDS.map((f) => `amb.edit.field.${f}`),
    ...['farmer_onboarded', 'first_sale_facilitated', 'first_txn_30d', 'listing_assist', 'sale_trail', 'worker_onboarded', 'kcc_facilitated', 'pmsby_enrolled', 'other'].map((e) => `amb.event.${e}`),
    ...['ambassador', 'metric', 'dates', 'dateOrder', 'value', 'TARGET_EXISTS', 'AMBASSADOR_NOT_FOUND', 'save'].map((e) => `amb.targetError.${e}`),
    'amb.person.named', 'amb.person.unnamed', ...['never', 'today', 'yesterday', 'daysAgo', 'inactive'].map((x) => `amb.lastActive.${x}`),
    'amb.flags.kiosk', 'amb.flags.aeps', 'amb.flags.both', 'amb.empty.filtered.title', 'amb.empty.filtered.body', 'ref.empty.filtered.title', 'ref.empty.filtered.body',
    'amb.audit.unreadable', 'amb.audit.notYet',
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
