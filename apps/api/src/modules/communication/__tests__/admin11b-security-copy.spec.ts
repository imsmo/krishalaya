// apps/api/src/modules/communication/__tests__/admin11b-security-copy.spec.ts · PC-56 ADMIN-11b, tenant realm.
//
// **THE SECOND LAYER, TESTED ALONE.** 0122 adds a trigger that refuses a tenant-scoped template row for an opt-out-locked
// or critical event, and the tenant realm's writer refuses the same thing before the write. Both exist on purpose — this
// table has three writers and a service check binds one of them — and the ADMIN-9b lesson is that defence in depth
// verified only through the outer layer is one layer with a story about a second. This file exercises the SERVICE layer
// with no database in the room.
//
// [PC-56 TENANT-8a] The writer is `TemplateOverrideService.saveDraft` now (PC-27's `TemplateAdminService.upsert` wrote
// the row's body in place and never sent — F-1). The refusal is the REVIEW's (`SECURITY_COPY_PLATFORM_ONLY`), the same
// function the form's preview runs, so the screen and the write cannot disagree.
import { TemplateOverrideService } from '../services/template-override.service';
import { NotificationEvent } from '../domain/notification-event.entity';
import { TemplateFormRefusedError } from '../domain/communication.errors';

const event = (over: Partial<{ code: string; priority: string; userCanOptOut: boolean }> = {}) =>
  NotificationEvent.rehydrate({
    code: 'order.delivered', defaultName: 'Order delivered', priority: 'important',
    defaultChannels: ['sms', 'push'], userCanOptOut: true, batchable: false, ...over,
  } as never);

function make(over: { event?: unknown } = {}) {
  const insertOverrideRow = jest.fn().mockResolvedValue(undefined);
  const insertDraftVersion = jest.fn().mockResolvedValue('v-1');
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ query: jest.fn() })) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => fn()) };
  const audit = { write: jest.fn() };
  const metrics = { inc: jest.fn() };
  const events = { getByCode: jest.fn().mockResolvedValue(over.event === undefined ? event() : over.event) };
  const templates = {
    variablesFor: jest.fn().mockResolvedValue([]), activeLanguages: jest.fn().mockResolvedValue([{ code: 'gu', nameEnglish: 'Gujarati', nameNative: 'ગુજરાતી' }]),
    tenantLanguageOrder: jest.fn().mockResolvedValue([]), slot: jest.fn().mockResolvedValue(null), servingWords: jest.fn().mockResolvedValue(null),
    lockOverride: jest.fn().mockResolvedValue(null), nextVersionNo: jest.fn().mockResolvedValue(1), insertOverrideRow, insertDraftVersion,
  };
  const svc = new TemplateOverrideService(uow as never, audit as never, idem as never, metrics as never, events as never, templates as never);
  return { svc, insertOverrideRow, insertDraftVersion, audit };
}

const actor = { userId: 'user-1', canAuthor: true, canApprove: false };
const dto = { eventCode: 'order.delivered', channel: 'sms', languageCode: 'gu', body: 'તમારો ઓર્ડર પહોંચી ગયો', reason: 'our pickup point' };

describe('ADMIN-11b · the tenant realm refuses security copy on its own', () => {
  it('refuses an override on an event a user cannot opt out of — and writes nothing', async () => {
    const { svc, insertOverrideRow, insertDraftVersion } = make({ event: event({ code: 'auth.otp', priority: 'critical', userCanOptOut: false }) });
    const p = svc.saveDraft('tenant-1', actor, 'k1', { ...dto, eventCode: 'auth.otp' }, null);
    await expect(p).rejects.toBeInstanceOf(TemplateFormRefusedError);
    await expect(p).rejects.toMatchObject({ details: { refusals: expect.arrayContaining([{ field: 'eventCode', code: 'SECURITY_COPY_PLATFORM_ONLY' }]) } });
    // **AND NOTHING WAS WRITTEN.** A refusal that reaches the repository first would leave the row and fail afterwards.
    expect(insertOverrideRow).not.toHaveBeenCalled();
    expect(insertDraftVersion).not.toHaveBeenCalled();
  });

  it('refuses on either half of the test, separately', async () => {
    // Not opt-out-able but only 'important' — a dispute notice.
    const a = make({ event: event({ code: 'dispute.raised', priority: 'important', userCanOptOut: false }) });
    await expect(a.svc.saveDraft('t', actor, 'k', { ...dto, eventCode: 'dispute.raised' }, null)).rejects.toBeInstanceOf(TemplateFormRefusedError);
    // Critical but opt-out-able — the operational half, still security copy.
    const b = make({ event: event({ code: 'payout.failed', priority: 'critical', userCanOptOut: true }) });
    await expect(b.svc.saveDraft('t', actor, 'k', { ...dto, eventCode: 'payout.failed' }, null)).rejects.toBeInstanceOf(TemplateFormRefusedError);
  });

  it('still allows a tenant its own wording on ordinary copy — as a DRAFT, audited', async () => {
    const { svc, insertOverrideRow, insertDraftVersion, audit } = make();
    const r = await svc.saveDraft('tenant-1', actor, 'k2', dto, null);
    expect(insertOverrideRow).toHaveBeenCalledTimes(1);
    expect(insertDraftVersion).toHaveBeenCalledTimes(1);
    expect(r.lifecycle).toBe('draft');
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'communication.template.draft', entityType: 'notification_template', reason: 'our pickup point' }));
  });

  it('refuses an event that is not in the catalogue', async () => {
    // Unknown is not permitted: an event code with no catalogue row cannot be shown to be safe to override.
    const { svc, insertOverrideRow } = make({ event: null });
    await expect(svc.saveDraft('t', actor, 'k', { ...dto, eventCode: 'made.up' }, null)).rejects.toMatchObject({ details: { refusals: expect.arrayContaining([{ field: 'eventCode', code: 'EVENT_UNKNOWN' }]) } });
    expect(insertOverrideRow).not.toHaveBeenCalled();
  });

  it('a member without the author verb is refused by the review, not by a bare 403', async () => {
    const { svc, insertOverrideRow } = make();
    await expect(svc.saveDraft('t', { userId: 'u', canAuthor: false, canApprove: true }, 'k', dto, null)).rejects.toMatchObject({ details: { refusals: expect.arrayContaining([{ field: null, code: 'NO_PERMISSION' }]) } });
    expect(insertOverrideRow).not.toHaveBeenCalled();
  });
});
