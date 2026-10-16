// apps/api/src/__tests__/store4a-account-addresses.integration.spec.ts · PC-56 STORE-4a — YOUR ACCOUNT, YOUR ADDRESSES, YOUR DATA, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, migration 0214's
// three SECURITY DEFINER functions, the export plane's REAL worker tick on the kv_relay pool (the object store is an in-memory stand-in patched
// onto the app's own ObjectStore instance — the one seam not crossed, as the plane's own spec names). Own fixtures (never the shared
// makeCategory). No flag is switched: `tenant_exports` stays OFF for the whole run (the personal export is not behind it — founder D2).
//
// What it proves (brief §C7):
//   (1) address create replayed with the same key → one row; a label + a delivery note stored; an unknown label (or a value of another
//       vocabulary) → 422 ADDRESS_LABEL_UNKNOWN; no `countryCode` → 422 VALIDATION_FAILED; a 281-character note → 422; the DB itself no longer
//       defaults the country (an INSERT without one is refused NOT NULL); the list and the detail carry `labelCode` + `deliveryNote`;
//   (2) an edit of an address an order delivers to, changing its note and label → a COPY carrying the new note and label; the old row keeps
//       its own (the order still points at it);
//   (3) a remove of another person's address → 404 (and their detail → 404); removing the default → the newest remaining is the default;
//   (4) `GET lookups/values?type=address_label` → the five platform codes in order (their hi/gu words are the storefront catalogues', by code);
//   (5) the export: a request → a PERSONAL job queued (the DSR `in_progress` with `export_job_id`); a second request while it is open → the SAME
//       request and job; a stranger (a tenant admin with every permission) → 404 on GET / link; the requester reads it with NO permission and
//       `tenant_exports` OFF, and from ANOTHER organisation's session too; the worker tick → `ready` with sha256 + row count; the CSV holds
//       the person's rows from TWO organisations (orders, a message), masked phone, retired address copies — and nobody else's; a link minted
//       and the download served (digest matched) and logged; `GET privacy/requests` carries the receipt and the request is `completed`;
//       `exports.export_ready` is addressed to the requester;
//   (6) deletion: an open order in ANOTHER organisation → 409 DSR_BLOCKED {openOrders: 1}; a captured payment on it → escrow figure; a wallet
//       balance → blocked with the wallet figure and its currency; clean → `open` + `coolingEndsAt` ≈ now + 90 d, audited `dsr.requested`;
//       `GET privacy/commitments` matches (invoice count, retention years from the setting); the DEFINER refuses another person's id;
//   (7) `PATCH users/me` writes `user.profile_updated` with field names and masked values — no name, no raw email; `GET users/me` names you;
//   (8) the invoice's buyer GSTIN: a PENDING business-KYC profile → NULL; VERIFIED → present (TradeInvoiceRepository.resolveParties);
//   (9) the relay gate is run as its own spec (group B) — no handler added.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { OBJECT_STORE } from '../core/media/s3-presign.service';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { TradeInvoiceRepository } from '../modules/payments/repositories/trade-invoice.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';   // in.gj.junagadh → GST state 24

/** The plane's object store stand-in (core/exports-plane/__tests__/export-plane.integration.spec.ts names the seam). */
class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return Readable.from([b]); }
}
const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => { const cs: Buffer[] = []; res.on('data', (c: Buffer) => cs.push(c)); res.on('end', () => cb(null, Buffer.concat(cs))); };   // eslint-disable-line @typescript-eslint/no-explicit-any

run('PC-56 STORE-4a · account, addresses, data rights (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let uow: UnitOfWork;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const store = new MemoryStore();
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let liveName = ''; let otherName = '';
  const U: Record<string, string> = {};
  const T: Record<string, string> = {};
  let seq = 0;
  const no = () => `S4A-${Date.now().toString(36)}-${++seq}`;

  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const role = async (userId: string, tenantId: string, code: string) =>
    admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  const order = async (tenantId: string, buyer: string, status: string, opts: { addressId?: string | null; total?: number } = {}) => {
    const id = randomUUID(); const n = no();
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, subtotal_minor, total_minor, currency_code, status, delivery_address_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 'INR', $7::order_status, $8)`, [id, tenantId, n, buyer, U.seller, opts.total ?? 615_000, status, opts.addressId ?? null]);
    return { id, orderNo: n };
  };
  const labels: Record<string, string> = {};
  const addrRow = async (id: string) => (await admin.query(`SELECT a.id, a.deleted_at, a.delivery_note, a.country_code, a.is_default, lv.code AS label FROM addresses a LEFT JOIN lookup_values lv ON lv.id = a.label_id WHERE a.id = $1`, [id])).rows[0];
  const createAddress = (token: string, body: Record<string, unknown>, key?: string) =>
    request(http).post('/v1/addresses').set({ ...H(token), ...(key ? { 'idempotency-key': key } : {}) }).send(body);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2 });
    await makeTenant(admin, LIVE, `Anand FPO s4a ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Kisan Sathi s4a ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    liveName = (await admin.query(`SELECT display_name FROM tenants WHERE id = $1`, [LIVE])).rows[0].display_name;
    otherName = (await admin.query(`SELECT display_name FROM tenants WHERE id = $1`, [OTHER])).rows[0].display_name;
    for (const k of ['buyer', 'stranger', 'seller', 'person', 'other', 'tadmin', 'd1', 'd2', 'd3', 'profile', 'kyc']) U[k] = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name = 'Nilesh Shah', email = 'nilesh@shahtrading.in' WHERE id = $1`, [U.person]);
    await admin.query(`UPDATE users SET full_name = 'Asha Old', email = 'asha.old@example.com', language_code = 'en' WHERE id = $1`, [U.profile]);
    for (const k of ['buyer', 'stranger', 'person', 'other', 'd1', 'd2', 'd3', 'profile', 'kyc']) await role(U[k], LIVE, 'customer');
    for (const k of ['person', 'd1']) await role(U[k], OTHER, 'customer');   // a person of TWO organisations
    await role(U.seller, LIVE, 'farmer'); await role(U.seller, OTHER, 'farmer'); await role(U.tadmin, LIVE, 'tenant_admin');
    app = await bootstrapE2EApp(); http = app.getHttpServer(); uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    void (http.address() as AddressInfo).port;
    const os = app.get(OBJECT_STORE) as unknown as Record<string, unknown>;   // the app's OWN instance — the worker and the download read it
    os.putObjectStream = store.putObjectStream.bind(store); os.getObjectStream = store.getObjectStream.bind(store);
    for (const k of ['buyer', 'stranger', 'person', 'other', 'd1', 'd2', 'd3', 'profile', 'kyc']) T[k] = mintToken(app, { userId: U[k], tenantId: LIVE, roles: ['customer'], perms: [] });
    T.personOther = mintToken(app, { userId: U.person, tenantId: OTHER, roles: ['customer'], perms: [] });
    T.d1Other = mintToken(app, { userId: U.d1, tenantId: OTHER, roles: ['customer'], perms: [] });
    T.tadmin = mintToken(app, { userId: U.tadmin, tenantId: LIVE, roles: ['tenant_admin'], perms: ['*'] });
    for (const r of (await admin.query(`SELECT id, code FROM lookup_values WHERE type_code = 'address_label' AND tenant_id IS NULL`)).rows) labels[r.code] = r.id;
  }, 240_000);
  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    // the plane's queue is ONE cross-tenant FIFO: this spec's jobs are finished or removed so a neighbour's head is its own
    await admin?.query(`UPDATE data_subject_requests SET export_job_id = NULL WHERE user_id = ANY($1::uuid[])`, [Object.values(U)]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_downloads WHERE tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_jobs WHERE tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await relayPool?.end().catch(() => undefined); await admin?.end();
  }, 40_000);

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(1)–(4) the address book: labels, the note, the country, copy-on-write, removal', () => {
    const A: Record<string, string> = {};
    it('(4) GET lookups/values?type=address_label → the five platform codes, in order', async () => {
      const r = await request(http).get('/v1/lookups/values').query({ type: 'address_label' }).set({ 'x-tenant-id': LIVE });
      expect(r.status).toBe(200);
      expect(r.body.data.map((v: { code: string }) => v.code)).toEqual(['home', 'farm', 'shop', 'warehouse', 'delivery']);
      expect(Object.keys(labels).sort()).toEqual(['delivery', 'farm', 'home', 'shop', 'warehouse']);
    });
    it('(1) create replayed with the same key → ONE row, its label and its note stored; the list and the detail carry labelCode + deliveryNote', async () => {
      const key = `address:${randomUUID()}`;
      const body = { line1: 'Plot 14, GIDC Vadal', village: 'Vadal', regionId: JUNAGADH, pincode: '362001', countryCode: 'in', contactName: 'Nilesh', contactPhone: '+919898012742', labelId: labels.farm, deliveryNote: 'Gate 2 — weighbridge inside. Trucks up to 19 ft OK.', isDefault: true };
      const a = await createAddress(T.buyer, body, key); const b = await createAddress(T.buyer, body, key);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(b.body.data.id).toBe(a.body.data.id);
      A.farm = a.body.data.id;
      expect(Number((await admin.query(`SELECT count(*)::int AS n FROM addresses WHERE user_id = $1`, [U.buyer])).rows[0].n)).toBe(1);
      const row = await addrRow(A.farm);
      expect([row.label, row.delivery_note, row.country_code, row.is_default]).toEqual(['farm', 'Gate 2 — weighbridge inside. Trucks up to 19 ft OK.', 'IN', true]);
      const list = await request(http).get('/v1/addresses').set(H(T.buyer));
      expect(list.body.data[0]).toEqual(expect.objectContaining({ id: A.farm, labelCode: 'farm', deliveryNote: 'Gate 2 — weighbridge inside. Trucks up to 19 ft OK.', countryCode: 'IN' }));
      const one = await request(http).get(`/v1/addresses/${A.farm}`).set(H(T.buyer));
      expect([one.status, one.body.data.labelCode, one.body.data.deliveryNote]).toEqual([200, 'farm', 'Gate 2 — weighbridge inside. Trucks up to 19 ft OK.']);
    });
    it('(1) an unknown label / another vocabulary\'s value → 422 ADDRESS_LABEL_UNKNOWN; no countryCode → 422 VALIDATION_FAILED; a 281-character note → 422; nothing written', async () => {
      const before = Number((await admin.query(`SELECT count(*)::int AS n FROM addresses WHERE user_id = $1`, [U.buyer])).rows[0].n);
      expect(refusal(await createAddress(T.buyer, { line1: 'Shop 3, Kalupur lane', pincode: '380001', countryCode: 'IN', labelId: randomUUID() }))).toEqual([422, 'ADDRESS_LABEL_UNKNOWN']);
      const cancelReason = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL LIMIT 1`)).rows[0].id;
      expect(refusal(await createAddress(T.buyer, { line1: 'Shop 3, Kalupur lane', pincode: '380001', countryCode: 'IN', labelId: cancelReason }))).toEqual([422, 'ADDRESS_LABEL_UNKNOWN']);
      expect(refusal(await createAddress(T.buyer, { line1: 'Shop 3, Kalupur lane', pincode: '380001' }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refusal(await createAddress(T.buyer, { line1: 'Shop 3, Kalupur lane', pincode: '380001', countryCode: 'IN', deliveryNote: 'x'.repeat(281) }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(Number((await admin.query(`SELECT count(*)::int AS n FROM addresses WHERE user_id = $1`, [U.buyer])).rows[0].n)).toBe(before);
      // Rule Zero at the database too (0214): no country → NOT NULL refuses it (the 'IN' default is gone)
      await expect(admin.query(`INSERT INTO addresses (user_id, line1) VALUES ($1, 'No country here')`, [U.buyer])).rejects.toMatchObject({ code: '23502' });
    });
    it('(2) an edit of an address an ORDER delivers to (the note and the label) → a COPY carrying both; the old row keeps its own', async () => {
      await order(LIVE, U.buyer, 'confirmed', { addressId: A.farm });
      const r = await request(http).patch(`/v1/addresses/${A.farm}`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({ deliveryNote: 'Gate 3 now — the weighbridge moved.', labelId: labels.warehouse });
      expect([r.status, r.body.data.copied, r.body.data.previousId]).toEqual([200, true, A.farm]);
      A.copy = r.body.data.id;
      const copy = await addrRow(A.copy); const old = await addrRow(A.farm);
      expect([copy.label, copy.delivery_note, copy.is_default, copy.deleted_at]).toEqual(['warehouse', 'Gate 3 now — the weighbridge moved.', true, null]);
      expect([old.label, old.delivery_note]).toEqual(['farm', 'Gate 2 — weighbridge inside. Trucks up to 19 ft OK.']);
      expect(old.deleted_at).not.toBeNull();
      // an edit with an unknown label is refused the same way (in the edit's transaction) and changes nothing
      expect(refusal(await request(http).patch(`/v1/addresses/${A.copy}`).set(H(T.buyer)).send({ labelId: randomUUID() }))).toEqual([422, 'ADDRESS_LABEL_UNKNOWN']);
      expect((await addrRow(A.copy)).label).toBe('warehouse');
    });
    it('(3) another person\'s remove / detail → 404; removing the DEFAULT makes the newest remaining the default', async () => {
      A.shop = (await createAddress(T.buyer, { line1: 'Shop 3, Kalupur lane', pincode: '380001', countryCode: 'IN', labelId: labels.shop })).body.data.id;
      A.home = (await createAddress(T.buyer, { line1: '12 Station Road', pincode: '362001', countryCode: 'IN', labelId: labels.home })).body.data.id;
      expect(refusal(await request(http).delete(`/v1/addresses/${A.shop}`).set(H(T.stranger)))).toEqual([404, 'ADDRESS_NOT_FOUND']);
      expect(refusal(await request(http).get(`/v1/addresses/${A.shop}`).set(H(T.stranger)))).toEqual([404, 'ADDRESS_NOT_FOUND']);
      expect((await addrRow(A.shop)).deleted_at).toBeNull();
      const r = await request(http).delete(`/v1/addresses/${A.copy}`).set(H(T.buyer));
      expect([r.status, r.body.data.defaultId]).toEqual([200, A.home]);
      expect((await addrRow(A.home)).is_default).toBe(true);
    });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(5) "Download my data" — a personal job on the export plane, readable by its requester only', () => {
    const X: Record<string, string> = {};
    it('fixtures: the person in TWO organisations — an order in each, a message, a consent, a notification, a retired address copy; another person\'s order and message', async () => {
      X.orderLive = (await order(LIVE, U.person, 'completed', { total: 615_000 })).orderNo;
      X.orderOther = (await order(OTHER, U.person, 'completed', { total: 98_000 })).orderNo;
      X.orderStranger = (await order(LIVE, U.other, 'completed', { total: 12_345 })).orderNo;
      const conv = (await admin.query(`INSERT INTO conversations (tenant_id, context_type) VALUES ($1, 'order') RETURNING id`, [OTHER])).rows[0].id;
      await admin.query(`INSERT INTO messages (conversation_id, tenant_id, sender_user_id, body) VALUES ($1, $2, $3, 'When can I collect the cumin?'), ($1, $2, $4, 'Someone else wrote this')`, [conv, OTHER, U.person, U.other]);
      await admin.query(`INSERT INTO consents (user_id, purpose_code, version, granted, channel) VALUES ($1, 'marketing', 'v1', false, 'web')`, [U.person]);
      await admin.query(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, status) VALUES ($1, $2, 'order.created', 'inapp', 'sent')`, [LIVE, U.person]);
      await admin.query(`INSERT INTO addresses (user_id, line1, pincode, country_code, contact_phone, delivery_note, deleted_at) VALUES ($1, 'Old farm gate, Vanthali', '362610', 'IN', '+919898012742', 'retired copy', now())`, [U.person]);
      X.phone = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [U.person])).rows[0].phone;
      expect((await admin.query(`SELECT is_enabled FROM feature_flags WHERE key = 'tenant_exports'`)).rows[0]?.is_enabled ?? false).toBe(false);
    });
    it('a request → the DSR in_progress with export_job_id, a PERSONAL job queued (position + ETA); a second request while open → the SAME request and job', async () => {
      const r = await request(http).post('/v1/privacy/export-requests').set({ ...H(T.person), 'idempotency-key': `dsr-export:${randomUUID()}` }).send({});
      expect(r.status).toBe(201);
      expect([r.body.data.kind, r.body.data.status, r.body.data.export?.status]).toEqual(['export', 'in_progress', 'queued']);
      expect(r.body.data.export.standing.position).toBeGreaterThanOrEqual(1);
      expect(['no_history', 'estimate']).toContain(r.body.data.export.standing.eta.kind);
      X.dsr = r.body.data.id; X.job = r.body.data.export.jobId;
      const row = (await admin.query(`SELECT status, export_job_id FROM data_subject_requests WHERE id = $1`, [X.dsr])).rows[0];
      expect([row.status, row.export_job_id]).toEqual(['in_progress', X.job]);
      const job = (await admin.query(`SELECT tenant_id, dataset_code, requested_by, params FROM tenant_export_jobs WHERE id = $1`, [X.job])).rows[0];
      expect([job.tenant_id, job.dataset_code, job.requested_by, job.params]).toEqual([LIVE, 'identity.dpdp_person', U.person, { userId: U.person }]);
      const again = await request(http).post('/v1/privacy/export-requests').set({ ...H(T.person), 'idempotency-key': `dsr-export:${randomUUID()}` }).send({});
      expect([again.body.data.id, again.body.data.export.jobId]).toEqual([X.dsr, X.job]);
      expect(Number((await admin.query(`SELECT count(*)::int AS n FROM tenant_export_jobs WHERE requested_by = $1`, [U.person])).rows[0].n)).toBe(1);
      expect(Number((await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'dsr.requested' AND entity_id = $1`, [X.dsr])).rows[0].n)).toBe(1);
    });
    it('a STRANGER (a tenant admin holding every permission) → 404 on the job and on its link; the requester reads it with no permission, flag OFF, from EITHER organisation', async () => {
      expect(refusal(await request(http).get(`/v1/exports/${X.job}`).set(H(T.tadmin)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      expect(refusal(await request(http).post(`/v1/exports/${X.job}/link`).set(H(T.tadmin)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      expect(refusal(await request(http).get(`/v1/exports/${X.job}`).set(H(T.other)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      const mine = await request(http).get(`/v1/exports/${X.job}`).set(H(T.person));
      expect([mine.status, mine.body.data.status, mine.body.data.datasetCode]).toEqual([200, 'queued', 'identity.dpdp_person']);
      const fromOther = await request(http).get(`/v1/exports/${X.job}`).set(H(T.personOther, OTHER));
      expect([fromOther.status, fromOther.body.data.id]).toEqual([200, X.job]);
      expect(refusal(await request(http).post(`/v1/exports/${X.job}/link`).set(H(T.person)))).toEqual([409, 'EXPORT_NOT_READY']);
    });
    it('the worker tick → ready with sha256 + row count; the CSV holds the person\'s rows from TWO organisations, masked — and nobody else\'s', async () => {
      const worker = app.get(ExportWorker);
      for (let i = 0; i < 10; i++) {
        await worker.tick(relayPool);
        if ((await admin.query(`SELECT status FROM tenant_export_jobs WHERE id = $1`, [X.job])).rows[0].status === 'ready') break;
      }
      const job = (await admin.query(`SELECT status, row_count, content_sha256, storage_key, failure_code, failure_detail FROM tenant_export_jobs WHERE id = $1`, [X.job])).rows[0];
      expect([job.status, job.failure_code]).toEqual(['ready', null]);
      const bytes = store.objects.get(job.storage_key)!;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(job.content_sha256);
      const csv = bytes.toString('utf8');
      const dataLines = csv.split('\r\n').filter((l) => l.trim() !== '').length - 1;
      expect(job.row_count).toBe(dataLines);
      expect(csv).toContain(X.orderLive); expect(csv).toContain(X.orderOther);
      expect(csv).toContain(liveName); expect(csv).toContain(otherName);
      expect(csv).toContain('When can I collect the cumin?');
      expect(csv).toContain('retired copy');
      for (const s of ['profile', 'address', 'order', 'message', 'consent', 'notification', 'data_request']) expect(csv).toMatch(new RegExp(`(^|\\n)\\uFEFF?${s},`, 'm'));
      // nobody else's
      expect(csv).not.toContain(X.orderStranger); expect(csv).not.toContain('Someone else wrote this');
      // masked: never the raw phone or email
      expect(csv).not.toContain(X.phone); expect(csv).not.toContain('nilesh@shahtrading.in'); expect(csv).not.toContain('9898012742');
      expect(csv).toContain(`${X.phone.slice(0, 5)}****${X.phone.slice(-4)}`); expect(csv).toContain('n***@shahtrading.in');
      const ready = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'exports.export_ready'`, [X.job])).rows[0];
      expect(ready?.payload?.userId).toBe(U.person);
    });
    it('a link minted, the download SERVED (digest matched) and LOGGED; GET privacy/requests carries the receipt and the request is completed', async () => {
      const link = await request(http).post(`/v1/exports/${X.job}/link`).set(H(T.person));
      expect([link.status, link.body.data.ttlSec]).toEqual([201, 900]);
      expect(refusal(await request(http).get(`/v1/exports/${X.job}/download`).query({ token: link.body.data.token }).set(H(T.tadmin)))).toEqual([404, 'EXPORT_JOB_NOT_FOUND']);
      const dl = await request(http).get(`/v1/exports/${X.job}/download`).query({ token: link.body.data.token }).set(H(T.person)).buffer(true).parse(binary);
      expect(dl.status).toBe(200);
      const sha = (await admin.query(`SELECT content_sha256 FROM tenant_export_jobs WHERE id = $1`, [X.job])).rows[0].content_sha256;
      expect(createHash('sha256').update(dl.body as Buffer).digest('hex')).toBe(sha);
      expect(dl.headers['x-export-sha256']).toBe(sha);
      await new Promise((r) => setTimeout(r, 200));
      const log = (await admin.query(`SELECT outcome, digest_matched, fetched_by FROM tenant_export_downloads WHERE job_id = $1 ORDER BY id DESC LIMIT 1`, [X.job])).rows[0];
      expect([log.outcome, log.digest_matched, log.fetched_by]).toEqual(['served', true, U.person]);
      const list = await request(http).get('/v1/privacy/requests').set(H(T.person));
      const mine = list.body.data.find((x: { id: string }) => x.id === X.dsr);
      expect([mine.status, mine.export.status, mine.export.receipt.sha256, mine.export.receipt.requestedBy, mine.export.download.kind]).toEqual(['completed', 'ready', sha, U.person, 'available']);
      expect((await admin.query(`SELECT status FROM data_subject_requests WHERE id = $1`, [X.dsr])).rows[0].status).toBe('completed');
    });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(6) deletion: refused while anything is open — across organisations; nothing moves', () => {
    it('an open order in ANOTHER organisation → 409 DSR_BLOCKED {openOrders: 1}; a captured payment on it → the escrow figure; nothing written', async () => {
      const o = await order(OTHER, U.d1, 'confirmed', { total: 250_000 });
      const r = await request(http).post('/v1/privacy/deletion-requests').set({ ...H(T.d1), 'idempotency-key': randomUUID() }).send({});
      expect(refusal(r)).toEqual([409, 'DSR_BLOCKED']);
      expect(r.body.error.details).toEqual(expect.objectContaining({ openOrders: 1, escrowMinor: '0', walletMinor: '0' }));
      const purpose = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'payment_purpose' AND code = 'direct_order' AND tenant_id IS NULL`)).rows[0].id;
      await admin.query(`INSERT INTO payments (tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key)
                         VALUES ($1, $2, $3, 'order', $4, 250000, 'INR', 'success', 'razorpay', $5)`, [OTHER, U.d1, purpose, o.id, `s4a-${randomUUID()}`]);
      const c = await request(http).get('/v1/privacy/commitments').set(H(T.d1Other, OTHER));
      expect(c.body.data).toEqual(expect.objectContaining({ openOrders: 1, escrowMinor: '250000', walletMinor: '0', currencyCode: 'INR', blocked: true, coolingDays: 90 }));
      const again = await request(http).post('/v1/privacy/deletion-requests').set({ ...H(T.d1), 'idempotency-key': randomUUID() }).send({});
      expect(again.body.error.details).toEqual(expect.objectContaining({ openOrders: 1, escrowMinor: '250000', currencyCode: 'INR' }));
      expect(Number((await admin.query(`SELECT count(*)::int AS n FROM data_subject_requests WHERE user_id = $1`, [U.d1])).rows[0].n)).toBe(0);
    });
    it('a wallet balance (no open order) → blocked with the wallet figure and its currency', async () => {
      await order(LIVE, U.d2, 'completed');
      await admin.query(`INSERT INTO wallet_accounts (owner_kind, owner_user_id, account_code, currency_code, cached_balance_minor) VALUES ('user', $1, 'main', 'INR', 5000)`, [U.d2]);
      const r = await request(http).post('/v1/privacy/deletion-requests').set({ ...H(T.d2), 'idempotency-key': randomUUID() }).send({});
      expect(refusal(r)).toEqual([409, 'DSR_BLOCKED']);
      expect(r.body.error.details).toEqual(expect.objectContaining({ openOrders: 0, escrowMinor: '0', walletMinor: '5000', currencyCode: 'INR' }));
    });
    it('clean → open + coolingEndsAt ≈ now + 90 d, audited `dsr.requested`; GET commitments matches (invoices kept, years from the setting); a replay → the same request', async () => {
      const o = await order(LIVE, U.d3, 'completed');
      await admin.query(`INSERT INTO trade_invoices (tenant_id, order_id, invoice_no, total_minor) VALUES ($1, $2, $3, 615000)`, [LIVE, o.id, `INV-${o.orderNo}`]);
      const c = await request(http).get('/v1/privacy/commitments').set(H(T.d3));
      expect(c.body.data).toEqual({ openOrders: 0, escrowMinor: '0', walletMinor: '0', currencyCode: null, multiCurrency: false, invoiceCount: 1, blocked: false, retentionYears: 8, coolingDays: 90 });
      const key = randomUUID();
      const r = await request(http).post('/v1/privacy/deletion-requests').set({ ...H(T.d3), 'idempotency-key': key }).send({});
      expect([r.status, r.body.data.kind, r.body.data.status]).toEqual([201, 'deletion', 'open']);
      const days = (new Date(r.body.data.coolingEndsAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(89.9); expect(days).toBeLessThan(90.1);
      const audit = (await admin.query(`SELECT new_value FROM audit_log WHERE action = 'dsr.requested' AND entity_id = $1`, [r.body.data.id])).rows;
      expect(audit).toHaveLength(1); expect(audit[0].new_value.kind).toBe('deletion');
      const again = await request(http).post('/v1/privacy/deletion-requests').set({ ...H(T.d3), 'idempotency-key': randomUUID() }).send({});
      expect(again.body.data.id).toBe(r.body.data.id);
      // the retention years are the SETTING's, never a literal: the registry value moved to 10 → the page reads 10
      await admin.query(`UPDATE setting_definitions SET default_value = '10'::jsonb WHERE key = 'platform.invoice_retention_years'`);
      try { expect((await request(http).get('/v1/privacy/commitments').set(H(T.d3))).body.data.retentionYears).toBe(10); }
      finally { await admin.query(`UPDATE setting_definitions SET default_value = '8'::jsonb WHERE key = 'platform.invoice_retention_years'`); }
    });
    it('the DEFINER answers only for the caller\'s own id (app.user_id set to another person → insufficient_privilege)', async () => {
      const c = await admin.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.user_id', $1, true)`, [U.d3]);
        await expect(c.query(`SELECT * FROM kv_person_open_commitments($1)`, [U.d2])).rejects.toMatchObject({ code: '42501' });
      } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
      const own = (await admin.query(`SELECT open_orders, wallet_minor::text AS w FROM kv_person_open_commitments($1)`, [U.d2])).rows[0];
      expect([own.open_orders, own.w]).toEqual([0, '5000']);
    });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(7) the profile edit is audited — field names and masked values, no PII', () => {
    it('PATCH users/me → `user.profile_updated` (fields, masked email, language) with no name and no raw email; GET users/me names you', async () => {
      const r = await request(http).patch('/v1/users/me').set(H(T.profile)).send({ fullName: 'Asha Patel', email: 'asha.new@example.com', languageCode: 'gu' });
      expect(r.status).toBe(200);
      const rows = (await admin.query(`SELECT old_value, new_value FROM audit_log WHERE action = 'user.profile_updated' AND entity_id = $1`, [U.profile])).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].new_value).toEqual({ fields: ['fullName', 'languageCode', 'email'], languageCode: 'gu', email: 'a***@example.com' });
      expect(rows[0].old_value).toEqual({ fields: ['fullName', 'languageCode', 'email'], languageCode: 'en', email: 'a***@example.com' });
      const raw = JSON.stringify(rows[0]);
      for (const pii of ['Asha Patel', 'Asha Old', 'asha.new@', 'asha.old@']) expect(raw).not.toContain(pii);
      const me = await request(http).get('/v1/users/me').set(H(T.profile));
      expect([me.body.data.fullName, me.body.data.displayName, me.body.data.languageCode, me.body.data.locale]).toEqual(['Asha Patel', 'Asha Patel', 'gu', 'gu']);
      expect(me.body.data.email).toBe('a***@example.com');
      expect(me.body.data.phone).toMatch(/\*\*\*\*/);
    });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(8) the tax invoice takes ONLY a verified GSTIN (founder D5)', () => {
    it('a PENDING business-KYC profile → buyer_gstin NULL; VERIFIED → the masked GSTIN', async () => {
      await admin.query(`INSERT INTO business_kyc_profiles (tenant_id, user_id, business_type, legal_name, gstin_masked, status) VALUES ($1, $2, 'trader', 'Shah Trading Co.', '24AAACS••••F1Z5', 'pending')`, [LIVE, U.kyc]);
      const repo = app.get(TradeInvoiceRepository);
      const read = () => uow.run(LIVE, (tx) => repo.resolveParties(tx, { tenantId: LIVE, buyerUserId: U.kyc, deliveryAddressId: null }), { userId: U.kyc });
      expect((await read()).buyerGstin).toBeNull();
      await admin.query(`UPDATE business_kyc_profiles SET status = 'rejected' WHERE user_id = $1`, [U.kyc]);
      expect((await read()).buyerGstin).toBeNull();
      await admin.query(`UPDATE business_kyc_profiles SET status = 'verified', reviewed_at = now() WHERE user_id = $1`, [U.kyc]);
      expect((await read()).buyerGstin).toBe('24AAACS••••F1Z5');
    });
  });
});
