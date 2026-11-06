// modules/ambassadors/__tests__/ops1c-kiosk-gate.spec.ts · PC-56 OPS-1c — OPS1-B7 (survey OPS-1 F-9) and the Q8-A consent-route refusal, unit.
//   B7 · assisted onboarding and BOTH on-behalf listing paths (create, suggest) refuse an ACTIVE ambassador whose kiosk mode is off
//        (403 AMBASSADOR_KIOSK_NOT_ENABLED) or whose training is not recorded (403 AMBASSADOR_TRAINING_INCOMPLETE) — BY NAME, after the
//        `is_active` check (an inactive person is still NOT_AN_AMBASSADOR) and before anything is read about her or written: no account, no
//        consent, no referral, no idempotency claim, no listing, no audit, no consent read. Both set → the act proceeds as before.
//   Q8-A · `ConsentService.grant` (the one writer `POST /v1/consents` and assisted onboarding share) refuses an `on_behalf_*` purpose WITH a helper
//        named on it (422 CONSENT_HELPER_NOT_RECORDED), before any transaction; the same purpose without a helper, and every other purpose with
//        one, are recorded as before.
import 'reflect-metadata';
import { AssistedOnboardingService } from '../services/assisted-onboarding.service';
import { OnBehalfListingService } from '../services/on-behalf-listing.service';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import {
  AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE, AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE, AmbassadorKioskNotEnabledError, AmbassadorTrainingIncompleteError,
  NotAnAmbassadorError, assertKioskGate,
} from '../domain/ambassadors.errors';
import { ConsentService } from '../../identity/services/consent.service';
import { CONSENT_HELPER_NOT_RECORDED_SENTENCE, ConsentHelperNotRecordedError, namesHelperOnBehalf } from '../../identity/domain/identity.errors';

const TRAINED = new Date('2026-10-01T00:00:00Z');
const prof = (kioskEnabled: boolean, trainingCompletedAt: Date | null, isActive = true) => AmbassadorProfile.rehydrate({ id: 'amb1', userId: 'ambUser', tenantId: 't',
  clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt, kioskEnabled, aepsEnabled: false, monthlyStipendMinor: 0n, lastActivityAt: null, isActive });
const actor = { userId: 'ambUser', canManage: false };

/** [label, profile, expected error class, code, sentence] */
const REFUSED: ReadonlyArray<[string, () => AmbassadorProfile, new () => Error, string, string]> = [
  ['kiosk off, trained', () => prof(false, TRAINED), AmbassadorKioskNotEnabledError, 'AMBASSADOR_KIOSK_NOT_ENABLED', AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE],
  ['kiosk on, training not recorded', () => prof(true, null), AmbassadorTrainingIncompleteError, 'AMBASSADOR_TRAINING_INCOMPLETE', AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE],
  ['kiosk off, training not recorded (kiosk named first)', () => prof(false, null), AmbassadorKioskNotEnabledError, 'AMBASSADOR_KIOSK_NOT_ENABLED', AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE],
];

function onboarding(p: AmbassadorProfile | null) {
  const tx = { query: jest.fn(async (sql: string) => (/clock_timestamp/.test(sql) ? { rows: [{ at: '2026-11-06 10:00:00+05:30' }], rowCount: 1 } : { rows: [], rowCount: 0 })) };
  const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const users = { adminCreate: jest.fn(async () => ({ id: 'farmer-new' })) };
  const consents = { grant: jest.fn() };
  const referrals = { findByReferee: jest.fn(async () => null), insert: jest.fn() };
  const profiles = { findByUser: jest.fn(async () => p), touchActivity: jest.fn(async () => 1) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => fn()) };
  const svc = new AssistedOnboardingService(uow as never, outbox as never, idem as never, { inc: jest.fn(), observe: jest.fn() } as never,
    users as never, consents as never, referrals as never, profiles as never);
  return { svc, uow, outbox, users, consents, referrals, profiles, idem };
}
function onBehalf(p: AmbassadorProfile | null, granted = true) {
  const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn({ query: jest.fn() })) };
  const docs = { suggest: jest.fn(async () => ({ fields: {}, needsReview: true })) };
  const audit = { write: jest.fn() };
  const listings = { create: jest.fn(async () => ({ id: 'listing-1' })) };
  const consents = { isGranted: jest.fn(async () => granted) };
  const profiles = { findByUser: jest.fn(async () => p), touchActivity: jest.fn(async () => 1) };
  const svc = new OnBehalfListingService(uow as never, docs as never, audit as never, listings as never, consents as never, profiles as never);
  return { svc, uow, docs, audit, listings, consents, profiles };
}
const onboardDto = { phone: '9876500077', languageCode: 'gu', countryCode: 'IN', consents: [{ purposeCode: 'terms', granted: true }] } as never;
const listingDto = { farmerUserId: 'farmer-1', listing: { title: 'x' } } as never;
const suggestDto = { farmerUserId: 'farmer-1', docText: 'text', locale: 'gu' } as never;

describe('PC-56 OPS-1c · OPS1-B7 · the kiosk and training gate (pure)', () => {
  it('both set → passes; kiosk off → KIOSK_NOT_ENABLED; training null → TRAINING_INCOMPLETE; both missing → kiosk named first', () => {
    expect(() => assertKioskGate({ kioskEnabled: true, trainingCompletedAt: TRAINED })).not.toThrow();
    expect(() => assertKioskGate({ kioskEnabled: true, trainingCompletedAt: '2026-10-01T00:00:00Z' })).not.toThrow();
    expect(() => assertKioskGate({ kioskEnabled: false, trainingCompletedAt: TRAINED })).toThrow(AmbassadorKioskNotEnabledError);
    expect(() => assertKioskGate({ kioskEnabled: true, trainingCompletedAt: null })).toThrow(AmbassadorTrainingIncompleteError);
    expect(() => assertKioskGate({ kioskEnabled: false, trainingCompletedAt: null })).toThrow(AmbassadorKioskNotEnabledError);
  });
  it('each refusal: 403, its code, its English sentence that says nothing was written', () => {
    expect(new AmbassadorKioskNotEnabledError()).toMatchObject({ code: 'AMBASSADOR_KIOSK_NOT_ENABLED', httpStatus: 403, message: AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE });
    expect(new AmbassadorTrainingIncompleteError()).toMatchObject({ code: 'AMBASSADOR_TRAINING_INCOMPLETE', httpStatus: 403, message: AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE });
    for (const s of [AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE, AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE]) expect(s).toMatch(/Nothing was written\.$/);
  });
});

describe('PC-56 OPS-1c · OPS1-B7 · assisted onboarding', () => {
  it.each(REFUSED.map((r) => [r[0], r]))('%s → refused by name, NOTHING written (no account, consent, referral, idempotency claim, activity)', async (_l, [, p, Cls, code, sentence]) => {
    const h = onboarding(p());
    const err = await h.svc.onboard('t', actor, 'k', onboardDto, null).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Cls);
    expect(err).toMatchObject({ code, httpStatus: 403, message: sentence });
    expect(h.idem.remember).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.users.adminCreate).not.toHaveBeenCalled();
    expect(h.consents.grant).not.toHaveBeenCalled(); expect(h.referrals.insert).not.toHaveBeenCalled(); expect(h.outbox.write).not.toHaveBeenCalled();
    expect(h.profiles.touchActivity).not.toHaveBeenCalled();
  });
  it('an INACTIVE person is still NOT_AN_AMBASSADOR (the active check comes first), and so is no profile', async () => {
    await expect(onboarding(prof(false, null, false)).svc.onboard('t', actor, 'k', onboardDto, null)).rejects.toBeInstanceOf(NotAnAmbassadorError);
    await expect(onboarding(null).svc.onboard('t', actor, 'k', onboardDto, null)).rejects.toBeInstanceOf(NotAnAmbassadorError);
  });
  it('both gates set → onboarded as before (one account, one consent, one referral)', async () => {
    const h = onboarding(prof(true, TRAINED));
    const out = await h.svc.onboard('t', actor, 'k', onboardDto, null);
    expect(out.user.id).toBe('farmer-new');
    expect([h.users.adminCreate.mock.calls.length, h.consents.grant.mock.calls.length, h.referrals.insert.mock.calls.length]).toEqual([1, 1, 1]);
  });
});

describe('PC-56 OPS-1c · OPS1-B7 · both on-behalf listing paths', () => {
  it.each(REFUSED.map((r) => [r[0], r]))('create · %s → refused by name; no consent read, no listing, no audit, no activity', async (_l, [, p, Cls, code]) => {
    const h = onBehalf(p());
    const err = await h.svc.createListing('t', actor, 'k', listingDto, null).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Cls); expect(err).toMatchObject({ code, httpStatus: 403 });
    expect(h.consents.isGranted).not.toHaveBeenCalled(); expect(h.listings.create).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.profiles.touchActivity).not.toHaveBeenCalled();
  });
  it.each(REFUSED.map((r) => [r[0], r]))('suggest · %s → refused by name; no consent read, no model call', async (_l, [, p, Cls, code]) => {
    const h = onBehalf(p());
    const err = await h.svc.suggestFromDocs('t', actor, suggestDto).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(Cls); expect(err).toMatchObject({ code, httpStatus: 403 });
    expect(h.consents.isGranted).not.toHaveBeenCalled(); expect(h.docs.suggest).not.toHaveBeenCalled();
  });
  it('an inactive person is NOT_AN_AMBASSADOR on both paths', async () => {
    await expect(onBehalf(prof(false, null, false)).svc.createListing('t', actor, 'k', listingDto, null)).rejects.toBeInstanceOf(NotAnAmbassadorError);
    await expect(onBehalf(prof(true, TRAINED, false)).svc.suggestFromDocs('t', actor, suggestDto)).rejects.toBeInstanceOf(NotAnAmbassadorError);
  });
  it('both gates set → the consent gate is what answers next (as before), and with her grant the listing is created and audited', async () => {
    const no = onBehalf(prof(true, TRAINED), false);
    await expect(no.svc.createListing('t', actor, 'k', listingDto, null)).rejects.toMatchObject({ code: 'ON_BEHALF_CONSENT_REQUIRED' });
    const yes = onBehalf(prof(true, TRAINED), true);
    await expect(yes.svc.createListing('t', actor, 'k', listingDto, null)).resolves.toEqual({ id: 'listing-1' });
    expect(yes.audit.write).toHaveBeenCalledTimes(1);
    await expect(onBehalf(prof(true, TRAINED), true).svc.suggestFromDocs('t', actor, suggestDto)).resolves.toMatchObject({ needsReview: true });
  });
});

describe('PC-56 OPS-1c · Q8-A · no route records an on-behalf consent with a helper named', () => {
  const svc = () => {
    const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn({ query: jest.fn() })) };
    const outbox = { write: jest.fn() };
    const repo = { currentPublishedVersion: jest.fn(async () => null), record: jest.fn() };
    return { s: new ConsentService(uow as never, outbox as never, repo as never), uow, outbox, repo };
  };
  it.each([['on_behalf_listing'], ['ON_BEHALF_LISTING'], [' on_behalf_listing '], ['on_behalf_kyc']])('%s + assistedBy → 422 CONSENT_HELPER_NOT_RECORDED, nothing read or written', async (purposeCode) => {
    const h = svc();
    const err = await h.s.grant('t', 'farmer-1', { purposeCode, granted: true, channel: 'app', assistedBy: '0192aaaa-0000-7000-8000-000000000001' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ConsentHelperNotRecordedError);
    expect(err).toMatchObject({ code: 'CONSENT_HELPER_NOT_RECORDED', httpStatus: 422, message: CONSENT_HELPER_NOT_RECORDED_SENTENCE });
    expect(h.uow.run).not.toHaveBeenCalled(); expect(h.repo.record).not.toHaveBeenCalled(); expect(h.outbox.write).not.toHaveBeenCalled();
  });
  it('granted: false with a helper named is refused too (the pairing is not recorded at all)', async () => {
    await expect(svc().s.grant('t', 'f', { purposeCode: 'on_behalf_listing', granted: false, channel: 'ambassador_assisted', assistedBy: '0192aaaa-0000-7000-8000-000000000001' }))
      .rejects.toBeInstanceOf(ConsentHelperNotRecordedError);
  });
  it('the same purpose WITHOUT a helper, and any other purpose WITH one, are recorded as before', async () => {
    const a = svc(); await a.s.grant('t', 'f', { purposeCode: 'on_behalf_listing', granted: true, channel: 'app' }); expect(a.repo.record).toHaveBeenCalledTimes(1);
    const b = svc(); await b.s.grant('t', 'f', { purposeCode: 'terms', granted: true, channel: 'ambassador_assisted', assistedBy: '0192aaaa-0000-7000-8000-000000000001' }); expect(b.repo.record).toHaveBeenCalledTimes(1);
    expect([namesHelperOnBehalf({ purposeCode: 'on_behalf_listing', assistedBy: '' }), namesHelperOnBehalf({ purposeCode: 'on_behalf_listing', assistedBy: null }),
      namesHelperOnBehalf({ purposeCode: 'privacy', assistedBy: 'x' }), namesHelperOnBehalf({ purposeCode: 'on_behalf_listing', assistedBy: 'x' })]).toEqual([false, false, false, true]);
  });
});
