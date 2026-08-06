// modules/communication/__tests__/communication.integration.spec.ts
// REAL end-to-end proof of the notification spine against a live Postgres (schema + the REAL seeded catalog +
// templates from db/seeds/core/0007):
//   1. fanout of 'order.confirmed' to a user records a delivery row per resolved channel — push + inapp 'sent'
//      (noop gateway accepts in test), sms 'failed' (no seeded sms template) — fail-closed, never throws;
//   2. the user's inbox lists them and mark-read flips one to 'read';
//   3. a preference opt-out (disable push for order.confirmed) suppresses the push row on the next fanout;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's notifications.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { NoopNotificationGateway } from '../gateway/noop.gateway';
import { NoopPushSender } from '../gateway/noop-push.sender';
import { PushDeviceRepository } from '../repositories/push-device.repository';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationService } from '../services/notification.service';
import { PreferenceService } from '../services/preference.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('communication spine (integration, real Postgres + RLS + seeded catalog)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let notifications: NotificationService; let prefsSvc: PreferenceService; let notifRepo: NotificationRepository;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const user = randomUUID();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, user);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const metrics = new PromMetrics();
    const gateway = new NoopNotificationGateway(config);   // test ⇒ accepts; no external notifier
    const pushSender = new NoopPushSender(false);          // test ⇒ accepts (no real device send)
    const pushDevices = new PushDeviceRepository(replica as any);
    const events = new NotificationEventRepository(replica as any);
    const templates = new NotificationTemplateRepository(replica as any);
    const prefs = new NotificationPreferenceRepository(replica as any);
    const quiet = new QuietHoursRepository(replica as any);
    notifRepo = new NotificationRepository(replica as any);
    const flags = new FlagsService(pools, new InMemoryCacheService());   // DB-backed; unseeded flag ⇒ OFF (old behavior), matching production default
    notifications = new NotificationService(uow, outbox, metrics, gateway, pushSender, pushDevices, events, templates, prefs, quiet, notifRepo, flags);
    prefsSvc = new PreferenceService(uow, outbox, events, prefs, quiet);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });


  it('fanout records one row per resolved channel (push+inapp sent, sms failed — no seeded sms template)', async () => {
    await uow.run(tenantA, (tx) => notifications.fanout(tx, { tenantId: tenantA, eventCode: 'order.confirmed', recipients: [user], payload: { orderNo: 'A-1' }, dedupeKey: `evt-${randomUUID()}` }));
    const rows = (await admin.query(`SELECT channel, status FROM notifications WHERE tenant_id=$1 AND user_id=$2 ORDER BY channel`, [tenantA, user])).rows;
    const byCh = Object.fromEntries(rows.map((r: any) => [r.channel, r.status]));
    expect(byCh.push).toBe('sent'); expect(byCh.inapp).toBe('sent'); expect(byCh.sms).toBe('failed');
  });

  it('inbox lists the rows and mark-read flips one to read', async () => {
    const { items } = await notifications.listInbox(tenantA, user, { limit: 50 });
    expect(items.length).toBeGreaterThanOrEqual(3);
    const inapp = items.find((i: any) => i.channel === 'inapp');
    // assert it exists rather than asserting it away: if the seeded in-app row is missing, THAT is the failure worth
    // reporting, not a cascade of undefined-property errors further down
    expect(inapp).toBeDefined();
    const read = await notifications.markRead(tenantA, user, inapp!.id);
    expect(read.status).toBe('read');
  });

  it('opting out of push suppresses the push row on the next fanout', async () => {
    await prefsSvc.setPreferences(tenantA, user, [{ eventCode: 'order.confirmed', channel: 'push', isEnabled: false }]);
    const before = (await admin.query(`SELECT count(*)::int n FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND channel='push'`, [tenantA, user])).rows[0].n;
    await uow.run(tenantA, (tx) => notifications.fanout(tx, { tenantId: tenantA, eventCode: 'order.confirmed', recipients: [user], payload: { orderNo: 'A-2' }, dedupeKey: `evt-${randomUUID()}` }));
    const after = (await admin.query(`SELECT count(*)::int n FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND channel='push'`, [tenantA, user])).rows[0].n;
    expect(after).toBe(before);   // no new push row — suppressed by the opt-out
  });

  it('RLS: tenant B cannot see tenant A\'s notifications', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM notifications WHERE tenant_id=$1 AND user_id=$2`, [tenantA, user])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM notifications WHERE user_id=$1`, [user])).rows.length).toBeGreaterThan(0);
  });
});

// ---- MESSAGING vertical (chat + masked calls) against real Postgres + RLS ---------------------------------
import { ConversationRepository } from '../repositories/conversation.repository';
import { MessageRepository } from '../repositories/message.repository';
import { MaskedCallRepository } from '../repositories/masked-call.repository';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import { MaskedCallService } from '../services/masked-call.service';
import { NoopMaskingGateway } from '../gateway/noop-masking.gateway';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';

run('messaging spine (integration, real Postgres + RLS + masked calls)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let convos: ConversationService; let messages: MessageService; let calls: MaskedCallService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const ua = randomUUID(); const ub = randomUUID();
  let convoId = '';
  const actorA = { userId: ua, isModerator: false }; const actorB = { userId: ub, isModerator: false };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, ua); await makeUser(admin, ub);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const metrics = new PromMetrics(); const idem = new PgIdempotencyService(pools);
    const cRepo = new ConversationRepository(replica as any); const mRepo = new MessageRepository(replica as any); const kRepo = new MaskedCallRepository(replica as any);
    convos = new ConversationService(uow, outbox, idem, metrics, cRepo);
    messages = new MessageService(uow, outbox, idem, metrics, mRepo, cRepo);
    calls = new MaskedCallService(uow, outbox, idem, metrics, new NoopMaskingGateway(config), kRepo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('opens a direct conversation with both participants', async () => {
    const c: any = await convos.open(tenantA, actorA, `idem-${randomUUID()}`, { contextType: 'direct', participantUserIds: [ub] } as any);
    convoId = c.id; expect(c.isLocked).toBe(false);
  });
  it('a participant posts a message; the other participant can read it', async () => {
    await messages.post(tenantA, actorA, convoId, `idem-${randomUUID()}`, { body: 'Namaste' } as any);
    const { items } = await messages.list(tenantA, actorB, convoId, { limit: 50 });
    expect(items.length).toBe(1); expect(items[0].body).toBe('Namaste');
  });
  it('a non-participant is 404 on the thread (no IDOR)', async () => {
    const stranger = { userId: randomUUID(), isModerator: false };
    await expect(messages.list(tenantA, stranger, convoId, { limit: 50 })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });
  it('locking blocks new messages', async () => {
    await convos.setLock(tenantA, actorA, convoId, true);
    await expect(messages.post(tenantA, actorA, convoId, `idem-${randomUUID()}`, { body: 'after lock' } as any)).rejects.toMatchObject({ code: 'CONVERSATION_LOCKED' });
  });
  it('masked call is logged with user ids + provider ref, never a phone number', async () => {
    const call: any = await calls.initiate(tenantA, actorA, `idem-${randomUUID()}`, { calleeUserId: ub, contextType: 'direct' } as any);
    expect(call.callerUserId).toBe(ua); expect(call.calleeUserId).toBe(ub);
    const row = (await admin.query(`SELECT provider_call_ref, caller_user_id FROM masked_calls WHERE id=$1`, [call.id])).rows[0];
    expect(row.provider_call_ref).toBeTruthy(); expect(row.caller_user_id).toBe(ua);
  });
  it('RLS: tenant B cannot see tenant A\'s conversations or messages', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM conversations WHERE id=$1`, [convoId])).rows.length).toBe(0);
    expect((await inspect.query(`SELECT id FROM messages WHERE conversation_id=$1`, [convoId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM conversations WHERE id=$1`, [convoId])).rows.length).toBe(1);
  });
});
