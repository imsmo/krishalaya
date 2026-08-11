// apps/api/src/modules/communication/__tests__/admin11b-security-copy.spec.ts · PC-56 ADMIN-11b, tenant realm.
//
// **THE SECOND LAYER, TESTED ALONE.** 0122 adds a trigger that refuses a tenant-scoped template row for an opt-out-locked
// or critical event, and `TemplateAdminService` refuses the same thing before the write. Both exist on purpose — this
// table has three writers and a service check binds one of them — and the ADMIN-9b lesson is that defence in depth
// verified only through the outer layer is one layer with a story about a second. This file exercises the SERVICE layer
// with no database in the room.
import { TemplateAdminService } from '../services/template-admin.service';
import { NotificationEvent } from '../domain/notification-event.entity';
import { SecurityCopyPlatformOnlyError, NotificationEventNotFoundError } from '../domain/communication.errors';

const event = (over: Partial<{ code: string; priority: string; userCanOptOut: boolean }> = {}) =>
  NotificationEvent.rehydrate({
    code: 'order.delivered', defaultName: 'Order delivered', priority: 'important',
    defaultChannels: ['sms'], userCanOptOut: true, batchable: false, ...over,
  } as never);

function make(over: { event?: unknown } = {}) {
  const upsert = jest.fn().mockResolvedValue(undefined);
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ query: jest.fn() })) };
  const events = { getByCode: jest.fn().mockResolvedValue(over.event ?? event()) };
  const templates = { upsert, listFor: jest.fn().mockResolvedValue([]) };
  const svc = new TemplateAdminService(uow as never, events as never, templates as never);
  return { svc, upsert, uow, events };
}

const dto = {
  eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', subject: null,
  body: 'તમારો ઓર્ડર પહોંચી ગયો', providerTemplateRef: null, isActive: true,
};

describe('ADMIN-11b · the tenant realm refuses security copy on its own', () => {
  // W101: "auth.otp and dispute events are opt-out-locked and tenant overrides are disabled on them — security copy
  // stays platform-controlled." Before this wave the method checked that the event EXISTED and nothing else, while
  // `resolve()` sorts `tenant_id NULLS LAST` — so a tenant row beat the platform default for every event including
  // `auth.otp`, and any tenant with `notification.manage` could rewrite the OTP message its farmers receive.
  it('refuses an override on an event a user cannot opt out of', async () => {
    const { svc, upsert } = make({ event: event({ code: 'auth.otp', priority: 'critical', userCanOptOut: false }) });
    await expect(svc.upsert('tenant-1', 'user-1', { ...dto, eventCode: 'auth.otp' }))
      .rejects.toBeInstanceOf(SecurityCopyPlatformOnlyError);
    // **AND NOTHING WAS WRITTEN.** A refusal that reaches the repository first would leave the row and fail afterwards.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses on either half of the test, separately', async () => {
    // Not opt-out-able but only 'important' — a dispute notice.
    const a = make({ event: event({ code: 'dispute.raised', priority: 'important', userCanOptOut: false }) });
    await expect(a.svc.upsert('t', 'u', { ...dto, eventCode: 'dispute.raised' })).rejects.toBeInstanceOf(SecurityCopyPlatformOnlyError);
    // Critical but opt-out-able — the operational half, still security copy.
    const b = make({ event: event({ code: 'payout.failed', priority: 'critical', userCanOptOut: true }) });
    await expect(b.svc.upsert('t', 'u', { ...dto, eventCode: 'payout.failed' })).rejects.toBeInstanceOf(SecurityCopyPlatformOnlyError);
  });

  it('still allows a tenant its own wording on ordinary copy', async () => {
    // The rule is narrow deliberately: a tenant branding its delivery message is the feature, and refusing that would
    // break the white-label promise rule zero exists to protect.
    const { svc, upsert } = make();
    await svc.upsert('tenant-1', 'user-1', dto);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses an event that is not in the catalogue before it looks at anything else', async () => {
    // Unknown is not permitted: an event code with no catalogue row cannot be shown to be safe to override.
    const { svc, upsert } = make();
    (svc as unknown as { events: { getByCode: jest.Mock } }).events.getByCode.mockResolvedValue(null);
    await expect(svc.upsert('t', 'u', { ...dto, eventCode: 'made.up' })).rejects.toBeInstanceOf(NotificationEventNotFoundError);
    expect(upsert).not.toHaveBeenCalled();
  });
});
