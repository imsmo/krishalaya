// modules/communication/__tests__/routine-fanout.spec.ts · DEV-07 (Development Program): the Q24/DELTA-059
// ruling wired into NotificationService.fanout() — decided at G0-4 2026-07-22, verbatim + tier mapping in
// Development_Program/spec_dev07.md. Founder's own test brief, reproduced as the six cases below:
//   (a) a routine-priority event picks exactly ONE primary channel;
//   (b) a delivery failure on that primary enqueues the SMS fallback exactly once;
//   (c) routine NEVER fans out to all channels, even when the catalog lists 3+ (assert the send count directly);
//   (d) critical/important tiers are UNAFFECTED — still multi-channel even with the flag ON;
//   (e) flag OFF ⇒ old multi-channel behavior (the kill-switch);
//   (f) idempotent under retry — a relay re-delivery derives the SAME ids for both the primary and the SMS
//       fallback (this module's existing, documented idempotency guarantee: the gateway dedups on a
//       deterministic id — see notification.service.ts's own deriveId() header comment — never a second
//       provider-side send).
// Same fake-harness convention as notification.service.spec.ts (plain `new`, no Nest TestingModule).
import { NotificationService, ROUTINE_FANOUT_FLAG } from '../services/notification.service';
import { NotificationEvent } from '../domain/notification-event.entity';
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotificationPreference } from '../domain/notification-preference.entity';
import { NotifChannel } from '../domain/communication.events';

const template = (channel: NotifChannel) => NotificationTemplate.rehydrate({ id: `tmpl-${channel}`, eventCode: 'x', channel, languageCode: 'en', tenantId: null, subject: null, body: 'hi {{x}}', providerTemplateRef: null, isActive: true });

interface HarnessOpts {
  event: NotificationEvent;
  prefs?: NotificationPreference[];
  routineFlagOn?: boolean;
  /** Per-channel dispatch outcome for the external gateway (whatsapp/sms/email/ivr) — defaults to 'accepted'. */
  dispatchByChannel?: Partial<Record<NotifChannel, 'accepted' | 'failed'>>;
}

function harness(opts: HarnessOpts) {
  const inserted: any[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const gateway = {
    providerCode: 'fake',
    dispatch: jest.fn(async (input: { channel: NotifChannel; idempotencyKey: string }) => {
      const status = opts.dispatchByChannel?.[input.channel] ?? 'accepted';
      return { status, providerMsgRef: `pmr-${input.channel}`, costMinor: 3 };
    }),
  };
  const events = { getByCode: jest.fn(async () => opts.event) };
  const templates = { resolve: jest.fn(async (_t: any, _e: string, channel: NotifChannel) => template(channel)) };
  const prefs = {
    listForUser: jest.fn(async () => opts.prefs ?? []),
    mapForUsers: jest.fn(async (ids: readonly string[]) => new Map(ids.map((id) =>
      [id, new Map((opts.prefs ?? []).filter((p) => p.toJSON().userId === id).map((p) => [p.channel, p.isEnabled]))]))),
  };
  const quiet = { getForUser: jest.fn(async () => null), mapForUsers: jest.fn(async () => new Map()) };
  const pushSender = {
    providerCode: 'fake',
    send: jest.fn(async () => (opts.dispatchByChannel?.push === 'failed' ? { sent: 0, invalidTokens: [], failureReason: 'push_failed' } : { sent: 1, invalidTokens: [] })),
  };
  const devices = { activeTokensForUser: jest.fn(async () => [{ token: 'tok', platform: 'android' }]), deactivate: jest.fn(async () => 1) };
  const notifications = { insert: jest.fn(async (_tx: any, n: any) => { inserted.push(n); }),
    // PC-56 TENANT-4d-5: the fake gains the address check the real repository now performs. `true` here
    // keeps every pre-existing assertion in this file about WHICH channels are attempted — the contactability
    // question is a separate axis and is covered behaviourally in tenant4d5-billing-notices.spec.ts, including
    // the case where it is false.
    contactableOn: jest.fn(async () => true),
    profilesFor: jest.fn(async (_tx: unknown, ids: readonly string[]) => new Map(ids.map((id) => [id, { languageCode: 'en', hasEmail: true, hasPhone: true }]))),
    getForUserUpdate: jest.fn(async () => null), update: jest.fn(), getByProviderRef: jest.fn() };
  const flags = { isEnabled: jest.fn(async (key: string) => (key === ROUTINE_FANOUT_FLAG ? (opts.routineFlagOn ?? false) : false)) };
  const svc = new NotificationService(uow as any, outbox as any, metrics as any, gateway as any, pushSender as any, devices as any, events as any, templates as any, prefs as any, quiet as any, notifications as any, flags as any);
  return { svc, tx, gateway, pushSender, notifications, inserted, metrics, flags };
}

const informational = (over: Partial<any> = {}) => NotificationEvent.rehydrate({ code: 'requirement.matched', defaultName: 'A listing matches your requirement', priority: 'informational', defaultChannels: ['push', 'inapp'] as NotifChannel[], userCanOptOut: true, batchable: true, ...over });
const promotional3ch = () => NotificationEvent.rehydrate({ code: 'test.promo_3ch', defaultName: 'Promo', priority: 'promotional', defaultChannels: ['whatsapp', 'sms', 'push'] as NotifChannel[], userCanOptOut: true, batchable: true });
const important = () => NotificationEvent.rehydrate({ code: 'order.delivered', defaultName: 'Order delivered', priority: 'important', defaultChannels: ['push', 'sms', 'whatsapp'] as NotifChannel[], userCanOptOut: true, batchable: false });

describe('Q24/DELTA-059 routine fan-out policy (flag ON)', () => {
  it('(a) a routine event picks exactly ONE primary (non-passive) channel', async () => {
    const h = harness({ event: informational(), routineFlagOn: true });
    await h.svc.fanout(h.tx as any, { tenantId: 't1', eventCode: 'requirement.matched', recipients: ['u1'], payload: {}, dedupeKey: 'e1' });
    const nonPassive = h.inserted.filter((n) => n.toProps().channel !== 'inapp');
    expect(nonPassive).toHaveLength(1);
    expect(nonPassive[0].toProps().channel).toBe('push');           // first non-passive in default_channels order
    expect(h.inserted.map((n) => n.toProps().channel).sort()).toEqual(['inapp', 'push']); // passive still recorded
  });

  it('(b) a primary delivery failure enqueues the SMS fallback exactly once', async () => {
    const h = harness({ event: promotional3ch(), routineFlagOn: true, dispatchByChannel: { whatsapp: 'failed', sms: 'accepted' } });
    await h.svc.fanout(h.tx as any, { tenantId: 't1', eventCode: 'test.promo_3ch', recipients: ['u1'], payload: {}, dedupeKey: 'e2' });
    const channels = h.inserted.map((n) => n.toProps().channel);
    expect(channels).toEqual(['whatsapp', 'sms']);                  // primary (failed) + exactly ONE fallback row
    const whatsapp = h.inserted.find((n) => n.toProps().channel === 'whatsapp');
    const sms = h.inserted.find((n) => n.toProps().channel === 'sms');
    expect(whatsapp.status).toBe('failed');
    expect(sms.status).toBe('sent');
    expect(h.gateway.dispatch).toHaveBeenCalledTimes(2);             // whatsapp attempt + sms fallback, no more
  });

  it('(c) NEVER fans out to all channels for routine, even with 3 catalog channels (assert send count)', async () => {
    const h = harness({ event: promotional3ch(), routineFlagOn: true });   // all succeed — no fallback needed
    await h.svc.fanout(h.tx as any, { tenantId: 't1', eventCode: 'test.promo_3ch', recipients: ['u1'], payload: {}, dedupeKey: 'e3' });
    expect(h.inserted).toHaveLength(1);                              // NOT 3 — the catalog had 3 candidates
    expect(h.inserted[0].toProps().channel).toBe('whatsapp');
    expect(h.gateway.dispatch).toHaveBeenCalledTimes(1);
  });

  it('(d) critical/important tiers stay multi-channel — UNAFFECTED even with the flag ON', async () => {
    const h = harness({ event: important(), routineFlagOn: true });
    await h.svc.fanout(h.tx as any, { tenantId: 't1', eventCode: 'order.delivered', recipients: ['u1'], payload: {}, dedupeKey: 'e4' });
    const channels = h.inserted.map((n) => n.toProps().channel).sort();
    expect(channels).toEqual(['push', 'sms', 'whatsapp']);           // all 3, same as pre-DEV-07 behavior
  });
});

describe('Q24/DELTA-059 routine fan-out policy (flag OFF — kill-switch / old behavior)', () => {
  it('(e) flag OFF ⇒ old multi-channel behavior, even for a routine-tier event with 3 catalog channels', async () => {
    const h = harness({ event: promotional3ch(), routineFlagOn: false });
    await h.svc.fanout(h.tx as any, { tenantId: 't1', eventCode: 'test.promo_3ch', recipients: ['u1'], payload: {}, dedupeKey: 'e5' });
    const channels = h.inserted.map((n) => n.toProps().channel).sort();
    expect(channels).toEqual(['push', 'sms', 'whatsapp']);           // no collapsing — pre-existing behavior intact
    expect(h.flags.isEnabled).toHaveBeenCalledWith(ROUTINE_FANOUT_FLAG, expect.anything());
  });
});

describe('Q24/DELTA-059 routine fan-out policy — idempotency under retry', () => {
  it('(f) a relay re-delivery (same dedupeKey) derives the SAME ids for the primary AND the sms fallback', async () => {
    const opts: HarnessOpts = { event: promotional3ch(), routineFlagOn: true, dispatchByChannel: { whatsapp: 'failed', sms: 'accepted' } };
    const first = harness(opts);
    await first.svc.fanout(first.tx as any, { tenantId: 't1', eventCode: 'test.promo_3ch', recipients: ['u1'], payload: {}, dedupeKey: 'evt-retry' });
    const second = harness(opts);   // simulates the relay retrying the SAME outbox event after a crash/redelivery
    await second.svc.fanout(second.tx as any, { tenantId: 't1', eventCode: 'test.promo_3ch', recipients: ['u1'], payload: {}, dedupeKey: 'evt-retry' });

    const idsOf = (h: typeof first) => Object.fromEntries(h.inserted.map((n) => [n.toProps().channel, n.id]));
    const idsA = idsOf(first); const idsB = idsOf(second);
    expect(idsA.whatsapp).toBe(idsB.whatsapp);                       // same primary id
    expect(idsA.sms).toBe(idsB.sms);                                 // same fallback id — gateway-level dedup holds
    // exactly one fallback attempt PER invocation — not accumulating across retries
    expect(first.inserted.filter((n) => n.toProps().channel === 'sms')).toHaveLength(1);
    expect(second.inserted.filter((n) => n.toProps().channel === 'sms')).toHaveLength(1);
    const smsCalls = (second.gateway.dispatch.mock.calls as any[]).filter((c) => c[0].channel === 'sms');
    expect(smsCalls).toHaveLength(1);
    expect(smsCalls[0][0].idempotencyKey).toBe(idsB.sms);
  });
});
