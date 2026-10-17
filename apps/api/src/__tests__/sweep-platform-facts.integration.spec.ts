// apps/api/src/__tests__/sweep-platform-facts.integration.spec.ts · PC-56 STORE-SWEEP-a · B3 (founder D3 / D7, migration 0223) — THE PLATFORM'S
// PUBLISHED FACTS, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres as kv_app,
// the eleven `setting_definitions` rows of 0223 / seed core/0008. Nothing moves money; the only write is the admin connection's own
// `platform_setting_values` row (the admin realm's table — set and removed here, exactly as settings-ops writes it).
//
//   (1) the seeded defaults ("" and JSON null) answer ALL null — not published yet, never an empty string (mutant M5 → red);
//   (2) a `platform_setting_values` row set → answered (a synthetic `@example.test` value — never a real mailbox or domain); removed → null again;
//   (3) anonymous, no tenant header needed — and a tenant header changes nothing (the facts are the platform's);
//   (4) the `stats` route is unchanged.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const KEYS = [
  'platform.legal.entity_name', 'platform.legal.registered_office',
  'platform.grievance.officer_name', 'platform.grievance.address', 'platform.grievance.email', 'platform.grievance.ack_hours', 'platform.grievance.resolve_days',
  'platform.contact.security_email', 'platform.contact.partners_email', 'platform.contact.press_email', 'platform.contact.general_email',
];
const ALL_NULL = {
  legal: { entityName: null, registeredOffice: null },
  grievance: { officerName: null, address: null, email: null, ackHours: null, resolveDays: null },
  contact: { securityEmail: null, partnersEmail: null, pressEmail: null, generalEmail: null },
};

run('PC-56 STORE-SWEEP-a · GET /v1/storefront/platform-facts (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); let slugA = '';
  const ADMIN_ID = randomUUID();
  const facts = (slug?: string) => (slug ? request(http).get('/v1/storefront/platform-facts').set('x-tenant-slug', slug) : request(http).get('/v1/storefront/platform-facts'));
  const setFact = (key: string, value: unknown) => admin.query(
    `INSERT INTO platform_setting_values (key, value, set_by_admin_id, reason, created_by) VALUES ($1, $2::jsonb, $3, $4, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, deleted_at = NULL, updated_at = now()`,
    [key, JSON.stringify(value), ADMIN_ID, 'STORE-SWEEP-a live spec: a synthetic published fact']);
  const clearFacts = () => admin.query(`DELETE FROM platform_setting_values WHERE key = ANY($1::varchar[])`, [KEYS]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Anand FPO swa ${A.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [A]);
    slugA = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [A])).rows[0].slug;
    await clearFacts();
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
  }, 240_000);
  afterAll(async () => {
    await clearFacts().catch(() => undefined);   // the seeded state back (a later spec in the same process reads the defaults)
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) the eleven rows as seeded (0223 + seed 0008): platform-scoped, "" / null defaults — answered ALL null, never ""', async () => {
    const rows = (await admin.query(
      `SELECT key, value_type, scope, risk_class, default_value FROM setting_definitions WHERE key = ANY($1::varchar[]) ORDER BY key`, [KEYS])).rows;
    expect(rows).toHaveLength(11);
    for (const r of rows) {
      // PC-56 STORE-SWEEP-b (0224, founder D6): the five mailboxes and the grievance officer's name and address are `security` (two
      // administrators); the entity, the office and the two figures stay `ordinary`
      expect([r.key, r.scope, r.risk_class]).toEqual([r.key, 'platform', /email$|officer_name$|grievance\.address$/.test(r.key) ? 'security' : 'ordinary']);
      expect([r.key, r.default_value]).toEqual([r.key, r.value_type === 'int' ? null : '']);
    }
    const r = await facts();
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(ALL_NULL);
    expect(JSON.stringify(r.body)).not.toContain('""');
  });

  it('(2) a value set in platform_setting_values is answered; a blank value and a removed row read null again', async () => {
    try {
      await setFact('platform.grievance.email', 'grievance@example.test');
      await setFact('platform.grievance.ack_hours', 48);
      await setFact('platform.contact.press_email', '   ');
      const r = await facts();
      expect(r.status).toBe(200);
      expect(r.body.data.grievance.email).toBe('grievance@example.test');
      expect(r.body.data.grievance.ackHours).toBe(48);
      expect(r.body.data.contact.pressEmail).toBeNull();          // blank = not published
      expect(r.body.data.grievance.resolveDays).toBeNull();
      await admin.query(`UPDATE platform_setting_values SET deleted_at = now() WHERE key = 'platform.grievance.email'`);
      expect((await facts()).body.data.grievance.email).toBeNull();
    } finally {
      await clearFacts();
    }
  });

  it('(3) anonymous, no tenant needed; a tenant header changes nothing (the facts are the platform\'s)', async () => {
    try {
      await setFact('platform.contact.general_email', 'hello@example.test');
      const anon = await facts();
      const withTenant = await facts(slugA);
      expect(anon.status).toBe(200);
      expect(withTenant.status).toBe(200);
      expect(withTenant.body.data).toEqual(anon.body.data);
      expect(anon.body.data.contact.generalEmail).toBe('hello@example.test');
      expect(Object.keys(anon.body.data).sort()).toEqual(['contact', 'grievance', 'legal']);
    } finally {
      await clearFacts();
    }
  });

  it('(4) the stats route is unchanged: the same four fields', async () => {
    const s = await request(http).get('/v1/storefront/stats');
    expect(s.status).toBe(200);
    expect(Object.keys(s.body.data).sort()).toEqual(['computedAt', 'districts', 'liveListings', 'verifiedOrganisations']);
  });
});
