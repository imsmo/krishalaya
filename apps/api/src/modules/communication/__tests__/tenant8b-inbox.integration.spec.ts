// modules/communication/__tests__/tenant8b-inbox.integration.spec.ts · PC-56 TENANT-8b · THE INBOX, live.
//
// Real PG16, the test database the harness builds from the real chain (migrations + seeds), every tenant-realm query as
// `kv_app` under RLS. Run under TZ=Asia/Kolkata AND TZ=UTC — every instant below is written in UTC with its IST wall
// time beside it, and nothing here may depend on the process zone. What this proves, in the order a cooperative lives it:
//   1. F-5 + F-4 · a member who never set quiet hours is quiet in the COOPERATIVE's window (21:00–06:00, its zone): at
//      22:00 IST the push and SMS legs of an important notice are WRITTEN as `suppressed · quiet_hours` with
//      `held_until` = 06:00 IST, the in-app item is written `sent`; at 06:01 the release job sends the push (and records
//      the SMS's `no_template` honestly), the rows keep their reason and gain `released_at`; a second tick releases
//      nothing (idempotent);
//   2. F-6 · a member whose row says `Asia/Kolkatta` (written before 0176 — the trigger now refuses it) does NOT fail the
//      fan-out: their window is read in the cooperative's zone and the OTHER member still gets their rows; the review and
//      the database both refuse the typo at write;
//   3. F-10 · the webhook's `failed` writes `failed` + a vocabulary reason + `failed_at`; `delivered` stamps `delivered_at`;
//   4. F-9 · the inbox lists only the in-app row, and names the other channels; W434's ladder is that delivery instance;
//   5. F-13 · the matrix is readable by a member WITHOUT notification.manage; the tenant health tiles are not;
//   6. another tenant sees none of it (rows, inbox, ladder), and kv_app cannot write across the wall;
//   7. mark-all-read is one audited act, idempotent on its key.
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
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { NoopNotificationGateway } from '../gateway/noop.gateway';
import { PushMessage, PushSender } from '../gateway/push-sender.port';
import { PushDeviceRepository } from '../repositories/push-device.repository';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { QuietHoursRepository } from '../repositories/quiet-hours.repository';
import { NotificationRepository } from '../repositories/notification.repository';
import { NotificationService } from '../services/notification.service';
import { InboxService } from '../services/inbox.service';
import { PreferenceService } from '../services/preference.service';
import { HeldReleaseCadenceJob } from '../jobs/held-release.cadence-job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class CapturingPush implements PushSender {
  readonly providerCode = 'capture';
  readonly sent: PushMessage[] = [];
  async send(msg: PushMessage) { this.sent.push(msg); return { sent: msg.tokens.length, invalidTokens: [] }; }
}

const NIGHT = new Date('2026-09-30T16:30:00Z');      // 22:00 IST — inside the cooperative's 21:00–06:00
const SIX_IST = new Date('2026-10-01T00:30:00Z');    // 06:00 IST the next morning — the window's end
const MORNING = new Date('2026-10-01T00:31:00Z');    // 06:01 IST
const NOON = new Date('2026-09-30T06:30:00Z');       // 12:00 IST — outside every window here
const EVENT = 'order.confirmed';                     // important, opt-out-able, push · sms · inapp (push + inapp served in en)

run('TENANT-8b · the inbox (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let clock = NIGHT;
  let spine: NotificationService; let inbox: InboxService; let prefs: PreferenceService; let job: HeldReleaseCadenceJob; let push: CapturingPush;
  /** A spine + job with a FRESH flag cache — the kill-switch is read through FlagsService, which caches. */
  let freshJob: (at: Date) => HeldReleaseCadenceJob;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const member = randomUUID(); const typo = randomUUID(); const neighbour = randomUUID(); const memberB = randomUUID();
  const asMember = (u: string) => ({ userId: u, canManage: false });

  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const rowsOf = async (u: string, key?: string) => (await admin.query(
    `SELECT channel, status::text AS status, suppressed_reason, failure_reason, held_until, released_at, sent_at, failed_at, delivered_at, fanout_key, provider_msg_ref
       FROM notifications WHERE user_id = $1 ${key ? `AND payload->>'orderNo' = $2` : ''} ORDER BY channel`, key ? [u, key] : [u])).rows;
  const fan = (recipients: string[], orderNo: string, tenant = tenantA, event = EVENT) =>
    uow.run(tenant, (tx) => spine.fanout(tx, { tenantId: tenant, eventCode: event, recipients, payload: { orderNo }, dedupeKey: `evt-${randomUUID()}` }));

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [member, typo, neighbour, memberB]) {
      await makeUser(admin, u);
      await admin.query(`UPDATE users SET language_code = 'en' WHERE id = $1`, [u]);
      await admin.query(`INSERT INTO push_devices (user_id, platform, token, is_active) VALUES ($1,'android',$2,true) ON CONFLICT (token) DO NOTHING`, [u, `tok-${randomUUID()}`]);
    }
    // A row written BEFORE 0176 refused unknown zones: the trigger is lifted for this one insert, exactly to reproduce
    // the state F-6 found on disk, and restored at once.
    await admin.query(`ALTER TABLE user_quiet_hours DISABLE TRIGGER trg_uqh_timezone_known`);
    await admin.query(`INSERT INTO user_quiet_hours (user_id, starts, ends, timezone) VALUES ($1, '21:00', '06:00', 'Asia/Kolkatta')`, [typo]);
    await admin.query(`ALTER TABLE user_quiet_hours ENABLE TRIGGER trg_uqh_timezone_known`);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const metrics = new PromMetrics(); const outbox = new PgOutboxWriter(); const audit = new AuditWriter(pools); const idem = new PgIdempotencyService(pools);
    const events = new NotificationEventRepository(replica as any); const templates = new NotificationTemplateRepository(replica as any);
    const prefRepo = new NotificationPreferenceRepository(replica as any); const quiet = new QuietHoursRepository(replica as any); const repo = new NotificationRepository(replica as any);
    const flags = new FlagsService(pools, new InMemoryCacheService());
    push = new CapturingPush();
    spine = new NotificationService(uow, outbox, metrics, new NoopNotificationGateway(config), push, new PushDeviceRepository(replica as any),
      events, templates, prefRepo, quiet, repo, flags, () => clock);
    inbox = new InboxService(uow, outbox, audit, idem, metrics, repo, events, spine);
    prefs = new PreferenceService(uow, outbox, events, prefRepo, quiet, audit, idem, templates, flags);
    job = new HeldReleaseCadenceJob(metrics, spine, repo);
    const devices = new PushDeviceRepository(replica as any); const gateway = new NoopNotificationGateway(config);
    freshJob = (at: Date) => new HeldReleaseCadenceJob(metrics,
      new NotificationService(uow, outbox, metrics, gateway, push, devices, events, templates, prefRepo, quiet, repo, new FlagsService(pools, new InMemoryCacheService()), () => at), repo);
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('F-5 + F-4 · at 22:00 IST a member with no window is quiet in the cooperative\'s: push and SMS HELD until 06:00, in-app sent', async () => {
    clock = NIGHT;
    await fan([member], 'A-2201');
    const rows = await rowsOf(member, 'A-2201');
    expect(rows.map((r: any) => [r.channel, r.status, r.suppressed_reason])).toEqual([
      ['inapp', 'sent', null], ['push', 'suppressed', 'quiet_hours'], ['sms', 'suppressed', 'quiet_hours']]);
    for (const r of rows.filter((x: any) => x.status === 'suppressed')) expect(new Date(r.held_until).toISOString()).toBe(SIX_IST.toISOString());
    // one delivery instance: every channel row carries the same key
    expect(new Set(rows.map((r: any) => r.fanout_key)).size).toBe(1);
    expect(push.sent).toHaveLength(0);                 // nothing interrupted anybody at 22:00
  });

  it('the bell says what is held for you, and when it comes', async () => {
    const b = await inbox.bell(tenantA, member);
    expect(b.unread).toBe(1);
    expect(b.held).toBe(2);
    expect(new Date(b.nextRelease as Date).toISOString()).toBe(SIX_IST.toISOString());
    expect(b.releaseStopped).toBe(false);
    expect(b.latest.map((i) => i.channel)).toEqual(['inapp']);
  });

  it('the release job: before 06:00 nothing moves; at 06:01 the push is SENT, the SMS records no_template; a second tick is a no-op', async () => {
    clock = new Date('2026-10-01T00:20:00Z');           // 05:50 IST
    const early = await job.tick(admin, clock);
    expect((await rowsOf(member, 'A-2201')).filter((r: any) => r.status === 'suppressed')).toHaveLength(2);
    void early;
    clock = MORNING;
    const t = await job.tick(admin, MORNING);
    expect(t.errors).toBe(0);
    const rows = await rowsOf(member, 'A-2201');
    const pushRow = rows.find((r: any) => r.channel === 'push'); const smsRow = rows.find((r: any) => r.channel === 'sms');
    expect([pushRow.status, pushRow.suppressed_reason]).toEqual(['sent', 'quiet_hours']);   // the reason stays, as history
    expect(pushRow.released_at).not.toBeNull();
    expect([smsRow.status, smsRow.failure_reason, smsRow.suppressed_reason]).toEqual(['failed', 'no_template', 'quiet_hours']);
    expect(push.sent.length).toBeGreaterThanOrEqual(1);
    const again = await job.tick(admin, MORNING);
    const after = await rowsOf(member, 'A-2201');
    expect(after.map((r: any) => r.status)).toEqual(rows.map((r: any) => r.status));
    expect(again.errors).toBe(0);
  });

  it('W434 · the ladder is the delivery instance: in-app sent; push queued → held → released → sent; SMS held → released → failed (no_template)', async () => {
    const { items } = await inbox.list(tenantA, member, { limit: 20 });
    const item = items.find((i) => (i.payload as any).orderNo === 'A-2201')!;
    expect(item.alsoOn.map((a) => [a.channel, a.outcome])).toEqual([['push', 'sent'], ['sms', 'failed']]);
    const l = await inbox.ladder(tenantA, member, item.id, item.at);
    expect(l.grouped).toBe(true);
    expect(l.channels.map((c) => [c.channel, c.steps.map((s) => s.kind).join('>')])).toEqual([
      ['inapp', 'queued>sent'], ['push', 'queued>held>released>sent'], ['sms', 'queued>held>released>failed']]);
    expect(l.channels[2].steps[3].reason).toBe('no_template');
  });

  it('F-6 · a typo\'d zone on disk cannot fail the fan-out: both members get their rows, the typo read in the cooperative\'s zone', async () => {
    expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkatta' }).format(0)).toThrow(RangeError);   // the defect's trigger
    clock = NIGHT;
    await expect(fan([typo, neighbour], 'A-2202')).resolves.toBeUndefined();
    const t = await rowsOf(typo, 'A-2202'); const n = await rowsOf(neighbour, 'A-2202');
    expect(t.map((r: any) => [r.channel, r.status, r.suppressed_reason])).toEqual([['inapp', 'sent', null], ['push', 'suppressed', 'quiet_hours'], ['sms', 'suppressed', 'quiet_hours']]);
    expect(n.map((r: any) => r.channel)).toEqual(['inapp', 'push', 'sms']);
    expect(new Date(t[1].held_until).toISOString()).toBe(SIX_IST.toISOString());   // 06:00 in the cooperative's zone
  });

  it('F-6 · and the typo is refused at write: by the review (TIMEZONE_UNKNOWN), by the writer, and by the database as kv_app (23514)', async () => {
    const r = await prefs.previewWindow(tenantA, typo, { starts: '22:00', ends: '05:30', timezone: 'Asia/Kolkatta' }, NOON);
    expect(r.ready).toBe(false);
    expect(r.refusals).toContainEqual({ field: 'timezone', code: 'TIMEZONE_UNKNOWN' });
    await expect(prefs.setQuietHours(tenantA, typo, { starts: '22:00', ends: '05:30', timezone: 'Asia/Kolkatta' })).rejects.toMatchObject({ code: 'INBOX_FORM_REFUSED' });
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE user_quiet_hours SET timezone = 'Asia/Kolkatta' WHERE user_id = $1`, [neighbour])))).toBe('ok');   // no row: 0 rows, no error
    expect(await pgCode(asApp(tenantA, (q) => q(`INSERT INTO user_quiet_hours (user_id, starts, ends, timezone) VALUES ($1,'22:00','06:00','Asia/Kolkatta')`, [neighbour])))).toBe('23514');
    // A blank zone is the COOPERATIVE's, never a literal; the window maths come back in that zone.
    const ok = await prefs.previewWindow(tenantA, typo, { starts: '22:00', ends: '05:30' }, NOON);
    expect(ok.ready).toBe(true);
    expect(ok.stored.timezone).toBe('Asia/Kolkata');
    expect(ok.maths).toMatchObject({ lengthMinutes: 450, crossesMidnight: true, off: false, zoneFromTenant: true });
    expect(ok.maths.next).toEqual({ start: '2026-09-30T16:30:00.000Z', end: '2026-10-01T00:00:00.000Z', current: false });
    const saved = await prefs.setQuietHours(tenantA, typo, { starts: '22:00', ends: '05:30' }, { idemKey: `qh-${randomUUID()}` });
    expect(saved.timezone).toBe('Asia/Kolkata');
    const audit = (await admin.query(`SELECT action, old_value, new_value FROM audit_log WHERE entity_type = 'user_quiet_hours' AND entity_id = $1`, [typo])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].old_value.timezone).toBe('Asia/Kolkatta');
  });

  it('F-10 · the webhook: `failed` writes failed + a vocabulary reason + failed_at; `delivered` stamps delivered_at; a repeat is unchanged', async () => {
    clock = NOON;
    // wage.paid is critical with a served sms:hi row — the noop gateway accepts it and hands back a provider ref.
    for (const u of [member, neighbour]) await admin.query(`UPDATE users SET language_code = 'hi' WHERE id = $1`, [u]);
    await fan([member, neighbour], 'W-1', tenantA, 'wage.paid');
    const refOf = async (u: string) => (await admin.query(`SELECT provider_msg_ref FROM notifications WHERE user_id = $1 AND event_code = 'wage.paid' AND channel = 'sms'`, [u])).rows[0].provider_msg_ref as string;
    const a = await refOf(member); const b = await refOf(neighbour);
    expect(await spine.applyDeliveryStatus(tenantA, a, 'failed', 'DND_REGISTERED')).toBe('failed');
    expect(await spine.applyDeliveryStatus(tenantA, b, 'delivered')).toBe('delivered');
    expect(await spine.applyDeliveryStatus(tenantA, b, 'failed', 'late')).toBe('unchanged');
    expect(await spine.applyDeliveryStatus(tenantA, 'no-such-ref', 'failed')).toBe('not_found');
    const fa = (await admin.query(`SELECT status::text AS s, failure_reason, failed_at FROM notifications WHERE provider_msg_ref = $1`, [a])).rows[0];
    expect([fa.s, fa.failure_reason]).toEqual(['failed', 'dnd_registered']);
    expect(fa.failed_at).not.toBeNull();
    const db = (await admin.query(`SELECT status::text AS s, delivered_at FROM notifications WHERE provider_msg_ref = $1`, [b])).rows[0];
    expect(db.s).toBe('delivered'); expect(db.delivered_at).not.toBeNull();
    // Free text never reaches the column (Law 6): the trigger refuses an unknown code even from the owner.
    expect(await pgCode(admin.query(`UPDATE notifications SET failure_reason = 'gateway said no' WHERE provider_msg_ref = $1`, [a]))).toBe('23514');
  });

  it('F-9 · the inbox is in-app rows only; filters narrow YOUR items (tier · module · channel · state)', async () => {
    const { items } = await inbox.list(tenantA, member, { limit: 50 });
    expect(items.length).toBe(1);                         // order A-2201's in-app item; wage.paid has no in-app channel
    expect(items.every((i) => i.channel === 'inapp')).toBe(true);
    const all = await admin.query(`SELECT count(*)::int n FROM notifications WHERE user_id = $1`, [member]);
    expect(all.rows[0].n).toBeGreaterThan(items.length);   // the log has the other channels; the inbox does not list them
    expect((await inbox.list(tenantA, member, { limit: 50, tier: 'important' })).items.every((i) => i.tier === 'important')).toBe(true);
    expect((await inbox.list(tenantA, member, { limit: 50, module: 'order' })).items.every((i) => i.module === 'order')).toBe(true);
    // wage.paid had no in-app channel, so "also by SMS" finds order.confirmed only
    expect((await inbox.list(tenantA, member, { limit: 50, channel: 'sms' })).items.every((i) => i.alsoOn.some((a) => a.channel === 'sms'))).toBe(true);
    expect(items[0].localDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('F-13 · the matrix is the MEMBER\'s own read (no notification.manage); the tenant health tiles are not — by name', async () => {
    const m = await prefs.matrix(tenantA, member);
    expect(m.counts.events).toBe((await admin.query(`SELECT count(*)::int n FROM notification_events WHERE deleted_at IS NULL`)).rows[0].n);
    expect(m.counts.locked).toBe((await admin.query(`SELECT count(*)::int n FROM notification_events WHERE NOT user_can_opt_out AND deleted_at IS NULL`)).rows[0].n);
    const otp = m.tiers.find((t) => t.tier === 'critical')!.events.find((e) => e.code === 'auth.otp')!;
    expect(otp.locked).toBe(true);
    expect(m.routineRule.decided).toBe(true);
    expect(m.quietHours.effective).toMatchObject({ starts: '21:00', ends: '06:00', timezone: 'Asia/Kolkata', source: 'tenant_default' });
    await expect(inbox.health(tenantA, asMember(member))).rejects.toMatchObject({ code: 'COMM_FORBIDDEN' });
    const h = await inbox.health(tenantA, { userId: member, canManage: true });
    expect(h.suppressedByReason.quiet_hours).toBeGreaterThanOrEqual(4);
    expect(h.failedByReason.dnd_registered).toBe(1);
    // A locked event cannot be switched off — by the review, then by the writer.
    const rv = await prefs.previewPreferences(member, [{ eventCode: 'auth.otp', channel: 'sms', isEnabled: false }, { eventCode: EVENT, channel: 'email', isEnabled: false }]);
    expect(rv.refusals).toEqual([{ field: 'auth.otp::sms', code: 'CANNOT_OPT_OUT' }, { field: `${EVENT}::email`, code: 'CHANNEL_NOT_SENT' }]);
  });

  it('another tenant sees none of it — rows, inbox, ladder — and kv_app cannot write across the wall', async () => {
    const { items } = await inbox.list(tenantA, member, { limit: 1 });
    expect((await inbox.list(tenantB, member, { limit: 50 })).items).toHaveLength(0);
    await expect(inbox.ladder(tenantB, member, items[0].id, items[0].at)).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    await expect(inbox.ladder(tenantA, neighbour, items[0].id, items[0].at)).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });   // another member: 404
    expect(await asApp(tenantB, async (q) => (await q(`SELECT count(*)::int n FROM notifications WHERE tenant_id = $1`, [tenantA])).rows[0].n)).toBe(0);
    expect(await asApp(tenantB, async (q) => (await q(`UPDATE notifications SET read_at = now() WHERE tenant_id = $1`, [tenantA])).rowCount)).toBe(0);
    expect(await pgCode(asApp(tenantB, (q) => q(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, status) VALUES ($1,$2,'order.confirmed','inapp','sent')`, [tenantA, memberB])))).toBe('42501');
    expect(await pgCode(asApp(tenantB, (q) => q(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, status) VALUES (NULL,$1,'order.confirmed','inapp','sent')`, [memberB])))).toBe('42501');
    // kv_app's UPDATE is the delivery columns only (0176): it cannot re-tenant or re-hold a row.
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notifications SET held_until = now() WHERE user_id = $1`, [member])))).toBe('42501');
  });

  it('mark read (one) and mark ALL read: audited, keyed, idempotent', async () => {
    clock = NOON;
    for (const n of ['A-9001', 'A-9002']) await fan([memberB], n, tenantA);
    const before = (await inbox.readAllPreview(tenantA, memberB)).unread;
    expect(before).toBe(2);
    const key = `ra-${randomUUID()}`;
    expect(await inbox.markAllRead(tenantA, asMember(memberB), key, '10.0.0.9')).toEqual({ marked: 2 });
    expect(await inbox.markAllRead(tenantA, asMember(memberB), key, '10.0.0.9')).toEqual({ marked: 2 });   // same key → the same answer, no second act
    expect(await inbox.markAllRead(tenantA, asMember(memberB), `ra-${randomUUID()}`, null)).toEqual({ marked: 0 });
    const audit = (await admin.query(`SELECT new_value FROM audit_log WHERE action = 'communication.notifications.read_all' AND entity_id = $1 ORDER BY created_at`, [memberB])).rows;
    expect(audit.map((a: any) => a.new_value.notificationsMarkedRead)).toEqual([2, 0]);
    expect((await inbox.bell(tenantA, memberB)).unread).toBe(0);
    // one item, with its own time (one partition) — read already, so no second audit row
    const { items } = await inbox.list(tenantA, memberB, { limit: 1 });
    const r = await inbox.markRead(tenantA, asMember(memberB), items[0].id, { at: items[0].at, idemKey: `mr-${randomUUID()}` });
    expect(r.status).toBe('read');
    // …and the TABLE says so (the pre-8b point update matched zero rows — see NotificationRepository's AT()).
    expect((await admin.query(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND channel = 'inapp' AND status = 'read' AND read_at IS NOT NULL`, [memberB])).rows[0].n).toBe(2);
    await expect(inbox.markRead(tenantA, asMember(member), items[0].id, {})).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });   // not yours: 404
  });

  it('opted out overnight → the held row is never sent; the kill-switch stops the release and loses nothing', async () => {
    clock = NIGHT;
    await fan([neighbour], 'A-3001');
    await prefs.setPreferences(tenantA, neighbour, [{ eventCode: EVENT, channel: 'push', isEnabled: false }]);
    await admin.query(`INSERT INTO feature_flags (key, is_enabled, tier) VALUES ('notification.held_release_kill_switch', true, 'kill_switch')
                       ON CONFLICT (key) DO UPDATE SET is_enabled = true`);
    const stopped = await freshJob(MORNING).tick(admin, MORNING);
    expect(stopped.stopped).toBe(true);
    expect((await rowsOf(neighbour, 'A-3001')).filter((r: any) => r.status === 'suppressed')).toHaveLength(2);   // still held, not lost
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'notification.held_release_kill_switch'`);
    const released = await freshJob(MORNING).tick(admin, MORNING);
    expect(released.optedOut).toBeGreaterThanOrEqual(1);
    const rows = await rowsOf(neighbour, 'A-3001');
    const p = rows.find((r: any) => r.channel === 'push');
    expect([p.status, p.suppressed_reason, p.held_until, p.released_at]).toEqual(['suppressed', 'opted_out', null, null]);
    expect(rows.find((r: any) => r.channel === 'sms').status).toBe('failed');   // still wanted; released; no sms template
  });
});
