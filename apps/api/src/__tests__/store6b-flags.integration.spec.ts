// apps/api/src/__tests__/store6b-flags.integration.spec.ts · PC-56 STORE-6b · B (founder D3 / Q8, migration 0222) — THE INSTALL INVITATION'S
// SWITCH, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, the
// seeded row of 0222 / seed core/0009. Own fixtures (two live organisations); nothing moves money, nothing is written by the API.
//
//   (1) the row as seeded: `storefront_install_prompt` OFF (Law 10); the allow-list answers 16 booleans for an organisation, the new key OFF;
//   (2) it is TENANT-scoped: absent with no tenant (the platform host — the storefront reads it OFF there, the 6a Q1 limit named again);
//   (3) per ORGANISATION: a tenant allow-list names A → A reads ON, B still OFF; the kill-switch (is_enabled = false) beats the allow-list;
//   (4) no rule, percentage or tenant list leaks in any answer.
// (The drafts on the phone and the `/sync` page have no API at all — nothing to prove here; they are the storefront's specs.)
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const KEY = 'storefront_install_prompt';

run('PC-56 STORE-6b · storefront_install_prompt (integration, real AppModule over HTTP)', () => {
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
    for (const [id, name] of [[A, 'Anand FPO 6b'], [B, 'Bhavnagar FPO 6b']] as const) {
      await makeTenant(admin, id, `${name} ${id.slice(0, 4)}`);
      await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [id]);
      slug[id] = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [id])).rows[0].slug;
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
  }, 240_000);
  afterAll(async () => {
    await setFlag(KEY, false, 100, {}).catch(() => undefined);   // the seeded state back (a later spec in the same process reads the row)
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) the row as seeded (0222 + seed 0009): OFF, 100, {}; an organisation is answered 16 booleans with the new key OFF', async () => {
    const rows = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [KEY])).rows;
    expect(rows).toEqual([{ key: KEY, is_enabled: false, rollout_pct: 100, rules: {} }]);
    const r = await flags(slug[A]);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toHaveLength(16);
    expect(r.body.data[KEY]).toBe(false);
    for (const v of Object.values(r.body.data)) expect(typeof v).toBe('boolean');
  });

  it('(2) tenant-scoped: absent with no tenant (the platform host reads it OFF), present with one', async () => {
    const p = await flags();
    expect(p.status).toBe(200);
    expect(p.body.data).not.toHaveProperty(KEY);
    expect(Object.keys(p.body.data).sort()).toEqual(['org_self_signup', 'storefront_browse', 'storefront_cart', 'storefront_pwa']);
    expect((await flags(slug[B])).body.data).toHaveProperty(KEY, false);
  });

  it('(3) per ORGANISATION: an allow-list turns A ON and leaves B OFF; the kill-switch beats it; never ON with no tenant', async () => {
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

  it('(4) no rule, percentage or tenant list leaks', async () => {
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
});
