// modules/communication/__tests__/tenant8e-whatsapp.integration.spec.ts · PC-56 TENANT-8e · THE BROADCAST PLANE, live.
//
// Real PG16, the harness's test database (the real migrations + seeds), every tenant-realm query as `kv_app` under RLS.
// Run under TZ=Asia/Kolkata AND TZ=UTC: the schedule is the cooperative's wall-clock and the fan-out's clock is pinned, so
// nothing here depends on the process zone or the hour the suite runs. What this proves:
//   1. F-19 · the verb is a real seed row held by tenant_admin only; a support agent (permissions read from the seed) reads
//      the plane and can neither draft nor send;
//   2. F-16 · a typo role is a typed 422 and records NOTHING — and 0179 refuses it underneath, as kv_app;
//   3. F-2  · `channel` can never claim WhatsApp: the review refuses it, 0179's CHECK refuses it on insert, the column
//      grant refuses it on update;
//   4. F-2  · a valid broadcast enqueues its audience; the fan-out writes one recipients row per member; the receipt's
//      `sent` equals the log's sent rows, the held push and the switched-off push are counted APART, the failed push
//      carries `no_device`; no SMS is forced; a re-delivery sends nothing twice;
//   5. F-17 · replaying the same Idempotency-Key (concurrently, and again) sends ONCE;
//   6. F-2  · a frame that stops serving refuses the send AT ENQUEUE (the verdict, and 0179 as kv_app);
//   7. F-21 · a scheduled broadcast is queued by the registered job at its time; a cancelled one is not;
//   8. another tenant sees none of it;
//   9. W2839/W2840 · the export job produces the CSV and its receipt says no WhatsApp dataset exists;
//  10. W430 · the opt-in policy: saved by the verb's holder, audited, `not_collected` — and the column cannot claim more.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
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
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { DatasetRegistry } from '../../../core/exports-plane/dataset.registry';
import { ExportJobRepository } from '../../../core/exports-plane/export-job.repository';
import { ExportDownloadRepository } from '../../../core/exports-plane/export-download.repository';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { ExportWorker } from '../../../core/exports-plane/export-worker';
import type { ObjectStore } from '../../../core/media/s3-presign.service';
import { NoopNotificationGateway } from '../gateway/noop.gateway';
import { PushMessage, PushSender } from '../gateway/push-sender.port';
import { PushDeviceRepository } from '../repositories/push-device.repository';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import { WhatsAppRepository } from '../repositories/whatsapp.repository';
import { NotificationService } from '../services/notification.service';
import { BroadcastService, BROADCAST_REQUESTED } from '../services/broadcast.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { BroadcastRequestedHandler } from '../events/handlers/broadcast-requested.handler';
import { BroadcastScheduleCadenceJob } from '../jobs/broadcast-schedule.cadence-job';
import { BroadcastsDataset, BROADCASTS_DATASET } from '../exports/broadcasts.dataset';
import { toLocalWall } from '../domain/broadcast-review';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class CapturingPush implements PushSender {
  readonly providerCode = 'capture';
  readonly sent: PushMessage[] = [];
  async send(msg: PushMessage) { this.sent.push(msg); return { sent: msg.tokens.length, invalidTokens: [] }; }
}
class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObjectStream(key: string, body: Readable): Promise<void> {
    const cs: Buffer[] = []; for await (const c of body) cs.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); this.objects.set(key, Buffer.concat(cs));
  }
  async getObjectStream(key: string): Promise<Readable> { return Readable.from([this.objects.get(key) ?? Buffer.alloc(0)]); }
}

const NOON = new Date('2026-09-30T06:30:00Z');     // 12:00 IST — outside the cooperative's 21:00–06:00
const ZONE = 'Asia/Kolkata';

run('TENANT-8e · the broadcast plane (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let svc: BroadcastService; let wa: WhatsAppService; let handler: BroadcastRequestedHandler; let job: BroadcastScheduleCadenceJob;
  let exportsPlane: ExportPlaneService; let worker: ExportWorker; let store: MemoryStore; let push: CapturingPush;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminUser = randomUUID(); const agentUser = randomUUID();
  const withDevice = randomUUID(); const noDevice = randomUUID(); const pushOff = randomUUID(); const ownQuiet = randomUUID(); const memberB = randomUUID();
  let adminPerms: Set<string>; let agentPerms: Set<string>;
  const meta = { ip: '203.0.113.7', requestId: 'req-8e' };
  const asAdmin = () => ({ userId: adminUser, canSend: adminPerms.has('notification.broadcast.send'), canRead: adminPerms.has('notification.broadcast.send') || adminPerms.has('notification.manage') });
  const asAgent = () => ({ userId: agentUser, canSend: agentPerms.has('notification.broadcast.send'), canRead: agentPerms.has('notification.broadcast.send') || agentPerms.has('notification.manage') });

  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>, user = ''): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const errCode = async (p: Promise<unknown>) => { try { await p; return { code: 'ok' } as any; } catch (e) { return { code: (e as any).code, details: (e as any).details }; } };
  const countOf = async (sql: string, p: unknown[]) => Number((await admin.query(sql, p)).rows[0].n);
  const deliver = (id: string, tenant = tenantA) => uow.run(tenant, (tx) => handler.handle({ id: randomUUID(), tenantId: tenant, eventType: BROADCAST_REQUESTED, payload: { v: 1, broadcastId: id } } as any, tx));
  const permsOf = async (role: string) => new Set<string>((await admin.query(
    `SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((r) => r.p));

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [adminUser, agentUser, withDevice, noDevice, pushOff, ownQuiet, memberB]) { await makeUser(admin, u); await admin.query(`UPDATE users SET language_code='gu' WHERE id=$1`, [u]); }
    const role = async (u: string, code: string, t = tenantA) => admin.query(
      `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [u, t, code]);
    await role(withDevice, 'farmer'); await role(noDevice, 'farmer'); await role(pushOff, 'farmer'); await role(ownQuiet, 'worker');
    await role(memberB, 'farmer', tenantB);
    for (const u of [withDevice, pushOff, ownQuiet]) await admin.query(`INSERT INTO push_devices (user_id, platform, token, is_active) VALUES ($1,'android',$2,true)`, [u, `tok-${randomUUID()}`]);
    await admin.query(`INSERT INTO notification_preferences (user_id, event_code, channel, is_enabled) VALUES ($1,'tenant.broadcast','push',false)`, [pushOff]);
    await admin.query(`INSERT INTO user_quiet_hours (user_id, starts, ends, timezone) VALUES ($1,'11:00','13:00','Asia/Kolkata')`, [ownQuiet]);
    adminPerms = await permsOf('tenant_admin'); agentPerms = await permsOf('support_agent');

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const metrics = new PromMetrics(); const outbox = new PgOutboxWriter(); const audit = new AuditWriter(pools); const idem = new PgIdempotencyService(pools);
    const events = new NotificationEventRepository(replica as any); const templates = new NotificationTemplateRepository(replica as any);
    const quiet = new QuietHoursRepository(replica as any); const repo = new BroadcastRepository(replica as any);
    push = new CapturingPush();
    const spine = new NotificationService(uow, outbox, metrics, new NoopNotificationGateway(config), push, new PushDeviceRepository(replica as any),
      events, templates, new NotificationPreferenceRepository(replica as any), quiet, new NotificationRepository(replica as any), new FlagsService(pools, new InMemoryCacheService()), () => NOON);
    svc = new BroadcastService(uow, outbox, audit, idem, metrics, repo, events, quiet);
    wa = new WhatsAppService(uow, outbox, audit, idem, new WhatsAppRepository(replica as any), repo);
    handler = new BroadcastRequestedHandler(repo, spine, outbox, audit);
    job = new BroadcastScheduleCadenceJob(metrics, outbox, audit, repo);
    // The two flags the export needs, answered for THIS suite's tenants only — never flipped globally under parallel suites.
    const flags = { isEnabled: async (k: string, ctx: { tenantId?: string } = {}) => (k === 'tenant_exports' || k === 'communication') && (ctx.tenantId === tenantA || ctx.tenantId === tenantB || ctx.tenantId === undefined) } as unknown as FlagsService;
    const registry = new DatasetRegistry();
    registry.register(new BroadcastsDataset(repo, new UiMessageRepository(replica as never), flags));
    store = new MemoryStore();
    const jobs = new ExportJobRepository(replica as never);
    exportsPlane = new ExportPlaneService(uow, outbox, idem, metrics, registry, store as unknown as ObjectStore, audit, flags, jobs, new ExportDownloadRepository(replica as never), config);
    worker = new ExportWorker(uow, outbox, replica as never, metrics, registry, store as unknown as ObjectStore, jobs);
  }, 120000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('F-19 · notification.broadcast.send is a real seed row on tenant_admin only; the support agent reads and can neither draft nor send', async () => {
    const holders = (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'notification.broadcast.send' ORDER BY 1`)).rows.map((r) => r.code);
    expect(holders).toEqual(['tenant_admin']);
    expect(agentPerms.has('notification.manage')).toBe(true);
    expect(agentPerms.has('notification.broadcast.send')).toBe(false);
    const list = await svc.list(tenantA, asAgent(), { limit: 10 });
    expect(list.canSend).toBe(false);
    const r = await errCode(svc.saveDraft(tenantA, asAgent(), `k-${randomUUID()}`, { title: 'Hello', body: 'Everyone' }, meta));
    expect(r).toMatchObject({ code: 'BROADCAST_FORM_REFUSED', details: { refusals: [{ field: null, code: 'NO_PERMISSION' }] } });
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcasts WHERE tenant_id=$1`, [tenantA])).toBe(0);
  });

  it('F-16 · a typo role is a typed 422 and records NOTHING; 0179 refuses it as kv_app too', async () => {
    const p = await svc.preview(tenantA, asAdmin(), { title: 'Mandi', body: 'Closed Monday', audienceRoleCode: 'farmerr' });
    expect(p.review.refusals).toEqual([{ field: 'audienceRoleCode', code: 'ROLE_UNKNOWN' }]);
    expect(p.audience.size).toBe(0);
    const r = await errCode(svc.saveDraft(tenantA, asAdmin(), `k-${randomUUID()}`, { title: 'Mandi', body: 'Closed Monday', audienceRoleCode: 'farmerr' }, meta));
    expect(r.code).toBe('BROADCAST_FORM_REFUSED');
    expect(r.details.refusals).toEqual([{ field: 'audienceRoleCode', code: 'ROLE_UNKNOWN' }]);
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcasts WHERE tenant_id=$1`, [tenantA])).toBe(0);
    expect(await countOf(`SELECT count(*) n FROM audit_log WHERE tenant_id=$1 AND action LIKE 'communication.broadcast%'`, [tenantA])).toBe(0);
    const code = await asApp(tenantA, (q) => pgCode(q(`INSERT INTO tenant_broadcasts (tenant_id, created_by_user_id, title, body, audience_role_code) VALUES ($1,$2,'t','b','farmerr')`, [tenantA, adminUser])), adminUser);
    expect(code).toBe('23514');
    // a platform-scope role is not a tenant audience either
    expect((await svc.preview(tenantA, asAdmin(), { title: 'x', body: 'y', audienceRoleCode: 'super_admin' })).review.refusals).toEqual([{ field: 'audienceRoleCode', code: 'ROLE_UNKNOWN' }]);
  });

  it('F-2 · channel can never claim WhatsApp: the review, the CHECK on insert, the grant on update', async () => {
    const p = await svc.preview(tenantA, asAdmin(), { title: 'x', body: 'y', channel: 'whatsapp' });
    expect(p.review.refusals).toEqual([{ field: 'channel', code: 'CHANNEL_NO_PROVIDER' }]);
    expect(p.channel).toEqual({ value: 'inapp', whatsappConnected: false });
    const ins = await asApp(tenantA, (q) => pgCode(q(`INSERT INTO tenant_broadcasts (tenant_id, created_by_user_id, title, body, channel) VALUES ($1,$2,'t','b','whatsapp')`, [tenantA, adminUser])), adminUser);
    expect(ins).toBe('23514');
    const upd = await asApp(tenantA, async (q) => {
      const r = await q(`INSERT INTO tenant_broadcasts (tenant_id, created_by_user_id, title, body) VALUES ($1,$2,'t','b') RETURNING id, channel, status`, [tenantA, adminUser]);
      expect([r.rows[0].channel, r.rows[0].status]).toEqual(['inapp', 'draft']);
      return pgCode(q(`UPDATE tenant_broadcasts SET channel='whatsapp' WHERE id=$1`, [r.rows[0].id]));
    }, adminUser);
    expect(upd).toBe('42501');
    expect((await admin.query(`SELECT whatsapp_provider_connected() AS c`)).rows[0].c).toBe(false);
  });

  let sentId = '';
  it('F-17 · the same Idempotency-Key replays ONE draft and ONE send — concurrently and again', async () => {
    const k1 = `k-${randomUUID()}`;
    // Concurrently: the key's claim lets ONE through; the other is told the request is in progress (409) — never a second row.
    const twice = await Promise.allSettled([1, 2].map(() => svc.saveDraft(tenantA, asAdmin(), k1, { title: 'Mandi closed Monday', body: 'The yard is closed for cleaning.' }, meta)));
    const won = twice.filter((t): t is PromiseFulfilledResult<any> => t.status === 'fulfilled').map((t) => t.value);
    for (const t of twice) if (t.status === 'rejected') expect((t.reason as any).code).toBe('CONFLICT');
    expect(won.length).toBeGreaterThanOrEqual(1);
    const a = won[0];
    const c = await svc.saveDraft(tenantA, asAdmin(), k1, { title: 'Mandi closed Monday', body: 'The yard is closed for cleaning.' }, meta);   // and again: the replay
    expect(c.broadcast.id).toBe(a.broadcast.id);
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcasts WHERE tenant_id=$1 AND title='Mandi closed Monday'`, [tenantA])).toBe(1);
    sentId = a.broadcast.id;
    expect(a.broadcast).toMatchObject({ status: 'draft', channel: 'inapp', audienceRoleCode: null, eligibleCount: 0 });
    expect(await countOf(`SELECT count(*) n FROM audit_log WHERE entity_id=$1 AND action='communication.broadcast_drafted'`, [sentId])).toBe(1);
    const acts = await svc.acts(tenantA, asAdmin(), sentId);
    expect(acts.verdicts.map((v) => [v.act, v.allowed])).toEqual([['send', true], ['cancel', true]]);
    expect(acts.preview!.audience).toEqual({ roleCode: null, size: 4, everyone: 4 });
    expect(acts.preview!.templates).toEqual({ required: ['inapp:en', 'inapp:gu', 'inapp:hi', 'push:en', 'push:gu', 'push:hi'], gaps: [], sendable: true });
    const im = acts.preview!.impact!;
    expect([im.audience, im.examined, im.cut]).toEqual([4, 4, false]);
    for (const ch of im.channels) expect(ch.now + ch.held + ch.optedOut + ch.noDevice).toBe(4);
    expect(im.channels.find((ch) => ch.channel === 'push')!.optedOut).toBe(1);
    const k2 = `k-${randomUUID()}`;
    const sends = await Promise.allSettled([1, 2].map(() => svc.act(tenantA, asAdmin(), sentId, 'send', k2, 'Monday notice to everyone', meta)));
    for (const t of sends) if (t.status === 'rejected') expect((t.reason as any).code).toBe('CONFLICT');
    const again = await svc.act(tenantA, asAdmin(), sentId, 'send', k2, 'Monday notice to everyone', meta);
    expect(again.broadcast.status).toBe('queued');
    const row = (await admin.query(`SELECT status, eligible_count, send_requested_by, queued_at FROM tenant_broadcasts WHERE id=$1`, [sentId])).rows[0];
    expect([row.status, row.eligible_count, row.send_requested_by]).toEqual(['queued', 4, adminUser]);
    expect(await countOf(`SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2`, [sentId, BROADCAST_REQUESTED])).toBe(1);
    const au = (await admin.query(`SELECT action, reason, host(ip) AS ip, request_id FROM audit_log WHERE entity_id=$1 AND action='communication.broadcast_queued'`, [sentId])).rows;
    expect(au).toEqual([{ action: 'communication.broadcast_queued', reason: 'Monday notice to everyone', ip: '203.0.113.7', request_id: 'req-8e' }]);
    // a different key for the same, now-queued broadcast is a verdict, not a second send
    expect((await errCode(svc.act(tenantA, asAdmin(), sentId, 'send', `k-${randomUUID()}`, 'again please', meta))).details.refusals).toEqual(['ILLEGAL_FROM_STATE']);
  });

  it('F-2 · the fan-out: one recipients row per member; sent = the log\'s sent rows; held and switched-off counted apart; no SMS forced; a re-delivery sends nothing', async () => {
    await deliver(sentId);
    await deliver(sentId);                                                   // re-delivery: a no-op
    const b = (await admin.query(`SELECT status, fanned_out_at FROM tenant_broadcasts WHERE id=$1`, [sentId])).rows[0];
    expect(b.status).toBe('sent');
    // every recipients row carries the fan-out's own instant, to the microsecond (compared in SQL — a JS Date would not match)
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcast_recipients r JOIN tenant_broadcasts b ON b.id = r.broadcast_id AND r.created_at = b.fanned_out_at WHERE b.id=$1`, [sentId])).toBe(4);
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcast_recipients WHERE broadcast_id=$1`, [sentId])).toBe(4);
    const log = (await admin.query(
      `SELECT n.user_id, n.channel, n.status::text AS status, n.suppressed_reason, n.failure_reason FROM tenant_broadcast_recipients r
         JOIN notifications n ON n.user_id = r.user_id AND n.fanout_key = r.fanout_key AND n.created_at = r.created_at
        WHERE r.broadcast_id = $1 ORDER BY n.channel, n.status`, [sentId])).rows;
    expect(log.filter((l) => l.channel === 'sms')).toEqual([]);              // never forced to SMS
    const push = log.filter((l) => l.channel === 'push');
    const by = (u: string) => push.find((l) => l.user_id === u);
    expect([by(withDevice)!.status, by(noDevice)!.failure_reason, by(pushOff)!.suppressed_reason, by(ownQuiet)!.suppressed_reason])
      .toEqual(['sent', 'no_device', 'opted_out', 'quiet_hours']);
    expect(log.filter((l) => l.channel === 'inapp').map((l) => l.status)).toEqual(['sent', 'sent', 'sent', 'sent']);
    const view = await svc.view(tenantA, asAgent(), sentId);
    const c = view.counts!;
    const sentRows = log.filter((l) => ['sent', 'delivered', 'read'].includes(l.status)).length;
    expect([c.recipients, c.sent, c.inapp, c.held, c.suppressed, c.failed]).toEqual([4, sentRows, 4, 1, 1, 1]);
    expect(c.sent).toBe(5);
    expect(c.channels.find((x) => x.channel === 'push')).toMatchObject({ sent: 1, held: 1, suppressed: 1, failed: 1, failedBy: { no_device: 1 }, suppressedBy: { opted_out: 1 } });
    expect(push.length).toBe(4);
    expect(await countOf(`SELECT count(*) n FROM audit_log WHERE entity_id=$1 AND action='communication.broadcast_fanned_out'`, [sentId])).toBe(1);
    // the list says the same, from the same log
    const list = await svc.list(tenantA, asAdmin(), { limit: 10 });
    expect(list.items.find((i) => i.id === sentId)!.counts!.sent).toBe(5);
  });

  it('F-2 · a frame that stops serving refuses the send AT ENQUEUE — the verdict, and 0179 as kv_app — and records nothing per member', async () => {
    const d = await svc.saveDraft(tenantA, asAdmin(), `k-${randomUUID()}`, { title: 'Seeds', body: 'Arrive Friday', audienceRoleCode: 'farmer' }, meta);
    await admin.query(`UPDATE notification_templates SET is_active=false WHERE event_code='tenant.broadcast' AND channel='push' AND language_code='gu' AND tenant_id IS NULL`);
    try {
      const r = await errCode(svc.act(tenantA, asAdmin(), d.broadcast.id, 'send', `k-${randomUUID()}`, 'seed notice', meta));
      expect(r).toMatchObject({ code: 'BROADCAST_ACT_REFUSED', details: { refusals: ['TEMPLATE_MISSING'], gaps: ['push:gu'] } });
      const code = await asApp(tenantA, (q) => pgCode(q(`UPDATE tenant_broadcasts SET status='queued', send_requested_by=$2, send_requested_at=now(), queued_at=now() WHERE id=$1`, [d.broadcast.id, adminUser])), adminUser);
      expect(code).toBe('23514');
    } finally {
      await admin.query(`UPDATE notification_templates SET is_active=true WHERE event_code='tenant.broadcast' AND channel='push' AND language_code='gu' AND tenant_id IS NULL`);
    }
    expect((await admin.query(`SELECT status FROM tenant_broadcasts WHERE id=$1`, [d.broadcast.id])).rows[0].status).toBe('draft');
    expect(await countOf(`SELECT count(*) n FROM tenant_broadcast_recipients WHERE broadcast_id=$1`, [d.broadcast.id])).toBe(0);
    // cancelled with its reason, word for word
    const c = await svc.act(tenantA, asAdmin(), d.broadcast.id, 'cancel', `k-${randomUUID()}`, 'wrong week', meta);
    expect([c.broadcast.status, c.broadcast.cancelReason, c.broadcast.cancelledBy]).toEqual(['cancelled', 'wrong week', adminUser]);
  });

  it('F-21 · a scheduled broadcast is queued by the registered job at its time; a cancelled one is not; the schedule is the cooperative\'s wall-clock', async () => {
    const at = new Date(Date.now() + 2 * 3_600_000);
    const local = toLocalWall(at, ZONE);
    const s = await svc.saveDraft(tenantA, asAdmin(), `k-${randomUUID()}`, { title: 'Vet camp', body: 'Saturday 9am', scheduledAt: local, audienceRoleCode: 'worker' }, meta);
    expect(s.broadcast.scheduledLocal).toBe(local);
    expect(Math.abs(new Date(s.broadcast.scheduledAt as Date).getTime() - Math.floor(at.getTime() / 60_000) * 60_000)).toBe(0);
    const x = await svc.saveDraft(tenantA, asAdmin(), `k-${randomUUID()}`, { title: 'Other', body: 'Cancelled one', scheduledAt: local }, meta);
    await svc.act(tenantA, asAdmin(), s.broadcast.id, 'send', `k-${randomUUID()}`, 'vet camp notice', meta);
    await svc.act(tenantA, asAdmin(), x.broadcast.id, 'send', `k-${randomUUID()}`, 'second notice', meta);
    expect((await svc.view(tenantA, asAdmin(), s.broadcast.id)).broadcast.status).toBe('scheduled');
    expect(await countOf(`SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2`, [s.broadcast.id, BROADCAST_REQUESTED])).toBe(0);
    await svc.act(tenantA, asAdmin(), x.broadcast.id, 'cancel', `k-${randomUUID()}`, 'not needed', meta);
    const early = await job.tick(admin, new Date(at.getTime() - 60_000));
    expect((await svc.view(tenantA, asAdmin(), s.broadcast.id)).broadcast.status).toBe('scheduled');
    expect(early.queued).toBe(0);
    await job.tick(admin, new Date(at.getTime() + 60_000));
    await job.tick(admin, new Date(at.getTime() + 120_000));               // idempotent
    expect((await svc.view(tenantA, asAdmin(), s.broadcast.id)).broadcast.status).toBe('queued');
    expect((await svc.view(tenantA, asAdmin(), x.broadcast.id)).broadcast.status).toBe('cancelled');
    expect(await countOf(`SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2`, [s.broadcast.id, BROADCAST_REQUESTED])).toBe(1);
    expect(await countOf(`SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2`, [x.broadcast.id, BROADCAST_REQUESTED])).toBe(0);
    await deliver(s.broadcast.id);
    const v = await svc.view(tenantA, asAdmin(), s.broadcast.id);
    expect([v.broadcast.status, v.counts!.recipients, v.counts!.inapp]).toEqual(['sent', 1, 1]);   // the one worker
    // once queued, a cancel is the fan-out's business, not a person's
    expect((await errCode(svc.act(tenantA, asAdmin(), s.broadcast.id, 'cancel', `k-${randomUUID()}`, 'too late', meta))).details.refusals).toEqual(['ILLEGAL_FROM_STATE']);
  });

  it('another tenant sees none of it — the service, and kv_app across the wall', async () => {
    const list = await svc.list(tenantB, asAdmin(), { limit: 50 });
    expect(list.items).toEqual([]);
    expect((await errCode(svc.view(tenantB, asAdmin(), sentId))).code).toBe('BROADCAST_NOT_FOUND');
    const seen = {
      ...(await asApp(tenantB, async (q) => ({
        broadcasts: (await q(`SELECT count(*)::int n FROM tenant_broadcasts WHERE tenant_id=$1`, [tenantA])).rows[0].n,
        recipients: (await q(`SELECT count(*)::int n FROM tenant_broadcast_recipients WHERE tenant_id=$1`, [tenantA])).rows[0].n,
        update: (await q(`UPDATE tenant_broadcasts SET title='x' WHERE id=$1`, [sentId])).rowCount,
      }))),
      insertForA: await asApp(tenantB, (q) => pgCode(q(`INSERT INTO tenant_broadcast_recipients (tenant_id, broadcast_id, user_id, fanout_key) VALUES ($1,$2,$3,repeat('c',64))`, [tenantA, sentId, memberB]))),
      del: await asApp(tenantB, (q) => pgCode(q(`DELETE FROM tenant_broadcasts WHERE id=$1`, [sentId]))),
    };
    expect(seen).toEqual({ broadcasts: 0, recipients: 0, update: 0, insertForA: '42501', del: '42501' });
    const sameTenant = await asApp(tenantA, async (q) => pgCode(q(`UPDATE tenant_broadcasts SET title='rewritten' WHERE id=$1`, [sentId])));
    expect(sameTenant).toBe('23514');                                       // the words are frozen once sent
  });

  it('W2839/W2840 · the export job produces the CSV, and its receipt says no WhatsApp dataset exists', async () => {
    const actor = { userId: agentUser, permissions: agentPerms };
    // The plane has ONE cross-tenant FIFO and ONE runtime history, and 6e-2's own suite asserts on both ("the platform has
    // never finished an export"). So this suite never ticks the shared worker (it would claim another suite's job) — it
    // drives ITS job by id — and retires the finished job from the runtime sample at once (expired keeps the receipt).
    const j = await exportsPlane.enqueue(tenantA, actor, `k-${randomUUID()}`, { datasetCode: BROADCASTS_DATASET, params: {} }, '10.0.0.1');
    expect(j.status).toBe('queued');
    expect(await worker.generate({ id: j.id, tenantId: tenantA })).toBe('ready');
    await admin.query(`UPDATE tenant_export_jobs SET status = 'expired', expired_at = now() WHERE id = $1 AND status = 'ready'`, [j.id]);
    const v = await exportsPlane.view(tenantA, actor, j.id);
    expect(v.status).toBe('expired');
    expect(v.receipt!.notes[0]).toMatch(/^no WhatsApp dataset exists/);
    expect(v.receipt!.fileName).toMatch(/^communication-broadcasts-history-\d{4}-\d{2}-\d{2}\.csv$/);
    const total = await countOf(`SELECT count(*) n FROM tenant_broadcasts WHERE tenant_id=$1`, [tenantA]);
    expect(v.receipt!.rowCount).toBe(total);
    const csv = [...store.objects.values()].map((b) => b.toString('utf8')).find((s) => s.includes(sentId))!;
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^"?broadcast_id"?,"?status"?/);
    expect(lines.find((l) => l.includes(sentId))).toMatch(/,4,4,5,0,1,1,1,/);
    // a member without the read verb cannot export
    expect((await errCode(exportsPlane.enqueue(tenantA, { userId: withDevice, permissions: new Set() }, `k-${randomUUID()}`, { datasetCode: BROADCASTS_DATASET, params: {} }, null))).code).toBe('FORBIDDEN');
  });

  it('W430 · the opt-in policy: the verb\'s holder saves it, audited, NOT collected; a support agent cannot; the column cannot claim more', async () => {
    const agent = { userId: agentUser, canRead: true, canManagePolicy: agentPerms.has('notification.whatsapp.policy.manage') };
    const owner = { userId: adminUser, canRead: true, canManagePolicy: adminPerms.has('notification.whatsapp.policy.manage') };
    expect([agent.canManagePolicy, owner.canManagePolicy]).toEqual([false, true]);
    const body = { sources: ['storefront_checkbox', 'assisted_kiosk_own_otp'], consentStatement: 'I agree to receive messages from Anand FPO on WhatsApp.' };
    expect((await errCode(wa.savePolicy(tenantA, agent, `k-${randomUUID()}`, body, meta))).details.refusals).toEqual([{ field: null, code: 'NO_PERMISSION' }]);
    const key = `k-${randomUUID()}`;
    const r = await wa.savePolicy(tenantA, owner, key, body, meta);
    await wa.savePolicy(tenantA, owner, key, body, meta);
    expect(r).toEqual({ saved: true, version: 1, collectionState: 'not_collected' });
    expect(await countOf(`SELECT count(*) n FROM audit_log WHERE tenant_id=$1 AND action='communication.whatsapp_optin_policy_saved'`, [tenantA])).toBe(1);
    const p = await wa.policy(tenantA, owner);
    expect([p.policy!.sources, p.collectionState, p.providerConnected]).toEqual([body.sources, 'not_collected', false]);
    expect(p.sources.map((s) => s.code)).toEqual(['storefront_checkbox', 'qr_till_card', 'assisted_kiosk_own_otp']);
    const codes = {
      collect: await asApp(tenantA, (q) => pgCode(q(`UPDATE whatsapp_optin_policies SET collection_state='collected' WHERE tenant_id=$1`, [tenantA]))),
      unknown: await asApp(tenantA, (q) => pgCode(q(`UPDATE whatsapp_optin_policies SET sources='{sms_reply}' WHERE tenant_id=$1`, [tenantA]))),
    };
    expect(codes).toEqual({ collect: '42501', unknown: '23514' });
    const hub = await wa.hub(tenantA, owner);
    expect(hub.provider.connected).toBe(false);
    expect(hub.templates.whatsappServing).toBe(0);
    expect(hub.templates.eventsDeclaringWhatsApp).toEqual(expect.arrayContaining(['auth.otp', 'order.delivered']));
    expect(hub.optin).toEqual({ recorded: true, collectionState: 'not_collected', version: 1 });
    expect(hub.broadcasts.counts.sent).toBeGreaterThanOrEqual(5);
    expect(hub.refused.find((x) => x.code === 'conversation')!.instead).toBe('/inbox');
    const tB = await wa.policy(tenantB, owner);
    expect(tB.policy).toBeNull();
  });
});
