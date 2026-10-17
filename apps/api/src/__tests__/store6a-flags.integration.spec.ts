// apps/api/src/__tests__/store6a-flags.integration.spec.ts · PC-56 STORE-6a · B (founder D4 + D2, migration 0221) — THE TWO NEW STOREFRONT SWITCHES,
// LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, the seeded
// rows of 0221 / seed core/0009. Own fixtures (two live organisations); nothing moves money, nothing is written by the API.
//
//   (1) the rows as seeded: `storefront_pwa` ON (the named Law 10 exception — the worker has been live since PC-24c), `storefront_offline_reads`
//       OFF; the allow-list answers 15 keys for an organisation, and both new keys are booleans;
//   (2) `storefront_pwa` is answered WITHOUT a tenant (platform-scoped — one worker per origin serves every path store) and is the same answer
//       with any tenant in context; switched OFF it reads OFF everywhere (the storefront's `/sw.js` then serves the self-unregistering worker);
//   (3) `storefront_offline_reads` is answered ONLY with an organisation in context (absent on the platform answer — the platform host's own
//       pages are never marked cacheable through it), OFF by default, and ON per organisation: a tenant allow-list names A → A reads ON,
//       B still OFF; the kill-switch (is_enabled = false) reads OFF for A again;
//   (4) no rule, percentage or tenant list leaks in any answer.
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

run('PC-56 STORE-6a · storefront_pwa + storefront_offline_reads (integration, real AppModule over HTTP)', () => {
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
    for (const [id, name] of [[A, 'Anand FPO 6a'], [B, 'Bhavnagar FPO 6a']] as const) {
      await makeTenant(admin, id, `${name} ${id.slice(0, 4)}`);
      await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [id]);
      slug[id] = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [id])).rows[0].slug;
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
  }, 240_000);
  afterAll(async () => {
    // put the seeded state back (this DB is rebuilt per run, but a later spec in the same process reads the same rows)
    await setFlag('storefront_pwa', true, 100, {}).catch(() => undefined);
    await setFlag('storefront_offline_reads', false, 100, {}).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) the rows as seeded (0221 + seed 0009): storefront_pwa ON, storefront_offline_reads OFF; an organisation is answered 17 booleans (STORE-6b: was 15 → 16; STORE-SWEEP-b: 17)', async () => {
    const rows = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key IN ('storefront_pwa', 'storefront_offline_reads') ORDER BY key`)).rows;
    expect(rows).toEqual([
      { key: 'storefront_offline_reads', is_enabled: false, rollout_pct: 100, rules: {} },
      { key: 'storefront_pwa', is_enabled: true, rollout_pct: 100, rules: {} },
    ]);
    const r = await flags(slug[A]);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toHaveLength(17);   // PC-56 STORE-6b (0222): + storefront_install_prompt (was 15) · PC-56 STORE-SWEEP-b (founder D1): + logistics
    expect(r.body.data).toMatchObject({ storefront_pwa: true, storefront_offline_reads: false });
    for (const v of Object.values(r.body.data)) expect(typeof v).toBe('boolean');
  });

  it('(2) storefront_pwa is a PLATFORM switch: answered with no tenant, the same with any tenant; OFF reads OFF everywhere', async () => {
    const p = await flags();
    expect(p.status).toBe(200);
    expect(p.body.data).toEqual({ org_self_signup: p.body.data.org_self_signup, storefront_browse: true, storefront_cart: true, storefront_pwa: true });
    expect((await flags(slug[B])).body.data.storefront_pwa).toBe(true);
    await setFlag('storefront_pwa', false, 100, {});
    try {
      expect((await flags()).body.data.storefront_pwa).toBe(false);
      expect((await flags(slug[A])).body.data.storefront_pwa).toBe(false);
    } finally {
      await setFlag('storefront_pwa', true, 100, {});
    }
    expect((await flags()).body.data.storefront_pwa).toBe(true);
  });

  it('(3) storefront_offline_reads is per ORGANISATION: absent with no tenant; OFF by default; an allow-list turns A ON and leaves B OFF; the kill-switch wins', async () => {
    expect((await flags()).body.data).not.toHaveProperty('storefront_offline_reads');
    expect((await flags(slug[A])).body.data.storefront_offline_reads).toBe(false);
    expect((await flags(slug[B])).body.data.storefront_offline_reads).toBe(false);
    await setFlag('storefront_offline_reads', true, 0, { tenant_ids: [A] });
    try {
      expect((await flags(slug[A])).body.data.storefront_offline_reads).toBe(true);
      expect((await flags(slug[B])).body.data.storefront_offline_reads).toBe(false);
      expect((await flags()).body.data).not.toHaveProperty('storefront_offline_reads');    // the platform host never reads it ON
      await setFlag('storefront_offline_reads', false, 0, { tenant_ids: [A] });             // the kill-switch beats the allow-list
      expect((await flags(slug[A])).body.data.storefront_offline_reads).toBe(false);
    } finally {
      await setFlag('storefront_offline_reads', false, 100, {});
    }
  });

  it('(4) no rule, percentage or tenant list leaks', async () => {
    await setFlag('storefront_offline_reads', true, 0, { tenant_ids: [A] });
    try {
      for (const r of [await flags(), await flags(slug[A]), await flags(slug[B])]) {
        expect(JSON.stringify(r.body)).not.toMatch(/rollout|tenant_ids|rules|pct/);
        expect(JSON.stringify(r.body)).not.toContain(A);
      }
    } finally {
      await setFlag('storefront_offline_reads', false, 100, {});
    }
  });
});
