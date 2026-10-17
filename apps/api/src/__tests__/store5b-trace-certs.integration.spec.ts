// apps/api/src/__tests__/store5b-trace-certs.integration.spec.ts · PC-56 STORE-5b — TRACE YOU CAN CHECK, CERTIFICATES YOU CAN BELIEVE, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the two clocks are
// ticked on a real kv_relay pool (production's role); the export plane's worker makes the real file (the object store is an in-memory stand-in
// patched onto the app's OWN instance — the 4a seam). `traceability` and `certificates_public` are flipped ON for the fixture tenants only and
// restored to their seeded OFF (Law 10). Own fixtures (never the shared makeCategory).
//
//   (1) B11 — a lot made through the API (a listing, a parcel in a village, a certificate): the v3 scan carries the organisation (+ slug), the
//       product line, the village + district, every event's hash at VERSION 2, the certificate — no uuid but the certificate's, no person; a
//       multi-key meta (posted in an order jsonb does not keep) VERIFIES ok for every v2 event; a v1 event (inserted by SQL with the old formula)
//       reads `unverifiable_v1` and the v2 event after it still verifies, the chain reported ok;
//   (2) a tampered meta (an UPDATE by the admin pool) → mismatch at that event AND every event after it, chain `broken_at`; restored → ok;
//   (3) D3 — the seal clock (kv_relay finds, kv_app writes per organisation): the lot is sealed (head, anchored_at, the event count, one audit row
//       per lot); a new event → matchesHead false; the next tick RE-SEALS; an organisation with `traceability` OFF is skipped; registered at
//       the table's cadence;
//   (4) D1 — the public certificate by id and by number: the type CODE, the verifier's ROLE (never the person — no owner / verifier / media
//       uuid); `certificates_public` OFF → CERTIFICATE_NOT_PUBLISHED; a non-live organisation → not found; a rejected certificate shows its
//       reason; `certTypeId` outside the vocabulary → 422 CERTIFICATE_TYPE_UNKNOWN;
//   (5) the expiry clock flips a lapsed verified certificate → expired (the public read says expired even before it runs); the listing it
//       covered reads `self_declared`; registered daily;
//   (6) B18 — a listing claiming `certified` with no covering certificate → `self_declared` (search, filter, facets, detail); with a verified
//       ORGANIC certificate on the organisation → `certified`; a LAB REPORT does not count; `natural` stays natural;
//   (7) D2 — the export: anonymous → 401; signed in → the job (requester-only, the session's organisation); a replay with the key → ONE job; a
//       stranger (even `*`) → 404; the requester from ANOTHER organisation reads it; the worker → the receipt (sha256, rows = events + the
//       seal row), the CSV's genesis prev_hash and verdicts, the 15-minute link, the fetch logged; an unpublished lot → 404 by name;
//   (8) W306's lot → the scan answers (no dairy field) — the page refuses (render test);
//   (9) D8 — a SUSPENDED organisation's lot → 404 TRACE_NO_LONGER_PUBLISHED (scan, verify, export); an unknown token → TRACE_SCAN_NOT_FOUND;
//  (10) `hash_version` on every `trace_events` partition; the join table's RLS isolates organisations.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { OBJECT_STORE } from '../core/media/s3-presign.service';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { DATASET_REGISTRY, DatasetRegistry, isRequesterOnly } from '../core/exports-plane/dataset.registry';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS } from '../core/jobs/clock-cadence';
import { TraceAnchorClock } from '../modules/traceability/jobs/anchor-hashes.job';
import { CertificateExpiryClock } from '../modules/catalogue/jobs/certificate-expiry-alerts.job';
import { chainHashV1 } from '../modules/traceability/domain/trace-chain';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return Readable.from([b]); }
}
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => { const cs: Buffer[] = []; res.on('data', (c: Buffer) => cs.push(c)); res.on('end', () => cb(null, Buffer.concat(cs))); };   // eslint-disable-line @typescript-eslint/no-explicit-any

run('PC-56 STORE-5b · trace you can check, certificates you can believe (integration, real AppModule over HTTP, clocks as kv_relay)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let uow: UnitOfWork;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const store = new MemoryStore();
  const LIVE = randomUUID(); const OTHER = randomUUID(); const SUSP = randomUUID(); const CT = randomUUID();
  const TENANTS = [LIVE, OTHER, SUSP, CT];
  const U: Record<string, string> = {}; const T: Record<string, string> = {};
  let liveName = ''; let liveSlug = ''; let product = ''; let catId = ''; let village = ''; let district = ''; let parcel = '';
  const L: Record<string, string> = {};   // listings
  const CERT: Record<string, string> = {}; let NPOP = ''; let LAB = '';
  const touched = ['traceability', 'certificates_public'];
  const flagCaches = (k: string) => [`flag:${k}`, `flagstale:${k}`, 'flags:all', ...TENANTS.map((t) => `flagctx:${t}`)];
  const setFlag = async (k: string, on: false | string[]) => {
    if (on === false) await admin.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = jsonb_build_object('tenant_ids', $2::jsonb) WHERE key = $1`, [k, JSON.stringify(on)]);
    for (const c of flagCaches(k)) await cache.del(c);
  };
  const role = (userId: string, tenantId: string, code: string) =>
    admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  const H = (token: string, tenantId: string = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const K = (token: string, tenantId: string = LIVE, key: string = randomUUID()) => ({ ...H(token, tenantId), 'idempotency-key': key });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const scan = (t: string) => request(http).get(`/v1/traceability/scan/${t}`);
  const verify = (t: string) => request(http).get(`/v1/traceability/scan/${t}/verify`);
  const append = (lotId: string, body: Record<string, unknown>, tenantId: string = LIVE) => request(http).post(`/v1/traceability/lots/${lotId}/events`).set(K(T.farmer, tenantId)).send(body);
  async function mkListing(tenantId: string, seller: string, claim: string, title: string): Promise<string> {
    return (await q1(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility, published_at, organic_claim)
       VALUES ($1, $2, $3, $4, $5, 25, 25, 1, 'quintal', 615000, 'INR', 'published', 'public', now(), $6) RETURNING id`, [tenantId, seller, product, catId, title, claim])).id as string;
  }
  async function mkLot(tenantId: string, body: Record<string, unknown>, token = T.farmer): Promise<{ id: string; qrToken: string }> {
    const r = await request(http).post('/v1/traceability/lots').set(K(token, tenantId)).send(body);
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return { id: r.body.data.id, qrToken: r.body.data.qrToken };
  }
  async function submitCert(tenantId: string, certTypeId: string, subjectType: string, subjectId: string, certNo: string, validUntil = '2099-12-31'): Promise<string> {
    const r = await request(http).post('/v1/certificates').set(K(T.farmer, tenantId)).send({ certTypeId, subjectType, subjectId, certNo, issuingBody: 'APEDA-accredited body s5b', validFrom: '2026-01-01', validUntil });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.id as string;
  }
  const decide = (tenantId: string, id: string, body: Record<string, unknown>) => request(http).post(`/v1/certificates/${id}/decision`).set(H(T.coord, tenantId)).send(body);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s5b ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Other Coop s5b ${OTHER.slice(0, 4)}`);
    await makeTenant(admin, SUSP, `Soon Dark s5b ${SUSP.slice(0, 4)}`); await makeTenant(admin, CT, `Cert Coop s5b ${CT.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = ANY($1::uuid[])`, [TENANTS]);
    const t = await q1(`SELECT display_name, slug FROM tenants WHERE id = $1`, [LIVE]); liveName = t.display_name; liveSlug = t.slug;
    for (const k of ['farmer', 'coord', 'buyer', 'stranger', 'tadmin']) U[k] = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [U.farmer]);
    for (const tn of TENANTS) { await role(U.farmer, tn, 'farmer'); await role(U.coord, tn, 'fpo_coordinator'); }
    await role(U.buyer, LIVE, 'customer'); await role(U.buyer, OTHER, 'customer'); await role(U.stranger, LIVE, 'customer'); await role(U.tadmin, LIVE, 'tenant_admin');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs5b' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await q1(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s5b', $1::text::ltree, 1, true) RETURNING id`, [code])).id;
    product = (await q1(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s5b', 'quintal', true) RETURNING id`, [catId])).id;
    // a district (seeded, level 2) → a taluka (3) → a village (4): the parcel sits in the village; the scan prints the village and the district
    const d = await q1(`SELECT id, default_name, path::text AS path, country_code FROM admin_regions WHERE level = 2 ORDER BY path LIMIT 1`);
    district = d.default_name;
    const tag = randomUUID().replace(/-/g, '').slice(0, 10);
    const taluka = (await q1(`INSERT INTO admin_regions (country_code, parent_id, level, default_name, path) VALUES ($1, $2, 3, 'Vanthali taluka s5b', ($3 || '.t' || $4)::ltree) RETURNING id, path::text AS path`, [d.country_code, d.id, d.path, tag]));
    village = 'Vadal s5b';
    const v = (await q1(`INSERT INTO admin_regions (country_code, parent_id, level, default_name, path, centroid_lat, centroid_lng) VALUES ($1, $2, 4, $3, ($4 || '.v' || $5)::ltree, 21.4567, 70.1234) RETURNING id`, [d.country_code, taluka.id, village, taluka.path, tag]));
    parcel = (await q1(`INSERT INTO land_parcels (tenant_id, owner_user_id, region_id, survey_no, area_value) VALUES ($1, $2, $3, 'SURVEY-77/1', 4.5) RETURNING id`, [LIVE, U.farmer, v.id])).id;
    L.lot = await mkListing(LIVE, U.farmer, 'certified', 'GG-20 Groundnut s5b');
    NPOP = (await q1(`SELECT id FROM lookup_values WHERE type_code = 'cert_type' AND tenant_id IS NULL AND code = 'npop'`)).id;
    LAB = (await q1(`SELECT id FROM lookup_values WHERE type_code = 'cert_type' AND tenant_id IS NULL AND code = 'lab_report'`)).id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE); uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    const os = app.get(OBJECT_STORE) as unknown as Record<string, unknown>;
    os.putObjectStream = store.putObjectStream.bind(store); os.getObjectStream = store.getObjectStream.bind(store);
    T.farmer = mintToken(app, { userId: U.farmer, tenantId: LIVE, roles: ['farmer'], perms: ['trace.manage', 'certificate.submit', 'listing.create'] });
    T.coord = mintToken(app, { userId: U.coord, tenantId: LIVE, roles: ['fpo_coordinator'], perms: ['certificate.verify', 'certificate.submit'] });
    T.buyer = mintToken(app, { userId: U.buyer, tenantId: LIVE, roles: ['customer'], perms: [] });
    T.buyerOther = mintToken(app, { userId: U.buyer, tenantId: OTHER, roles: ['customer'], perms: [] });
    T.stranger = mintToken(app, { userId: U.stranger, tenantId: LIVE, roles: ['customer'], perms: [] });
    T.tadmin = mintToken(app, { userId: U.tadmin, tenantId: LIVE, roles: ['tenant_admin'], perms: ['*'] });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relayPool = new Pool({ connectionString: u.toString(), max: 3, application_name: 'store5b-relay' });
    for (const k of touched) await setFlag(k, false);
    await setFlag('traceability', [LIVE, SUSP]);          // ON for LIVE and SUSP; OFF for OTHER and CT
    await setFlag('certificates_public', [LIVE, SUSP, CT]);
  }, 240_000);
  afterAll(async () => {
    try { for (const k of touched) await admin?.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [TENANTS]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_downloads WHERE tenant_id = ANY($1::uuid[])`, [TENANTS]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_jobs WHERE tenant_id = ANY($1::uuid[])`, [TENANTS]).catch(() => undefined);
    await relayPool?.end().catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 60_000);

  const A: Record<string, any> = {};   // eslint-disable-line @typescript-eslint/no-explicit-any

  describe('(1) B11 — the v3 lot, version-2 hashes that recompute; a v1 event is unverifiable, never "mismatch"', () => {
    it('a lot made through the API: organisation (+ slug), product, village + district, every hash at version 2, the certificate; no uuid but the certificate\'s, no person', async () => {
      CERT.lotNpop = await submitCert(LIVE, NPOP, 'listing', L.lot, `NPOP-S5B-${randomUUID().slice(0, 6)}`);
      expect((await decide(LIVE, CERT.lotNpop, { decision: 'verify' })).status).toBe(201);
      A.lot = await mkLot(LIVE, { listingId: L.lot, parcelId: parcel, certificateIds: [CERT.lotNpop, randomUUID()] });   // a foreign id is dropped by the join
      // a MULTI-KEY meta posted in an order jsonb does not keep (packType, packCount, quantity, unit → jsonb: unit, quantity, packType, packCount)
      expect((await append(A.lot.id, { eventCode: 'packed', meta: { packType: 'jute bag', packCount: 50, quantity: 25, unit: 'quintal' } })).status).toBe(201);
      expect((await append(A.lot.id, { eventCode: 'in_transit', meta: { mode: 'road' } })).status).toBe(201);
      const r = await scan(A.lot.qrToken);
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      const p = r.body.data;
      expect(Object.keys(p).sort()).toEqual(['anchor', 'certificates', 'createdAt', 'events', 'organisation', 'place', 'product', 'qrToken', 'sealed']);
      expect(p.organisation).toEqual({ displayName: liveName, slug: liveSlug });
      expect(p.product).toEqual({ title: 'GG-20 Groundnut s5b', quantity: 25, unit: 'quintal' });
      expect(p.place).toEqual({ village, district });
      expect(p.events.map((e: any) => [e.no, e.eventCode, e.hashVersion])).toEqual([[1, 'listed', 2], [2, 'packed', 2], [3, 'in_transit', 2]]);   // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const e of p.events) expect(e.eventHash).toMatch(/^[0-9a-f]{64}$/);
      expect(p.certificates).toEqual([{ id: CERT.lotNpop, typeCode: 'npop', status: 'verified', validUntil: '2099-12-31' }]);
      const raw = JSON.stringify(p);
      expect(raw.match(UUID)).toEqual([CERT.lotNpop]);
      for (const s of ['Ramesh', U.farmer, 'SURVEY-77', '21.4567', '70.1234', 'lotId', 'tenantId', 'farmerUserId', LIVE]) expect(raw).not.toContain(s);
      expect((await q1(`SELECT count(*)::int n FROM trace_lot_certificates WHERE trace_lot_id = $1`, [A.lot.id])).n).toBe(1);
      // the stored rows: version 2, and the instant hashed IS the stored instant
      const rows = (await admin.query(`SELECT hash_version, meta FROM trace_events WHERE trace_lot_id = $1 ORDER BY created_at, id`, [A.lot.id])).rows;
      expect(rows.map((x) => x.hash_version)).toEqual([2, 2, 2]);
      expect(Object.keys(rows[1].meta)).not.toEqual(['packType', 'packCount', 'quantity', 'unit']);   // jsonb re-ordered the keys
    }, 120_000);
    it('verify: every v2 event recomputes ok, chain ok; the first prevHash is null (the lot id never leaves); no uuid', async () => {
      const r = await verify(A.lot.qrToken);
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      const v = r.body.data;
      expect(v.events.map((e: any) => e.recomputed)).toEqual(['ok', 'ok', 'ok']);   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect([v.chain, v.brokenAt, v.v1Count, v.formula]).toEqual(['ok', null, 0, 'v2']);
      expect(v.events[0].prevHash).toBeNull(); expect(v.events[1].prevHash).toBe(v.events[0].eventHash);
      expect(JSON.stringify(v)).not.toMatch(UUID);
    });
    it('a v1 event (inserted by SQL with the OLD formula, multi-key meta) → unverifiable_v1 — never "mismatch"; the v2 event after it verifies; chain ok', async () => {
      A.v1 = await mkLot(LIVE, { declaredInputs: [], certificateIds: [] });
      await admin.query(`DELETE FROM trace_events WHERE trace_lot_id = $1`, [A.v1.id]);   // replace the API's genesis with a pre-0219 row
      const meta = { variety: 'GG-20', quantity: 25, unit: 'quintal' };
      const h1 = chainHashV1(A.v1.id, A.v1.id, 'harvested', meta);
      await admin.query(`INSERT INTO trace_events (trace_lot_id, tenant_id, event_code, meta, event_hash, created_at) VALUES ($1, $2, 'harvested', $3::jsonb, $4, now() - interval '1 day')`,
        [A.v1.id, LIVE, JSON.stringify(meta), h1]);
      expect((await q1(`SELECT hash_version FROM trace_events WHERE trace_lot_id = $1`, [A.v1.id])).hash_version).toBe(1);   // the column default
      expect((await append(A.v1.id, { eventCode: 'in_transit', meta: { mode: 'road' } })).status).toBe(201);
      const v = (await verify(A.v1.qrToken)).body.data;
      expect(v.events.map((e: any) => [e.hashVersion, e.recomputed])).toEqual([[1, 'unverifiable_v1'], [2, 'ok']]);   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect([v.chain, v.v1Count]).toEqual(['ok', 1]);
    });
  });

  describe('(2) a tampered meta → mismatch at that event and every event after it', () => {
    it('UPDATE packed.packCount → events 2 and 3 mismatch, chain broken_at 2; restored → ok again', async () => {
      await admin.query(`UPDATE trace_events SET meta = jsonb_set(meta, '{packCount}', '49') WHERE trace_lot_id = $1 AND event_code = 'packed'`, [A.lot.id]);
      const v = (await verify(A.lot.qrToken)).body.data;
      expect(v.events.map((e: any) => e.recomputed)).toEqual(['ok', 'mismatch', 'mismatch']);   // eslint-disable-line @typescript-eslint/no-explicit-any
      expect([v.chain, v.brokenAt]).toEqual(['broken_at', 2]);
      // a key the public allow-list drops, added by hand → mismatch too (it was never written through the API's door)
      await admin.query(`UPDATE trace_events SET meta = jsonb_set(jsonb_set(meta, '{packCount}', '50'), '{farmerName}', '"Ramesh"') WHERE trace_lot_id = $1 AND event_code = 'packed'`, [A.lot.id]);
      const w = (await verify(A.lot.qrToken)).body.data;
      expect([w.chain, w.brokenAt]).toEqual(['broken_at', 2]);
      expect(JSON.stringify((await scan(A.lot.qrToken)).body.data)).not.toContain('Ramesh');
      await admin.query(`UPDATE trace_events SET meta = meta - 'farmerName' WHERE trace_lot_id = $1 AND event_code = 'packed'`, [A.lot.id]);
      expect((await verify(A.lot.qrToken)).body.data.chain).toBe('ok');
    });
  });

  describe('(3) D3 — the daily platform seal', () => {
    it('registered at the table\'s cadence (daily); a tick seals the head (anchored_at, the count, one audit row); OTHER (traceability OFF) is skipped', async () => {
      const jobs = new Map(app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY).list().map((j) => [j.name, j.intervalMs]));
      expect([jobs.get('trace-anchor'), jobs.get('certificate-expiry')]).toEqual([CLOCK_CADENCE_MS['trace-anchor'], CLOCK_CADENCE_MS['certificate-expiry']]);
      expect(CLOCK_CADENCE_MS['trace-anchor']).toBe(24 * 60 * 60_000);
      A.other = (await q1(`INSERT INTO trace_lots (tenant_id, qr_token, farmer_user_id) VALUES ($1, $2, $3) RETURNING id, qr_token`, [OTHER, `S5BO${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`, U.farmer]));
      await admin.query(`INSERT INTO trace_events (trace_lot_id, tenant_id, event_code, meta, event_hash) VALUES ($1, $2, 'harvested', '{}'::jsonb, 'o1')`, [A.other.id, OTHER]);
      expect((await verify(A.lot.qrToken)).body.data.anchor.matchesHead).toBe(false);
      const res = await app.get(TraceAnchorClock).tick(relayPool);
      expect(res.sealed).toBeGreaterThanOrEqual(2);   // A.lot and A.v1 (and any other live lot due in this database)
      expect(res.tenantsSkipped).toBeGreaterThanOrEqual(1);
      const lot = await q1(`SELECT blockchain_anchor, anchored_at, anchored_event_count FROM trace_lots WHERE id = $1`, [A.lot.id]);
      const head = (await q1(`SELECT event_hash FROM trace_events WHERE trace_lot_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [A.lot.id])).event_hash;
      expect([lot.blockchain_anchor, lot.anchored_event_count, lot.anchored_at !== null]).toEqual([head, 3, true]);
      expect((await q1(`SELECT anchored_at FROM trace_lots WHERE id = $1`, [A.other.id])).anchored_at).toBeNull();   // OTHER skipped (fails closed)
      const audits = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'trace.lot_sealed' AND entity_id = $1`, [A.lot.id])).rows;
      expect(audits).toEqual([{ actor_user_id: null, new_value: { anchor: head, eventCount: 3 } }]);
      const v = (await verify(A.lot.qrToken)).body.data;
      expect([v.anchor.matchesHead, v.anchor.anchoredEventCount]).toEqual([true, 3]);
      expect((await scan(A.lot.qrToken)).body.data.sealed).toBe(true);
    }, 120_000);
    it('a new event → matchesHead false ("not yet sealed"); the next tick RE-SEALS (never "only once"); a second tick seals nothing more for it', async () => {
      expect((await append(A.lot.id, { eventCode: 'delivered', meta: { quantity: 25, unit: 'quintal' } })).status).toBe(201);
      const before = (await scan(A.lot.qrToken)).body.data;
      expect([before.sealed, before.anchor.matchesHead]).toEqual([false, false]);
      await app.get(TraceAnchorClock).tick(relayPool);
      const v = (await verify(A.lot.qrToken)).body.data;
      expect([v.anchor.matchesHead, v.anchor.anchoredEventCount, v.chain]).toEqual([true, 4, 'ok']);
      await app.get(TraceAnchorClock).tick(relayPool);
      expect((await q1(`SELECT count(*)::int n FROM audit_log WHERE action = 'trace.lot_sealed' AND entity_id = $1`, [A.lot.id])).n).toBe(2);
    }, 120_000);
  });

  describe('(4) D1 — the public certificate: the role, never the person; the flag; the reason', () => {
    it('by id and by number: the type CODE, "checked by" the ROLE, verifiedAt — no owner / verifier / media uuid', async () => {
      const r = await request(http).get(`/v1/certificates/public/${CERT.lotNpop}`);
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      const c = r.body.data;
      expect(c).toMatchObject({ id: CERT.lotNpop, organisation: { displayName: liveName, slug: liveSlug }, typeCode: 'npop', status: 'verified', subjectType: 'listing',
        coversListing: 'GG-20 Groundnut s5b', checkedBy: { organisation: liveName, role: 'fpo_coordinator' }, rejectionReason: null });
      expect(c.checkedBy.at).toEqual(expect.any(String));
      const raw = JSON.stringify(c);
      expect(raw.match(UUID)).toEqual([CERT.lotNpop]);
      for (const s of [U.farmer, U.coord, 'ownerUserId', 'verifiedBy', 'mediaId', 'tenantId', 'platform']) expect(raw).not.toContain(s);
      const no = (await q1(`SELECT cert_no FROM certificates WHERE id = $1`, [CERT.lotNpop])).cert_no;
      const b = await request(http).get('/v1/certificates/public').query({ no: no.toLowerCase() }).set({ 'x-tenant-id': LIVE });
      expect([b.status, b.body.data?.id]).toEqual([200, CERT.lotNpop]);
      expect(refusal(await request(http).get('/v1/certificates/public').query({ no }))).toEqual([400, 'TENANT_REQUIRED']);
      expect((await q1(`SELECT verified_at IS NOT NULL AS v FROM certificates WHERE id = $1`, [CERT.lotNpop])).v).toBe(true);
    });
    it('`certificates_public` OFF for the organisation → CERTIFICATE_NOT_PUBLISHED (≠ not found); an unknown id → CERTIFICATE_NOT_FOUND', async () => {
      await setFlag('certificates_public', [SUSP, CT]);
      try {
        expect(refusal(await request(http).get(`/v1/certificates/public/${CERT.lotNpop}`))).toEqual([404, 'CERTIFICATE_NOT_PUBLISHED']);
      } finally { await setFlag('certificates_public', [LIVE, SUSP, CT]); }
      expect(refusal(await request(http).get(`/v1/certificates/public/${randomUUID()}`))).toEqual([404, 'CERTIFICATE_NOT_FOUND']);
    });
    it('a rejected certificate shows its reason (part of the record); a type outside the vocabulary → 422 CERTIFICATE_TYPE_UNKNOWN', async () => {
      CERT.rej = await submitCert(LIVE, LAB, 'listing', L.lot, `LAB-S5B-${randomUUID().slice(0, 6)}`);
      expect((await decide(LIVE, CERT.rej, { decision: 'reject', reason: 'The lab could not confirm the number' })).status).toBe(201);
      const c = (await request(http).get(`/v1/certificates/public/${CERT.rej}`)).body.data;
      expect([c.status, c.rejectionReason, c.typeCode, c.checkedBy.role]).toEqual(['rejected', 'The lab could not confirm the number', 'lab_report', 'fpo_coordinator']);
      expect((await q1(`SELECT rejection_reason FROM certificates WHERE id = $1`, [CERT.rej])).rejection_reason).toBe('The lab could not confirm the number');
      const bad = await request(http).post('/v1/certificates').set(K(T.farmer)).send({ certTypeId: (await q1(`SELECT id FROM lookup_values WHERE type_code = 'address_label' AND tenant_id IS NULL LIMIT 1`)).id, subjectType: 'listing', subjectId: L.lot });
      expect(refusal(bad)).toEqual([422, 'CERTIFICATE_TYPE_UNKNOWN']);
    });
    it('a NON-LIVE organisation\'s certificate → CERTIFICATE_NOT_FOUND (the definer answers NULL)', async () => {
      const lst = await mkListing(SUSP, U.farmer, 'none', 'Soon dark s5b');
      CERT.susp = (await q1(`INSERT INTO certificates (tenant_id, owner_user_id, cert_type_id, cert_no, subject_type, subject_id, status) VALUES ($1, $2, $3, 'SUSP-1', 'listing', $4, 'verified') RETURNING id`, [SUSP, U.farmer, NPOP, lst])).id;
      expect((await request(http).get(`/v1/certificates/public/${CERT.susp}`)).status).toBe(200);
      await admin.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [SUSP]);
      try { expect(refusal(await request(http).get(`/v1/certificates/public/${CERT.susp}`))).toEqual([404, 'CERTIFICATE_NOT_FOUND']); }
      finally { await admin.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [SUSP]); }
    });
  });

  const organicOf = async (tenantId: string, id: string) => {
    const s = await request(http).get('/v1/listings').query({ limit: 50 }).set({ 'x-tenant-id': tenantId });
    expect(s.status).toBe(200);
    const card = s.body.data.find((x: { id: string }) => x.id === id);
    const d = await request(http).get(`/v1/listings/${id}`).set({ 'x-tenant-id': tenantId });
    expect(d.status).toBe(200);
    return { card: card?.organic ?? 'absent', detail: d.body.data.organicClaim as string };
  };

  describe('(6) B18 — "certified" only while a verified organic certificate covers it', () => {
    it('no covering certificate → self_declared (card + detail), not in organic=certified; natural stays natural', async () => {
      L.ct = await mkListing(CT, U.farmer, 'certified', 'Cumin certified-claim s5b');
      L.nat = await mkListing(CT, U.farmer, 'natural', 'Cumin natural s5b');
      expect(await organicOf(CT, L.ct)).toEqual({ card: 'self_declared', detail: 'self_declared' });
      expect(await organicOf(CT, L.nat)).toEqual({ card: 'natural', detail: 'natural' });
      const f = await request(http).get('/v1/listings').query({ organic: 'certified' }).set({ 'x-tenant-id': CT });
      expect(f.body.data.map((x: { id: string }) => x.id)).not.toContain(L.ct);
      expect(f.body.meta.facets.organic).toMatchObject({ certified: 0 });
      const all = await request(http).get('/v1/listings').set({ 'x-tenant-id': CT });
      expect(all.body.meta.facets.organic).toMatchObject({ certified: 0, selfDeclared: 1, natural: 1 });
    });
    it('a verified LAB REPORT does not count; a verified ORGANIC certificate on the organisation → certified (filter and facet too)', async () => {
      const lab = (await q1(`INSERT INTO certificates (tenant_id, owner_user_id, cert_type_id, cert_no, subject_type, subject_id, status, valid_until) VALUES ($1, $2, $3, 'LAB-CT-1', 'listing', $4, 'verified', '2099-12-31') RETURNING id`, [CT, U.farmer, LAB, L.ct])).id;
      expect(await organicOf(CT, L.ct)).toEqual({ card: 'self_declared', detail: 'self_declared' });
      CERT.ctOrg = (await q1(`INSERT INTO certificates (tenant_id, owner_user_id, cert_type_id, cert_no, subject_type, subject_id, status, valid_until) VALUES ($1, $2, $3, 'NPOP-CT-1', 'tenant', $1, 'verified', '2099-12-31') RETURNING id`, [CT, U.farmer, NPOP])).id;
      expect(await organicOf(CT, L.ct)).toEqual({ card: 'certified', detail: 'certified' });
      expect(await organicOf(CT, L.nat)).toEqual({ card: 'natural', detail: 'natural' });   // a certificate never upgrades a natural claim
      const f = await request(http).get('/v1/listings').query({ organic: 'certified' }).set({ 'x-tenant-id': CT });
      expect(f.body.data.map((x: { id: string }) => x.id)).toEqual([L.ct]);
      void lab;
    });
  });

  describe('(5) the expiry clock — lapsed → expired; the badge drops at read time', () => {
    it('a verified certificate past valid_until: the public read already says expired; the listing reads self_declared; the tick flips the row once', async () => {
      expect(await organicOf(LIVE, L.lot)).toEqual({ card: 'certified', detail: 'certified' });   // (1)'s verified npop covers it
      await admin.query(`UPDATE certificates SET valid_until = '2020-01-31' WHERE id = $1`, [CERT.lotNpop]);
      expect((await request(http).get(`/v1/certificates/public/${CERT.lotNpop}`)).body.data.status).toBe('expired');   // before the clock
      expect((await scan(A.lot.qrToken)).body.data.certificates[0].status).toBe('expired');
      expect(await organicOf(LIVE, L.lot)).toEqual({ card: 'self_declared', detail: 'self_declared' });
      const r = await app.get(CertificateExpiryClock).tick(relayPool);
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect((await q1(`SELECT status::text s FROM certificates WHERE id = $1`, [CERT.lotNpop])).s).toBe('expired');
      expect((await q1(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'catalogue.certificate_expired' AND aggregate_id = $1`, [CERT.lotNpop])).n).toBe(1);
      await app.get(CertificateExpiryClock).tick(relayPool);
      expect((await q1(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'catalogue.certificate_expired' AND aggregate_id = $1`, [CERT.lotNpop])).n).toBe(1);   // once
      expect(await organicOf(LIVE, L.lot)).toEqual({ card: 'self_declared', detail: 'self_declared' });
    }, 120_000);
  });

  describe('(7) D2 — "Download the record": signed in, requester-only, on the plane, CSV', () => {
    it('the dataset is registered requester-only; anonymous → 401; signed in → { jobId } in the SESSION\'s organisation; a replay with the key → ONE job; audited with the token', async () => {
      const ds = app.get<DatasetRegistry>(DATASET_REGISTRY).get('traceability.lot_record');
      expect([Boolean(ds), isRequesterOnly(ds)]).toEqual([true, true]);
      expect((await request(http).post(`/v1/traceability/scan/${A.lot.qrToken}/export`).set({ 'idempotency-key': randomUUID() })).status).toBe(401);
      const key = `trace-export:${randomUUID()}`;
      const r = await request(http).post(`/v1/traceability/scan/${A.lot.qrToken}/export`).set(K(T.buyer, LIVE, key));
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      A.job = r.body.data.jobId;
      const again = await request(http).post(`/v1/traceability/scan/${A.lot.qrToken}/export`).set(K(T.buyer, LIVE, key));
      expect(again.body.data.jobId).toBe(A.job);
      const job = await q1(`SELECT tenant_id, dataset_code, requested_by, params FROM tenant_export_jobs WHERE id = $1`, [A.job]);
      expect([job.tenant_id, job.dataset_code, job.requested_by, job.params]).toEqual([LIVE, 'traceability.lot_record', U.buyer, { qrToken: A.lot.qrToken }]);
      expect((await q1(`SELECT count(*)::int n FROM tenant_export_jobs WHERE requested_by = $1 AND dataset_code = 'traceability.lot_record'`, [U.buyer])).n).toBe(1);
      const audit = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE action = 'trace.export_requested' AND entity_id = $1`, [A.job])).rows;
      expect(audit).toEqual([{ actor_user_id: U.buyer, new_value: { qrToken: A.lot.qrToken, dataset: 'traceability.lot_record' } }]);
    });
    it('a STRANGER (even a `*` tenant admin) → 404; the requester reads it with no permission, from EITHER organisation', async () => {
      expect(refusal(await request(http).get(`/v1/exports/${A.job}`).set(H(T.stranger)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      expect(refusal(await request(http).get(`/v1/exports/${A.job}`).set(H(T.tadmin)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      const mine = await request(http).get(`/v1/exports/${A.job}`).set(H(T.buyer));
      expect([mine.status, mine.body.data.status, mine.body.data.datasetCode]).toEqual([200, 'queued', 'traceability.lot_record']);
      const fromOther = await request(http).get(`/v1/exports/${A.job}`).set(H(T.buyerOther, OTHER));
      expect([fromOther.status, fromOther.body.data.id]).toEqual([200, A.job]);
    });
    it('the worker → ready: rows = events + the seal row, the CSV\'s genesis prev_hash and verdicts, sha256; the 15-minute link; the fetch served and LOGGED', async () => {
      expect(await app.get(ExportWorker).generate({ id: A.job, tenantId: LIVE })).toBe('ready');
      const job = await q1(`SELECT status, row_count, content_sha256, storage_key, failure_code FROM tenant_export_jobs WHERE id = $1`, [A.job]);
      const events = (await q1(`SELECT count(*)::int n FROM trace_events WHERE trace_lot_id = $1`, [A.lot.id])).n;
      expect([job.status, job.failure_code, job.row_count]).toEqual(['ready', null, events + 1]);
      const bytes = store.objects.get(job.storage_key)!;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(job.content_sha256);
      const lines = bytes.toString('utf8').replace(/^﻿/, '').split('\r\n').filter((l) => l !== '');
      expect(lines[0]).toBe('event_no,event_code,at,hash_version,event_hash,prev_hash,meta_json,recomputed');
      expect(lines[1].split(',').slice(0, 2)).toEqual(['1', 'listed']);
      expect(lines[1]).toContain(`,${A.lot.id},`);   // the genesis: the first event chains off the lot (the file is recomputable end to end)
      expect(lines.slice(1, -1).every((l) => l.endsWith(',ok'))).toBe(true);
      expect(lines[lines.length - 1]).toMatch(/^seal,/); expect(lines[lines.length - 1]).toMatch(/,head$/);
      expect(bytes.toString('utf8')).not.toMatch(/Ramesh|SURVEY-77|21\.4567/);
      const link = await request(http).post(`/v1/exports/${A.job}/link`).set(H(T.buyer));
      expect([link.status, link.body.data.ttlSec]).toEqual([201, 900]);
      const dl = await request(http).get(`/v1/exports/${A.job}/download`).query({ token: link.body.data.token }).set(H(T.buyer)).buffer(true).parse(binary);
      expect(dl.status).toBe(200);
      expect(dl.headers['x-export-sha256']).toBe(job.content_sha256);
      await new Promise((r) => setTimeout(r, 200));
      const log = (await admin.query(`SELECT outcome, digest_matched, fetched_by FROM tenant_export_downloads WHERE job_id = $1 ORDER BY id DESC LIMIT 1`, [A.job])).rows[0];
      expect([log.outcome, log.digest_matched, log.fetched_by]).toEqual(['served', true, U.buyer]);
    }, 120_000);
    it('an unpublished lot (OTHER — traceability OFF) → 404 TRACE_NOT_PUBLISHED; nothing queued', async () => {
      expect(refusal(await request(http).post(`/v1/traceability/scan/${A.other.qr_token}/export`).set(K(T.buyer)))).toEqual([404, 'TRACE_NOT_PUBLISHED']);
      expect((await q1(`SELECT count(*)::int n FROM tenant_export_jobs WHERE requested_by = $1 AND params->>'qrToken' = $2`, [U.buyer, A.other.qr_token])).n).toBe(0);
    });
  });

  describe('(8) W306 — the scan of a lot answers, and carries no dairy field', () => {
    it('no cows, litres, collections, cold chain or split in the answer', async () => {
      const raw = JSON.stringify((await scan(A.lot.qrToken)).body.data);
      expect(raw).not.toMatch(/cow|litre|collection|coldChain|cold_chain|split|member/i);
    });
  });

  describe('(9) D8 — a suspended organisation: no longer published; an unknown token: not found', () => {
    it('scan / verify / export of a SUSPENDED organisation\'s lot → 404 TRACE_NO_LONGER_PUBLISHED; the rows are kept; unknown → TRACE_SCAN_NOT_FOUND', async () => {
      A.susp = await mkLot(SUSP, { declaredInputs: [], certificateIds: [] }, mintToken(app, { userId: U.farmer, tenantId: SUSP, roles: ['farmer'], perms: ['trace.manage'] }));
      expect((await scan(A.susp.qrToken)).status).toBe(200);
      await admin.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [SUSP]);
      try {
        expect(refusal(await scan(A.susp.qrToken))).toEqual([404, 'TRACE_NO_LONGER_PUBLISHED']);
        expect(refusal(await verify(A.susp.qrToken))).toEqual([404, 'TRACE_NO_LONGER_PUBLISHED']);
        expect(refusal(await request(http).post(`/v1/traceability/scan/${A.susp.qrToken}/export`).set(K(T.buyer)))).toEqual([404, 'TRACE_NO_LONGER_PUBLISHED']);
        const body = JSON.stringify((await scan(A.susp.qrToken)).body);
        expect(body).not.toMatch(/eventHash|displayName|Soon Dark|qrToken/);   // nothing of the lot
        expect((await q1(`SELECT count(*)::int n FROM trace_events WHERE trace_lot_id = $1`, [A.susp.id])).n).toBe(1);   // never deleted
      } finally { await admin.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [SUSP]); }
      expect(refusal(await scan('S5BNOSUCHTOKEN0000'))).toEqual([404, 'TRACE_SCAN_NOT_FOUND']);
      expect(refusal(await verify('S5BNOSUCHTOKEN0000'))).toEqual([404, 'TRACE_SCAN_NOT_FOUND']);
    });
  });

  describe('(10) the schema: hash_version everywhere; the join table isolates organisations', () => {
    it('every trace_events partition carries hash_version NOT NULL; trace_lot_certificates is RLS-forced and a stranger organisation reads none of LIVE\'s rows', async () => {
      const p = await q1(`SELECT count(*)::int total, count(*) FILTER (WHERE a.attname IS NOT NULL AND a.attnotnull)::int has
                            FROM pg_inherits i LEFT JOIN pg_attribute a ON a.attrelid = i.inhrelid AND a.attname = 'hash_version' AND NOT a.attisdropped
                           WHERE i.inhparent = 'trace_events'::regclass`);
      expect(p.total).toBeGreaterThan(0); expect(p.has).toBe(p.total);
      const rls = await q1(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'trace_lot_certificates'`);
      expect([rls.relrowsecurity, rls.relforcerowsecurity]).toEqual([true, true]);
      const asLive = await uow.run(LIVE, (tx) => tx.query(`SELECT certificate_id FROM trace_lot_certificates WHERE trace_lot_id = $1`, [A.lot.id]));
      const asOther = await uow.run(OTHER, (tx) => tx.query(`SELECT certificate_id FROM trace_lot_certificates WHERE trace_lot_id = $1`, [A.lot.id]));
      expect([asLive.rows.length, asOther.rows.length]).toEqual([1, 0]);
    });
  });
});
