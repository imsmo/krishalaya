// modules/communication/__tests__/tenant8a-override.integration.spec.ts · PC-56 TENANT-8a · THE OVERRIDE, live.
//
// Real PG16, the test database the harness builds from the real chain (migrations + seeds), every tenant-realm query as
// `kv_app` under RLS. What this proves, in the order a cooperative lives it:
//   1. a tenant override is a DRAFT version (never serving), SUBMITTED by its author, APPROVED by a SECOND person — and
//      only then does `resolve()` answer with it; the author approving their own words is refused by the verdict AND
//      by 0175's trigger (23514);
//   2. the FAN-OUT sends the override's words to that tenant's member and the platform's words to another tenant's —
//      and it found the override through THIS tenant's own language order (F-22: the reader speaks hi, the tenant
//      declared gu, and no Hindi rung was guessed);
//   3. an SMS override never serves: approval sends it to the provider (`submitted_to_provider`), the fan-out still
//      records `no_template`, and the database refuses a hand-made `approved` or a pointer onto it (23514);
//   4. a channel outside the event's `default_channels` is refused by the review and by the database (F-11);
//   5. retiring falls back to the platform default, never to silence;
//   6. kv_app cannot touch a platform row or the catalogue (F-3) and tenant B sees nothing of A's;
//   7. W180's counts are live queries (F-12).
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
import { TemplateOverrideService } from '../services/template-override.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class CapturingPush implements PushSender {
  readonly providerCode = 'capture';
  readonly sent: PushMessage[] = [];
  async send(msg: PushMessage) { this.sent.push(msg); return { sent: msg.tokens.length, invalidTokens: [] }; }
}

const EVENT = 'order.confirmed';            // important, opt-out-able, default channels push · sms · inapp
const BODY_GU = 'આનંદ FPO: તમારો ઓર્ડર {{orderNo}} કન્ફર્મ થયો — પિકઅપ વંથલી MCC';

run('TENANT-8a · the override (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let svc: TemplateOverrideService; let notifications: NotificationService; let templates: NotificationTemplateRepository; let push: CapturingPush;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const author = randomUUID(); const checker = randomUUID(); const memberA = randomUUID(); const memberB = randomUUID();
  const authorActor = { userId: author, canAuthor: true, canApprove: true };      // holds BOTH verbs — and still cannot approve their own
  const checkerActor = { userId: checker, canAuthor: false, canApprove: true };
  const agentActor = { userId: randomUUID(), canAuthor: true, canApprove: false }; // support_agent: author only (F-19)
  let pushTemplateId = ''; let pushVersionId = ''; let smsTemplateId = ''; let smsVersionId = '';

  /** Run statements as kv_app under a tenant, inside a transaction that is always rolled back. */
  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [author, checker, memberA, memberB, agentActor.userId]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET full_name = 'Kavita Author' WHERE id = $1`, [author]);
    await admin.query(`UPDATE users SET full_name = 'Rajesh Checker' WHERE id = $1`, [checker]);
    // Tenant A speaks Gujarati first (the platform's `tenant_languages` row); tenant B declared nothing.
    await admin.query(`INSERT INTO tenant_languages (tenant_id, language_code, is_default) VALUES ($1,'gu',true) ON CONFLICT DO NOTHING`, [tenantA]);
    for (const u of [memberA, memberB]) {
      await admin.query(`INSERT INTO push_devices (user_id, platform, token, is_active) VALUES ($1,'android',$2,true) ON CONFLICT (token) DO NOTHING`, [u, `tok-${randomUUID()}`]);
    }
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const metrics = new PromMetrics();
    const events = new NotificationEventRepository(replica as any);
    templates = new NotificationTemplateRepository(replica as any);
    svc = new TemplateOverrideService(uow, new AuditWriter(pools), new PgIdempotencyService(pools), metrics, events, templates);
    push = new CapturingPush();
    notifications = new NotificationService(uow, new PgOutboxWriter(), metrics, new NoopNotificationGateway(config), push, new PushDeviceRepository(replica as any),
      events, templates, new NotificationPreferenceRepository(replica as any), new QuietHoursRepository(replica as any), new NotificationRepository(replica as any),
      new FlagsService(pools, new InMemoryCacheService()));
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  const form = (over: Record<string, string> = {}) => ({ eventCode: EVENT, channel: 'push', languageCode: 'gu', body: BODY_GU, reason: 'our pickup point, in Gujarati', ...over });

  it('the review is computed from the real catalogue, the tenant\'s languages and what serves today', async () => {
    const r = await svc.preview(tenantA, authorActor, form());
    expect(r.ready).toBe(true);
    expect(r.preview.servingToday.source).toBe('none');         // order.confirmed × push × gu has no platform row
    expect(r.preview.servesAfterApproval).toBe(true);
    expect(r.preview.rendered?.body).toContain('આનંદ FPO');
    // A language the tenant does not speak, a channel the event is not sent on, and security copy — each by name.
    expect((await svc.preview(tenantA, authorActor, form({ languageCode: 'hi' }))).refusals).toEqual([{ field: 'languageCode', code: 'LANGUAGE_NOT_TENANT' }]);
    expect((await svc.preview(tenantA, authorActor, form({ channel: 'email' }))).refusals).toEqual([{ field: 'channel', code: 'CHANNEL_NOT_DEFAULT' }]);
    expect((await svc.preview(tenantA, authorActor, form({ eventCode: 'auth.otp', channel: 'sms' }))).refusals).toContainEqual({ field: 'eventCode', code: 'SECURITY_COPY_PLATFORM_ONLY' });
    // Tenant B declared no languages → the platform registry's active ones are the choices; `hi` is allowed there.
    expect((await svc.preview(tenantB, authorActor, form({ languageCode: 'hi' }))).ready).toBe(true);
    // A declared contract: order.delivered requires {{order_id}}; a typo is refused, with what a member would have read.
    const typo = await svc.preview(tenantA, authorActor, form({ eventCode: 'order.delivered', body: 'Order {{order_no}} delivered' }));
    expect(typo.refusals).toEqual([{ field: 'body', code: 'UNKNOWN_VARIABLES' }, { field: 'body', code: 'MISSING_REQUIRED_VARIABLES' }]);
  });

  it('saving writes a DRAFT (row born inactive, unserved), keyed and audited; the fan-out still sends nothing of it', async () => {
    const key = `k-${randomUUID()}`;
    const a = await svc.saveDraft(tenantA, authorActor, key, form(), '10.0.0.1');
    const again = await svc.saveDraft(tenantA, authorActor, key, form(), '10.0.0.1');
    expect(again).toEqual(a);                                   // the same key never writes twice
    pushTemplateId = a.templateId; pushVersionId = a.versionId;
    expect(a).toMatchObject({ versionNo: 1, lifecycle: 'draft' });
    const row = (await admin.query(`SELECT tenant_id, is_active, serving_version_id, body FROM notification_templates WHERE id=$1`, [a.templateId])).rows[0];
    expect(row).toEqual({ tenant_id: tenantA, is_active: false, serving_version_id: null, body: '' });
    const v = (await admin.query(`SELECT tenant_id, lifecycle, authored_by_user_id, body, body_sha256 = encode(digest(body,'sha256'),'hex') AS sha_ok FROM notification_template_versions WHERE id=$1`, [a.versionId])).rows[0];
    expect(v).toEqual({ tenant_id: tenantA, lifecycle: 'draft', authored_by_user_id: author, body: BODY_GU, sha_ok: true });
    expect(await templates.resolve(tenantA, EVENT, 'push', 'gu')).toBeNull();
    // A second draft beside an undecided one is refused by the review (OPEN_VERSION_EXISTS) and by the index.
    await expect(svc.saveDraft(tenantA, authorActor, `k-${randomUUID()}`, form({ body: `${BODY_GU} !` }), null)).rejects.toMatchObject({ code: 'TEMPLATE_FORM_REFUSED' });
    expect(await pgCode(asApp(tenantA, (q) => q(`INSERT INTO notification_template_versions (template_id, version_no, body, body_sha256, reason, authored_by_user_id, event_code, channel, language_code)
      VALUES ($1, 9, 'x', 'x', 'why', $2, $3, 'push', 'gu')`, [a.templateId, author, EVENT])))).toBe('23505');
  });

  it('submit → the author cannot approve (verdict AND trigger 23514) → a second person approves → SERVING', async () => {
    await svc.act(tenantA, authorActor, `k-${randomUUID()}`, pushTemplateId, 'submit', { reason: 'ready for a second read', versionId: pushVersionId }, null);
    await expect(svc.act(tenantA, authorActor, `k-${randomUUID()}`, pushTemplateId, 'approve', { reason: 'looks right to me' }, null))
      .rejects.toMatchObject({ code: 'TEMPLATE_ACT_REFUSED', details: { refusals: ['MAKER_IS_CHECKER'] } });
    // The support agent may write words but is not a checker (F-19).
    await expect(svc.act(tenantA, agentActor, `k-${randomUUID()}`, pushTemplateId, 'approve', { reason: 'approving it' }, null))
      .rejects.toMatchObject({ details: { refusals: ['NO_PERMISSION'] } });
    // The database says the same without the service in the room: kv_app naming the author as approver → 23514.
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notification_template_versions SET lifecycle='approved', approved_by_user_id=$2, approved_at=now() WHERE id=$1`, [pushVersionId, author])))).toBe('23514');
    // … nor may the pointer move onto a version that is not approved, nor the row be active without one.
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notification_templates SET serving_version_id=$2 WHERE id=$1`, [pushTemplateId, pushVersionId])))).toBe('23514');
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notification_templates SET is_active=true WHERE id=$1`, [pushTemplateId])))).toBe('23514');

    const r = await svc.act(tenantA, checkerActor, `k-${randomUUID()}`, pushTemplateId, 'approve', { reason: 'reads well for our members', versionId: pushVersionId }, null);
    expect(r).toMatchObject({ act: 'approve', to: 'approved' });
    const t = await templates.resolve(tenantA, EVENT, 'push', 'gu');
    expect(t?.versionId).toBe(pushVersionId);
    expect(t?.isTenantOverride).toBe(true);
    const v = (await admin.query(`SELECT lifecycle, approved_by_user_id, submitted_by_user_id FROM notification_template_versions WHERE id=$1`, [pushVersionId])).rows[0];
    expect(v).toEqual({ lifecycle: 'approved', approved_by_user_id: checker, submitted_by_user_id: author });
  });

  it('the FAN-OUT sends the override\'s words to tenant A\'s member and the platform\'s to tenant B\'s (and found A\'s through gu, not a guessed hi)', async () => {
    const platformEn = (await admin.query(`SELECT v.id, v.body FROM notification_templates t JOIN notification_template_versions v ON v.id=t.serving_version_id
      WHERE t.tenant_id IS NULL AND t.event_code=$1 AND t.channel='push' AND t.language_code='en'`, [EVENT])).rows[0];
    expect(platformEn).toBeDefined();
    push.sent.length = 0;
    await uow.run(tenantA, (tx) => notifications.fanout(tx, { tenantId: tenantA, eventCode: EVENT, recipients: [memberA], payload: { orderNo: 'A-19207' }, dedupeKey: `e-${randomUUID()}` }));
    await uow.run(tenantB, (tx) => notifications.fanout(tx, { tenantId: tenantB, eventCode: EVENT, recipients: [memberB], payload: { orderNo: 'B-1' }, dedupeKey: `e-${randomUUID()}` }));
    expect(push.sent).toHaveLength(2);
    expect(push.sent[0].body).toBe('આનંદ FPO: તમારો ઓર્ડર A-19207 કન્ફર્મ થયો — પિકઅપ વંથલી MCC');
    expect(push.sent[1].body).not.toContain('આનંદ');
    const logged = async (tenant: string, user: string) => (await admin.query(`SELECT template_version_id, language_code FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND channel='push'`, [tenant, user])).rows[0];
    expect(await logged(tenantA, memberA)).toEqual({ template_version_id: pushVersionId, language_code: 'gu' });
    expect(await logged(tenantB, memberB)).toEqual({ template_version_id: platformEn.id, language_code: 'en' });
  });

  it('an SMS override NEVER serves: approval sends it to the provider, the fan-out still records no_template, the DB refuses a hand-made approval', async () => {
    const d = await svc.saveDraft(tenantA, authorActor, `k-${randomUUID()}`, form({ channel: 'sms', body: 'Anand FPO: order {{orderNo}} confirmed' }), null);
    smsTemplateId = d.templateId; smsVersionId = d.versionId;
    await svc.act(tenantA, authorActor, `k-${randomUUID()}`, smsTemplateId, 'submit', { reason: 'for DLT' }, null);
    const r = await svc.act(tenantA, checkerActor, `k-${randomUUID()}`, smsTemplateId, 'approve', { reason: 'wording agreed' }, null);
    expect(r.to).toBe('submitted_to_provider');
    expect((await admin.query(`SELECT t.is_active, t.serving_version_id, v.lifecycle, v.provider_template_ref FROM notification_templates t JOIN notification_template_versions v ON v.template_id=t.id WHERE t.id=$1`, [smsTemplateId])).rows[0])
      .toEqual({ is_active: false, serving_version_id: null, lifecycle: 'submitted_to_provider', provider_template_ref: null });
    expect(await templates.resolve(tenantA, EVENT, 'sms', 'gu')).toBeNull();
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notification_template_versions SET lifecycle='approved' WHERE id=$1`, [smsVersionId])))).toBe('23514');
    expect(await pgCode(asApp(tenantA, (q) => q(`UPDATE notification_template_versions SET provider_template_ref='1107' WHERE id=$1`, [smsVersionId])))).toBe('42501');
    const dk = `e-${randomUUID()}`;
    await uow.run(tenantA, (tx) => notifications.fanout(tx, { tenantId: tenantA, eventCode: EVENT, recipients: [memberA], payload: { orderNo: 'A-2' }, dedupeKey: dk }));
    const sms = (await admin.query(`SELECT status, template_version_id FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND channel='sms' ORDER BY created_at DESC LIMIT 1`, [tenantA, memberA])).rows[0];
    expect(sms).toEqual({ status: 'failed', template_version_id: null });
    // W181 prints it as the provider's, by name.
    const view = await svc.view(tenantA, checkerActor, smsTemplateId);
    expect(view.provider).toBe('dlt');
    expect(view.versions[0]).toMatchObject({ lifecycle: 'submitted_to_provider', authorName: 'Kavita Author', approverName: 'Rajesh Checker' });
    expect(view.slot.source).toBe('none');
  });

  it('a channel outside the event\'s default_channels is refused by the writer and by the database (F-11)', async () => {
    await expect(svc.saveDraft(tenantA, authorActor, `k-${randomUUID()}`, form({ channel: 'email' }), null))
      .rejects.toMatchObject({ code: 'TEMPLATE_FORM_REFUSED', details: { refusals: [{ field: 'channel', code: 'CHANNEL_NOT_DEFAULT' }] } });
    expect(await pgCode(asApp(tenantA, (q) => q(`INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, body, is_active) VALUES ($1,'email','gu',$2,'',false)`, [EVENT, tenantA])))).toBe('23514');
    expect(await pgCode(asApp(tenantA, (q) => q(`INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, body, is_active) VALUES ($1,'inapp','gu',$2,'',true)`, [EVENT, tenantA])))).toBe('23514');
  });

  it('kv_app cannot touch a platform row, a platform version or the catalogue (F-3, re-run)', async () => {
    const probe = async (sql: string, p: unknown[] = []) => pgCode(asApp(tenantA, (q) => q(sql, p)));
    expect(await probe(`INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, body, is_active) VALUES ('review.prompt','push','gu',NULL,'probe',false)`)).toBe('42501');
    expect(await asApp(tenantA, async (q) => (await q(`UPDATE notification_templates SET is_active = is_active WHERE tenant_id IS NULL AND event_code='auth.otp'`)).rowCount)).toBe(0);
    expect(await probe(`UPDATE notification_templates SET body='probe' WHERE tenant_id IS NULL AND event_code='auth.otp'`)).toBe('42501');
    expect(await probe(`DELETE FROM notification_templates WHERE tenant_id IS NULL`)).toBe('42501');
    expect(await probe(`UPDATE notification_events SET user_can_opt_out=true, priority='important' WHERE code='auth.otp'`)).toBe('42501');
    expect(await probe(`INSERT INTO notification_event_variables (event_code,name,source_ref,sample_value) VALUES ('auth.otp','probe','x','y')`)).toBe('42501');
    expect(await probe(`UPDATE messaging_sender_ids SET note='probe'`)).toBe('42501');
    expect(await probe(`INSERT INTO notification_template_versions (template_id, version_no, body, body_sha256, reason, authored_by_user_id, event_code, channel, language_code)
      SELECT id, 99, 'probe', 'x', 'probe', $1, event_code, channel, language_code FROM notification_templates WHERE tenant_id IS NULL AND event_code='auth.otp' LIMIT 1`, [author])).toBe('42501');
    expect(await asApp(tenantA, async (q) => (await q(`UPDATE notification_template_versions SET lifecycle='rejected', rejection_reason='x' WHERE tenant_id IS NULL`)).rowCount)).toBe(0);
    // Reading is untouched: every tenant reads the platform defaults underneath its overrides.
    expect(await asApp(tenantA, async (q) => (await q(`SELECT count(*)::int n FROM notification_templates WHERE tenant_id IS NULL`)).rows[0].n)).toBeGreaterThan(0);
  });

  it('tenant B sees nothing of A\'s override, as rows or as a screen', async () => {
    expect(await asApp(tenantB, async (q) => (await q(`SELECT count(*)::int n FROM notification_templates WHERE tenant_id=$1`, [tenantA])).rows[0].n)).toBe(0);
    expect(await asApp(tenantB, async (q) => (await q(`SELECT count(*)::int n FROM notification_template_versions WHERE tenant_id=$1`, [tenantA])).rows[0].n)).toBe(0);
    await expect(svc.view(tenantB, checkerActor, pushTemplateId)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
    await expect(svc.act(tenantB, checkerActor, `k-${randomUUID()}`, pushTemplateId, 'retire', { reason: 'not ours to retire' }, null)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });

  it('W180: the slot says who serves; the counts are live queries (F-12), never literals', async () => {
    const a = await svc.index(tenantA, checkerActor, { eventCode: EVENT, limit: 50 });
    const pushGu = a.items.find((r) => r.channel === 'push' && r.languageCode === 'gu')!;
    expect(pushGu).toMatchObject({ source: 'override', override: { servingVersionNo: 1, serves: true } });
    expect(a.items.find((r) => r.channel === 'sms' && r.languageCode === 'gu')).toMatchObject({ source: 'none', override: { latestLifecycle: 'submitted_to_provider' } });
    expect(a.items.find((r) => r.channel === 'push' && r.languageCode === 'en')).toMatchObject({ source: 'platform' });
    const b = await svc.index(tenantB, checkerActor, { eventCode: EVENT, limit: 50 });
    expect(b.items.some((r) => r.override.templateId !== null)).toBe(false);
    const live = (await admin.query(`SELECT count(*)::int n FROM notification_events e WHERE e.deleted_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM notification_templates t JOIN notification_template_versions v ON v.id=t.serving_version_id AND v.lifecycle='approved'
         WHERE t.event_code=e.code AND t.tenant_id IS NULL AND t.is_active AND t.deleted_at IS NULL)`)).rows[0].n;
    expect(b.summary.eventsWithoutTemplate).toHaveLength(live);
    expect(b.summary.whatsappServing).toBe(0);
    expect(a.summary.overridesServing).toBe(1);
    expect(a.summary.versionsAtProvider).toBe(1);
    expect(a.summary.lockedEvents).toBe((await admin.query(`SELECT count(*)::int n FROM notification_events WHERE deleted_at IS NULL AND (user_can_opt_out=false OR priority='critical')`)).rows[0].n);
    // Keyset: the second page starts strictly after the first page's last slot.
    const p1 = await svc.index(tenantA, checkerActor, { limit: 5 });
    const p2 = await svc.index(tenantA, checkerActor, { limit: 5, cursor: (() => { const l = p1.items[4]; return { e: l.eventCode, c: l.channel, l: l.languageCode }; })() });
    expect(`${p2.items[0].eventCode}|${p2.items[0].channel}|${p2.items[0].languageCode}` > `${p1.items[4].eventCode}|${p1.items[4].channel}|${p1.items[4].languageCode}`).toBe(true);
  });

  it('retire falls back to the platform default, never to silence — and every act is on the audit trail', async () => {
    await svc.act(tenantA, checkerActor, `k-${randomUUID()}`, pushTemplateId, 'retire', { reason: 'back to the platform words' }, null);
    expect(await templates.resolve(tenantA, EVENT, 'push', 'gu')).toBeNull();          // no platform push:gu …
    const en = await templates.resolve(tenantA, EVENT, 'push', 'en');
    expect(en?.isTenantOverride).toBe(false);                                          // … so the chain's en rung answers
    expect((await admin.query(`SELECT lifecycle FROM notification_template_versions WHERE id=$1`, [pushVersionId])).rows[0].lifecycle).toBe('superseded');
    const audit = (await admin.query(`SELECT action, actor_user_id, reason FROM audit_log WHERE entity_type='notification_template' AND entity_id=$1 ORDER BY created_at, action`, [pushTemplateId])).rows;
    expect(audit.map((x: any) => x.action)).toEqual(['communication.template.draft', 'communication.template.submit', 'communication.template.approve', 'communication.template.retire']);
    expect(audit[2]).toEqual({ action: 'communication.template.approve', actor_user_id: checker, reason: 'reads well for our members' });
  });
});
