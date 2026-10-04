// modules/ambassadors/__tests__/tenant10a-ambassadors.spec.ts · PC-56 TENANT-10a — the pure rules + the service seams.
// Every block here fails on 9743e8b (the file, or the behaviour it pins, did not exist):
//   F-17 the microsecond cursor · F-5 the plan conditions + the goods-subtotal base · W2481–W2484 the recruit / edit rules ·
//   F-16 the short name + the 1b mask · F-14 the leaderboard redaction + gate · F-4 assisted onboarding refuses an existing
//   phone BEFORE any consent · F-12 the audits (edit before/after, suspend reason, activate reason, claim) · F-15 the
//   activity writer · the route-order gate (a parametric route never shadows a static one) · A2 the payout verb.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { encodeCursor, decodeCursor, encodeAmountCursor, decodeAmountCursor } from '../domain/cursor';
import { evaluatePlanConditions, PLAN_CONDITION_KEYS } from '../domain/commission-plan.entity';
import { recruitRefusals, editRefusals, editDiff, RecruitFacts, MAX_CLUSTERS } from '../domain/recruit.rules';
import { shortName, maskPhone } from '../domain/display';
import { redactForViewer } from '../read-models/leaderboard.read-model';
import { saleBase, OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { AssistedOnboardingService } from '../services/assisted-onboarding.service';
import { AmbassadorProfileService } from '../services/ambassador-profile.service';
import { ReferralService } from '../services/referral.service';
import { AmbassadorVisitService } from '../services/ambassador-visit.service';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { Referral } from '../domain/referral.entity';
import { AssistedOnboardingExistingUserError, ReasonRequiredError, LeaderboardForbiddenError } from '../domain/ambassadors.errors';
import { FieldOpsController } from '../controllers/v1/field-ops.controller';
import { AmbassadorsController } from '../controllers/v1/ambassadors.controller';
import { ReferralsController } from '../controllers/v1/referrals.controller';
import { EarningsController } from '../controllers/v1/earnings.controller';
import { AepsController } from '../controllers/v1/aeps.controller';
import { PayoutRunsController } from '../controllers/v1/payout-runs.controller';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { AUDITOR_READ_ACT_KEY, auditorVerdict } from '../../../core/auth/auditor-read-only.guard';

const ID = '01a0c000-0000-7000-8000-0000000000a1';
const ID2 = '01a0c000-0000-7000-8000-0000000000a2';

describe('F-17 · the microsecond cursor', () => {
  it('round-trips the raw text exactly (all six fractional digits)', () => {
    const raw = '2026-10-02 10:00:00.123456+05:30';
    expect(decodeCursor(encodeCursor(raw, ID))).toEqual({ c: raw, id: ID });
  });
  it('refuses junk: a non-timestamp, a non-uuid, an injection attempt, an over-long string', () => {
    expect(encodeCursor('yesterday', ID)).toBeNull();
    expect(encodeCursor('2026-10-02 10:00:00.123456+05:30', 'x')).toBeNull();
    expect(decodeCursor(Buffer.from(`2026-10-02'; DROP TABLE x;--|${ID}`).toString('base64url'))).toBeUndefined();
    expect(decodeCursor('a'.repeat(300))).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
  it('the Owed ▾ cursor is integer minor units + uuid only', () => {
    expect(decodeAmountCursor(encodeAmountCursor('684000', ID))).toEqual({ amount: '684000', id: ID });
    expect(encodeAmountCursor('6.84', ID)).toBeNull();
    expect(decodeAmountCursor(Buffer.from(`1|${ID}|x`).toString('base64url'))).toBeUndefined();
  });
});

describe('F-5 · plan conditions (seed 0207 vocabulary)', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  const ctx = (o: Partial<Parameters<typeof evaluatePlanConditions>[1]> = {}) => ({ now, referralCreatedAt: new Date('2026-09-20T00:00:00Z'), subjectUserId: 'f1', priorCountForSubject: 0, priorSalesForSubject: 0, ...o });
  it('the closed vocabulary is exactly the three keys the seed uses', () => {
    expect([...PLAN_CONDITION_KEYS].sort()).toEqual(['after_first_sales', 'max_per_farmer', 'max_sales_per_farmer', 'within_days']);
    const seed = fs.readFileSync(path.join(__dirname, '../../../../../../db/seeds/rules/0207_ambassador_commission_plans.sql'), 'utf8');
    const used = new Set([...seed.matchAll(/"([a-z_]+)"\s*:/g)].map((m) => m[1]));
    for (const k of used) expect(PLAN_CONDITION_KEYS as readonly string[]).toContain(k);
  });
  it('no conditions → allowed', () => { expect(evaluatePlanConditions({}, ctx())).toBeNull(); });
  it('max_sales_per_farmer: 4 prior → allowed; 5 prior → cap_reached; no farmer → no_farmer', () => {
    expect(evaluatePlanConditions({ max_sales_per_farmer: 5 }, ctx({ priorCountForSubject: 4 }))).toBeNull();
    expect(evaluatePlanConditions({ max_sales_per_farmer: 5 }, ctx({ priorCountForSubject: 5 }))).toBe('cap_reached');
    expect(evaluatePlanConditions({ max_sales_per_farmer: 5 }, ctx({ subjectUserId: null }))).toBe('no_farmer');
  });
  it('max_per_farmer (listing_assist) binds the same way; both present → the tighter binds', () => {
    expect(evaluatePlanConditions({ max_per_farmer: 5 }, ctx({ priorCountForSubject: 5 }))).toBe('cap_reached');
    expect(evaluatePlanConditions({ max_per_farmer: 2, max_sales_per_farmer: 5 }, ctx({ priorCountForSubject: 2 }))).toBe('cap_reached');
  });
  it('within_days: inside → allowed; past → window_closed; no referral → no_referral_window', () => {
    expect(evaluatePlanConditions({ within_days: 30 }, ctx())).toBeNull();
    expect(evaluatePlanConditions({ within_days: 10 }, ctx())).toBe('window_closed');
    expect(evaluatePlanConditions({ within_days: 30 }, ctx({ referralCreatedAt: null }))).toBe('no_referral_window');
  });
  it('after_first_sales (sale_trail): only once the farmer\'s first N sale commissions exist', () => {
    expect(evaluatePlanConditions({ after_first_sales: 5 }, ctx({ priorSalesForSubject: 4 }))).toBe('trail_not_reached');
    expect(evaluatePlanConditions({ after_first_sales: 5 }, ctx({ priorSalesForSubject: 5 }))).toBeNull();
    expect(evaluatePlanConditions({ after_first_sales: 5 }, ctx({ subjectUserId: null }))).toBe('no_farmer');
  });
  it('unknown or malformed → refused by name', () => {
    expect(evaluatePlanConditions({ max_sale_per_farmer: 5 }, ctx())).toBe('unknown_condition');
    expect(evaluatePlanConditions({ within_days: '30' }, ctx())).toBe('malformed_condition');
    expect(evaluatePlanConditions({ max_per_farmer: -1 }, ctx())).toBe('malformed_condition');
  });
  it('the sale base is the GOODS subtotal — event first, else the order row — never the order total', () => {
    expect(saleBase({ subtotalMinor: '400000', totalMinor: '452000' }, null)).toBe(400000n);
    expect(saleBase({ totalMinor: '452000' }, '400000')).toBe(400000n);
    expect(saleBase({ totalMinor: '452000' }, null)).toBeNull();
    expect(saleBase({ subtotalMinor: '4.5' }, null)).toBeNull();
  });
});

describe('W2481–W2484 · the recruit and edit rules', () => {
  const facts = (o: Partial<RecruitFacts> = {}): RecruitFacts => ({ phoneE164: '+919876543210', member: { userId: 'u1', isMember: true }, alreadyAmbassador: false, tierKnown: null, unknownClusterIds: [], mentor: null, ...o });
  it('a clean recruit is ready', () => { expect(recruitRefusals({ phone: '9876543210' }, facts())).toEqual([]); });
  it('the phone ladder: required → invalid → no account → not a member → already an ambassador', () => {
    expect(recruitRefusals({}, facts()).map((r) => r.code)).toEqual(['PHONE_REQUIRED']);
    expect(recruitRefusals({ phone: 'abc' }, facts({ phoneE164: null })).map((r) => r.code)).toEqual(['PHONE_INVALID']);
    expect(recruitRefusals({ phone: '9876543210' }, facts({ member: null })).map((r) => r.code)).toEqual(['NO_ACCOUNT']);
    expect(recruitRefusals({ phone: '9876543210' }, facts({ member: { userId: 'u1', isMember: false } })).map((r) => r.code)).toEqual(['NOT_A_MEMBER']);
    expect(recruitRefusals({ phone: '9876543210' }, facts({ alreadyAmbassador: true })).map((r) => r.code)).toEqual(['ALREADY_AMBASSADOR']);
  });
  it('EVERY invalid field is listed (W2481), each against its own field', () => {
    const r = recruitRefusals({ phone: '9876543210', clusterRegionIds: [ID, ID, ID2, 'x'], monthlyStipendMinor: '12.5', tierId: ID },
      facts({ tierKnown: false, unknownClusterIds: ['x'], mentor: { exists: false, active: false, userId: null } }));
    expect(r).toEqual([
      { field: 'tierId', code: 'TIER_UNKNOWN' }, { field: 'clusterRegionIds', code: 'TOO_MANY_CLUSTERS' }, { field: 'clusterRegionIds', code: 'CLUSTER_REPEATED' },
      { field: 'clusterRegionIds', code: 'CLUSTER_UNKNOWN' }, { field: 'mentorAmbassadorId', code: 'MENTOR_UNKNOWN' }, { field: 'monthlyStipendMinor', code: 'STIPEND_INVALID' },
    ]);
    expect(MAX_CLUSTERS).toBe(3);
  });
  it('a mentor must be active and not the recruit themself', () => {
    expect(recruitRefusals({ phone: '1' }, facts({ mentor: { exists: true, active: false, userId: 'm' } })).map((r) => r.code)).toEqual(['MENTOR_INACTIVE']);
    expect(recruitRefusals({ phone: '1' }, facts({ mentor: { exists: true, active: true, userId: 'u1' } })).map((r) => r.code)).toEqual(['MENTOR_SELF']);
  });
  it('the edit diff names only what changes; an edit that changes nothing is refused by name', () => {
    const current = { tierId: null, clusterRegionIds: [ID], mentorAmbassadorId: null, kioskEnabled: false, aepsEnabled: true, monthlyStipendMinor: '0', trainingCompletedAt: null };
    expect(editDiff(current, { clusterRegionIds: [ID], kioskEnabled: true, monthlyStipendMinor: '150000' })).toEqual([
      { field: 'kioskEnabled', before: 'false', after: 'true' }, { field: 'monthlyStipendMinor', before: '0', after: '150000' }]);
    const none = editDiff(current, { aepsEnabled: true });
    expect(none).toEqual([]);
    expect(editRefusals({ aepsEnabled: true }, { tierKnown: null, unknownClusterIds: [], mentor: null }, 'u1', none)).toEqual([{ field: null, code: 'NOTHING_CHANGED' }]);
  });
});

describe('F-16 · how a person is named', () => {
  it('given name(s) + family initial; one word stays; nothing → null', () => {
    expect(shortName('Dinesh Bhai Makwana')).toBe('Dinesh Bhai M.');
    expect(shortName('Kavita')).toBe('Kavita');
    expect(shortName('   ')).toBeNull();
    expect(shortName(null)).toBeNull();
    expect(shortName('મીરા જોશી')).toBe('મીરા જ.');
  });
  it('the phone is the 1b mask, in the canon shape', () => { expect(maskPhone('+919912345205')).toBe('+91 99••• ••205'); expect(maskPhone('12')).toBe('•••'); });
});

describe('F-14 · the leaderboard', () => {
  const row = { ambassadorId: 'a2', userId: 'u2', tierId: null, earnedMinor: '684000', events: 3, rank: 1, displayName: 'Kavita D.' };
  it('a manager sees every amount; an ambassador sees their own only', () => {
    expect(redactForViewer(row, { userId: 'boss', canManage: true }).earnedMinor).toBe('684000');
    expect(redactForViewer(row, { userId: 'u2', canManage: false })).toMatchObject({ earnedMinor: '684000', isSelf: true });
    expect(redactForViewer(row, { userId: 'u9', canManage: false })).toMatchObject({ earnedMinor: null, isSelf: false, rank: 1, displayName: 'Kavita D.' });
  });
  it('the route refuses a caller who is neither a manager nor an active ambassador', async () => {
    const top = jest.fn(async () => []);
    const mk = (profile: unknown) => new FieldOpsController({} as never, {} as never, {} as never, {} as never, { top } as never, { findByUser: jest.fn(async () => profile) } as never);
    const ctx = (perms: string[]) => ({ tenantId: 't', userId: 'farmer', permissions: new Set(perms), roles: [] }) as never;
    await expect(mk(null).leaderboardTop(ctx([]), { limit: 20 } as never)).rejects.toBeInstanceOf(LeaderboardForbiddenError);
    const suspended = AmbassadorProfile.rehydrate({ id: 'a', userId: 'farmer', tenantId: 't', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: false });
    await expect(mk(suspended).leaderboardTop(ctx([]), { limit: 20 } as never)).rejects.toBeInstanceOf(LeaderboardForbiddenError);
    await mk(null).leaderboardTop(ctx(['ambassador.manage']), { limit: 20 } as never);
    expect(top).toHaveBeenCalledWith('t', expect.anything(), { userId: 'farmer', canManage: true });
  });
});

describe('F-4 · assisted onboarding refuses an existing phone BEFORE any consent or attribution', () => {
  const build = (existing: boolean, createdOlder = false) => {
    const tx = { query: jest.fn(async (sql: string) => {
      if (/FROM users WHERE phone/.test(sql)) return { rows: existing ? [{ '?column?': 1 }] : [], rowCount: existing ? 1 : 0 };
      if (/clock_timestamp/.test(sql)) return { rows: [{ at: '2026-10-02 10:00:00.000001+05:30' }], rowCount: 1 };
      if (/created_at < \$2/.test(sql)) return { rows: [{ older: createdOlder }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
    const users = { adminCreate: jest.fn(async () => ({ id: 'farmer-new' })) };
    const consents = { grant: jest.fn() };
    const referrals = { findByReferee: jest.fn(async () => null), insert: jest.fn() };
    const me = AmbassadorProfile.rehydrate({ id: 'amb1', userId: 'ambUser', tenantId: 't', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: true, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: true });
    const profiles = { findByUser: jest.fn(async () => me), touchActivity: jest.fn(async () => 1) };
    const svc = new AssistedOnboardingService(uow as never, { write: jest.fn() } as never, { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, users as never, consents as never, referrals as never, profiles as never);
    return { svc, users, consents, referrals, profiles };
  };
  const dto = { phone: '9876543210', languageCode: 'gu', countryCode: 'IN', consents: [{ purposeCode: 'data_processing', granted: true }] } as never;
  it('an existing phone → 409 AMB_EXISTING_USER, no account resolved, no consent, no referral', async () => {
    const h = build(true);
    await expect(h.svc.onboard('t', { userId: 'ambUser', canManage: false }, 'k1', dto, null)).rejects.toBeInstanceOf(AssistedOnboardingExistingUserError);
    expect(h.users.adminCreate).not.toHaveBeenCalled(); expect(h.consents.grant).not.toHaveBeenCalled(); expect(h.referrals.insert).not.toHaveBeenCalled();
  });
  it('a race (the account turns out older than the check) is the same refusal — still before any consent', async () => {
    const h = build(false, true);
    await expect(h.svc.onboard('t', { userId: 'ambUser', canManage: false }, 'k2', dto, null)).rejects.toMatchObject({ code: 'AMB_EXISTING_USER', httpStatus: 409 });
    expect(h.consents.grant).not.toHaveBeenCalled(); expect(h.referrals.insert).not.toHaveBeenCalled();
  });
  it('a new phone → account, consents, attribution, and the ambassador\'s activity is touched in-tx (F-15)', async () => {
    const h = build(false);
    const out = await h.svc.onboard('t', { userId: 'ambUser', canManage: false }, 'k3', dto, null);
    expect(out.user.id).toBe('farmer-new');
    expect(h.consents.grant).toHaveBeenCalledTimes(1); expect(h.referrals.insert).toHaveBeenCalledTimes(1);
    expect(h.profiles.touchActivity).toHaveBeenCalledWith(expect.anything(), 't', 'amb1');
    // F-28 (found on the way): the attribution code is a VALID referral code (it used to carry a hyphen the code rule refuses)
    expect((h.referrals.insert.mock.calls as any[])[0][1].toProps().code).toMatch(/^AMB[0-9A-F]{8}$/);
  });
});

describe('F-12 · the audits', () => {
  const tx = () => ({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })) });
  const prof = () => AmbassadorProfile.rehydrate({ id: ID, userId: 'u1', tenantId: 't', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: true });
  const profileSvc = () => {
    const t = tx(); const audit = { write: jest.fn() };
    const repo = { getForUpdate: jest.fn(async () => prof()), update: jest.fn(), getById: jest.fn(async () => prof()) };
    const svc = new AmbassadorProfileService({ run: jest.fn(async (_t: string, fn: any) => fn(t)) } as never, { write: jest.fn() } as never, { inc: jest.fn(), observe: jest.fn() } as never,
      { remember: jest.fn() } as never, audit as never, repo as never, { tierKnown: jest.fn(async () => true), unknownRegions: jest.fn(async () => []) } as never);
    return { svc, audit, repo };
  };
  const mgr = { userId: 'admin', canManage: true };
  it('edit writes ambassador.updated with the before and after of exactly the changed fields (+ reason)', async () => {
    const h = profileSvc();
    await h.svc.update('t', mgr, ID, { monthlyStipendMinor: '150000', kioskEnabled: false, reason: 'raised for the season' });
    const a = h.audit.write.mock.calls[0][1];
    expect(a).toMatchObject({ action: 'ambassador.updated', actorUserId: 'admin', oldValue: { monthlyStipendMinor: '0' }, newValue: { monthlyStipendMinor: '150000' }, reason: 'raised for the season' });
  });
  it('suspend REQUIRES a reason and records before → after; reinstate takes one optionally', async () => {
    const h = profileSvc();
    await expect(h.svc.setActive('t', mgr, ID, false, null, '')).rejects.toBeInstanceOf(ReasonRequiredError);
    await h.svc.setActive('t', mgr, ID, false, null, 'not visiting villages');
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ action: 'ambassador.suspended', oldValue: { isActive: true }, newValue: { isActive: false }, reason: 'not visiting villages' });
    await h.svc.setActive('t', mgr, ID, true, null, null);
    expect(h.audit.write.mock.calls[1][1]).toMatchObject({ action: 'ambassador.reinstated', reason: null });
  });
  const referralSvc = (r: Referral) => {
    const t = tx(); const audit = { write: jest.fn() };
    const repo = { getForUpdate: jest.fn(async () => r), update: jest.fn(), findByCode: jest.fn(async () => r), refereeHasAny: jest.fn(async () => false) };
    const earnings = { accrue: jest.fn(async () => null) };
    const svc = new ReferralService({ run: jest.fn(async (_t: string, fn: any) => fn(t)) } as never, { write: jest.fn() } as never, { remember: jest.fn() } as never,
      { inc: jest.fn(), observe: jest.fn() } as never, audit as never, repo as never, { findByUser: jest.fn(async () => prof()) } as never, earnings as never);
    return { svc, audit, earnings };
  };
  it('activate REQUIRES a reason, writes referral.activated, and accrues with the farmer + the referral date', async () => {
    const r = Referral.rehydrate({ id: ID2, tenantId: 't', referrerUserId: 'u1', refereeUserId: 'farmer', code: 'MEERA88', status: 'signed_up', rewardRule: {}, rewardTxnId: null, createdAt: new Date('2026-09-20T00:00:00Z') });
    const h = referralSvc(r);
    await expect(h.svc.activate('t', mgr, ID2, '  ')).rejects.toBeInstanceOf(ReasonRequiredError);
    await h.svc.activate('t', mgr, ID2, 'first sale confirmed at the centre');
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ action: 'referral.activated', oldValue: { status: 'signed_up' }, reason: 'first sale confirmed at the centre' });
    expect((h.earnings.accrue.mock.calls as any[])[0][1]).toMatchObject({ eventCode: 'farmer_onboarded', subjectUserId: 'farmer', referralCreatedAt: new Date('2026-09-20T00:00:00Z') });
    expect(r.toProps().activatedAt).toBeInstanceOf(Date);
  });
  it('claim writes referral.claimed with the claimant as actor', async () => {
    const r = Referral.rehydrate({ id: ID2, tenantId: 't', referrerUserId: 'u1', refereeUserId: null, code: 'MEERA88', status: 'invited', rewardRule: {}, rewardTxnId: null });
    const h = referralSvc(r);
    await h.svc.claim('t', { userId: 'farmer', canManage: false }, { code: 'MEERA88' });
    expect(h.audit.write.mock.calls[0][1]).toMatchObject({ action: 'referral.claimed', actorUserId: 'farmer', oldValue: { status: 'invited', refereeUserId: null }, newValue: { status: 'signed_up', refereeUserId: 'farmer' } });
  });
});

describe('F-15 · last_activity_at has a writer', () => {
  it('a visit touches the ambassador inside the visit\'s own transaction', async () => {
    const t = { query: jest.fn(async () => ({ rows: [], rowCount: 1 })) };
    const me = AmbassadorProfile.rehydrate({ id: 'amb1', userId: 'u1', tenantId: 't', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: true });
    const profiles = { findByUser: jest.fn(async () => me), touchActivity: jest.fn(async () => 1) };
    const svc = new AmbassadorVisitService({ run: jest.fn(async (_t: string, fn: any) => fn(t)) } as never, { write: jest.fn() } as never, { inc: jest.fn(), observe: jest.fn() } as never, { insert: jest.fn() } as never, profiles as never);
    await svc.log('t', 'u1', { purpose: 'onboarding' } as never);
    expect(profiles.touchActivity).toHaveBeenCalledWith(t, 't', 'amb1');
  });
});

describe('F-27 · the sale-commission handler does its work on the request tier, never on the relay\'s transaction', () => {
  it('every query runs on the unit of work; the relay tx is untouched', async () => {
    const work = { query: jest.fn(async () => ({ rows: [{ s: '400000' }], rowCount: 1 })) };
    const relayTx = { query: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: any) => fn(work)) };
    const r = Referral.rehydrate({ id: ID2, tenantId: 't', referrerUserId: 'u1', refereeUserId: 'seller', code: 'MEERA88', status: 'activated', rewardRule: {}, rewardTxnId: null, createdAt: new Date() });
    const amb = AmbassadorProfile.rehydrate({ id: 'amb1', userId: 'u1', tenantId: 't', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: true });
    const accrue = jest.fn(async () => null);
    const h = new OrderCompletedHandler(uow as never, { findByReferee: jest.fn(async () => r) } as never, { findByUser: jest.fn(async () => amb) } as never, { accrue } as never);
    await h.handle({ id: '1', tenantId: 't', aggregateType: 'order', aggregateId: ID, eventType: 'orders.order_completed', payload: { sellerUserId: 'seller', totalMinor: '452000' } } as never, relayTx as never);
    expect(relayTx.query).not.toHaveBeenCalled();
    expect((accrue.mock.calls as any[])[0][0]).toBe(work);
    expect((accrue.mock.calls as any[])[0][1]).toMatchObject({ baseMinor: 400000n, subjectUserId: 'seller', referenceId: ID });
  });
});

describe('the route-order gate — a parametric route never shadows a static one', () => {
  const NAME: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE' };
  // The module's registration order, read from the module file itself (the order Express will match in).
  const moduleSrc = fs.readFileSync(path.join(__dirname, '../ambassadors.module.ts'), 'utf8');
  const order = /controllers:\s*\[([^\]]+)\]/.exec(moduleSrc)![1].split(',').map((s) => s.trim());
  const classes: Record<string, any> = { AmbassadorsController, ReferralsController, EarningsController, FieldOpsController, AepsController, PayoutRunsController };
  const routes: Array<{ m: string; segs: string[]; label: string; perms: string[] | undefined; act?: unknown }> = [];
  for (const name of order) {
    const cls = classes[name];
    const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    for (const h of Object.getOwnPropertyNames(cls.prototype)) {
      const fn = cls.prototype[h];
      if (h === 'constructor' || typeof fn !== 'function') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn);
      if (m === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
      const full = [base, sub].filter((x) => x && x !== '/').join('/');
      routes.push({ m: NAME[m], segs: full.split('/').filter(Boolean), label: `${NAME[m]} /${full} (${name}.${h})`, perms: Reflect.getMetadata(PERMISSIONS_KEY, fn), act: Reflect.getMetadata(AUDITOR_READ_ACT_KEY, fn) });
    }
  }
  it('every controller of the module is in the walk; AmbassadorsController (the `:id` owner) is registered last', () => {
    expect(order.sort()).toEqual(Object.keys(classes).sort());
    expect(/controllers:\s*\[([^\]]+)\]/.exec(moduleSrc)![1].trim().endsWith('AmbassadorsController')).toBe(true);
  });
  it('no earlier route matches a later route\'s static path', () => {
    const shadows: string[] = [];
    routes.forEach((a, i) => routes.slice(i + 1).forEach((b) => {
      if (a.m !== b.m || a.segs.length !== b.segs.length) return;
      const covers = a.segs.every((s, k) => s.startsWith(':') || s === b.segs[k]);
      const differs = a.segs.some((s, k) => s.startsWith(':') && !b.segs[k].startsWith(':'));
      if (covers && differs) shadows.push(`${a.label} shadows ${b.label}`);
    }));
    expect(shadows).toEqual([]);
  });
  it('the auditor gate: every non-GET route of this module (the new reviews, the weekly run, the payout) is refused for an auditor', () => {
    const writes = routes.filter((r) => r.m !== 'GET');
    expect(writes.map((r) => r.label.split(' (')[0])).toEqual(expect.arrayContaining(['POST /ambassadors/review', 'POST /ambassadors/payouts/run', 'POST /ambassadors/:id/review', 'POST /ambassadors/:id/payout', 'POST /ambassadors/referrals/:id/activate']));
    for (const r of writes) { expect(r.act).toBeUndefined(); expect(auditorVerdict(['auditor'], r.m, r.act as never)).toBe('refused'); }
  });
  it('A2 / A13 · PC-56 TENANT-SW-b: the two 10a payout routes now PREPARE a run (ambassador.payout.prepare); confirming reads ambassador.payout; the reads stay manage', () => {
    const by = (label: string) => routes.find((r) => r.label.startsWith(label))!;
    expect(by('POST /ambassadors/:id/payout').perms).toEqual(['ambassador.payout.prepare']);
    expect(by('POST /ambassadors/payouts/run').perms).toEqual(['ambassador.payout.prepare']);
    expect(by('POST /ambassadors/payout-runs/prepare').perms).toEqual(['ambassador.payout.prepare']);
    expect(by('POST /ambassadors/payout-runs/:runId/confirm').perms).toEqual(['ambassador.payout']);
    expect(by('POST /ambassadors/payout-runs/:runId/pay').perms).toEqual(['ambassador.payout']);
    expect(by('POST /ambassadors/:id/message').perms).toEqual(['ambassador.manage']);
    expect(by('GET /ambassadors/summary').perms).toEqual(['ambassador.manage']);
    expect(by('GET /ambassadors/referrals/all').perms).toEqual(['ambassador.manage']);
    expect(by('GET /ambassadors/referrals/summary').perms).toEqual(['ambassador.manage']);
    expect(by('GET /ambassadors/leaderboard').perms).toBeUndefined();   // gated in the handler: manage OR an active ambassador
  });
});

describe('0184 + seed 0004 · the wall and the verb, as rows', () => {
  const mig = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0184_ambassador_truth.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, '../../../../../../db/seeds/core/0004_roles_permissions.sql'), 'utf8');
  it('commission_plans_ambassador: the ALL policy is dropped; SELECT admits the platform row; writes admit the tenant\'s only', () => {
    expect(mig).toContain('DROP POLICY IF EXISTS tenant_isolation_commission_plans_ambassador ON commission_plans_ambassador;');
    expect(mig).toMatch(/CREATE POLICY cpa_read\s+ON commission_plans_ambassador FOR SELECT USING \(tenant_id IS NULL OR tenant_id = current_tenant_id\(\)\);/);
    expect(mig).toMatch(/CREATE POLICY cpa_insert_own ON commission_plans_ambassador FOR INSERT WITH CHECK \(tenant_id = current_tenant_id\(\)\);/);
    expect(mig).toMatch(/CREATE POLICY cpa_update_own ON commission_plans_ambassador FOR UPDATE USING \(tenant_id = current_tenant_id\(\)\) WITH CHECK \(tenant_id = current_tenant_id\(\)\);/);
    expect(mig).toMatch(/ALTER TABLE commission_plans_ambassador FORCE ROW LEVEL SECURITY;/);
  });
  it('ambassador.payout exists in BOTH and is granted to tenant_admin ONLY', () => {
    expect(mig).toContain(`('ambassador.payout', 'Run ambassador commission payouts', 'M-AMB')`);
    expect(mig).toMatch(/SELECT r\.id, 'ambassador\.payout' FROM roles r WHERE r\.code = 'tenant_admin'/);
    expect(seed).toContain(`('ambassador.payout','Run ambassador commission payouts','M-AMB')`);
    const grants = [...seed.matchAll(/OR \(r\.code IN \(([^)]*)\) AND p\.code IN \(([^)]*)\)\)/g)].filter((m) => m[2].includes(`'ambassador.payout'`));
    expect(grants.map((g) => g[1])).toEqual([`'tenant_admin'`]);
  });
  it('one open code per tenant (F-18); activation has its own timestamp; an earning names its farmer', () => {
    expect(mig).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_open_code ON referrals(tenant_id, code) WHERE referee_user_id IS NULL;');
    expect(mig).toContain('ALTER TABLE referrals ADD COLUMN IF NOT EXISTS activated_at timestamptz;');
    expect(mig).toContain('ALTER TABLE ambassador_earnings ADD COLUMN IF NOT EXISTS subject_user_id uuid;');
    expect(mig).not.toMatch(/GRANT[^;]*TO kv_relay/);
  });
});
