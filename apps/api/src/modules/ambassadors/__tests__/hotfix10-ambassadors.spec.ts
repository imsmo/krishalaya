// modules/ambassadors/__tests__/hotfix10-ambassadors.spec.ts · PC-56 HOTFIX-10 — the ambassador half of "the desk learns nothing it should not".
//   H10-2 · `AepsController` carries the module's `ambassadors` flag (metadata read the way FeatureFlagGuard reads it) + the guard;
//           the record writes ONE audit row in its transaction and the supervisor read ONE row before returning — neither with a customer digit.
//   H10-3 · assisted onboarding refuses, BY NAME and before any read or write, a consent that empowers the helper (`on_behalf_listing`,
//           any `on_behalf_*`), whatever `granted` says; the existing-phone race keeps its TENANT-10a name (AMB_EXISTING_USER).
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FEATURE_FLAG_KEY, FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { AepsController } from '../controllers/v1/aeps.controller';
import { FieldOpsController } from '../controllers/v1/field-ops.controller';
import { AepsService, aepsRecordAuditValue } from '../services/aeps.service';
import { AssistedOnboardingService, assistedGrantable, ASSISTED_UNGRANTABLE_PURPOSES } from '../services/assisted-onboarding.service';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { AssistedConsentNotGrantableError, AssistedOnboardingExistingUserError } from '../domain/ambassadors.errors';
import { UserPhoneAlreadyRegisteredError } from '../../identity/domain/identity.errors';

const flagsOf = (cls: object): string[] => ([] as string[]).concat(Reflect.getMetadata(FEATURE_FLAG_KEY, cls) ?? []);
const profile = (over: Partial<{ aepsEnabled: boolean; isActive: boolean }> = {}) => AmbassadorProfile.rehydrate({ id: 'amb1', userId: 'ambUser', tenantId: 't', clusterRegionIds: [], tierId: null,
  mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: true, aepsEnabled: over.aepsEnabled ?? true, monthlyStipendMinor: 0n, lastActivityAt: null, isActive: over.isActive ?? true });

describe('HOTFIX-10 · H10-2 · the AePS log is behind the ambassadors kill-switch', () => {
  it('AepsController names `ambassadors` exactly as its sibling FieldOpsController does, and runs FeatureFlagGuard', () => {
    expect(flagsOf(AepsController)).toEqual(['ambassadors']);
    expect(flagsOf(AepsController)).toEqual(flagsOf(FieldOpsController));
    expect(Reflect.getMetadata(GUARDS_METADATA, AepsController)).toContain(FeatureFlagGuard);
  });
});

describe('HOTFIX-10 · H10-2 · the AePS log is audited', () => {
  const build = () => {
    const tx = { query: jest.fn() };
    const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn(tx)) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => fn()) };
    const repo = { insert: jest.fn(async () => '4711'), list: jest.fn(async () => [{ id: '1', aadhaarLast4: '9876', accountLast4: '4321' }, { id: '2' }]), listForAmbassador: jest.fn(async () => []) };
    const profiles = { findByUser: jest.fn(async () => profile()), touchActivity: jest.fn(async () => 1) };
    const audit = { write: jest.fn(), log: jest.fn() };
    return { svc: new AepsService(uow as never, idem as never, repo as never, profiles as never, audit as never), repo, audit, tx };
  };
  const dto = { serviceKind: 'cash_withdrawal', status: 'success', attemptNo: 1, deviceCertified: true, amountMinor: '200000', bankName: 'Bank of Baroda',
    accountLast4: '4321', aadhaarLast4: '9876', customerUserId: '0190a000-0000-7000-8000-00000000c0de', npciRrn: 'RRN998877' };

  it('a record → one row + ONE `ambassadors.aeps_event_recorded` audit row in the same transaction, with no customer digit', async () => {
    const h = build();
    await h.svc.record('t', 'ambUser', 'k1', dto as never, '10.0.0.9');
    expect(h.repo.insert).toHaveBeenCalledTimes(1);
    expect(h.audit.write).toHaveBeenCalledTimes(1);
    const [tx, row] = h.audit.write.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(tx).toBe(h.tx);
    expect(row).toMatchObject({ tenantId: 't', actorUserId: 'ambUser', action: 'ambassadors.aeps_event_recorded', entityType: 'ambassador_profile', entityId: 'amb1', ip: '10.0.0.9' });
    expect(row.newValue).toEqual({ eventId: '4711', serviceKind: 'cash_withdrawal', status: 'success', exceptionCode: null, attemptNo: 1, deviceCertified: true });
    const said = JSON.stringify(row);
    for (const leak of ['9876', '4321', 'Bank of Baroda', '200000', 'c0de', 'RRN998877']) expect(said).not.toContain(leak);
  });

  it('a refused record (an uncertified device claiming success) writes nothing — not even the audit row', async () => {
    const h = build();
    await expect(h.svc.record('t', 'ambUser', 'k2', { ...dto, deviceCertified: false } as never)).rejects.toMatchObject({ httpStatus: 400 });
    expect(h.repo.insert).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('a supervisor read → ONE `ambassadors.aeps_events_read` row (filters + count only), written before the rows are returned', async () => {
    const h = build();
    const rows = await h.svc.oversight('t', 'supervisor', { status: 'failed', limit: 100 }, '10.0.0.7');
    expect(rows).toHaveLength(2);
    expect(h.audit.log).toHaveBeenCalledTimes(1);
    const row = h.audit.log.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ tenantId: 't', actorUserId: 'supervisor', action: 'ambassadors.aeps_events_read', entityType: 'aeps_service_events', ip: '10.0.0.7' });
    expect(row.newValue).toEqual({ status: 'failed', exceptionCode: null, limit: 100, rows: 2, windowDays: 90 });
    expect(JSON.stringify(row)).not.toContain('9876');
  });

  it('if the read cannot be recorded it is not served', async () => {
    const h = build();
    h.audit.log.mockImplementationOnce(async () => { throw new Error('audit down'); });
    await expect(h.svc.oversight('t', 'supervisor', { limit: 10 })).rejects.toThrow('audit down');
  });

  it('aepsRecordAuditValue carries only the event\'s kind and outcome', () => {
    expect(Object.keys(aepsRecordAuditValue('1', dto as never)).sort()).toEqual(['attemptNo', 'deviceCertified', 'eventId', 'exceptionCode', 'serviceKind', 'status']);
  });
});

describe('HOTFIX-10 · H10-3 · assisted onboarding never records a consent that empowers the helper', () => {
  const build = () => {
    const tx = { query: jest.fn(async (sql: string) => (/clock_timestamp/.test(sql) ? { rows: [{ at: '2026-11-05 10:00:00+05:30' }], rowCount: 1 } : { rows: [], rowCount: 0 })) };
    const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => unknown) => fn(tx)) };
    const users = { adminCreate: jest.fn(async () => ({ id: 'farmer-new' })) };
    const consents = { grant: jest.fn() };
    const referrals = { findByReferee: jest.fn(async () => null), insert: jest.fn() };
    const profiles = { findByUser: jest.fn(async () => profile()), touchActivity: jest.fn(async () => 1) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => fn()) };
    const svc = new AssistedOnboardingService(uow as never, { write: jest.fn() } as never, idem as never, { inc: jest.fn(), observe: jest.fn() } as never,
      users as never, consents as never, referrals as never, profiles as never);
    return { svc, users, consents, referrals, profiles, uow, idem };
  };
  const actor = { userId: 'ambUser', canManage: false };
  const dto = (consents: Array<{ purposeCode: string; granted: boolean }>) => ({ phone: '9876500001', languageCode: 'gu', countryCode: 'IN', consents }) as never;

  for (const purposeCode of ['on_behalf_listing', 'ON_BEHALF_LISTING', 'on_behalf_sale', 'on_behalf_kyc']) {
    for (const granted of [true, false]) {
      it(`'${purposeCode}' (granted: ${granted}) → ASSISTED_CONSENT_NOT_GRANTABLE before ANY read or write`, async () => {
        const h = build();
        const err = await h.svc.onboard('t', actor, 'k', dto([{ purposeCode: 'terms', granted: true }, { purposeCode, granted }]), null).then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(AssistedConsentNotGrantableError);
        expect(err).toMatchObject({ code: 'ASSISTED_CONSENT_NOT_GRANTABLE', httpStatus: 422, details: { purposeCode } });
        expect((err as Error).message).toBe('A consent that lets the helper act for her cannot be recorded by the helper. She gives it herself, on her own phone.');
        expect(h.profiles.findByUser).not.toHaveBeenCalled(); expect(h.uow.run).not.toHaveBeenCalled(); expect(h.idem.remember).not.toHaveBeenCalled();
        expect(h.users.adminCreate).not.toHaveBeenCalled(); expect(h.consents.grant).not.toHaveBeenCalled(); expect(h.referrals.insert).not.toHaveBeenCalled();
      });
    }
  }

  it('the registry: on_behalf_listing is named; the farmer\'s own purposes stay grantable', () => {
    expect(ASSISTED_UNGRANTABLE_PURPOSES).toContain('on_behalf_listing');
    for (const p of ['terms', 'privacy', 'marketing', 'ai_training', 'data_sharing', 'location']) expect(assistedGrantable(p)).toBe(true);
    expect(assistedGrantable('on_behalf_listing')).toBe(false);
  });

  it('only grantable purposes → onboarded as before (one grant per purpose, channel ambassador_assisted)', async () => {
    const h = build();
    const out = await h.svc.onboard('t', actor, 'k', dto([{ purposeCode: 'terms', granted: true }, { purposeCode: 'privacy', granted: true }]), null);
    expect(out.user.id).toBe('farmer-new');
    expect(h.consents.grant).toHaveBeenCalledTimes(2);
    expect(h.consents.grant.mock.calls.map((c: unknown[]) => (c[2] as { channel: string }).channel)).toEqual(['ambassador_assisted', 'ambassador_assisted']);
  });

  it('the existing-phone race now surfacing from adminCreate keeps its TENANT-10a name — AMB_EXISTING_USER, no consent, no referral', async () => {
    const h = build();
    h.users.adminCreate.mockImplementationOnce(async () => { throw new UserPhoneAlreadyRegisteredError(); });
    await expect(h.svc.onboard('t', actor, 'k', dto([{ purposeCode: 'terms', granted: true }]), null)).rejects.toBeInstanceOf(AssistedOnboardingExistingUserError);
    expect(h.consents.grant).not.toHaveBeenCalled(); expect(h.referrals.insert).not.toHaveBeenCalled();
  });
});
