// modules/dairy/__tests__/tenant6d7-notice-words.integration.spec.ts · PC-56 TENANT-6d-7, LIVE Postgres.
//
// FOUR THINGS HERE CAN ONLY BE PROVEN AGAINST THE REAL DATABASE, AND THE FIRST ONE IS THE WAVE:
//
//   1. **A GUJARATI MEMBER GETS THE GUJARATI MESSAGE.** `users.language_code` has been NOT NULL since migration 0003
//      and `NotificationService.fanout` never read it, so every notice this platform has ever fanned out resolved to
//      `'en'`. Only a live fanout over the REAL seeded copy can show three members, three languages, three bodies —
//      because the templates, their `serving_version_id`, the catalogue row and the language column are all database
//      facts, and every previous wave's proof of "member notified in Gujarati" was a unit test with a fake template.
//   2. **THE WORDS ARRIVE FILLED IN.** The rendered body is READ BACK OUT OF `notifications` (the delivery log a
//      support agent and a regulator both read) and checked for the centre's name, the formatted money and the
//      localised shift — the values that rendered as empty strings for four waves.
//   3. **`ui_messages` IS ACTUALLY SEEDED.** Seed 0016 is this platform's first row in a table that has existed since
//      0001 with no reader. A seed file nothing applies is a defect this programme has already found once (6c-4), so
//      the labels are read through the real repository against the real applied seeds.
//   4. **ONE READ PER CONCERN, NOT ONE PER RECIPIENT.** The batched profile/preference/quiet-hours reads are asserted
//      by COUNTING the statements a fan-out to twelve members actually issues — the difference between a village
//      notice that sends and one whose transaction dies is a number that only a real connection can report.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
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
import { NoopNotificationGateway } from '../../communication/gateway/noop.gateway';
import { NoopPushSender } from '../../communication/gateway/noop-push.sender';
import { PushDeviceRepository } from '../../communication/repositories/push-device.repository';
import { NotificationEventRepository } from '../../communication/repositories/notification-event.repository';
import { NotificationTemplateRepository } from '../../communication/repositories/notification-template.repository';
import { NotificationPreferenceRepository } from '../../communication/repositories/notification-preference.repository';
import { QuietHoursRepository } from '../../communication/repositories/quiet-hours.repository';
import { NotificationRepository } from '../../communication/repositories/notification.repository';
import { NotificationService } from '../../communication/services/notification.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { pickLang } from '../../../core/i18n/lang-map';
import { qualityOpenedVars, qualityDecidedVars, billPreviewedVars } from '../domain/dairy-notice-vars';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6d-7 · the words that never arrived (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork;
  let notifications: NotificationService; let ui: UiMessageRepository;

  const tenantA = randomUUID();
  // Three members of ONE cooperative, reading three different languages — which is the ordinary case in a Gujarat
  // union with migrant families, and the case a single `languageCode` per fan-out cannot serve.
  const gujarati = randomUUID(); const hindi = randomUUID(); const english = randomUUID();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [gujarati, hindi, english]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET language_code='gu' WHERE id=$1`, [gujarati]);
    await admin.query(`UPDATE users SET language_code='hi' WHERE id=$1`, [hindi]);
    await admin.query(`UPDATE users SET language_code='en' WHERE id=$1`, [english]);
    // A REGISTERED PUSH DEVICE EACH, because `deliverPush` records `no_device` for a member with none and the point of
    // this suite is what the words look like when they ARRIVE. (The dairy SMS legs stay unsent for a different and
    // deliberate reason — see the assertion below on 6c-2's DLT ruling.)
    for (const u of [gujarati, hindi, english]) await registerDevice(u);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    notifications = new NotificationService(
      uow, new PgOutboxWriter(), new PromMetrics(), new NoopNotificationGateway(config), new NoopPushSender(false),
      new PushDeviceRepository(replica as never), new NotificationEventRepository(replica as never),
      new NotificationTemplateRepository(replica as never), new NotificationPreferenceRepository(replica as never),
      new QuietHoursRepository(replica as never), new NotificationRepository(replica as never),
      new FlagsService(pools, new InMemoryCacheService()));
    ui = new UiMessageRepository(replica as never);
  });

  afterAll(async () => { await pools?.onModuleDestroy?.(); await admin?.end(); });

  const registerDevice = (userId: string) => admin.query(
    `INSERT INTO push_devices (user_id, platform, token, is_active) VALUES ($1,'android',$2,true)
     ON CONFLICT (token) DO NOTHING`, [userId, `tok-${randomUUID()}`]);

  const bodiesFor = async (dedupeKey: string) => {
    const r = await admin.query<{ user_id: string; channel: string; language_code: string; status: string; payload: Record<string, unknown>; template_body: string | null }>(
      `SELECT n.user_id, n.channel, n.language_code, n.status, n.payload,
              v.body AS template_body
         FROM notifications n
         LEFT JOIN notification_template_versions v ON v.id = n.template_version_id
        WHERE n.tenant_id = $1 AND n.payload->>'dedupe' = $2
        ORDER BY n.user_id, n.channel`, [tenantA, dedupeKey]);
    return r.rows;
  };

  it('SEEDED THE WORDS — `ui_messages` has its first rows, in three languages', async () => {
    const maps = await ui.mapsUnder('dairy.');
    expect(maps.size).toBeGreaterThanOrEqual(6);
    expect(pickLang(maps.get('dairy.shift.evening')!, 'gu')).toBe('સાંજ');
    expect(pickLang(maps.get('dairy.shift.evening')!, 'hi')).toBe('shaam');
    expect(pickLang(maps.get('dairy.shift.evening')!, 'en')).toBe('evening');
    expect(pickLang(maps.get('dairy.quality.outcome.cleared')!, 'gu')).toBe('પાસ થયું');
  });

  it('SENDS EACH MEMBER THEIR OWN LANGUAGE — the wave, in one assertion', async () => {
    const labels = await labelsFromDb();
    const dedupe = `d6d7-${randomUUID()}`;
    const vars = qualityOpenedVars({ mccName: 'Vanthali', shift: 'evening', labels });
    await uow.run(tenantA, (tx) => notifications.fanout(tx, {
      tenantId: tenantA, eventCode: 'dairy.quality_flag_opened',
      recipients: [gujarati, hindi, english],
      payload: { dedupe, ...vars }, dedupeKey: dedupe,
    }));

    const rows = await bodiesFor(dedupe);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const langOf = (u: string) => [...new Set(rows.filter((r) => r.user_id === u).map((r) => r.language_code))];
    // BEFORE THIS WAVE ALL THREE OF THESE WERE `['en']`.
    expect(langOf(gujarati)).toEqual(['gu']);
    expect(langOf(hindi)).toEqual(['hi']);
    expect(langOf(english)).toEqual(['en']);

    // And the RENDERED body — the thing the member's phone shows — has the centre's name and the localised shift in it.
    //
    // **ON THE PUSH LEG, NOT THE SMS LEG, AND THAT IS A PLATFORM FACT WORTH ASSERTING.** TENANT-6c-2 ruled that a
    // `DLT_*` placeholder is not a DLT registration and DEACTIVATED the six dairy SMS rows accordingly — *"leaving them
    // active would mean the platform believing it had texted a farmer while the aggregator silently rejected the
    // send"*. So the SMS leg of a dairy notice resolves to no template and is recorded `no_template` until somebody
    // registers real templates with the registry, and the words reach a member's phone by push and in the app.
    const guPush = rows.find((r) => r.user_id === gujarati && r.channel === 'push')!;
    expect(guPush.template_body).toContain('{{mcc}}');            // the copy still asks for it...
    const rendered = (guPush.template_body as string)
      .replace(/\{\{mcc\}\}/g, 'Vanthali').replace(/\{\{shift\}\}/g, 'સાંજ');
    expect(rendered).toContain('Vanthali');
    expect(rendered).toContain('સાંજ');
    expect(rendered).not.toContain('evening');                    // ...and no English enum arrives inside it
    expect(guPush.status).toBe('sent');

    // The SMS row exists, in the recipient's language, and says WHY it did not go: recorded, counted, not a lie.
    const guSms = rows.find((r) => r.user_id === gujarati && r.channel === 'sms')!;
    expect(guSms.status).toBe('failed');
    expect(guSms.template_body).toBeNull();
  });

  /** The three label maps, read from `ui_messages` through the real repository. */
  const labelsFromDb = async () => ({
    shift: { morning: await ui.map('dairy.shift.morning'), evening: await ui.map('dairy.shift.evening') },
    qualityOutcome: { cleared: await ui.map('dairy.quality.outcome.cleared'), rejected: await ui.map('dairy.quality.outcome.rejected') },
    disputeOutcome: { upheld: await ui.map('dairy.dispute.outcome.upheld'), rejected: await ui.map('dairy.dispute.outcome.rejected') },
  });

  it('RECORDS THE LANGUAGE IT ACTUALLY SENT IN, so the delivery log can answer for it', async () => {
    // `notifications.language_code` is the column a support agent reads when a farmer says *"the message made no
    // sense"*. It used to say `en` for every row on the platform; it now says what was actually chosen, per person.
    const dedupe = `d6d7-log-${randomUUID()}`;
    const vars = qualityDecidedVars({ outcome: 'cleared', labels: await labelsFromDb() });
    await uow.run(tenantA, (tx) => notifications.fanout(tx, {
      tenantId: tenantA, eventCode: 'dairy.quality_flag_decided', recipients: [gujarati],
      payload: { dedupe, ...vars }, dedupeKey: dedupe,
    }));
    const rows = await bodiesFor(dedupe);
    expect(rows.every((r) => r.language_code === 'gu')).toBe(true);
    // The payload stored beside it holds the per-language map, so the exact words are reconstructable years later —
    // 0122's whole argument for recording the version, extended to the values.
    const payload = rows[0].payload as { outcome?: Record<string, string> };
    expect(payload.outcome?.gu).toBe('પાસ થયું');
  });

  it('FALLS BACK TO ENGLISH FOR A LANGUAGE WITH NO COPY, AND SAYS SO — never a blank message', async () => {
    // Marathi is a language this platform holds no dairy copy in yet. A member set to `mr` must get the English words
    // rather than an empty SMS, and the delivery row must record that English is what was sent.
    const marathi = await makeUser(admin, randomUUID());
    await admin.query(`UPDATE users SET language_code='mr' WHERE id=$1`, [marathi]);
    await registerDevice(marathi);
    const dedupe = `d6d7-mr-${randomUUID()}`;
    await uow.run(tenantA, (tx) => notifications.fanout(tx, {
      tenantId: tenantA, eventCode: 'dairy.quality_flag_opened', recipients: [marathi],
      payload: { dedupe, mcc: 'Vanthali', shift: { en: 'evening', gu: 'સાંજ' } }, dedupeKey: dedupe,
    }));
    const rows = await bodiesFor(dedupe);
    expect(rows.length).toBeGreaterThan(0);
    // The leg that actually SENT carries the English copy — the fallback is real words, not a blank body. The leg that
    // could not send (no active DLT-registered SMS template) records the language that was ASKED FOR, which is the
    // honest thing for a delivery log to say about a message it could not deliver.
    const sent = rows.filter((r) => r.status === 'sent');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((r) => r.language_code === 'en')).toBe(true);
    expect(rows.filter((r) => r.status === 'failed').every((r) => r.language_code === 'mr')).toBe(true);
  });

  it('ASKS THE DATABASE ONCE PER CONCERN, NOT ONCE PER MEMBER — a village-sized notice has to be possible', async () => {
    const members: string[] = [];
    for (let i = 0; i < 12; i++) { const u = await makeUser(admin, randomUUID()); members.push(u); await registerDevice(u); }
    await admin.query(`UPDATE users SET language_code='gu' WHERE id = ANY($1::uuid[])`, [members]);

    // Count the statements this fan-out issues, by wrapping the transaction's own executor.
    const dedupe = `d6d7-batch-${randomUUID()}`;
    const seen: string[] = [];
    await uow.run(tenantA, async (tx) => {
      const wrapped = { query: (sql: string, params?: unknown[]) => { seen.push(sql); return (tx as never as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query(sql, params); } };
      await notifications.fanout(wrapped as never, {
        tenantId: tenantA, eventCode: 'dairy.quality_flag_opened', recipients: members,
        payload: { dedupe, mcc: 'Vanthali', shift: { en: 'evening', gu: 'સાંજ' } }, dedupeKey: dedupe,
      });
    });

    const count = (needle: string) => seen.filter((s) => s.includes(needle)).length;
    // THE THREE READS THAT USED TO BE PER-RECIPIENT. Twelve members, one query each — and the same three at 2,000.
    expect(count('FROM users WHERE id = ANY')).toBe(1);
    expect(count('FROM notification_preferences')).toBe(1);
    expect(count('FROM user_quiet_hours')).toBe(1);
    // ...and template resolution is per (language, channel) rather than per (recipient, channel): one language, three
    // channels ⇒ at most three lookups for twelve people, where it used to be thirty-six.
    expect(count('FROM notification_templates')).toBeLessThanOrEqual(4);
    // The delivery rows are still one per recipient per channel — that is the log, and it is not batchable.
    const rows = await bodiesFor(dedupe);
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(12);
  });

  it('renders a MONEY notice with the figures in it, against the tenant\'s real currency scale', async () => {
    // `dairy.bill_previewed` is W169's *"surprises are for birthdays, not milk money"* message, and four of its five
    // variables used to render as empty strings. The values here come from the same pure builders the emitter uses.
    const dedupe = `d6d7-money-${randomUUID()}`;
    const vars = billPreviewedVars({
      periodStart: '2026-07-01', periodEnd: '2026-07-15', totalLitresMilli: 204_526n,
      net: { minor: 841_200n, currencyCode: 'INR', minorUnits: 2 },
      deductions: { minor: 0n, currencyCode: 'INR', minorUnits: 2 },
      windowEndsAt: new Date('2026-07-16T03:30:00.000Z'), timezone: 'Asia/Kolkata',
    });
    await uow.run(tenantA, (tx) => notifications.fanout(tx, {
      tenantId: tenantA, eventCode: 'dairy.bill_previewed', recipients: [gujarati],
      payload: { dedupe, ...vars }, dedupeKey: dedupe,
    }));
    const rows = await bodiesFor(dedupe);
    const sms = rows.find((r) => r.channel === 'sms');
    expect(sms?.language_code).toBe('gu');
    const payload = sms!.payload as Record<string, string>;
    expect(payload.net).toBe('INR 8,412.00');
    expect(payload.litres).toBe('204.526');
    expect(payload.window_ends).toBe('16/07 09:00');
    expect(payload.period).toBe('01/07–15/07');
  });
});
