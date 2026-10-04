// apps/api/src/__tests__/tenant-swe-logistics-ops.integration.spec.ts · PC-56 TENANT-SW-e · LOGISTICS OPS — the live proof against real
// Postgres + RLS + 0201, driven through the REAL AppModule over HTTP with the REAL SDK (`@krishalaya/sdk-js` source — F-19: the shapes
// the console uses are the shapes proven here), the device ingest over raw HTTP with a real HMAC, the OTPs captured from the SMS port
// (never from a log), the jobs on a kv_relay pool and the parcel fee through SW-b's own run preparer.
//   A  carriers: create (a rider must hold delivery_partner — the database refuses anyone else) · patch · toggle WITH a reason, audited ·
//      Shipments 30d real · On-time REFUSED BY NAME · rider KYC / wage terms real, insured refused · µs cursor.
//   B  slots: the desk read masked; a proposal writes nothing to pickup_slots; a desk accept and a desk write of the seller's slots are
//      refused by the database; the OTP link accepts and writes the windows; an in-app decline writes nothing; expiry by the job;
//      suggestions are a read.
//   C  Village Run: draft → the drafter's confirm refused (RUN_CHECKER_IS_DRAFTER) → a second person confirms → load → depart → the
//      keeper's OTP handover → the member's OTP collection → the `parcel_handover` earning ONCE at the tenant fee ≥ the floor (a second
//      accrual and a direct second earning both refused) → in SW-b's prepared run; consolidation is a real count.
//   D  cold chain: the manual route refuses a body band / time (strict DTO) and copies the band from the store; a forged band on a direct
//      insert is overwritten; device ingest with a valid HMAC accepted; a bad signature, a stale timestamp and a replayed nonce refused;
//      ONE out-of-band device reading opens nothing, TWO do; a manual reading never does; the first in-band device reading closes it; the
//      buyer offer (> 15 min) and the buyer's decision recorded; the silence job alerts ("alerted, not called"); median refused then
//      measured; loss only where recorded; the export on the 6e-2 plane says "unsigned"; µs paging; no OTP and no device key in any log.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool, PoolClient } from 'pg';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { KrishalayaClient, SdkError } from '../../../../packages/sdk-js/dist';   // the BUILT SDK (dist): exactly what the console imports
import { SMS_SENDER, SmsSender } from '../core/auth/otp.service';
import { signIngest } from '../modules/logistics/domain/logistics-ops';
import { ColdChainWatchJob, SlotProposalExpiryJob } from '../modules/logistics/jobs/logistics-ops.jobs';
import { AmbassadorPayoutRunJob } from '../modules/ambassadors/jobs/payout-run.job';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { UNIT_OF_WORK } from '../core/database/unit-of-work';
import { OUTBOX_WRITER } from '../core/outbox/outbox.writer';
import { READ_REPLICA } from '../core/database/read-replica.provider';
import { METRICS } from '../core/observability/metrics';
import { DATASET_REGISTRY } from '../core/exports-plane/dataset.registry';
import { ExportJobRepository } from '../core/exports-plane/export-job.repository';
import { Readable } from 'node:stream';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;
/** The instant a keyset cursor carries (base64 / base64url of `<instant>|<id>`) — µs means six fractional digits. */
const cursorInstant = (c: string) => Buffer.from(c, 'base64url').toString('utf8').split('|')[0];
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof SdkError ? e.code : ((/\[([A-Z_]+)\]/.exec(String((e as Error)?.message)) ?? [])[1] ?? String((e as { code?: string })?.code ?? e)); } };

class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObject(k: string, body: Buffer): Promise<void> { this.objects.set(k, Buffer.from(body)); }
  async getObject(k: string): Promise<Buffer> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return b; }
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { return Readable.from([await this.getObject(k)]); }
}

run('PC-56 TENANT-SW-e · logistics ops (integration, real Postgres + RLS + 0201, real HTTP + SDK)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let base = '';
  const T = randomUUID();
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: any }> = [];
  const U = { admin1: '', admin2: '', staff: '', seller: '', buyer: '', keeper: '', rider: '', stranger: '' };
  const tok: Record<string, string> = {};
  const sms: Array<{ phone: string; purpose: string; code: string }> = [];
  const logged: string[] = [];
  const secrets: string[] = [];
  let ambassadorId = ''; let GJ = ''; let V2 = '';

  const sdk = (who: keyof typeof U | null) => new KrishalayaClient({ baseUrl: base, apiVersion: 'v1', retries: 0, timeoutMs: 20_000,
    getToken: () => (who ? tok[who] : null), getHeaders: () => ({ 'x-tenant-id': T }) });
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, T, code]);
  const permsOf = async (code: string) => (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code=$1`, [code])).rows.map((x) => x.permission_code as string);
  const lastCode = (purpose: string, phone: string) => { const s = [...sms].reverse().find((x) => x.purpose === purpose && x.phone === phone); if (!s) throw new Error(`no ${purpose} code to ${phone}`); secrets.push(s.code); return s.code; };
  async function history(fn: (c: PoolClient) => Promise<void>): Promise<void> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  /** As kv_app with a session user: what the request tier may do, judged by the database. */
  async function asApp(userId: string, sql: string, p: unknown[] = []): Promise<string> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app');
      await c.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [T, userId]);
      await c.query(sql, p); return 'ok';
    } catch (e) { const m = /\[([A-Z_]+)\]/.exec(String((e as Error).message)); return m ? m[1] : `${(e as { code?: string }).code}`; }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const allow = async (flag: string) => {
    const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1`, [flag])).rows[0];
    if (!row) throw new Error(`flag ${flag} missing`);
    if (!flagBackup.find((f) => f.key === flag)) flagBackup.push(row);
    const rules = row.is_enabled ? { ...(row.rules ?? {}), tenant_ids: [...((row.rules ?? {}).tenant_ids ?? []), T] } : { tenant_ids: [T] };
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=$2, rules=$3::jsonb WHERE key=$1`, [flag, row.is_enabled ? row.rollout_pct : 0, JSON.stringify(rules)]);
  };
  const phone = () => `+9198${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
  const mkUser = async (name: string, ...roles: string[]) => {
    const u = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name=$2, phone=$3, language_code='gu' WHERE id=$1`, [u, name, phone()]);
    for (const r of roles) await role(u, r);
    return u;
  };
  const phoneOf = async (u: string) => (await q1(`SELECT phone FROM users WHERE id=$1`, [u])).phone as string;
  /** An open order + shipment for the buyer, dropping in `region`, created `daysAgo` ago (the village parcel / the reefer). */
  const parcel = async (region: string, o: { status?: string; daysAgo?: number; pickedUpDaysAgo?: number | null; attempts?: number } = {}) => {
    const orderId = (await q1(`SELECT uuid_generate_v7() AS id`)).id as string;
    await admin.query(`INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, subtotal_minor, total_minor) VALUES ($1,$2,$3,$4,$5,1000,1000)`,
      [orderId, T, `SWE-${orderId.slice(0, 8)}`, U.buyer, U.seller]);
    const drop = randomUUID(); const pick = randomUUID();
    await admin.query(`INSERT INTO addresses (id, tenant_id, user_id, line1, village, region_id, pincode, country_code) VALUES ($1,$2,$3,'drop','v',$4,'362001','IN'), ($5,$2,$6,'pick','v',$4,'362001','IN')`,
      [drop, T, U.buyer, region, pick, U.seller]);
    const r = await admin.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, pickup_address_id, drop_address_id, picked_up_at, delivery_attempts, created_at)
       VALUES (uuid_generate_v7(),$1,$2,$3,$4,$5, CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(days => $7::int) END, $8, now() - make_interval(days => $6::int)) RETURNING id`,
      [T, orderId, o.status ?? 'in_transit', pick, drop, o.daysAgo ?? 0, o.pickedUpDaysAgo ?? null, o.attempts ?? 0]);
    return r.rows[0].id as string;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    await admin.query(`ALTER ROLE kv_ingest WITH LOGIN PASSWORD 'dev'`);   // same statement as db/local/local-login-roles.sql
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2 });
    process.env.INGEST_DATABASE_URL = as('kv_ingest');
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    process.env.TENANT_CONSOLE_BASE_URL = 'https://console.example.test';

    await makeTenant(admin, T, 'Sabar Dairy FPO');
    GJ = (await q1(`SELECT id FROM admin_regions ORDER BY id LIMIT 1`)).id;
    V2 = (await q1(`SELECT id FROM admin_regions WHERE id <> $1 ORDER BY id LIMIT 1`, [GJ])).id;
    U.admin1 = await mkUser('Kiran Admin', 'tenant_admin'); U.admin2 = await mkUser('Mehul Admin', 'tenant_admin');
    U.staff = await mkUser('Staff Ben', 'tenant_staff');
    U.seller = await mkUser('Ramesh Patel', 'farmer'); U.buyer = await mkUser('Bhavna Shah', 'farmer');
    U.keeper = await mkUser('Dinesh Makwana', 'ambassador', 'farmer'); U.rider = await mkUser('Ravi Rider', 'delivery_partner');
    U.stranger = await mkUser('Not A Rider', 'farmer');
    ambassadorId = (await q1(`INSERT INTO ambassador_profiles (user_id, tenant_id, monthly_stipend_minor) VALUES ($1,$2,0) RETURNING id`, [U.keeper, T])).id;
    for (const f of ['logistics', 'logistics_slot_proposals', 'logistics_village_run', 'cold_chain_device_ingest', 'tenant_exports', 'ambassadors']) {
      if ((await admin.query(`SELECT 1 FROM feature_flags WHERE key=$1`, [f])).rowCount) await allow(f);
    }
    // the cooperative raised its per-parcel fee to ₹12 (a money_path setting: written here as its confirmed proposal would — triggers off)
    await history((c) => c.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'logistics.parcel_handover_fee_minor', '1200'::jsonb)`, [T]).then(() => undefined));

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const adminPerms = await permsOf('tenant_admin');
    tok.admin1 = mintToken(app, { userId: U.admin1, tenantId: T, perms: adminPerms, roles: ['tenant_admin'] });
    tok.admin2 = mintToken(app, { userId: U.admin2, tenantId: T, perms: adminPerms, roles: ['tenant_admin'] });
    tok.staff = mintToken(app, { userId: U.staff, tenantId: T, perms: await permsOf('tenant_staff'), roles: ['tenant_staff'] });
    for (const k of ['seller', 'buyer', 'keeper'] as const) tok[k] = mintToken(app, { userId: U[k], tenantId: T, perms: await permsOf('farmer'), roles: ['farmer'] });
    // the OTP leaves through the SMS port — captured HERE (the only place a test may read a code), never from a log
    const port = app.get<SmsSender>(SMS_SENDER);
    jest.spyOn(port, 'sendOtp').mockImplementation(async (p: string, ctx: { code: string; purpose?: string }) => { sms.push({ phone: p, purpose: String(ctx.purpose), code: ctx.code }); });
    // every log line the app writes from here on is kept, to prove no OTP and no device key ever reaches one
    const keep = (...a: unknown[]) => { logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    for (const m of ['log', 'error', 'warn', 'debug', 'verbose'] as const) jest.spyOn(Logger.prototype, m).mockImplementation(keep as never);
    for (const m of ['log', 'error', 'warn', 'info', 'debug'] as const) jest.spyOn(console, m).mockImplementation(keep as never);
  }, 240_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id=$1`, [T]).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await app?.close().catch(() => undefined); await relayPool?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  /* ═══════════════════════════════════════════ A · CARRIERS ═══════════════════════════════════════════ */
  describe('A · carriers (W228 · W2378–W2384) through the SDK', () => {
    let fleetId = '';
    it('a rider carrier must name a user holding delivery_partner — the DATABASE refuses anyone else', async () => {
      expect(await codeOf(sdk('admin1').carriers.create({ partnerKind: 'rider', defaultName: 'Not a rider', riderUserId: U.stranger }, idem()))).toBe('RIDER_NOT_DELIVERY_PARTNER');
      expect(await asApp(U.admin1, `INSERT INTO logistics_partners (tenant_id, partner_kind, default_name, rider_user_id) VALUES ($1,'rider','Forged',$2)`, [T, U.stranger])).toBe('RIDER_NOT_DELIVERY_PARTNER');
      const r = await sdk('admin1').carriers.create({ partnerKind: 'rider', defaultName: 'Ravi (bike)', riderUserId: U.rider, vehicle: { regNo: 'GJ09AB1234', capacityKg: 40 } }, idem());
      expect(r).toMatchObject({ partnerKind: 'rider', riderUserId: U.rider, isActive: true });
      expect(r.vehicleId).toEqual(expect.any(String));
    });
    it('create (own fleet, masked contact) · patch · deactivate WITH a reason, audited; a bare toggle is refused', async () => {
      const c = await sdk('admin1').carriers.create({ partnerKind: 'tenant_fleet', defaultName: 'Our reefer van', contactPhone: '+919812345678', supportsColdChain: true,
        vehicle: { regNo: 'GJ01CC0001', capacityKg: 900, isRefrigerated: true } }, idem());
      fleetId = c.id;
      expect(c.contactMasked).toMatch(/678$/); expect(c.contactMasked).not.toContain('98123');
      expect(c.vehicleId).toEqual(expect.any(String));
      expect((await sdk('admin1').carriers.get(fleetId)).capability).toMatchObject({ vehicles: 1, reefer: true });
      const p = await sdk('admin1').carriers.patch(fleetId, { defaultName: 'Reefer van 1' });
      expect(p.defaultName).toBe('Reefer van 1');
      expect(await codeOf(sdk('admin1').carriers.setActive(fleetId, false, 'short'))).toMatch(/VALIDATION|REASON/);
      const off = await sdk('admin1').carriers.setActive(fleetId, false, 'Van in the workshop for two weeks');
      expect(off).toMatchObject({ isActive: false, statusReason: 'Van in the workshop for two weeks' });
      expect(await q1(`SELECT reason, action FROM audit_log WHERE entity_type='logistics_partner' AND entity_id=$1 AND action='logistics.partner_deactivated'`, [fleetId]))
        .toEqual({ reason: 'Van in the workshop for two weeks', action: 'logistics.partner_deactivated' });
      expect(await codeOf(sdk('staff').carriers.create({ partnerKind: '3pl', defaultName: 'X' }, idem()))).toBe('FORBIDDEN');
    });
    it('the list: Shipments 30d is a real count; On-time REFUSED BY NAME; rider KYC / wage terms real, insured refused; µs cursor', async () => {
      const v = (await q1(`SELECT id FROM vehicles WHERE tenant_id=$1 AND partner_id=$2`, [T, fleetId]))?.id;
      for (let i = 0; i < 2; i++) { const s = await parcel(GJ); await admin.query(`UPDATE shipments SET partner_id=$2 WHERE id=$1`, [s, fleetId]); }
      const page = await sdk('admin1').carriers.list({ activeOnly: false, limit: 1 });
      expect(page.onTime).toEqual({ kind: 'refused', code: 'NO_PROMISED_DELIVERY_TIME' });
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeTruthy();
      expect(cursorInstant(page.nextCursor as string)).toMatch(/\.\d{6}/);   // µs, not ms (F-14)
      const all = await sdk('admin1').carriers.list({ activeOnly: false, limit: 50 });
      const fleet = all.items.find((x) => x.id === fleetId)!;
      expect(fleet.shipments30d).toBe(2);
      expect(fleet.onTime).toEqual({ kind: 'refused', code: 'NO_PROMISED_DELIVERY_TIME' });
      const rider = all.items.find((x) => x.partnerKind === 'rider')!;
      expect(rider.rider).toMatchObject({ kycVerified: false, wageTerms: expect.any(String), insured: { kind: 'refused', code: 'NO_RIDER_INSURANCE_RECORD' } });
      const next = await sdk('admin1').carriers.list({ activeOnly: false, limit: 1, cursor: page.nextCursor as string });
      expect(next.items[0]?.id).not.toBe(page.items[0].id);
      expect(v).toBeTruthy();
    });
  });

  /* ═══════════════════════════════════════════ B · PICKUP SLOTS ═══════════════════════════════════════════ */
  describe('B · pickup slots (W230 · W2399–W2401): the desk proposes, the member accepts', () => {
    let pid = ''; let pid2 = '';
    it('the desk read: sellers masked, delivery first-attempt labelled, pickup first-attempt REFUSED BY NAME', async () => {
      await parcel(GJ, { status: 'delivered', pickedUpDaysAgo: 3, attempts: 1 });
      const d = await sdk('admin1').pickupSlots.desk({ limit: 50 });
      const row = d.items.find((x) => x.sellerUserId === U.seller)!;
      expect(row.sellerPhoneMasked).toMatch(/^[•*x]+|\d{2,4}$/); expect(row.sellerPhoneMasked).not.toBe(await phoneOf(U.seller));
      expect(row.sellerName).not.toBe('Ramesh Patel');
      expect(row.pickupFirstAttempt).toEqual({ kind: 'refused', code: 'NO_PICKUP_ATTEMPT_RECORD' });
      expect(row.deliveryFirstAttempt).toMatchObject({ kind: 'delivery', attempted: 1, firstAttempt: 1 });
      expect(d.refused).toEqual({ pickupFirstAttempt: 'NO_PICKUP_ATTEMPT_RECORD', voiceSlots: 'NO_VOICE_SLOT_CAPTURE' });
    });
    it('suggestions are a READ (nothing written)', async () => {
      const before = await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1`, [T]);
      const s = await sdk('admin1').pickupSlots.suggestions(U.seller);
      expect(s).toMatchObject({ basis: 'own_pickup_history', model: null, writes: 'none', windowDays: 90 });
      expect(await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1`, [T])).toBe(before);
    });
    it('a proposal writes NOTHING to the seller\'s pickup_slots; a desk accept and a desk write of the slots are refused by the database', async () => {
      pid = (await sdk('admin1').pickupSlots.propose({ sellerUserId: U.seller, slots: [{ weekday: 2, start: '07:00', end: '09:00' }, { weekday: 5, start: '16:00', end: '18:00' }], reason: 'The collection van passes at 8' }, idem())).id;
      expect(await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2`, [T, U.seller])).toBe(0);
      expect(await n(`SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type='logistics.slot_proposed'`, [pid])).toBe(1);
      expect(await asApp(U.admin1, `UPDATE pickup_slot_proposals SET status='accepted', decided_at=now(), decided_by=$2, channel='app' WHERE id=$1`, [pid, U.admin1])).toBe('SLOT_PROPOSAL_NOT_SELLER');
      expect(await asApp(U.admin1, `INSERT INTO pickup_slots (tenant_id, seller_user_id, weekday, start_time, end_time) VALUES ($1,$2,2,'07:00','09:00')`, [T, U.seller])).toBe('PICKUP_SLOT_NOT_YOURS');
      expect(await codeOf(sdk('admin1').pickupSlots.accept(pid, idem()))).toMatch(/SLOT_PROPOSAL_NOT_SELLER|SLOT_PROPOSAL_NOT_FOUND/);
      expect(await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2`, [T, U.seller])).toBe(0);
    });
    it('the OTP link: the code goes to the seller\'s own phone; a wrong code is refused; the right one ACCEPTS and writes the windows', async () => {
      const view = await sdk(null).pickupSlots.linkView(pid);
      expect(view).toMatchObject({ status: 'proposed', organisation: 'Sabar Dairy FPO' });
      expect(view.phoneTail).toContain((await phoneOf(U.seller)).slice(-4)); expect(view.phoneTail).not.toContain((await phoneOf(U.seller)).slice(3, 8));
      await sdk(null).pickupSlots.linkSendCode(pid);
      const code = lastCode('slot_proposal', await phoneOf(U.seller));
      expect(await codeOf(sdk(null).pickupSlots.linkDecide(pid, { code: code === '000000' ? '111111' : '000000', decision: 'accept' }))).toBe('SLOT_OTP_INVALID');
      const ok = await sdk(null).pickupSlots.linkDecide(pid, { code, decision: 'accept' });
      expect(ok).toMatchObject({ status: 'accepted', channel: 'otp_link', windowsWritten: 2 });
      expect((await admin.query(`SELECT weekday, to_char(start_time,'HH24:MI') s FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2 ORDER BY weekday`, [T, U.seller])).rows)
        .toEqual([{ weekday: 2, s: '07:00' }, { weekday: 5, s: '16:00' }]);
    });
    it('an in-app DECLINE by the seller writes nothing; the expiry job closes one unanswered for 7 days', async () => {
      pid2 = (await sdk('admin1').pickupSlots.propose({ sellerUserId: U.seller, slots: [{ weekday: 3, start: '10:00', end: '12:00' }], reason: 'Wednesday mandi traffic' }, idem())).id;
      expect((await sdk('seller').pickupSlots.myProposals()).items.map((x) => x.id)).toContain(pid2);
      expect(await sdk('seller').pickupSlots.decline(pid2, 'I am at the mandi on Wednesdays', idem())).toMatchObject({ status: 'declined' });
      expect(await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2 AND weekday=3`, [T, U.seller])).toBe(0);
      const p3 = (await sdk('admin1').pickupSlots.propose({ sellerUserId: U.seller, slots: [{ weekday: 1, start: '06:00', end: '07:00' }], reason: 'Early Monday pickups' }, idem())).id;
      await history((c) => c.query(`UPDATE pickup_slot_proposals SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id=$1`, [p3]).then(() => undefined));
      expect(await app.get(SlotProposalExpiryJob).sweep(relayPool, [T])).toMatchObject({ tenants: 1, expired: 1, failed: 0 });
      expect((await q1(`SELECT status FROM pickup_slot_proposals WHERE id=$1`, [p3])).status).toBe('expired');
      expect(await n(`SELECT count(*) n FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2 AND weekday=1`, [T, U.seller])).toBe(0);
    });
  });

  /* ═══════════════════════════════════════════ C · VILLAGE RUN ═══════════════════════════════════════════ */
  describe('C · Village Run (W232 · W2814–W2820) and the per-parcel fee (C2, MONEY)', () => {
    let routeId = ''; let dpId = ''; let runId = ''; let p1 = ''; let p2 = ''; let handoverId = '';
    it('a route through the villages, a drop point kept by an ambassador (anyone else refused), a real consolidation count', async () => {
      const today = (await q1(`SELECT extract(dow FROM kv_ist_today())::int AS d, kv_ist_today()::text AS ymd`));
      routeId = randomUUID();
      // an approved, active route (its own maker-checker is 5b's — written here as its confirmed state, triggers off)
      await history((c) => c.query(`INSERT INTO delivery_routes (id, tenant_id, default_name, run_weekday, village_region_ids, status, approved_by, approved_at) VALUES ($1,$2,'Thursday villages',$3,$4::jsonb,'active',$5, now())`,
        [routeId, T, today.d, JSON.stringify([GJ, V2]), U.admin2]).then(() => undefined));
      expect(await codeOf(sdk('admin1').villageRun.addDropPoint(routeId, { sequence: 1, regionId: GJ, name: 'Dairy office', ambassadorUserId: U.stranger }, idem()))).toBe('DROP_POINT_KEEPER_NOT_AMBASSADOR');
      dpId = (await sdk('admin1').villageRun.addDropPoint(routeId, { sequence: 1, regionId: GJ, name: 'Panchayat office', ambassadorUserId: U.keeper, windowStart: '09:00', windowEnd: '18:00' }, idem())).id;
      p1 = await parcel(GJ); p2 = await parcel(V2); await parcel(GJ);   // three bound for the route's villages this week
      expect((await sdk('admin1').villageRun.candidates(routeId)).items.map((x) => x.shipmentId)).toEqual(expect.arrayContaining([p1, p2]));
      const draft = await sdk('admin1').villageRun.draft(routeId, { runDate: today.ymd, plan: [{ shipmentId: p1, dropPointId: dpId }], reason: 'Thursday run for the dairy villages' }, idem());
      runId = draft.id;
      const page = await sdk('admin1').villageRun.route(routeId);
      expect(page.current?.id).toBe(runId);
      expect(page.current?.consolidation).toMatchObject({ onRun: 1, boundForVillages: expect.any(Number) });
      expect(page.current!.consolidation!.boundForVillages).toBeGreaterThanOrEqual(3);
      expect(page.current?.freight).toEqual({ kind: 'refused', code: 'NO_FREIGHT_BILLED_FOR_RUN' });
      expect(page.refused).toEqual({ freightVsAdHoc: 'NO_AD_HOC_FREIGHT_FACT', returnLeg: 'NO_RETURN_LEG_RECORD' });
      expect(page.economics).toMatchObject({ feeInForceMinor: '1200', platformFloorMinor: '500' });
    });
    it('THE CHECKER WALL: the drafter cannot confirm (database: RUN_CHECKER_IS_DRAFTER); a second person can; then load → depart', async () => {
      expect((await sdk('admin1').villageRun.run(runId)).acts).not.toContain('confirm');   // not offered to the drafter
      expect(await codeOf(sdk('admin1').villageRun.act(runId, 'confirm', null, idem()))).toBe('RUN_CHECKER_IS_DRAFTER');
      expect((await q1(`SELECT status FROM route_runs WHERE id=$1`, [runId])).status).toBe('draft');
      expect(await sdk('admin2').villageRun.act(runId, 'confirm', null, idem())).toMatchObject({ status: 'confirmed' });
      expect(await asApp(U.admin1, `UPDATE route_runs SET loading_plan='[]'::jsonb WHERE id=$1`, [runId])).toBe('RUN_PLAN_FROZEN');
      expect(await sdk('admin1').villageRun.act(runId, 'start_loading', null, idem())).toMatchObject({ status: 'loading' });
      expect(await sdk('admin1').villageRun.act(runId, 'depart', null, idem())).toMatchObject({ status: 'in_transit' });
    });
    it('the keeper\'s OTP hands the parcel over; the member\'s OTP collects it; the fee is written ONCE at the tenant fee ≥ the floor', async () => {
      await sdk('admin2').villageRun.sendKeeperCode(runId, p1);
      const kcode = lastCode('parcel_handover', await phoneOf(U.keeper));
      expect(await codeOf(sdk('admin2').villageRun.handOver(runId, { shipmentId: p1, code: kcode === '000000' ? '111111' : '000000' }, idem()))).toBe('HANDOVER_OTP_INVALID');
      handoverId = (await sdk('admin2').villageRun.handOver(runId, { shipmentId: p1, code: kcode }, idem())).id;
      expect(await n(`SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND reference_id=$2`, [T, handoverId])).toBe(0);   // not before collection
      expect(await codeOf(sdk('admin2').villageRun.sendCollectCode(handoverId))).toBe('SHIPMENT_FORBIDDEN');   // the keeper records the collection, nobody else
      await sdk('keeper').villageRun.sendCollectCode(handoverId);
      const mcode = lastCode('parcel_collect', await phoneOf(U.buyer));
      const done = await sdk('keeper').villageRun.collect(handoverId, mcode, idem());
      expect(done).toMatchObject({ status: 'collected', feeMinor: '1200', feeSource: 'tenant_setting' });
      const e = (await admin.query(`SELECT event_code, ambassador_id, amount_minor::text a, payout_id FROM ambassador_earnings WHERE tenant_id=$1 AND reference_id=$2`, [T, handoverId])).rows;
      expect(e).toEqual([{ event_code: 'parcel_handover', ambassador_id: ambassadorId, a: '1200', payout_id: null }]);
      expect(await q1(`SELECT otp_verified_at IS NOT NULL k, recipient_otp_verified_at IS NOT NULL m FROM parcel_handovers WHERE id=$1`, [handoverId])).toEqual({ k: true, m: true });
    });
    it('the earning is UNIQUE per handover: a second accrual adds nothing, a direct second earning is refused (PARCEL_FEE_ONCE)', async () => {
      await admin.query(`SELECT kv_accrue_parcel_handover_fee($1)`, [handoverId]);
      expect(await n(`SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND event_code='parcel_handover' AND reference_id=$2`, [T, handoverId])).toBe(1);
      const plan = (await q1(`SELECT id FROM commission_plans_ambassador WHERE tenant_id IS NULL AND event_code='parcel_handover' AND deleted_at IS NULL`)).id;
      const twice = await admin.query(`INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor) VALUES ($1,$2,$3,'parcel_handover','parcel_handover',$4,1200)`,
        [T, ambassadorId, plan, handoverId]).then(() => 'ok', (x) => (/\[([A-Z_]+)\]/.exec(String(x.message)) ?? [])[1]);
      expect(twice).toBe('PARCEL_FEE_ONCE');
      expect(await n(`SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND event_code='parcel_handover' AND reference_id=$2`, [T, handoverId])).toBe(1);
      // an earning for a handover that was never collected is refused too
      const notEarned = await admin.query(`INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor) VALUES ($1,$2,$3,'parcel_handover','parcel_handover',$4,1200)`,
        [T, ambassadorId, plan, randomUUID()]).then(() => 'ok', (x) => (/\[([A-Z_]+)\]/.exec(String(x.message)) ?? [])[1]);
      expect(notEarned).toBe('PARCEL_FEE_NOT_EARNED');
      expect(await q1(`SELECT kv_parcel_handover_fee_minor($1)::text f`, [randomUUID()])).toEqual({ f: '500' });   // a cooperative with no setting: the floor
    });
    it('the fee is PAID by SW-b\'s weekly run: the preparer (kv_relay pool) puts it on the keeper\'s line; the economics card reads it', async () => {
      const now = new Date(); const thu = new Date(now.getTime() + ((4 - now.getUTCDay() + 7) % 7 + 7) * 86_400_000); thu.setUTCHours(17, 40, 0, 0);
      expect(await app.get(AmbassadorPayoutRunJob).sweep(relayPool, thu, [T])).toMatchObject({ inWindow: true, prepared: 1, failed: 0 });
      const line = await q1(`SELECT l.commission_minor::text c, l.status FROM ambassador_payout_run_lines l JOIN ambassador_payout_runs r ON r.id = l.run_id WHERE r.tenant_id=$1 AND l.ambassador_id=$2`, [T, ambassadorId]);
      expect(line).toEqual({ c: '1200', status: 'pending' });
      const eco = (await sdk('admin1').villageRun.route(routeId)).economics.keepers.find((k) => k.userId === U.keeper)!;
      expect(eco).toMatchObject({ parcels: 1, accruedMinor: '1200', paidMinor: '0', unpaidMinor: '1200' });
      expect((await sdk('admin1').villageRun.run(runId)).handovers[0]).toMatchObject({ status: 'collected', feeMinor: '1200' });
    });
  });

  /* ═══════════════════════════════════════════ D · COLD CHAIN ═══════════════════════════════════════════ */
  describe('D · cold chain (W234 · W239 · W240 · W2534–W2538): device ingest + server bands', () => {
    let reefer = ''; let deviceId = ''; let key = ''; let breachId = ''; let seq = 1;
    const ingest = async (body: Record<string, unknown>, o: { key?: string; ts?: number; nonce?: string; device?: string } = {}) => {
      const raw = JSON.stringify(body); const ts = String(o.ts ?? Math.floor(Date.now() / 1000)); const nonce = o.nonce ?? `n${randomUUID().replace(/-/g, '')}`;
      const res = await fetch(`${base}/v1/ingest/cold-chain/readings`, { method: 'POST', body: raw, headers: { 'content-type': 'application/json', 'x-kv-device': o.device ?? deviceId,
        'x-kv-timestamp': ts, 'x-kv-nonce': nonce, 'x-kv-signature': signIngest(o.key ?? key, ts, nonce, raw) } });
      const json = await res.json().catch(() => ({})) as { data?: unknown; error?: { code?: string } };
      return { status: res.status, code: json.error?.code ?? null, data: json.data as { accepted?: boolean; duplicate?: boolean } | undefined, nonce, ts, raw };
    };
    const reading = (tempC: number, minutesAgo = 0) => ({ tempC, recordedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), sequenceNo: seq++ });

    it('the band is set in the store only; the manual route refuses a body band and a body time BY NAME (strict DTO) and copies the band', async () => {
      reefer = await parcel(GJ);
      await sdk('admin1').coldChain.setThreshold({ subjectType: 'shipment', subjectId: reefer, minC: 2, maxC: 8, reason: 'Paneer — 2 to 8 °C on the label' }, idem());
      const forged = await fetch(`${base}/v1/logistics/cold-chain/readings`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.admin1}`, 'x-tenant-id': T },
        body: JSON.stringify({ subjectType: 'shipment', subjectId: reefer, tempC: 4, allowedMinC: -50, allowedMaxC: 50, recordedAt: new Date().toISOString() }) });
      expect(forged.status).toBe(422);
      const why = JSON.stringify(await forged.json());
      expect(why).toContain('VALIDATION_FAILED'); expect(why).toMatch(/allowedMinC/); expect(why).toMatch(/recordedAt/);
      const m = await sdk('admin1').coldChain.recordReading({ subjectType: 'shipment', subjectId: reefer, tempC: 11 });
      expect(m).toMatchObject({ band: { minC: 2, maxC: 8 }, isBreach: true, label: 'manual', opensBreach: false });
      await sdk('admin1').coldChain.recordReading({ subjectType: 'shipment', subjectId: reefer, tempC: 12 });   // a SECOND manual excursion
      expect(await n(`SELECT count(*) n FROM cold_chain_breaches WHERE subject_id=$1`, [reefer])).toBe(0);    // a manual reading never opens one
      // a forged band on a direct insert (the superuser — as a definer path would) is OVERWRITTEN by the store's band
      const f = await q1(`INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, source, band_min_c, band_max_c)
                          VALUES ($1,'shipment',$2, 5, now(), 'manual', -40, 40) RETURNING band_min_c::float8 mn, band_max_c::float8 mx, is_breach`, [T, reefer]);
      expect(f).toEqual({ mn: 2, mx: 8, is_breach: false });
      expect(await asApp(U.admin1, `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, source, band_min_c) VALUES ($1,'shipment',$2,5,now(),'manual',-40)`, [T, reefer])).toBe('42501');
      expect(await asApp(U.admin1, `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, source) VALUES ($1,'shipment',$2,5, now() - interval '1 hour','manual')`, [T, reefer])).toBe('COLD_CHAIN_MANUAL_TIME_IS_SERVER');
    });
    it('a logger registered in 12\'s registry gets a key SHOWN ONCE (sealed at rest; a replay answers no key)', async () => {
      deviceId = (await sdk('admin1').coldChain.registerLogger({ serial: `RF-${randomUUID().slice(0, 8)}`, label: 'Van 1 reefer' }, idem())).id;
      const k = idem();
      const issued = await sdk('admin1').coldChain.issueKey(deviceId, { subjectType: 'shipment', subjectId: reefer, reason: 'Logger mounted in the reefer van' }, k);
      expect(issued.keyShown).toBe(true); expect(issued.key).toMatch(/^ccdk_/);
      key = issued.key as string; secrets.push(key);
      expect(await sdk('admin1').coldChain.issueKey(deviceId, { subjectType: 'shipment', subjectId: reefer, reason: 'Logger mounted in the reefer van' }, k)).toMatchObject({ key: null, keyShown: false });
      const row = await q1(`SELECT key_enc, key_hint FROM device_keys WHERE device_id=$1 AND status='active'`, [deviceId]);
      expect(row.key_enc).toMatch(/^v2\./); expect(row.key_enc).not.toContain(key.slice(5)); expect(row.key_hint).toBe(key.slice(-4));
      expect(await asApp(U.admin1, `SELECT key_enc FROM device_keys WHERE device_id=$1`, [deviceId])).toBe('42501');   // kv_app cannot even read the ciphertext
      expect(await n(`SELECT count(*) n FROM idempotency_keys WHERE response_body::text LIKE '%' || $1 || '%'`, [key.slice(5)])).toBe(0);   // the replay record never holds it
      expect(await n(`SELECT count(*) n FROM audit_log WHERE coalesce(new_value::text,'') || coalesce(old_value::text,'') LIKE '%' || $1 || '%'`, [key.slice(5)])).toBe(0);
    });
    it('device ingest: a valid HMAC is accepted as source=device with the store\'s band; a bad signature, a stale time and a replayed nonce are refused', async () => {
      const ok = await ingest(reading(5));
      expect(ok).toMatchObject({ status: 201, data: { accepted: true, duplicate: false } });
      expect(await q1(`SELECT source, device_id, band_min_c::float8 mn, server_recorded_at IS NOT NULL s FROM cold_chain_logs WHERE subject_id=$1 AND source='device' ORDER BY id DESC LIMIT 1`, [reefer]))
        .toEqual({ source: 'device', device_id: deviceId, mn: 2, s: true });
      expect((await ingest(reading(5), { key: `ccdk_${'A'.repeat(43)}` })).code).toBe('INGEST_SIGNATURE_INVALID');
      expect((await ingest(reading(5), { device: randomUUID() })).code).toBe('INGEST_SIGNATURE_INVALID');   // an unknown device answers the same
      expect((await ingest(reading(5), { ts: Math.floor(Date.now() / 1000) - 600 })).code).toBe('INGEST_STALE');
      const once = await ingest(reading(5));
      expect(once.status).toBe(201);
      const replay = await fetch(`${base}/v1/ingest/cold-chain/readings`, { method: 'POST', body: once.raw, headers: { 'content-type': 'application/json', 'x-kv-device': deviceId,
        'x-kv-timestamp': once.ts, 'x-kv-nonce': once.nonce, 'x-kv-signature': signIngest(key, once.ts, once.nonce, once.raw) } });
      expect(replay.status).toBe(409); expect(((await replay.json()) as { error: { code: string } }).error.code).toBe('INGEST_REPLAY');
      const withBand = await ingest({ ...reading(5), bandMinC: -40 });
      expect(withBand.code).toBe('INGEST_BODY_INVALID');   // a device can never send a band either
    });
    it('THE BREACH RULE: ONE out-of-band device reading opens nothing; the SECOND opens a breach, alerted; the first in-band reading closes it', async () => {
      await admin.query(`INSERT INTO ops_alert_rules (tenant_id, kind, rule_name, threshold, recipient_user_ids, created_by) VALUES ($1,'cold_chain_breach','Reefer breaches','{}'::jsonb,$2::jsonb,$3)`,
        [T, JSON.stringify([U.admin1]), U.admin1]).catch(() => undefined);
      expect((await ingest(reading(10.5, 22))).status).toBe(201);
      expect(await n(`SELECT count(*) n FROM cold_chain_breaches WHERE subject_id=$1`, [reefer])).toBe(0);     // one is an excursion, not a breach
      expect((await ingest(reading(11.2, 20))).status).toBe(201);
      const b = await q1(`SELECT id, peak_c::float8 pk, direction, readings_out, alert_state, closed_at FROM cold_chain_breaches WHERE subject_id=$1`, [reefer]);
      expect(b).toMatchObject({ pk: 11.2, direction: 'above', readings_out: 2, closed_at: null });
      breachId = b.id;
      expect(await n(`SELECT count(*) n FROM ops_fired_alerts WHERE dedupe_key=$1 AND rule_id IS NULL`, [`cold_chain_breach:${breachId}`])).toBe(1);
      await sdk('admin1').coldChain.recordReading({ subjectType: 'shipment', subjectId: reefer, tempC: 4 });   // a MANUAL in-band reading does not close it
      expect((await q1(`SELECT closed_at FROM cold_chain_breaches WHERE id=$1`, [breachId])).closed_at).toBeNull();
      expect((await ingest(reading(6, 2))).status).toBe(201);
      const closed = await q1(`SELECT closed_at IS NOT NULL c, duration_seconds FROM cold_chain_breaches WHERE id=$1`, [breachId]);
      expect(closed.c).toBe(true); expect(closed.duration_seconds).toBeGreaterThanOrEqual(19 * 60);
    });
    it('the buyer is offered accept / accept-with-test / reject (> 15 min out of range); the decision is the buyer\'s alone and recorded once', async () => {
      expect(await app.get(ColdChainWatchJob).sweep(relayPool, [T])).toMatchObject({ tenants: 1, offers: 1, failed: 0 });
      expect((await q1(`SELECT buyer_offer_state s, buyer_user_id u FROM cold_chain_breaches WHERE id=$1`, [breachId]))).toEqual({ s: 'offered', u: U.buyer });
      expect((await sdk('buyer').coldChain.myOffers()).items.map((x) => x.id)).toContain(breachId);
      expect(await codeOf(sdk('seller').coldChain.decideOffer(breachId, { decision: 'accept' }, idem()))).toMatch(/BREACH_DECISION_NOT_BUYER|BREACH_NOT_FOUND/);
      expect(await sdk('buyer').coldChain.decideOffer(breachId, { decision: 'accept_with_test' }, idem())).toMatchObject({ decision: 'accept_with_test', dispute: 'not_applicable' });
      expect(await q1(`SELECT buyer_offer_state s, buyer_decision d FROM cold_chain_breaches WHERE id=$1`, [breachId])).toEqual({ s: 'decided', d: 'accept_with_test' });
      expect(await codeOf(sdk('buyer').coldChain.decideOffer(breachId, { decision: 'reject', reason: 'changed my mind about it' }, idem()))).toMatch(/BREACH_OFFER_MOVE/);
    });
    it('W240: median alert → action REFUSED until an action exists, then measured; loss only where recorded; acts once; µs paging', async () => {
      const before = await sdk('admin1').coldChain.breaches({ limit: 50 });
      expect(before.window?.medianAlertToAction).toMatchObject({ kind: 'refused', code: 'NO_ACTION_RECORDED' });
      expect(before.window?.loss).toEqual({ kind: 'none_recorded', breachesWithLoss: 0 });
      await sdk('admin1').coldChain.breachAct(breachId, 'acknowledge', {}, idem());
      expect(await codeOf(sdk('admin2').coldChain.breachAct(breachId, 'acknowledge', {}, idem()))).toBe('BREACH_ACT_ONCE');
      await sdk('admin1').coldChain.breachAct(breachId, 'record_action', { note: 'Driver re-iced the box and closed the door seal' }, idem());
      await sdk('admin1').coldChain.breachAct(breachId, 'record_outcome', { outcome: 'loss_recorded', reason: 'Two paneer packs discarded at drop', lossMinor: '24000', lossCurrency: 'INR' }, idem());
      const after = await sdk('admin1').coldChain.breaches({ limit: 1 });
      expect(after.window?.medianAlertToAction).toMatchObject({ kind: 'measured', over: 1 });
      expect(after.window?.loss).toEqual({ kind: 'recorded', breachesWithLoss: 1, totals: [{ currency: 'INR', minor: '24000' }] });
      expect(after.items[0]).toMatchObject({ id: breachId, playbookRun: { kind: 'refused', code: 'NO_PLAYBOOK_OBJECT' } });
      // µs paging: a second breach (another subject), then page one by one
      const box = randomUUID();
      await sdk('admin1').coldChain.setThreshold({ subjectType: 'vaccine_box', subjectId: box, minC: 2, maxC: 8, reason: 'Vaccine box band per the label' }, idem());
      const k2 = await sdk('admin1').coldChain.issueKey(deviceId, { subjectType: 'vaccine_box', subjectId: box, reason: 'Logger moved to the vaccine box' }, idem());
      secrets.push(k2.key as string); key = k2.key as string;
      await ingest(reading(9.1)); await ingest(reading(9.3));
      const p1 = await sdk('admin1').coldChain.breaches({ limit: 1 });
      expect(p1.nextCursor).toBeTruthy(); expect(cursorInstant(p1.nextCursor as string)).toMatch(/\.\d{6}/);
      const p2 = await sdk('admin1').coldChain.breaches({ limit: 1, cursor: p1.nextCursor as string });
      expect(p2.items[0].id).not.toBe(p1.items[0].id);
      expect((await sdk('admin1').coldChain.breaches({ hours: 48, limit: 5 })).window).toMatchObject({ hours: 48 });   // `hours` kept for compatibility
    });
    it('the 15-minute silence: the job flags the logger once and alerts ("alerted, not called"); its next reading resolves it', async () => {
      await history((c) => c.query(`UPDATE twin_devices SET last_reading_at = now() - interval '20 minutes' WHERE id=$1`, [deviceId]).then(() => undefined));
      expect(await app.get(ColdChainWatchJob).sweep(relayPool, [T])).toMatchObject({ silences: 1, failed: 0 });
      expect(await app.get(ColdChainWatchJob).sweep(relayPool, [T])).toMatchObject({ silences: 0, failed: 0 });   // once per silence
      const s = await q1(`SELECT s.alert_state, a.detail->>'called' called, a.detail->>'why' why FROM cold_chain_device_silences s JOIN ops_fired_alerts a ON a.id = s.alert_id WHERE s.device_id=$1`, [deviceId]);
      expect(s).toEqual({ alert_state: 'alerted', called: 'false', why: 'NO_VOICE_CHANNEL' });
      await ingest(reading(5));
      expect(await n(`SELECT count(*) n FROM cold_chain_device_silences WHERE device_id=$1 AND resolved_at IS NULL`, [deviceId])).toBe(0);
    });
    it('the subject page and the overview read the store; the export is queued on the 6e-2 plane and its receipt says UNSIGNED', async () => {
      const subj = await sdk('admin1').coldChain.subject('shipment', reefer, { hours: 24 });
      expect(subj.band).toMatchObject({ minC: '2.00', maxC: '8.00' });
      expect(subj.trail.some((r) => r.source === 'manual') && subj.trail.some((r) => r.source === 'device')).toBe(true);
      expect(subj.refused).toMatchObject({ bothTenants: 'NO_CROSS_TENANT_SHIPMENT', autoCall: 'NO_VOICE_CHANNEL' });
      const ov = await sdk('admin1').coldChain.subjects();
      expect(ov.items.find((x) => x.subjectId === reefer)).toMatchObject({ target: { minC: '2.00' } });
      const job = await sdk('admin1').coldChain.exportTrail({ subjectType: 'shipment', subjectId: reefer, days: 30 }, idem());
      expect(job.status).toBe('queued');
      const store = new MemoryStore();
      const worker = new ExportWorker(app.get(UNIT_OF_WORK), app.get(OUTBOX_WRITER), app.get(READ_REPLICA), app.get(METRICS), app.get(DATASET_REGISTRY), store as never, app.get(ExportJobRepository));
      expect(await worker.generate({ id: job.id, tenantId: T } as never)).toBe('ready');
      const ready = await sdk('admin1').exportsPlane.get(job.id);
      expect(ready.receipt?.notes.join('\n')).toContain('unsigned — signing is a founder-physical key; the sha256 is printed');
      expect(ready.receipt?.sha256).toMatch(/^[0-9a-f]{64}$/);
      const breaches = await sdk('admin1').coldChain.exportBreaches({ months: 12 }, idem());
      expect(await worker.generate({ id: breaches.id, tenantId: T } as never)).toBe('ready');
      expect((await sdk('admin1').exportsPlane.get(breaches.id)).receipt?.rowCount).toBeGreaterThanOrEqual(2);
    });
  });

  /* ═══════════════════════════════════════════ NEVER LOGGED ═══════════════════════════════════════════ */
  it('no OTP code and no device key ever reached a log line', () => {
    expect(secrets.length).toBeGreaterThanOrEqual(5);
    const leaked = secrets.filter((s) => logged.some((l) => l.includes(s)));
    expect(leaked).toEqual([]);
  });
});
