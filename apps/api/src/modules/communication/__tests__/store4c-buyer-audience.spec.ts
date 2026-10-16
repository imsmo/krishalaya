// modules/communication/__tests__/store4c-buyer-audience.spec.ts · PC-56 STORE-4c — the unit half of the wave (the live half is
// src/__tests__/store4c-notifications-prefs.integration.spec.ts):
//   • B4 — the buyer audience is in PARITY with the bridge (every map row whose recipient key names the buyer is on the buyer's page; every
//     listed entry is a mapped event; the broadcast constant is the repository's);
//   • D2 — the promotional DEFAULT rule (the matrix: OFF unless an explicit opt-in row; the review's "before"), `resolveChannels` suppresses an
//     un-opted promotional channel, the CONSENT batch (one query, the latest decision wins) and the fan-out's `no_consent` rows (absent reader →
//     fail closed); a held promotional row whose consent was withdrawn overnight is dropped `no_consent`;
//   • D1 — the matrix renders `payment.success` LOCKED once the catalogue says so; the review refuses its opt-out (`CANNOT_OPT_OUT`);
//   • B2 — the payment row notifies the PAYER for an ORDER payment only (`onlyWhen`), and `order.created` is mapped.
import { NOTIFICATION_EVENT_MAP } from '../events/notification-event-map';
import { DomainEventFanoutHandler } from '../events/handlers/domain-event-fanout.handler';
import { BUYER_AUDIENCE_EVENTS, BUYER_LISTED_EVENTS, BUYER_RECIPIENT_KEYS, BUYER_SELF_EVENTS, BROADCAST_EVENT_CODE, inAudience } from '../domain/buyer-audience';
import { BROADCAST_EVENT } from '../repositories/broadcast.repository';
import { resolveChannels } from '../domain/channel-resolution';
import { SUPPRESSED_REASONS } from '../domain/delivery-log';
import { inForce, reviewPreferences } from '../domain/inbox-review';
import { PreferenceService } from '../services/preference.service';
import { NotificationService, PROMOTIONAL_CONSENT_PURPOSE } from '../services/notification.service';
import { NotificationEvent } from '../domain/notification-event.entity';
import { NotificationTemplate } from '../domain/notification-template.entity';
import { NotificationPreference } from '../domain/notification-preference.entity';
import { Notification } from '../domain/notification.entity';
import { ConsentRepository } from '../../identity/repositories/consent.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import type { NotifChannel, NotifPriority } from '../domain/communication.events';

const ev = (code: string, priority: NotifPriority, defaultChannels: NotifChannel[], userCanOptOut = true) =>
  NotificationEvent.rehydrate({ code, defaultName: code, priority, defaultChannels, userCanOptOut, batchable: false });

describe('STORE-4c · B4 the buyer audience is in parity with the bridge', () => {
  it('every map row whose recipient key names the BUYER is on the buyer\'s page', () => {
    const keyed = NOTIFICATION_EVENT_MAP.filter((r) => r.recipientKeys.some((k) => (BUYER_RECIPIENT_KEYS as readonly string[]).includes(k)));
    expect(keyed.length).toBeGreaterThanOrEqual(14);
    for (const r of keyed) expect([r.eventCode, BUYER_AUDIENCE_EVENTS.has(r.eventCode)]).toEqual([r.eventCode, true]);
  });
  it('every audience entry is a MAPPED event (a buyer notice nothing emits is the defect class) — except the broadcast, which its handler fans out', () => {
    const mapped = new Set(NOTIFICATION_EVENT_MAP.map((r) => r.eventCode));
    for (const code of BUYER_AUDIENCE_EVENTS) if (code !== BROADCAST_EVENT_CODE) expect([code, mapped.has(code)]).toEqual([code, true]);
    expect(BROADCAST_EVENT_CODE).toBe(BROADCAST_EVENT);
  });
  it('a LISTED / SELF entry rides a `recipientUserIds` / person-keyed row (never a buyer key — else it would be KEYED)', () => {
    for (const code of [...Object.keys(BUYER_LISTED_EVENTS), ...Object.keys(BUYER_SELF_EVENTS)]) {
      const rows = NOTIFICATION_EVENT_MAP.filter((r) => r.eventCode === code);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.recipientKeys.some((k) => (BUYER_RECIPIENT_KEYS as readonly string[]).includes(k))).toBe(false);
    }
  });
  it('not on the buyer\'s page, by name: the dairy, labour, SaaS and group-lot notices; no audience → every event', () => {
    for (const code of ['dairy.bill_previewed', 'labour.roster_confirmed', 'saas.invoice_issued', 'group_lot.settled', 'kyc.approved', 'payout.credited', 'quote.accepted']) {
      expect([code, inAudience(code, 'buyer')]).toEqual([code, false]);
      expect(inAudience(code, undefined)).toBe(true);
    }
    for (const code of ['payment.success', 'order.created', 'order.delivered', 'bid.outbid', 'tenant.broadcast']) expect(inAudience(code, 'buyer')).toBe(true);
  });
});

describe('STORE-4c · B2 the money notices find their recipient', () => {
  it('`order.created` is mapped to the buyer; `payment.success` names the PAYER (the capture\'s only person key) for an ORDER payment', () => {
    expect(NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === 'orders.order_created')).toMatchObject({ eventCode: 'order.created', recipientKeys: ['buyerUserId', 'userId'] });
    const pay = NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === 'payments.payment_succeeded')!;
    expect(pay.recipientKeys).toContain('payerUserId');
    expect(pay.onlyWhen).toEqual({ key: 'referenceType', values: ['order'] });
  });
  it('the handler: an order payment fans out to the payer; a membership / SaaS capture does not (they have their own notices); no key → fans out', async () => {
    const fanout = jest.fn(async () => undefined);
    const h = new DomainEventFanoutHandler(NOTIFICATION_EVENT_MAP.find((r) => r.outboxType === 'payments.payment_succeeded')!, { fanout } as never);
    const evt = (payload: Record<string, unknown>) => ({ id: 'e1', tenantId: 't1', eventType: 'payments.payment_succeeded', aggregateType: 'payment', aggregateId: 'p1', payload }) as never;
    await h.handle(evt({ payerUserId: 'buyer-1', referenceType: 'order' }), {} as never);
    expect(fanout).toHaveBeenLastCalledWith({}, expect.objectContaining({ eventCode: 'payment.success', recipients: ['buyer-1'] }));
    fanout.mockClear();
    await h.handle(evt({ payerUserId: 'member-1', referenceType: 'membership_fee' }), {} as never);
    await h.handle(evt({ payerUserId: 'admin-1', referenceType: 'saas_invoice' }), {} as never);
    expect(fanout).not.toHaveBeenCalled();
    await h.handle(evt({ payerUserId: 'x-1' }), {} as never);
    expect(fanout).toHaveBeenCalledTimes(1);
  });
});

describe('STORE-4c · D2 a promotional notice is OPT-IN', () => {
  const promo = { code: 'tenant.broadcast', priority: 'promotional' as const, defaultChannels: ['push', 'inapp'] as NotifChannel[], userCanOptOut: true };
  it('resolveChannels: no row → every channel `opted_out`; an explicit opt-in sends that channel only', () => {
    expect(resolveChannels(promo, new Map(), null, new Date())).toEqual({ channels: [], suppressed: [{ channel: 'push', reason: 'opted_out' }, { channel: 'inapp', reason: 'opted_out' }] });
    expect(resolveChannels(promo, new Map([['inapp', true]]), null, new Date())).toEqual({ channels: ['inapp'], suppressed: [{ channel: 'push', reason: 'opted_out' }] });
    // an IMPORTANT event with no row still sends (opt-out semantics unchanged)
    expect(resolveChannels({ ...promo, code: 'order.created', priority: 'important' }, new Map(), null, new Date()).channels).toEqual(['push', 'inapp']);
  });
  it('the review\'s "before" for a promotional cell with no row is OFF (an opt-in is a change; an opt-out is NOTHING_CHANGED)', () => {
    expect(inForce(new Map(), 'tenant.broadcast', 'push', true)).toBe(false);
    expect(inForce(new Map(), 'order.created', 'push')).toBe(true);
    const catalog = new Map([['tenant.broadcast', { code: 'tenant.broadcast', priority: 'promotional', userCanOptOut: true, defaultChannels: ['push', 'inapp'] }]]);
    const on = reviewPreferences({ changes: [{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true }], catalog, explicit: new Map() });
    expect(on.changes).toEqual([{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true, before: false, locked: false }]);
    const off = reviewPreferences({ changes: [{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: false }], catalog, explicit: new Map() });
    expect(off.refusals).toEqual([{ field: null, code: 'NOTHING_CHANGED' }]);
  });
  it('the delivery log can say why: `no_consent` is a suppress reason (0215 widens the CHECK)', () => {
    expect(SUPPRESSED_REASONS).toContain('no_consent');
  });
});

describe('STORE-4c · the matrix (D1 locked · D2 promotional OFF + consent · B4 audience)', () => {
  const svc = (o: { explicit?: NotificationPreference[]; granted?: boolean; consents?: boolean } = {}) => {
    const events = [
      ev('payment.success', 'critical', ['push', 'sms', 'inapp'], false), ev('order.created', 'important', ['push', 'sms', 'inapp']),
      ev('tenant.broadcast', 'promotional', ['push', 'inapp']), ev('dairy.bill_previewed', 'important', ['sms', 'push']),
    ];
    const latestGranted = jest.fn(async () => o.granted === true);
    return {
      latestGranted,
      s: new PreferenceService(
        {} as never, {} as never, { list: async () => events } as never,
        { listForUser: async () => o.explicit ?? [], languageOf: async () => 'en' } as never,
        { getForUser: async () => null, tenantContext: async () => ({ zone: 'Europe/London', defaultWindow: { starts: '21:00', ends: '06:00' } }) } as never,
        {} as never, {} as never,
        { activeLanguages: async () => [{ code: 'en', nameEnglish: 'English', nameNative: 'English' }], tenantLanguageOrder: async () => [] } as never,
        { isEnabled: async () => false } as never,
        o.consents === false ? undefined : ({ latestGranted } as never),
      ),
    };
  };
  const find = (m: { tiers: Array<{ events: Array<{ code: string }> }> }, code: string) => m.tiers.flatMap((t) => t.events).find((e) => e.code === code) as any;
  it('audience=buyer drops the dairy notice; no audience keeps every event (W433 unchanged)', async () => {
    const { s } = svc();
    const buyer = await s.matrix('t1', 'u1', 'buyer');
    expect(buyer.tiers.flatMap((t) => t.events).map((e) => e.code).sort()).toEqual(['order.created', 'payment.success', 'tenant.broadcast']);
    expect(buyer.counts).toMatchObject({ events: 3, locked: 1, critical: 1 });
    expect((await s.matrix('t1', 'u1')).counts.events).toBe(4);
  });
  it('payment.success is LOCKED and every channel ON (in-app included); the promotional row is OFF by default with its consent half', async () => {
    const { s, latestGranted } = svc();
    const m = await s.matrix('t1', 'u1', 'buyer');
    const pay = find(m, 'payment.success');
    expect(pay.locked).toBe(true);
    expect(pay.cells.filter((c: any) => c.sentOn).map((c: any) => [c.channel, c.enabled])).toEqual([['push', true], ['sms', true], ['inapp', true]]);
    const promo = find(m, 'tenant.broadcast');
    expect(promo.cells.filter((c: any) => c.sentOn).map((c: any) => c.enabled)).toEqual([false, false]);
    expect(promo.consent).toEqual({ purpose: PROMOTIONAL_CONSENT_PURPOSE, granted: false });
    expect(find(m, 'order.created').consent).toBeUndefined();
    expect(latestGranted).toHaveBeenCalledWith('t1', 'u1', 'marketing');
  });
  it('an explicit opt-in turns the promotional cell ON; the grant is reported; an absent consent reader reads NOT granted (fail closed)', async () => {
    const explicit = [NotificationPreference.rehydrate({ userId: 'u1', eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true })];
    const m = await svc({ explicit, granted: true }).s.matrix('t1', 'u1', 'buyer');
    expect(find(m, 'tenant.broadcast').cells.filter((c: any) => c.sentOn).map((c: any) => [c.channel, c.enabled])).toEqual([['push', true], ['inapp', false]]);
    expect(find(m, 'tenant.broadcast').consent.granted).toBe(true);
    expect(find(await svc({ granted: true, consents: false }).s.matrix('t1', 'u1', 'buyer'), 'tenant.broadcast').consent.granted).toBe(false);
  });
});

describe('STORE-4c · B3 the consent batch', () => {
  it('ONE query; the LATEST decision per person wins (DISTINCT ON … created_at DESC); a withdrawal or no row is absent', async () => {
    const query = jest.fn(async () => ({ rows: [{ user_id: 'a', granted: true }, { user_id: 'b', granted: false }] }));
    const repo = new ConsentRepository({} as never);
    const out = await repo.grantedFor({ query } as never, ['a', 'b', 'c', 'a', ''], 'marketing');
    expect([...out]).toEqual(['a']);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query.mock.calls[0] as unknown) as [string, unknown[]];
    expect(sql).toMatch(/DISTINCT ON \(user_id\)/); expect(sql).toMatch(/ORDER BY user_id, created_at DESC, id DESC/);
    expect(params).toEqual([['a', 'b', 'c'], 'marketing']);
    expect(await repo.grantedFor({ query } as never, [], 'marketing')).toEqual(new Set());
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('STORE-4c · D2 the fan-out writes `no_consent` (one place — the broadcast handler inherits it)', () => {
  const harness = (o: { event: NotificationEvent; optIn?: boolean; granted?: string[] | null }) => {
    const inserted: Notification[] = [];
    const prefMap = new Map<string, Map<NotifChannel, boolean>>();
    if (o.optIn) for (const u of ['u1', 'u2']) prefMap.set(u, new Map(o.event.toCatalog().defaultChannels.map((c) => [c, true] as const)));
    const grantedFor = jest.fn(async (_x: unknown, ids: readonly string[]) => new Set(ids.filter((id) => (o.granted ?? []).includes(id))));
    const svc = new NotificationService(
      {} as never, { write: jest.fn() } as never, { inc: jest.fn(), observe: jest.fn() } as never,
      { dispatch: jest.fn(async () => ({ status: 'accepted', providerMsgRef: 'p' })) } as never,
      { send: jest.fn(async () => ({ sent: 1, invalidTokens: [] })) } as never,
      { activeTokensForUser: jest.fn(async () => [{ token: 't', platform: 'android' }]) } as never,
      { getByCode: jest.fn(async () => o.event) } as never,
      { resolve: jest.fn(async (_t: unknown, _e: string, channel: NotifChannel) => NotificationTemplate.rehydrate({ id: `tm-${channel}`, eventCode: o.event.code, channel, languageCode: 'en', tenantId: null, subject: '{{title}}', body: '{{body}}', providerTemplateRef: null, isActive: true, versionId: `v-${channel}` })), tenantLanguageOrder: jest.fn(async () => []) } as never,
      { mapForUsers: jest.fn(async () => prefMap) } as never,
      { mapForUsers: jest.fn(async () => new Map()), tenantContext: jest.fn(async () => ({ zone: null, defaultWindow: null })) } as never,
      { insert: jest.fn(async (_tx: unknown, n: Notification) => { inserted.push(n); }), profilesFor: jest.fn(async (_tx: unknown, ids: readonly string[]) => new Map(ids.map((id) => [id, { languageCode: 'en', hasEmail: true, hasPhone: true }]))) } as never,
      { isEnabled: jest.fn(async () => false) } as never,
      undefined,
      o.granted === null ? undefined : ({ grantedFor } as never),
    );
    return { svc, inserted, grantedFor };
  };
  const promo = () => ev('tenant.broadcast', 'promotional', ['push', 'inapp']);
  const rows = (ns: Notification[]) => ns.map((n) => [n.toProps().userId, n.toProps().channel, n.status, n.toProps().suppressedReason ?? null]);
  it('no grant → every channel `suppressed · no_consent`, nothing sent; ONE consent query for the whole page', async () => {
    const h = harness({ event: promo(), optIn: true, granted: ['u2'] });
    await h.svc.fanout({ query: jest.fn() } as never, { tenantId: 't1', eventCode: 'tenant.broadcast', recipients: ['u1', 'u2'], payload: { title: 'T', body: 'B' }, dedupeKey: 'b1' });
    expect(rows(h.inserted)).toEqual([
      ['u1', 'push', 'suppressed', 'no_consent'], ['u1', 'inapp', 'suppressed', 'no_consent'],
      ['u2', 'push', 'sent', null], ['u2', 'inapp', 'sent', null],
    ]);
    expect(h.grantedFor).toHaveBeenCalledTimes(1);
    expect(h.grantedFor).toHaveBeenCalledWith(expect.anything(), ['u1', 'u2'], 'marketing');
  });
  it('a grant WITHOUT an opt-in is `opted_out` (both halves are needed)', async () => {
    const h = harness({ event: promo(), optIn: false, granted: ['u1'] });
    await h.svc.fanout({ query: jest.fn() } as never, { tenantId: 't1', eventCode: 'tenant.broadcast', recipients: ['u1'], payload: {}, dedupeKey: 'b2' });
    expect(rows(h.inserted)).toEqual([['u1', 'push', 'suppressed', 'opted_out'], ['u1', 'inapp', 'suppressed', 'opted_out']]);
  });
  it('an ABSENT consent reader fails CLOSED (no_consent), and a non-promotional event never asks for consent', async () => {
    const h = harness({ event: promo(), optIn: true, granted: null });
    await h.svc.fanout({ query: jest.fn() } as never, { tenantId: 't1', eventCode: 'tenant.broadcast', recipients: ['u1'], payload: {}, dedupeKey: 'b3' });
    expect(rows(h.inserted).map((r) => r[3])).toEqual(['no_consent', 'no_consent']);
    const pay = harness({ event: ev('payment.success', 'critical', ['push', 'inapp'], false), granted: [] });
    await pay.svc.fanout({ query: jest.fn() } as never, { tenantId: 't1', eventCode: 'payment.success', recipients: ['u1'], payload: {}, dedupeKey: 'p1' });
    expect(rows(pay.inserted)).toEqual([['u1', 'push', 'sent', null], ['u1', 'inapp', 'sent', null]]);
    expect(pay.grantedFor).not.toHaveBeenCalled();
  });
});

describe('STORE-4c · the inbox lists what REACHED you', () => {
  it('a SUPPRESSED in-app row (opted out · no_consent) is the log\'s record of a notice NOT sent — never an inbox item, never counted unread', async () => {
    const exec = { query: jest.fn(async (sql: string) => (/data_retention_policies/.test(sql) ? { rows: [{ since: new Date('2026-04-01T00:00:00Z') }], rowCount: 1 } : { rows: [{ n: 0 }], rowCount: 0 })) };
    const repo = new NotificationRepository({ forTenant: () => exec } as never);
    await repo.inbox('u1', 't1', { limit: 50 });
    await repo.unreadCount('t1', 'u1');
    await repo.bell('t1', 'u1').catch(() => undefined);
    const sqls = exec.query.mock.calls.map((c) => String(c[0])).filter((q) => /channel = 'inapp'/.test(q));
    expect(sqls.length).toBeGreaterThanOrEqual(3);
    for (const q of sqls) expect(q).toMatch(/status <> 'suppressed'/);
  });
});
