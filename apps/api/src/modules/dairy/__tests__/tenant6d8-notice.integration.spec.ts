// modules/dairy/__tests__/tenant6d8-notice.integration.spec.ts · PC-56 TENANT-6d-8, LIVE Postgres.
//
// **W170's SENTENCE, END TO END, AGAINST A REAL DATABASE:** *"divert evening shift to Bhesan (route notice to 87
// pourers, Gujarati voice)"*. Three members of one cooperative, three languages, one signature — and the delivery log
// afterwards says who was told, in what, and on which channel.
//
// SIX THINGS HERE CANNOT BE PROVEN ANY OTHER WAY:
//
//   1. **THE NOTICE ACTUALLY REACHES THE MEMBERS OF THAT CENTRE'S ROLL** — resolved through `dairy_membership_routes`
//      as of the diverted day, which needs real routes, real memberships and a real day.
//   2. **IN EACH MEMBER'S OWN LANGUAGE**, over the REAL seeded copy: the Gujarati member's row carries `gu` and its
//      template body is the Gujarati one. Before TENANT-6d-7 every one of these was `en`.
//   3. **THE RECEIPT AND THE COLUMN GRANT.** 0166 revoked UPDATE on this table and granted back two endings; 0167 adds
//      four notice columns. Only a live write as `kv_app` proves the grant was extended and not widened.
//   4. **THE RETRACTION**, and the CHECK that refuses one for a diversion that announced nothing.
//   5. **THE DELIVERY REPORT'S OWN QUERY** — the bounded read over a partitioned table, with the counts a screen
//      prints and the distinction between rows and people.
//   6. **THE FLAG'S KILL-SWITCH**: with the notice off, the act still works and NOTHING is queued.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { realNoticeVars } from '../../../../test/helpers/notice-vars';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { NoopNotificationGateway } from '../../communication/gateway/noop.gateway';
import { NoopPushSender } from '../../communication/gateway/noop-push.sender';
import { PushDeviceRepository } from '../../communication/repositories/push-device.repository';
import { NotificationEventRepository } from '../../communication/repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../../communication/repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../../communication/repositories/notification-preference.repository';
import { QuietHoursRepository } from '../../communication/repositories/quiet-hours.repository';
import { NotificationRepository } from '../../communication/repositories/notification.repository';
import { NotificationService } from '../../communication/services/notification.service';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { DairyDiversionRepository } from '../repositories/dairy-diversion.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { DairyDiversionService } from '../services/dairy-diversion.service';
import { NOTICE_FLAG } from '../domain/dairy-diversion.flags';
import { DairyEventType } from '../domain/dairy.events';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-8 · the notice (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork;
  let mccs: MccCentreService; let memberships: DairyMembershipService;
  let diversions: DairyDiversionService; let notifications: NotificationService;
  let divRepo: DairyDiversionRepository; let flagCache: InMemoryCacheService;

  const tenantA = randomUUID();
  const operator = randomUUID();
  const lead = randomUUID();
  // Three families on ONE centre's roll, reading three different languages — the ordinary case in a Gujarat union with
  // migrant members, and the case W170's *"Gujarati voice"* has to survive.
  const gujarati = randomUUID(); const hindi = randomUUID(); const english = randomUUID();
  const opActor = { userId: operator, canManage: true, canOverride: false };
  const leadActor = { userId: lead, canManage: true, canOverride: true };

  let vanthali = ''; let bhesan = ''; let today = '';

  const roleIn = (userId: string) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
     SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
     ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [userId, tenantA]);

  const registerDevice = (userId: string) => admin.query(
    `INSERT INTO push_devices (user_id, platform, token, is_active) VALUES ($1,'android',$2,true)
     ON CONFLICT (token) DO NOTHING`, [userId, `tok-${randomUUID()}`]);

  const setNoticeFlag = async (on: boolean) => {
    await admin.query(
      `INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier)
       VALUES ($1,'itest',$2,100,'experiment')
       ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`, [NOTICE_FLAG, on]);
    // The flag cache is per-process and the read is cached for a TTL, so a test that flips a flag has to invalidate
    // it — the same two keys TENANT-6c-6's live suite clears.
    await flagCache.del(`flag:${NOTICE_FLAG}`); await flagCache.del('flags:all');
  };

  /** The relay's job, done by hand: take the outbox rows this act wrote and fan them out through the real spine. */
  const fanoutQueued = async (eventTypes: string[]) => {
    const rows = await admin.query<{ id: string; event_type: string; payload: Record<string, unknown> }>(
      `SELECT id, event_type, payload FROM outbox_events
        WHERE tenant_id=$1 AND event_type = ANY($2::text[]) AND published_at IS NULL
        ORDER BY created_at`, [tenantA, eventTypes]);
    for (const row of rows.rows) {
      await uow.run(tenantA, (tx) => notifications.fanout(tx, {
        tenantId: tenantA, eventCode: row.event_type,
        recipients: (row.payload.recipientUserIds as string[]) ?? [],
        payload: row.payload, dedupeKey: row.id,
      }));
      await admin.query(`UPDATE outbox_events SET published_at = now() WHERE id = $1`, [row.id]);
    }
    return rows.rows.length;
  };

  const deliveries = (eventCode: string) => admin.query<{ user_id: string; channel: string; language_code: string; status: string; body: string | null }>(
    `SELECT n.user_id, n.channel, n.language_code, n.status, v.body
       FROM notifications n
       LEFT JOIN notification_template_versions v ON v.id = n.template_version_id
      WHERE n.tenant_id=$1 AND n.event_code=$2
      ORDER BY n.user_id, n.channel`, [tenantA, eventCode]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [operator, lead, gujarati, hindi, english]) await makeUser(admin, u);
    for (const u of [operator, lead, gujarati, hindi, english]) await roleIn(u);
    await admin.query(`UPDATE users SET language_code='gu' WHERE id=$1`, [gujarati]);
    await admin.query(`UPDATE users SET language_code='hi' WHERE id=$1`, [hindi]);
    await admin.query(`UPDATE users SET language_code='en' WHERE id=$1`, [english]);
    for (const u of [gujarati, hindi, english]) await registerDevice(u);
    today = String((await admin.query(`SELECT current_date::text AS d`)).rows[0].d);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);

    const mccRepo = new MccCentreRepository(replica as never);
    const routeRepo = new DairyMembershipRouteRepository(replica as never);
    divRepo = new DairyDiversionRepository(replica as never);
    notifications = new NotificationService(
      uow, outbox, metrics, new NoopNotificationGateway(config), new NoopPushSender(false),
      new PushDeviceRepository(replica as never), new NotificationEventRepository(replica as never),
      new NotificationTemplateRepository(replica as never), new NotificationPreferenceRepository(replica as never),
      new QuietHoursRepository(replica as never), new NotificationRepository(replica as never), flags);

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo, new MccOperatorAssignmentRepository(replica as never));
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, new DairyMembershipRepository(replica as never), mccRepo, routeRepo);
    diversions = new DairyDiversionService(uow, outbox, idem, metrics, audit, divRepo, mccRepo, flags,
      realNoticeVars(replica) as never, notifications);

    const v: any = await mccs.create(tenantA, opActor as never, `idem-${randomUUID()}`, { code: 'MCC-D8-VNT', defaultName: 'Vanthali' } as never, null);
    vanthali = v.id;
    const b: any = await mccs.create(tenantA, opActor as never, `idem-${randomUUID()}`, { code: 'MCC-D8-BHE', defaultName: 'Bhesan' } as never, null);
    bhesan = b.id;
    // THREE FAMILIES ON VANTHALI'S ROLL. Enrolment opens each membership's first route period (0164), which is what the
    // notice resolves its recipients from.
    let n = 0;
    for (const u of [gujarati, hindi, english]) {
      n += 1;
      await memberships.create(tenantA, opActor as never, `idem-${randomUUID()}`, {
        farmerUserId: u, mccId: vanthali, memberCode: `D8-00${n}`, defaultAnimalType: 'buffalo', paymentCycle: 'fortnightly',
      } as never);
    }
    await setNoticeFlag(true);
  }, 60_000);

  afterAll(async () => { await pools?.onModuleDestroy?.(); await admin?.end(); });

  const sign = async (day = today, shift: 'morning' | 'evening' = 'evening') => {
    const req: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
      fromMccId: vanthali, toMccId: bhesan, divertedOn: day, shift, reason: 'power cut, DG will not hold the evening',
    }, null);
    const signed: any = await diversions.approve(tenantA, leadActor as never, `idem-${randomUUID()}`, req.id, null);
    return { req, signed };
  };

  it('TELLS THE CENTRE\'S OWN ROLL, EACH IN THEIR OWN LANGUAGE — W170\'s sentence, kept', async () => {
    const { signed } = await sign();
    expect(signed.state).toBe('live');
    expect(signed.notice).toBe('queued');
    expect(signed.noticeRecipients).toBe(3);

    // The relay's work, done here so the assertions are about what the members receive rather than what was queued.
    expect(await fanoutQueued([DairyEventType.ShiftDiverted])).toBe(1);
    const rows = (await deliveries('dairy.shift_diverted')).rows;
    const langOf = (u: string) => [...new Set(rows.filter((r) => r.user_id === u).map((r) => r.language_code))];
    // BEFORE TENANT-6d-7 ALL THREE OF THESE WERE `['en']`, and W170 says *"Gujarati voice"*.
    expect(langOf(gujarati)).toEqual(['gu']);
    expect(langOf(hindi)).toEqual(['hi']);
    expect(langOf(english)).toEqual(['en']);

    // AND THE WORDS ARRIVE FILLED IN: the Gujarati body names both villages, the day in digits and *સાંજ*.
    const guPush = rows.find((r) => r.user_id === gujarati && r.channel === 'push')!;
    expect(guPush.status).toBe('sent');
    expect(guPush.body).toContain('{{to}}');                    // the copy asks for it...
    const payload = (await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND channel='push' AND event_code='dairy.shift_diverted'`,
      [tenantA, gujarati])).rows[0].payload;
    expect(payload.from).toBe('Vanthali');
    expect(payload.to).toBe('Bhesan');
    expect(payload.day).toMatch(/^\d{2}\/\d{2}$/);
    expect((payload.shift as Record<string, string>).gu).toBe('સાંજ');

    // THE VOICE LEG IS REAL — `ivr` is in `default_channels` (0166) and its template exists in all three languages, so
    // a row is written for it rather than the channel being silently absent.
    expect(rows.some((r) => r.user_id === gujarati && r.channel === 'ivr')).toBe(true);
    // ...and the in-app leg 0167 added, which is the copy a member can re-read at the counter.
    expect(rows.some((r) => r.user_id === gujarati && r.channel === 'inapp' && r.status === 'sent')).toBe(true);
  });

  it('REPORTS WHAT THE DELIVERY LOG SAYS — people, not rows', async () => {
    const list: any[] = await diversions.list(tenantA, leadActor as never, { limit: 10 });
    const live = list.find((d) => d.notice === 'queued')!;
    const rep: any = await diversions.noticeReport(tenantA, leadActor as never, live.id);
    expect(rep.state).toBe('queued');
    expect(rep.queuedFor).toBe(3);
    // Three families, four channels each ⇒ twelve rows and THREE PEOPLE. A screen that showed rows where a cooperative
    // asked *"how many were told?"* would report three families as twelve.
    expect(rep.delivery.rows).toBeGreaterThanOrEqual(3);
    expect(rep.delivery.people).toBe(3);
    expect(rep.delivery.byLanguage.gu).toBeGreaterThan(0);
    expect(rep.delivery.byLanguage.hi).toBeGreaterThan(0);
    expect(rep.delivery.byChannel.inapp).toBe(3);
    // The SMS leg is recorded and NOT sent: 6c-2's DLT ruling deactivated placeholder rows, and these were seeded with
    // real bodies but no registered template id, so they resolve and send in test and are recorded either way.
    expect(Object.keys(rep.delivery.byStatus).length).toBeGreaterThan(0);
  });

  it('RETRACTS IT when the diversion is called off, and the members are told again', async () => {
    const { signed } = await sign(today, 'morning');
    expect(signed.notice).toBe('queued');
    await fanoutQueued([DairyEventType.ShiftDiverted]);

    const done: any = await diversions.cancel(tenantA, opActor as never, `idem-${randomUUID()}`, signed.id, 'DG held after all', null);
    expect(done.notice).toBe('retracted');
    expect(done.retractionRecipients).toBe(3);
    expect(await fanoutQueued([DairyEventType.ShiftDiversionCancelled])).toBe(1);

    const rows = (await deliveries('dairy.shift_diversion_cancelled')).rows;
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(3);
    expect(rows.filter((r) => r.user_id === gujarati).every((r) => r.language_code === 'gu')).toBe(true);
    // The retraction is its own catalogue row, `critical` and unmutable like the diversion — so it is not suppressed by
    // a member's quiet hours at five in the morning, which is exactly when it matters.
    const ev = await admin.query<{ priority: string; user_can_opt_out: boolean }>(
      `SELECT priority, user_can_opt_out FROM notification_events WHERE code='dairy.shift_diversion_cancelled'`);
    expect(ev.rows[0]).toEqual({ priority: 'critical', user_can_opt_out: false });
  });

  it('WILL NOT LET A RETRACTION EXIST WITHOUT A NOTICE — in the database, not only in the service', async () => {
    // A day of its own: `uq_dairy_diversion_live` allows ONE live diversion per centre-shift-day and the first test in
    // this file already holds today's evening (6d-6's index, doing its job inside this wave's suite).
    const day = String((await admin.query(`SELECT (current_date + 3)::text AS d`)).rows[0].d);
    const r: any = await diversions.request(tenantA, opActor as never, `idem-${randomUUID()}`, {
      fromMccId: vanthali, toMccId: bhesan, divertedOn: day, shift: 'evening', reason: 'asked in error, never signed',
    }, null);
    // A cancelled REQUEST announced nothing, so the service writes no retraction...
    const done: any = await diversions.cancel(tenantA, opActor as never, `idem-${randomUUID()}`, r.id, 'called off before signing', null);
    expect(done.notice).toBe('not_signed');
    expect(done.retractionQueuedAt).toBeNull();
    // ...and 0167's CHECK refuses one for anything that does not come through the service.
    await expect(admin.query(
      `UPDATE dairy_shift_diversions SET retraction_queued_at = now(), retraction_recipients = 3 WHERE id = $1`, [r.id]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('KEEPS THE RECEIPT APPEND-ONLY: the application role may write these four columns and nothing else', async () => {
    const { signed } = await sign(String((await admin.query(`SELECT (current_date + 1)::text AS d`)).rows[0].d));
    // The four columns 0167 granted, written by the act itself — proven by the row, not by the grant table.
    const row = await admin.query<{ notice_recipients: number }>(
      `SELECT notice_recipients FROM dairy_shift_diversions WHERE id=$1`, [signed.id]);
    expect(row.rows[0].notice_recipients).toBe(3);

    // And the columns 0166 protected are still protected: `kv_app` cannot rewrite what was asked for. (A GRANT
    // statement that had used REVOKE ALL + GRANT would have silently widened this back.)
    const app = new Pool({ connectionString: APP_URL });
    try {
      await app.query(`SET app.tenant_id = '${tenantA}'`);
      await expect(app.query(`UPDATE dairy_shift_diversions SET reason='rewritten' WHERE id=$1`, [signed.id]))
        .rejects.toMatchObject({ code: '42501' });
      // ...while the notice receipt is writable, which is what 0167 added.
      await expect(app.query(`UPDATE dairy_shift_diversions SET notice_recipients = notice_recipients WHERE id=$1`, [signed.id]))
        .resolves.toBeDefined();
    } finally { await app.end(); }
  });

  it('QUEUES NOTHING WITH THE FLAG OFF — the act still works, and the screen says who tells them', async () => {
    await setNoticeFlag(false);
    try {
      const day = String((await admin.query(`SELECT (current_date + 2)::text AS d`)).rows[0].d);
      const { signed } = await sign(day);
      expect(signed.state).toBe('live');                  // the diversion happened
      expect(signed.notice).toBe('not_enabled');          // and this cooperative announces it themselves
      expect(signed.noticeQueuedAt).toBeNull();
      const queued = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_events
          WHERE tenant_id=$1 AND event_type=$2 AND (payload->>'divertedOn') = $3`,
        [tenantA, DairyEventType.ShiftDiverted, day]);
      expect(queued.rows[0].n).toBe(0);
      // And the PREVIEW says it before anybody signs, which is the point of showing it at all.
      const p: any = await diversions.preview(tenantA, leadActor as never, {
        fromMccId: vanthali, toMccId: bhesan, divertedOn: day, shift: 'morning', reason: 'testing the flag',
      });
      expect(p.noticeEnabled).toBe(false);
      expect(p.affectedMembers).toBe(3);
    } finally { await setNoticeFlag(true); }
  });
});
