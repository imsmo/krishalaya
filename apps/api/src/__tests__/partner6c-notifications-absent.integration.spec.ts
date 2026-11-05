// apps/api/src/__tests__/partner6c-notifications-absent.integration.spec.ts · PC-56 PARTNER-6c · WHAT THE PLATFORM TELLS A PARTNER PERSON — the
// LIVE proof (the real AppModule over HTTP, real Postgres + RLS) behind W270 `/account/notifications` and W271 `/account/notifications/preferences`,
// two honest pages that read nothing (founder 6c-1 / 6c-2, door Q5-A), and the language act (6c-3, door Q7-A), which is a browser cookie and
// touches no route at all. This wave adds NO route, NO definer, NO grant, NO event and NO migration; this spec is its only `apps/api` file (the
// 4c / 5b / 6a / 6b precedent). It proves that what the two pages say is true of the platform underneath:
//
//   (1) a partner person's token on the TENANT notification routes — the inbox (`GET /v1/notifications`, `/bell`, `/filters`,
//       `/delivery-health`, `GET` / `POST /read-all`) and the preferences (`GET` / `PUT /v1/notifications/preferences`, `/matrix`, `GET` / `PUT
//       /quiet-hours`) — is refused (401, the verifier) and NOTHING is written (no notification, preference or quiet-hours row for the person);
//   (2) absence → 404: no partner inbox, read-all, preference or language address exists in the partner realm (with `partner_console` ON, so a
//       404 is the route's absence, not the switch);
//   (3) THE TWO SMS ARE THE ONLY PARTNER MESSAGES: a partner sign-in OTP request (`POST /v1/partner/auth/otp`) and a team invitation
//       (`POST /v1/partner/team/invites`, then its outbox event handed to the registered `partner.member_invited` handler — the relay is off in
//       this harness) each reach the platform SmsSender EXACTLY ONCE, and write NO `notifications` row (searched by each person's `user_id`):
//       neither passes through the notification engine (survey C-12);
//   (4) THE 42501 PROBE under `SET LOCAL ROLE kv_partner`: notifications, notification_preferences, user_quiet_hours, notification_templates,
//       notification_events (all five exist — 0012), and the nine of 0232:189-190 → 42501 each, no write privilege on any; `pg_proc` holds no
//       partner_%notif% / partner_%prefer% / partner_%quiet% / partner_%language% function. M6 (a throwaway 0233 granting SELECT on
//       notifications to kv_partner) kills here.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService, SMS_SENDER, SmsSender } from '../core/auth/otp.service';
import { OUTBOX_HANDLER_REGISTRY, OutboxEvent } from '../core/outbox/event-envelope';
import type { OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import type { TxContext } from '../core/database/unit-of-work';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');

run('PC-56 PARTNER-6c · a partner person gets two SMS and nothing else; no inbox, no preference, no language route; kv_partner holds nothing on the engine (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const PA = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  const sent: Array<{ phone: string; kind: 'send' | 'otp' }> = [];

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  /** Every row of the notification engine that names this person — the inbox / delivery log, the preferences, the quiet window. */
  const engineRows = async (userId: string) => {
    const n = async (t: string) => (await admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = $1`, [userId])).rows[0].n as number;
    return { notifications: await n('notifications'), preferences: await n('notification_preferences'), quiet: await n('user_quiet_hours') };
  };
  const NONE = { notifications: 0, preferences: 0, quiet: 0 };
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp', 'PartnerTeamController.invite', 'PartnerConsoleController.invite'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const sentTo = (phone: string) => sent.filter((s) => s.phone === phone);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Notice Insurer', 'insurer')`, [PA, `p6c_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Notice partner admin'], ['invitee', 'Notice invitee']] as const) await user(k, n);
    await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people.aAdmin.id, PA]);

    await setFlag('partner_console', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of flagKeys('partner_console')) await cache.del(k);
    // the platform's ONE SmsSender, recorded (the harness's sender is the dev no-op; nothing leaves the machine)
    const sms = app.get<SmsSender>(SMS_SENDER, { strict: false });
    sms.send = async (phone: string) => { sent.push({ phone, kind: 'send' }); };
    sms.sendOtp = async (phone: string) => { sent.push({ phone, kind: 'otp' }); };
    await resetRates();
    const { code } = await otp.issue(people.aAdmin.phone);
    const v = await request(http).post('/v1/partner/auth/verify').send({ phone: people.aAdmin.phone, code });
    expect(v.status).toBe(201);
    tok.aAdmin = v.body.data.accessToken;
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`,
        [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
      if (cache) for (const x of flagKeys(k)) await cache.del(x).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) a partner token on the TENANT inbox and preference routes is refused (401, the verifier) and nothing is written', async () => {
    const before = await engineRows(people.aAdmin.id);
    expect(before).toEqual(NONE);
    const h = bearer(tok.aAdmin);
    for (const p of ['/v1/notifications', '/v1/notifications/bell', '/v1/notifications/filters', '/v1/notifications/delivery-health', '/v1/notifications/read-all',
      '/v1/notifications/preferences', '/v1/notifications/matrix', '/v1/notifications/quiet-hours']) {
      const r = await request(http).get(p).set(h);
      expect([p, r.status]).toEqual([p, 401]);
    }
    const posts: Array<['post' | 'put', string, object]> = [
      ['post', '/v1/notifications/read-all', {}],
      ['put', '/v1/notifications/preferences', { preferences: [{ eventCode: 'auth.otp', channel: 'sms', isEnabled: false }] }],
      ['put', '/v1/notifications/quiet-hours', { starts: '22:00', ends: '07:00', timezone: 'Asia/Kolkata' }],
    ];
    for (const [m, p, body] of posts) {
      const r = await request(http)[m](p).set({ ...h, 'idempotency-key': randomUUID() }).send(body);
      expect([m, p, r.status]).toEqual([m, p, 401]);
    }
    expect(await engineRows(people.aAdmin.id)).toEqual(NONE);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) absence → 404: no partner inbox, read-all, preference or language address exists (partner_console ON)', async () => {
    const h = bearer(tok.aAdmin);
    // the switch is ON: a real partner read answers 200 in this same run, so every 404 below is the route's absence
    expect((await request(http).get('/v1/partner/me').set(h)).status).toBe(200);
    for (const p of ['/v1/partner/notifications', '/v1/partner/notifications/preferences', '/v1/partner/notifications/bell', '/v1/partner/me/language']) {
      const r = await request(http).get(p).set(h);
      expect([p, r.status]).toEqual([p, 404]);
    }
    for (const [m, p] of [['post', '/v1/partner/notifications/read-all'], ['put', '/v1/partner/notifications/preferences'], ['put', '/v1/partner/me/language'],
      ['post', '/v1/partner/me/language']] as const) {
      const r = await request(http)[m](p).set({ ...h, 'idempotency-key': randomUUID() }).send({ language: 'gu' });
      expect([m, p, r.status]).toEqual([m, p, 404]);
    }
    expect(await engineRows(people.aAdmin.id)).toEqual(NONE);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) the two SMS are the ONLY partner messages: the sign-in code and the team invitation each reach the SmsSender exactly once; no notifications row', async () => {
    sent.length = 0;
    await resetRates();
    // (a) the sign-in code — through the partner realm's own OTP route
    const o = await request(http).post('/v1/partner/auth/otp').send({ phone: people.aAdmin.phone });
    expect([200, 201]).toContain(o.status);
    expect(sentTo(people.aAdmin.phone).map((s) => s.kind)).toEqual(['otp']);
    // (b) the team invitation — the route writes the invite and ONE outbox event; the registered handler (the relay's, run here directly —
    // the relay is off in this harness) sends the SMS
    const inv = await request(http).post('/v1/partner/team/invites').set({ ...bearer(tok.aAdmin), 'idempotency-key': randomUUID() })
      .send({ phone: people.invitee.phone, roleCode: 'partner_viewer' });
    expect(inv.status).toBe(201);
    const rows = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id::text, event_type, payload FROM outbox_events
      WHERE event_type = 'partner.member_invited' AND aggregate_id = $1`, [inv.body.data.id])).rows;
    expect(rows.length).toBe(1);
    const ev: OutboxEvent = { id: rows[0].id, tenantId: rows[0].tenant_id, aggregateType: rows[0].aggregate_type, aggregateId: rows[0].aggregate_id,
      eventType: rows[0].event_type, payload: rows[0].payload };
    const registry = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY, { strict: false });
    const handlers = registry.handlersFor('partner.member_invited');
    expect(handlers.length).toBe(1);
    await handlers[0].handle(ev, {} as TxContext);
    expect(sentTo(people.invitee.phone).map((s) => s.kind)).toEqual(['send']);
    expect((await admin.query(`SELECT sent_at IS NOT NULL AS sent, token_sealed IS NULL AS cleared FROM partner_invites WHERE id = $1`, [inv.body.data.id])).rows[0]).toEqual({ sent: true, cleared: true });
    // idempotent: the same event again sends nothing more
    await handlers[0].handle(ev, {} as TxContext);
    expect(sentTo(people.invitee.phone).length).toBe(1);
    // exactly two messages left the platform, one to each person — and neither went through the notification engine
    expect(sent.length).toBe(2);
    expect(await engineRows(people.aAdmin.id)).toEqual(NONE);
    expect(await engineRows(people.invitee.id)).toEqual(NONE);
    // and the engine's catalogue has no partner event at all (survey §1 engine): no claim / survey / consent / premium / report event exists
    const partnerish = (await admin.query(`SELECT code FROM notification_events WHERE code LIKE 'partner.%' OR code IN
      ('claim.intimated', 'claim.decision.required', 'survey.report.submitted', 'consent.expiring', 'parametric.window.reminder', 'premium.received',
       'report.export.ready', 'product.announcements', 'security.otp') ORDER BY code`)).rows.map((r) => r.code as string);
    expect(partnerish).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) THE WALL IS THE GRANT: kv_partner → 42501 on the notification engine\'s tables (and the nine of 0232); no partner notification definer exists', async () => {
    const TABLES = ['notifications', 'notification_preferences', 'user_quiet_hours', 'notification_templates', 'notification_events',
      // the nine of 0232:189-190
      'bank_accounts', 'payouts', 'payout_batches', 'loan_disbursement_runs', 'loan_disbursement_run_items', 'kcc_drawl_ledger', 'loan_restructures', 'credit_scores', 'credit_score_consents'];
    for (const t of TABLES) {
      expect([t, (await admin.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`])).rows[0].ok]).toEqual([t, true]);
      const c = await admin.connect();
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
        await c.query(`SELECT set_config('app.partner_id', $1, true)`, [PA]);
        expect([t, await errCode(c.query(`SELECT 1 FROM ${t} LIMIT 1`))]).toEqual([t, '42501']);
      } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    }
    for (const t of TABLES) {
      const w = (await admin.query(`SELECT has_table_privilege('kv_partner', $1, 'SELECT') OR has_table_privilege('kv_partner', $1, 'INSERT') OR has_table_privilege('kv_partner', $1, 'UPDATE') OR has_table_privilege('kv_partner', $1, 'DELETE') AS any`, [`public.${t}`])).rows[0].any;
      expect([t, w]).toEqual([t, false]);
    }
    const names = async (pattern: string) => (await admin.query(`SELECT proname FROM pg_proc WHERE proname LIKE $1 ORDER BY proname`, [pattern])).rows.map((r) => r.proname as string);
    for (const p of ['partner\\_%notif%', 'partner\\_%prefer%', 'partner\\_%quiet%', 'partner\\_%language%']) expect([p, await names(p)]).toEqual([p, []]);
  }, 60_000);
});
