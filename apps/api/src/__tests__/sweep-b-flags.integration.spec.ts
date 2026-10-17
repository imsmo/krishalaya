// apps/api/src/__tests__/sweep-b-flags.integration.spec.ts · PC-56 STORE-SWEEP-b · B11 (founder D1) + D6 — THE DELIVERY SECTION'S SWITCH AND THE
// SENSITIVE FACTS' RISK CLASS, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as
// kv_app, the seeded rows of 0009 / 0223 / 0224 + seed core/0008. Own fixtures (two live organisations); nothing moves money, nothing is written by
// the API.
//
//   (1) the `logistics` row as seeded: OFF (Law 10); the allow-list answers 17 booleans for an organisation, `logistics` false;
//   (2) it is TENANT-scoped: absent with no tenant (the platform host never asks it — the order page is always an organisation's);
//   (3) per ORGANISATION: a tenant allow-list names A → A reads ON, B still OFF; the kill-switch (is_enabled = false) beats the allow-list;
//   (4) FAIL-CLOSED: the flag store failing for `logistics` reads OFF (the storefront then says it could not read — it never guesses ON), while the
//       fail-open kill-switches (`storefront_cart`, `storefront_browse`) still read ON — read the way store1b/1c's unit specs prove fail-open;
//   (5) no rule, percentage or tenant list leaks in any answer;
//   (6) founder D6 (0224): the five mailboxes and the grievance officer's name and address are `security` (two administrators) with a lock note;
//       the entity, the office and the two figures stay `ordinary`.
// No hour-of-day literal, no notification template (the night-time holds stay out of this spec).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { FlagsService } from '../core/feature-flags/flags.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const KEY = 'logistics';
const SECURITY = ['platform.grievance.email', 'platform.contact.security_email', 'platform.contact.partners_email', 'platform.contact.press_email',
  'platform.contact.general_email', 'platform.grievance.officer_name', 'platform.grievance.address'];
const ORDINARY = ['platform.legal.entity_name', 'platform.legal.registered_office', 'platform.grievance.ack_hours', 'platform.grievance.resolve_days'];

run('PC-56 STORE-SWEEP-b · logistics on the storefront allow-list + the facts\' risk class (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  const slug: Record<string, string> = {};
  const flags = (s?: string) => (s ? request(http).get('/v1/storefront/flags').set('x-tenant-slug', s) : request(http).get('/v1/storefront/flags'));
  const forget = async (key: string) => { for (const k of [`flag:${key}`, 'flags:all', `flagstale:${key}`]) await cache.del(k); };
  const setFlag = async (key: string, on: boolean, pct: number, rules: Record<string, unknown>) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [key, on, pct, JSON.stringify(rules)]);
    await forget(key);
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const [id, name] of [[A, 'Anand FPO swb'], [B, 'Bhavnagar FPO swb']] as const) {
      await makeTenant(admin, id, `${name} ${id.slice(0, 4)}`);
      await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [id]);
      slug[id] = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [id])).rows[0].slug;
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
  }, 240_000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await setFlag(KEY, false, 100, {}).catch(() => undefined);   // the seeded state back (a later spec in the same process reads the row)
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) the row as seeded (seed 0009): OFF, 100, {}; an organisation is answered 17 booleans with `logistics` false', async () => {
    const rows = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [KEY])).rows;
    expect(rows).toEqual([{ key: KEY, is_enabled: false, rollout_pct: 100, rules: {} }]);
    const r = await flags(slug[A]);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toHaveLength(17);
    expect(r.body.data[KEY]).toBe(false);
    for (const v of Object.values(r.body.data)) expect(typeof v).toBe('boolean');
  });

  it('(2) tenant-scoped: absent with no tenant, present with one', async () => {
    const p = await flags();
    expect(p.status).toBe(200);
    expect(p.body.data).not.toHaveProperty(KEY);
    expect(Object.keys(p.body.data).sort()).toEqual(['org_self_signup', 'storefront_browse', 'storefront_cart', 'storefront_pwa']);
    expect((await flags(slug[B])).body.data).toHaveProperty(KEY, false);
  });

  it('(3) per ORGANISATION: an allow-list turns A ON and leaves B OFF; the kill-switch beats it; never present with no tenant', async () => {
    await setFlag(KEY, true, 0, { tenant_ids: [A] });
    try {
      expect((await flags(slug[A])).body.data[KEY]).toBe(true);
      expect((await flags(slug[B])).body.data[KEY]).toBe(false);
      expect((await flags()).body.data).not.toHaveProperty(KEY);
      await setFlag(KEY, false, 0, { tenant_ids: [A] });                 // the kill-switch beats the allow-list
      expect((await flags(slug[A])).body.data[KEY]).toBe(false);
    } finally {
      await setFlag(KEY, false, 100, {});
    }
  });

  it('(4) FAIL-CLOSED: the flag store failing for `logistics` reads OFF for an organisation that has it ON; the kill-switches still fail OPEN', async () => {
    await setFlag(KEY, true, 0, { tenant_ids: [A] });
    const svc = app.get(FlagsService);
    const real = svc.isEnabled.bind(svc);
    const spy = jest.spyOn(svc, 'isEnabled').mockImplementation(async (k: string, c?: { tenantId?: string }) => {
      if (k === KEY || k === 'storefront_cart' || k === 'storefront_browse') throw new Error('flag store down');
      return real(k, c);
    });
    try {
      const r = await flags(slug[A]);
      expect(r.status).toBe(200);
      expect(r.body.data[KEY]).toBe(false);                               // never guessed ON
      expect(r.body.data.storefront_cart).toBe(true);                     // the buying kill-switch fails OPEN (2b)
      expect(r.body.data.storefront_browse).toBe(true);                   // the catalogue kill-switch fails OPEN (2a)
      expect(Object.keys(r.body.data)).toHaveLength(17);
    } finally {
      spy.mockRestore();
      await setFlag(KEY, false, 100, {});
    }
    expect((await flags(slug[A])).body.data[KEY]).toBe(false);            // the seeded state back
  });

  it('(5) no rule, percentage or tenant list leaks', async () => {
    await setFlag(KEY, true, 0, { tenant_ids: [A] });
    try {
      for (const r of [await flags(), await flags(slug[A]), await flags(slug[B])]) {
        expect(JSON.stringify(r.body)).not.toMatch(/rollout|tenant_ids|rules|pct/);
        expect(JSON.stringify(r.body)).not.toContain(A);
      }
    } finally {
      await setFlag(KEY, false, 100, {});
    }
  });

  it('(6) founder D6 (0224): seven facts are `security` with a lock note; the entity, the office and the two figures stay `ordinary`', async () => {
    const rows = (await admin.query(
      `SELECT key, risk_class, lock_note FROM setting_definitions WHERE key = ANY($1::varchar[]) ORDER BY key`, [[...SECURITY, ...ORDINARY]])).rows;
    expect(rows).toHaveLength(11);
    for (const r of rows) {
      if (SECURITY.includes(r.key)) {
        expect([r.key, r.risk_class]).toEqual([r.key, 'security']);
        expect([r.key, /Two administrators/.test(String(r.lock_note))]).toEqual([r.key, true]);
      } else {
        expect([r.key, r.risk_class]).toEqual([r.key, 'ordinary']);
      }
    }
  });
});
