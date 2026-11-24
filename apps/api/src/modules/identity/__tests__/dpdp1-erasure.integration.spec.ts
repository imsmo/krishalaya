// PC-56 DPDP-1 · THE ERASURE, END TO END, AS PRODUCTION RUNS IT (real Postgres; gated on DATABASE_URL + DATABASE_ADMIN_URL).
//
//   fixtures (superuser, and money through the app's own wallet client as kv_app — Law 2)
//     → the worker's hourly cooling job, on a client LOGGED IN as kv_relay
//     → the `identity.erasure_ready` event, relayed by the REAL OutboxDispatcher on a kv_relay pool, to the REAL ErasureReadyHandler
//     → migration 0245's wall.
// Asserts: every personal field gone; business records still there and consistent (ledger zero-sum and the person's entries byte-
// identical, order totals unchanged); a second run is a no-op; the old session cannot refresh and an old access token is refused by
// the posture cut-off; the request is completed with its summary and one evidence row per matrix class; an audit row with no PII.
// Separately: a person with wallet money and an open order is BLOCKED with reasons, told once, and completes after the blockers clear.
// And the COVERAGE GATE: every table that references users(id) is decided (matrix or reference-only).
import { randomUUID, createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, ensureUnitCurrency } from '../../../../test/helpers/fixtures';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { platform, PlatformAccount, userMain } from '../../../core/wallet/account-codes';
import { postureVerdict } from '../../../core/auth/session-posture.guard';
import { ErasureReadyHandler } from '../events/handlers/erasure-ready.handler';
import { ERASURE_MATRIX, ERASURE_REFERENCE_ONLY, ERASED_TOMBSTONE } from '../domain/erasure.rules';
// the worker's job itself, not a copy of its SQL
import { dpdpErasureCoolingJob } from '../../../../../worker/src/jobs/dpdp-erasure-cooling.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
jest.setTimeout(120_000);

const metrics = { inc: () => undefined, observe: () => undefined, gauge: () => undefined } as any;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

run('PC-56 DPDP-1 · DPDP erasure executor (integration, real Postgres, production roles)', () => {
  let admin: Pool; let app: Pool; let relay: Pool;
  const wallet = new InProcessWalletClient(new LedgerRepository());
  let T1: string; let T2: string; let productId: string; let categoryId: string;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    app = new Pool({ connectionString: APP_URL });
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) {
      await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);   // as db/local/local-login-roles.sql
      const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev'; relayUrl = u.toString();
    }
    relay = new Pool({ connectionString: relayUrl });
    const who = (await relay.query(`SELECT current_user AS u`)).rows[0].u;
    expect(who).toBe('kv_relay');
    T1 = await makeTenant(admin, randomUUID(), 'DPDP One');
    T2 = await makeTenant(admin, randomUUID(), 'DPDP Two');
    await ensureUnitCurrency(admin, 'quintal');
    categoryId = randomUUID(); const code = `d${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Wheat',$3::ltree,1,true)`, [categoryId, code, code]);
    productId = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Wheat','quintal',$3,true, to_tsvector('simple','wheat'))`, [productId, categoryId, T1]);
  });
  afterAll(async () => { await Promise.all([admin?.end(), app?.end(), relay?.end()]); });

  /* ───────────────────────────── helpers ───────────────────────────── */
  const q = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows;
  const one = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const num = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  async function replica(fn: (c: PoolClient) => Promise<void>): Promise<void> {   // fixture rows whose guards are not this spec's subject
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  /** Money moves through the app's own wallet client, as kv_app in a tenant transaction (Law 2 — never a hand-written ledger row). */
  async function post(tenantId: string, txnType: string, key: string, legs: { account: any; amountMinor: bigint }[]): Promise<void> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const tx: TxContext = { query: (s, p) => c.query(s, p as any) as any, tenantId, userId: 'system' };
      await wallet.post(tx, { tenantId, txnType, idempotencyKey: key, initiatedBy: 'system', legs });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function makePerson(name: string): Promise<string> {
    const id = uuidv7();
    await admin.query(`INSERT INTO users (id, phone, full_name, email, dob, gender, language_code, aadhaar_last4, aadhaar_vault_ref, pan_vault_ref, phone_verified_at)
      VALUES ($1,$2,$3,$4,'1980-02-03','female','hi','1234','vault://aadhaar/x','vault://pan/y', now())`,
      [id, '+9197' + String(Math.floor(10000000 + Math.random() * 89999999)), name, `${name.toLowerCase().replace(/\s/g, '')}@example.in`]);
    for (const t of [T1, T2]) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at, role_data)
        SELECT $1, $2, r.id, true, now(), '{"village":"Kheda"}'::jsonb FROM roles r WHERE r.code='farmer'`, [id, t]);
    }
    return id;
  }
  async function makeListing(sellerId: string, tenantId: string, status = 'published'): Promise<string> {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, description, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility, lat, lng, pincode)
       VALUES ($1,$2,$3,$4,$5,'Sharbati wheat from Ramesh farm','Grown on my field behind the temple',100,100,1,'quintal',50000,'INR',$6,'public',22.75,72.68,'387411')`,
      [id, tenantId, sellerId, productId, categoryId, status]);
    return id;
  }
  async function makeOrder(tenantId: string, buyer: string, seller: string, listingId: string, status: string, total: bigint): Promise<string> {
    const id = uuidv7();
    await replica(async (c) => {
      await c.query(
        `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, status, version, created_at)
         VALUES ($1,$2,$3,$4,$5,'direct','INR',$6,0,0,$6,$7,1, uuid_v7_time($1))`, [id, tenantId, `KVD-${id.slice(0, 12)}`, buyer, seller, total.toString(), status]);
      await c.query(
        `INSERT INTO order_items (order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot, quantity, unit_code, unit_price_minor, line_total_minor)
         SELECT $1, o.created_at, $2, $3, $4, 'Wheat', 1, 'quintal', $5, $5 FROM orders o WHERE o.id=$1`, [id, tenantId, listingId, productId, total.toString()]);
    });
    return id;
  }
  async function makeMedia(uploader: string, tenantId: string | null, kind = 'image'): Promise<string> {
    const id = randomUUID();
    await admin.query(`INSERT INTO media_assets (id, tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status)
      VALUES ($1,$2,$3,$4,$5,'image/jpeg',1000,$6,'clean')`, [id, tenantId, uploader, kind, `t/${tenantId ?? 'platform'}/${kind}/${id}.jpg`, sha(id)]);
    return id;
  }
  async function makeDsr(userId: string): Promise<string> {
    const id = uuidv7();
    await admin.query(`INSERT INTO data_subject_requests (id, user_id, request_type, status, cooling_ends_at, acknowledged_at)
      VALUES ($1,$2,'erasure','open', now() - interval '1 day', now() - interval '91 days')`, [id, userId]);
    return id;
  }
  /** The worker's cooling job, on a client logged in as kv_relay (the worker's production role). */
  async function runCoolingJob(): Promise<void> {
    const c = await relay.connect();
    try { await dpdpErasureCoolingJob.run({ client: c, metrics }); } finally { c.release(); }
  }
  /** Relay every pending `identity.erasure_ready` event for this person through the REAL dispatcher, as kv_relay. */
  async function relayErasure(userId: string): Promise<string[]> {
    const reg = new OutboxHandlerRegistry(); reg.register(new ErasureReadyHandler());
    const d = new OutboxDispatcher(relay, reg, metrics);
    const ids = (await q(`SELECT id::text FROM outbox_events WHERE status='pending' AND event_type='identity.erasure_ready' AND aggregate_id=$1 ORDER BY id`, [userId])).map((r) => r.id);
    const out: string[] = [];
    for (const id of ids) { const r = await d.relayById(id); out.push(r.status); if (r.status === 'failed') throw r.error; }
    return out;
  }
  const ledgerZeroSum = async () => (await one(`SELECT coalesce(sum(amount_minor),0)::text AS s FROM ledger_entries`)).s;
  const ledgerFingerprint = async (userId: string) => sha(JSON.stringify(await q(
    `SELECT le.id, le.txn_id, le.amount_minor::text, le.balance_after_minor::text, le.entry_hash FROM ledger_entries le JOIN wallet_accounts w ON w.id = le.account_id
      WHERE w.owner_kind='user' AND w.owner_user_id=$1 ORDER BY le.id`, [userId])));

  /* ───────────────────────────── the coverage gate ───────────────────────────── */
  it('COVERAGE: every table that references users(id) is decided — in the erasure matrix or the reference-only list', async () => {
    const rows = await q(`
      SELECT DISTINCT r.relname AS t FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
       WHERE c.contype='f' AND c.confrelid='users'::regclass AND NOT r.relispartition AND r.relname <> 'users'
      UNION
      SELECT DISTINCT c.relname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
         AND a.attname ~ '(user_id|user$|_by$|recipient|author|sender|owner|actor)' AND a.attname NOT IN ('created_by','updated_by')`);
    const decided = new Set([...Object.keys(ERASURE_MATRIX), ...ERASURE_REFERENCE_ONLY, 'users']);
    const undecided = rows.map((r) => r.t as string).filter((t) => !decided.has(t)).sort();
    expect(undecided).toEqual([]);
  });

  it('the executor is reachable by kv_relay ONLY (EXECUTE), and kv_relay gained no table privilege for it', async () => {
    for (const f of ['kv_dsr_erasure_claim(uuid)', 'kv_dsr_erasure_block(uuid,text[],uuid)', 'kv_dsr_erasure_execute(uuid,uuid)']) {
      expect((await one(`SELECT has_function_privilege('kv_relay', $1, 'EXECUTE') AS v`, [f])).v).toBe(true);
      expect((await one(`SELECT has_function_privilege('kv_app', $1, 'EXECUTE') AS v`, [f])).v).toBe(false);
    }
    expect((await one(`SELECT has_function_privilege('kv_relay', 'kv_dsr_erasure_figures(uuid)', 'EXECUTE') AS v`)).v).toBe(false);
    // the erasure writes tables kv_relay itself may NOT write — so it can only be reaching them through the wall (no grant was widened)
    for (const t of ['users', 'kyc_documents', 'bank_accounts', 'dsr_erasure_actions']) {
      expect((await one(`SELECT has_table_privilege('kv_relay', $1, 'UPDATE') OR has_table_privilege('kv_relay', $1, 'DELETE') OR has_table_privilege('kv_relay', $1, 'INSERT') AS v`, [t])).v).toBe(false);
    }
  });

  /* ───────────────────────────── the fixture person ───────────────────────────── */
  it('ERASES a realistic person across two organisations — personal data gone, legal records kept and consistent, idempotent', async () => {
    const P = await makePerson('Ramesh Patel');
    const B = await makePerson('Other Buyer');
    // profile photo, addresses, devices, sessions, sign-in log, prefs
    const photo = await makeMedia(P, T1);
    await admin.query(`UPDATE users SET photo_media_id=$2 WHERE id=$1`, [P, photo]);
    const addr = randomUUID();
    await admin.query(`INSERT INTO addresses (id, user_id, tenant_id, line1, line2, village, pincode, country_code, lat, lng, contact_name, contact_phone, delivery_note, is_default)
      VALUES ($1,$2,$3,'12 Temple Road','Near the well','Kheda','387411','IN',22.75,72.68,'Ramesh','+919812345678','Ring twice',true)`, [addr, P, T1]);
    const dev = randomUUID();
    await admin.query(`INSERT INTO devices (id, user_id, fingerprint, platform, model, push_token) VALUES ($1,$2,'fp-1','android','Redmi 9','push-token-1')`, [dev, P]);
    await admin.query(`INSERT INTO push_devices (user_id, platform, token) VALUES ($1,'android','fcm-token-1')`, [P]);
    await admin.query(`INSERT INTO sessions (user_id, device_id, refresh_token_hash, ip, expires_at, realm) VALUES ($1,$2,$3,'10.1.2.3', now() + interval '30 days','tenant')`, [P, dev, sha('refresh-P')]);
    await admin.query(`INSERT INTO login_events (user_id, phone, succeeded, method, ip, device_fingerprint) VALUES ($1,'+919700000001',true,'otp','10.1.2.3','fp-1')`, [P]);
    await admin.query(`INSERT INTO notification_preferences (user_id, event_code, channel, is_enabled) VALUES ($1,'order.created','sms',false)`, [P]);
    await admin.query(`INSERT INTO saved_searches (tenant_id, user_id, default_name, query) VALUES ($1,$2,'wheat near Kheda','{"q":"wheat"}')`, [T1, P]);
    // consents (the LOG is evidence: kept)
    await admin.query(`INSERT INTO consents (user_id, purpose_code, version, granted, channel) VALUES ($1,'terms','v1',true,'app'), ($1,'marketing','v1',true,'app')`, [P]);
    // KYC (document + scan) and a bank account
    const kycScan = await makeMedia(P, T1, 'document');
    await replica(async (c) => {
      await c.query(`INSERT INTO kyc_documents (tenant_id, user_id, doc_type_id, media_id, doc_no_masked, issued_by, verify_payload, status, subject_kind, doc_type_code, submitted_by, last_decision)
        SELECT $1, $2, lv.id, $3, 'XXXX-XXXX-1234', 'UIDAI', '{"name":"Ramesh Patel"}'::jsonb, 'pending', 'user', 'aadhaar', $2, 'submit'
          FROM lookup_values lv WHERE lv.type_code='doc_type' AND lv.code='aadhaar' AND lv.tenant_id IS NULL LIMIT 1`, [T1, P, kycScan]);
    });
    await admin.query(`INSERT INTO bank_accounts (user_id, tenant_id, account_kind, upi_id, account_last4, ifsc, holder_name, vault_ref, is_primary)
      VALUES ($1,$2,'bank','ramesh@upi','4321','SBIN0001234','Ramesh Patel','vault://fund/acc_1',true)`, [P, T1]);
    // cart
    const L0 = await makeListing(B, T1);
    const cart = randomUUID();
    await admin.query(`INSERT INTO carts (id, tenant_id, user_id, status) VALUES ($1,$2,$3,'active')`, [cart, T1, P]);
    await admin.query(`INSERT INTO cart_items (cart_id, listing_id, quantity, added_price_minor) VALUES ($1,$2,2,50000)`, [cart, L0]);
    // listings: one never ordered (with a photo), one sold in a COMPLETED, PAID order (seller P, buyer B) with the money settled + paid out
    const L1 = await makeListing(P, T1);
    const L1photo = await makeMedia(P, T1);
    await admin.query(`INSERT INTO media_links (media_id, entity_type, entity_id, purpose, sort_order) VALUES ($1,'listing',$2,'gallery',0)`, [L1photo, L1]);
    const L2 = await makeListing(P, T1, 'sold_out');
    const O1 = await makeOrder(T1, B, P, L2, 'completed', 452000n);
    await admin.query(`INSERT INTO payments (tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key, webhook_payload)
      SELECT $1, $2, lv.id, 'order', $3, 452000, 'INR', 'success', 'sandbox', $4, '{"contact":"+919811111111","email":"buyer@example.in"}'::jsonb
        FROM lookup_values lv WHERE lv.type_code='payment_purpose' AND lv.tenant_id IS NULL ORDER BY (lv.code='order') DESC LIMIT 1`, [T1, B, O1, `dpdp-pay-${O1}`]);
    await post(T1, 'order_payment', `dpdp-fund:${O1}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: 452000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -452000n }]);
    await post(T1, 'escrow_release', `dpdp-settle:${O1}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: -452000n }, { account: userMain(P), amountMinor: 452000n }]);
    await post(T1, 'payout', `dpdp-payout:${O1}`, [{ account: userMain(P), amountMinor: -452000n }, { account: platform(PlatformAccount.Payouts), amountMinor: 452000n }]);
    // P as a BUYER in the second organisation: a completed order they reviewed
    const LB = await makeListing(B, T2);
    const O2 = await makeOrder(T2, P, B, LB, 'completed', 90000n);
    await admin.query(`INSERT INTO payments (tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key, webhook_payload)
      SELECT $1, $2, lv.id, 'order', $3, 90000, 'INR', 'success', 'sandbox', $4, '{"contact":"+919700000001","email":"rameshpatel@example.in","vpa":"ramesh@upi"}'::jsonb
        FROM lookup_values lv WHERE lv.type_code='payment_purpose' AND lv.tenant_id IS NULL ORDER BY (lv.code='order') DESC LIMIT 1`, [T2, P, O2, `dpdp-pay-${O2}`]);
    await admin.query(`INSERT INTO reviews (tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags, is_verified_purchase, status)
      VALUES ($1,$2,$3,'seller',$4,4,'{"quality":4}'::jsonb,'Good wheat, Ramesh from Kheda recommends','["fresh"]'::jsonb,true,'published')`, [T2, O2, P, B]);
    await admin.query(`INSERT INTO reviews (tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags, is_verified_purchase, status, seller_response)
      VALUES ($1,$2,$3,'seller',$4,5,'{}'::jsonb,'Great seller','[]'::jsonb,true,'published','Thank you — Ramesh, 98xxxx')`, [T1, O1, B, P]);
    // chat: P and B on one conversation
    const conv = randomUUID();
    await admin.query(`INSERT INTO conversations (id, tenant_id, context_type, context_id, is_locked) VALUES ($1,$2,'order',$3,false)`, [conv, T1, O1]);
    await admin.query(`INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1,$2,'seller'), ($1,$3,'buyer')`, [conv, P, B]);
    const voice = await makeMedia(P, T1, 'audio');
    await admin.query(`INSERT INTO messages (conversation_id, tenant_id, sender_user_id, body, voice_media_id, is_ai_generated, is_flagged) VALUES
      ($1,$2,$3,'Call me on 9812345678, I live behind the temple',$4,false,false),
      ($1,$2,$5,'Thanks, received the wheat',NULL,false,false)`, [conv, T1, P, voice, B]);
    await admin.query(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, payload, status) VALUES ($1,$2,'order.completed','inapp','{"name":"Ramesh"}'::jsonb,'sent')`, [T1, P]);

    // ── baselines ──
    const sumBefore = await ledgerZeroSum();
    expect(sumBefore).toBe('0');
    const fpBefore = await ledgerFingerprint(P);
    const ordersBefore = await q(`SELECT id, total_minor::text, subtotal_minor::text, status::text FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [[O1, O2]]);
    const accessTokenIatSec = Math.floor(Date.now() / 1000) - 60;   // a token minted a minute before the erasure

    // ── the request; the cooling job (kv_relay); the relay (kv_relay) ──
    const dsr = await makeDsr(P);
    await runCoolingJob();
    expect((await one(`SELECT status FROM data_subject_requests WHERE id=$1`, [dsr])).status).toBe('in_progress');
    expect(await relayErasure(P)).toEqual(['published']);

    // ── the request: completed, with its summary and evidence ──
    const d = await one(`SELECT status, completed_at, erasure_summary, blocked_reasons FROM data_subject_requests WHERE id=$1`, [dsr]);
    expect(d.status).toBe('completed');
    expect(d.completed_at).not.toBeNull();
    expect(d.blocked_reasons).toBeNull();
    const s = d.erasure_summary;
    expect(Object.keys(s.classes).sort()).toEqual(Object.keys(ERASURE_MATRIX).sort());
    expect(s.unmappedRetentionClasses).toEqual([]);
    expect(s.mediaPendingStoragePurge).toBe(4);   // photo, KYC scan, voice note, L1's photo
    expect(JSON.stringify(s)).not.toMatch(/Ramesh|Kheda|98123|example\.in|Temple/i);   // the evidence carries no personal data
    const ev = await q(`SELECT data_class, action FROM dsr_erasure_actions WHERE request_id=$1`, [dsr]);
    expect(ev.length).toBe(Object.keys(ERASURE_MATRIX).length);
    for (const r of ev) expect(r.action).toBe(ERASURE_MATRIX[r.data_class].action);
    expect(s.classes.sessions.rows).toBe(1);
    expect(s.classes.messages.rows).toBe(1);
    expect(s.classes.consents).toEqual({ action: 'blocked_by_law', rows: 2 });
    const audit = await q(`SELECT actor_user_id, actor_role, new_value::text AS nv FROM audit_log WHERE entity_id=$1 AND action='dsr.erasure_completed'`, [dsr]);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_role).toBe('system');
    expect(audit[0].actor_user_id).toBeNull();
    expect(audit[0].nv).not.toMatch(/Ramesh|Kheda|98123/);

    // ── the person: a tombstone ──
    const u = await one(`SELECT * FROM users WHERE id=$1`, [P]);
    expect(u.phone).toBe(`erased:${P}`);
    for (const k of ['full_name', 'email', 'dob', 'gender', 'photo_media_id', 'aadhaar_last4', 'aadhaar_vault_ref', 'pan_vault_ref', 'phone_verified_at']) expect(u[k]).toBeNull();
    expect(u.status).toBe('soft_deleted');
    expect(await num(`SELECT count(*) n FROM user_tenant_roles WHERE user_id=$1 AND (is_active OR role_data <> '{}'::jsonb OR revoked_at IS NULL)`, [P])).toBe(0);
    const a = await one(`SELECT line1, line2, village, pincode, lat, lng, contact_name, contact_phone, delivery_note, deleted_at FROM addresses WHERE id=$1`, [addr]);
    expect(a).toMatchObject({ line1: ERASED_TOMBSTONE, line2: null, village: null, pincode: null, lat: null, lng: null, contact_name: null, contact_phone: null, delivery_note: null });
    for (const t of ['devices', 'push_devices', 'sessions', 'login_events', 'notification_preferences', 'saved_searches', 'carts', 'notifications']) {
      expect(await num(`SELECT count(*) n FROM ${t} WHERE user_id=$1`, [P])).toBe(0);
    }
    expect(await num(`SELECT count(*) n FROM cart_items WHERE cart_id=$1`, [cart])).toBe(0);
    const k = await one(`SELECT doc_no_masked, issued_by, verify_payload, deleted_at FROM kyc_documents WHERE user_id=$1`, [P]);
    expect(k).toMatchObject({ doc_no_masked: null, issued_by: null, verify_payload: null });
    expect(k.deleted_at).not.toBeNull();
    const ba = await one(`SELECT vault_ref, upi_id, account_last4, ifsc, holder_name, deleted_at FROM bank_accounts WHERE user_id=$1`, [P]);
    expect(ba.vault_ref).toMatch(/^erased:/);
    expect(ba).toMatchObject({ upi_id: null, account_last4: null, ifsc: null, holder_name: null });
    const media = await q(`SELECT id, deleted_at, storage_purge_requested_at, storage_purge_reason FROM media_assets WHERE id = ANY($1::uuid[])`, [[photo, kycScan, voice, L1photo]]);
    expect(media).toHaveLength(4);
    for (const m of media) { expect(m.deleted_at).not.toBeNull(); expect(m.storage_purge_reason).toBe('dsr_erasure'); }
    // consents kept (evidence), the person's words tombstoned, the other party's kept
    expect(await num(`SELECT count(*) n FROM consents WHERE user_id=$1`, [P])).toBe(2);
    const msgs = await q(`SELECT sender_user_id, body, voice_media_id FROM messages WHERE conversation_id=$1 ORDER BY created_at, id`, [conv]);
    expect(msgs.find((m) => m.sender_user_id === P)).toMatchObject({ body: ERASED_TOMBSTONE, voice_media_id: null });
    expect(msgs.find((m) => m.sender_user_id === B).body).toBe('Thanks, received the wheat');
    const rv = await one(`SELECT body, tags, stars, sub_ratings FROM reviews WHERE reviewer_user_id=$1`, [P]);
    expect(rv).toMatchObject({ body: ERASED_TOMBSTONE, tags: [], stars: 4, sub_ratings: { quality: 4 } });
    const rOfP = await one(`SELECT body, seller_response FROM reviews WHERE reviewer_user_id=$1 AND target_id=$2`, [B, P]);
    expect(rOfP).toEqual({ body: 'Great seller', seller_response: ERASED_TOMBSTONE });
    // listings: archived; the never-ordered one lost its title + photo; the sold one keeps its title (the order's record)
    const l1 = await one(`SELECT status::text, title, description, lat, pincode, deleted_at FROM listings WHERE id=$1`, [L1]);
    expect(l1).toMatchObject({ status: 'archived', title: ERASED_TOMBSTONE, description: null, lat: null, pincode: null });
    const l2 = await one(`SELECT status::text, title, description, lat FROM listings WHERE id=$1`, [L2]);
    expect(l2).toEqual({ status: 'archived', title: 'Sharbati wheat from Ramesh farm', description: null, lat: null });
    expect(await num(`SELECT count(*) n FROM media_links WHERE entity_id=$1`, [L1])).toBe(0);
    expect(await num(`SELECT count(*) n FROM outbox_events WHERE event_type='listing.status_changed' AND aggregate_id = ANY($1::uuid[]) AND payload->>'to'='archived'`, [[L1, L2]])).toBe(2);
    // P's own payment (as the buyer of O2): the gateway body is gone, the amount stays; B's payment (O1) is not P's and is untouched
    expect(await one(`SELECT webhook_payload, amount_minor::text FROM payments WHERE reference_id=$1`, [O2])).toEqual({ webhook_payload: null, amount_minor: '90000' });
    expect((await one(`SELECT webhook_payload FROM payments WHERE reference_id=$1`, [O1])).webhook_payload).not.toBeNull();

    // ── the business records: still there, still consistent ──
    expect(await ledgerZeroSum()).toBe(sumBefore);
    expect(await ledgerFingerprint(P)).toBe(fpBefore);
    expect(await q(`SELECT id, total_minor::text, subtotal_minor::text, status::text FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id`, [[O1, O2]])).toEqual(ordersBefore);
    expect(await num(`SELECT count(*) n FROM wallet_accounts WHERE owner_user_id=$1 AND cached_balance_minor = 0`, [P])).toBeGreaterThan(0);

    // ── the old tokens: the refresh session is gone; an access token issued before the cut-off is refused in BOTH organisations ──
    expect(await num(`SELECT count(*) n FROM sessions WHERE refresh_token_hash=$1`, [sha('refresh-P')])).toBe(0);
    for (const t of [T1, T2]) {
      const cut = await one(`SELECT (extract(epoch from revoked_after) * 1000)::bigint::text AS at FROM tenant_session_revocations WHERE tenant_id=$1 AND user_id=$2`, [t, P]);
      expect(cut).toBeDefined();
      expect(postureVerdict({ issuedAtSec: accessTokenIatSec, cutoffMs: Number(cut.at), isStaff: false, required: false, confirmed: true, exempt: false })).toBe('SESSION_REVOKED');
    }

    // ── a second run is a no-op ──
    const snap = async () => sha(JSON.stringify([
      await one(`SELECT * FROM users WHERE id=$1`, [P]), await one(`SELECT status, erasure_summary, completed_at FROM data_subject_requests WHERE id=$1`, [dsr]),
      await num(`SELECT count(*) n FROM dsr_erasure_actions WHERE request_id=$1`, [dsr]), await num(`SELECT count(*) n FROM audit_log WHERE entity_id=$1`, [dsr]),
      await num(`SELECT count(*) n FROM outbox_events WHERE aggregate_id = ANY($1::uuid[])`, [[L1, L2]]),
    ]));
    const before2 = await snap();
    await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'user',$2,'identity.erasure_ready',$3::jsonb)`,
      [T1, P, JSON.stringify({ v: 1, dsrId: dsr, userId: P })]);
    expect(await relayErasure(P)).toEqual(['published']);
    await runCoolingJob();                                               // and the clock does not re-drive a completed request
    expect(await num(`SELECT count(*) n FROM outbox_events WHERE status='pending' AND event_type='identity.erasure_ready' AND aggregate_id=$1`, [P])).toBe(0);
    expect(await snap()).toBe(before2);

    // the counterpart is untouched
    const b = await one(`SELECT full_name, status FROM users WHERE id=$1`, [B]);
    expect(b).toEqual({ full_name: 'Other Buyer', status: 'active' });
  });

  /* ───────────────────────────── blocked, then cleared ───────────────────────────── */
  it('BLOCKS a person with wallet money and an open order (reasons, told once), never touches money, and completes after both clear', async () => {
    const Q = await makePerson('Sita Devi');
    const S = await makePerson('Some Seller');
    const LQ = await makeListing(S, T1);
    const OQ = await makeOrder(T1, Q, S, LQ, 'confirmed', 30000n);
    // money in Q's wallet (a refund credited, through the wallet client)
    await post(T1, 'order_payment', `dpdpq-fund:${OQ}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: 12345n }, { account: platform(PlatformAccount.Gateway), amountMinor: -12345n }]);
    await post(T1, 'refund', `dpdpq-refund:${OQ}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: -12345n }, { account: userMain(Q), amountMinor: 12345n }]);
    const fp = await ledgerFingerprint(Q);
    const dsr = await makeDsr(Q);

    await runCoolingJob();
    expect(await relayErasure(Q)).toEqual(['published']);
    let d = await one(`SELECT status, blocked_reasons, erasure_summary, erasure_attempts FROM data_subject_requests WHERE id=$1`, [dsr]);
    expect(d).toMatchObject({ status: 'blocked', blocked_reasons: ['open_orders', 'wallet_balance'], erasure_summary: null, erasure_attempts: 1 });
    expect((await one(`SELECT full_name FROM users WHERE id=$1`, [Q])).full_name).toBe('Sita Devi');      // nothing erased
    expect(await ledgerFingerprint(Q)).toBe(fp);                                                             // money untouched
    expect((await one(`SELECT cached_balance_minor::text AS b FROM wallet_accounts WHERE owner_user_id=$1 AND account_code='main'`, [Q])).b).toBe('12345');
    const notices = async () => q(`SELECT payload FROM outbox_events WHERE event_type='identity.erasure_blocked' AND aggregate_id=$1`, [dsr]);
    expect(await notices()).toEqual([{ payload: { v: 1, dsrId: dsr, userId: Q, reasons: ['open_orders', 'wallet_balance'] } }]);
    expect(await num(`SELECT count(*) n FROM audit_log WHERE entity_id=$1 AND action='dsr.erasure_blocked' AND actor_role='system'`, [dsr])).toBe(1);

    // the hourly clock re-drives it (an hour later); same blockers → NOT told again
    await admin.query(`UPDATE data_subject_requests SET last_attempt_at = now() - interval '2 hours' WHERE id=$1`, [dsr]);
    await runCoolingJob();
    expect(await relayErasure(Q)).toEqual(['published']);
    d = await one(`SELECT status, erasure_attempts FROM data_subject_requests WHERE id=$1`, [dsr]);
    expect(d).toEqual({ status: 'blocked', erasure_attempts: 2 });
    expect(await notices()).toHaveLength(1);

    // the order closes; the money is paid out (through the wallet) — the blockers clear on their own terms
    await replica(async (c) => { await c.query(`UPDATE orders SET status='cancelled' WHERE id=$1`, [OQ]); });
    await post(T1, 'payout', `dpdpq-payout:${OQ}`, [{ account: userMain(Q), amountMinor: -12345n }, { account: platform(PlatformAccount.Payouts), amountMinor: 12345n }]);
    await admin.query(`UPDATE data_subject_requests SET last_attempt_at = now() - interval '2 hours' WHERE id=$1`, [dsr]);
    await runCoolingJob();
    expect(await relayErasure(Q)).toEqual(['published']);
    d = await one(`SELECT status, blocked_reasons, erasure_summary IS NOT NULL AS has_summary FROM data_subject_requests WHERE id=$1`, [dsr]);
    expect(d).toEqual({ status: 'completed', blocked_reasons: null, has_summary: true });
    const u = await one(`SELECT full_name, phone, status FROM users WHERE id=$1`, [Q]);
    expect(u).toEqual({ full_name: null, phone: `erased:${Q}`, status: 'soft_deleted' });
    expect(await ledgerZeroSum()).toBe('0');
  });

  it('GUARDED rows: invites, a setup-call request, 2FA, a desk seat and a partner membership move only the way their guards allow', async () => {
    const G = await makePerson('Gita Ben');
    const inviter = await makePerson('Org Admin');
    const checker = await makePerson('Org Checker');
    const deskId = randomUUID(); const partnerId = randomUUID();
    // rows as their own flows leave them (inserted with triggers off: their BIRTH rules are not this spec's subject — their MOVES are)
    await replica(async (c) => {
      await c.query(`INSERT INTO staff_invites (tenant_id, phone, role_id, desk_ids, invited_by, language_code, channel, token_hash, expires_at, status, accepted_user_id, accepted_at)
        SELECT $1, '+919812300001', r.id, '{}', $2, 'hi', 'sms', $3, now() + interval '7 days', 'accepted', $4, now() FROM roles r WHERE r.code='support_agent'`, [T1, inviter, sha('inv-g'), G]);
      await c.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, sla, is_active) VALUES ($1, $2, 'Bank', 'bank', '{}'::jsonb, true)`, [partnerId, `p${partnerId.slice(0, 8)}`]);
      await c.query(`INSERT INTO partner_invites (partner_id, phone, role_id, invited_by, language_code, token_hash, expires_at, status, accepted_user_id, accepted_at)
        SELECT $1, '+919812300001', r.id, $2, 'hi', $3, now() + interval '7 days', 'accepted', $4, now() FROM roles r WHERE r.code='partner_viewer'`, [partnerId, inviter, sha('pinv-g'), G]);
      await c.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code='partner_viewer'`, [G, partnerId]);
      await c.query(`INSERT INTO setup_call_requests (tenant_id, requested_by, preferred_slot_start, preferred_slot_end, language_code, phone_masked, notes, status)
        VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 1 hour', 'hi', '••••0001', 'Call after 6pm, ask for Gita', 'requested')`, [T1, G]);
      await c.query(`INSERT INTO user_totp (user_id, secret_enc, enrolled_at, confirmed_at, updated_at) VALUES ($1, 'v2.0123abcd.c2VhbGVk.dGFn', now(), now(), now())`, [G]);
      await c.query(`INSERT INTO user_recovery_codes (user_id, batch_id, code_hash) VALUES ($1, $2, $3)`, [G, randomUUID(), sha('rc-g')]);
      await c.query(`INSERT INTO desks (id, tenant_id, code, name, status, created_by, confirmed_by, created_by_proposal) VALUES ($1,$2,$3,'KYC desk','active',$4,$5,$6)`,
        [deskId, T1, `d${deskId.slice(0, 8)}`, inviter, checker, randomUUID()]);
      await c.query(`INSERT INTO desk_members (tenant_id, desk_id, user_id, added_by, added_at) VALUES ($1,$2,$3,$4, now())`, [T1, deskId, G, inviter]);
    });
    const dsr = await makeDsr(G);
    await runCoolingJob();
    expect(await relayErasure(G)).toEqual(['published']);
    expect((await one(`SELECT status FROM data_subject_requests WHERE id=$1`, [dsr])).status).toBe('completed');
    expect((await one(`SELECT phone, status FROM staff_invites WHERE accepted_user_id=$1`, [G]))).toEqual({ phone: '+10000000000', status: 'accepted' });
    expect((await one(`SELECT phone FROM partner_invites WHERE accepted_user_id=$1`, [G])).phone).toBe('+10000000000');
    expect(await one(`SELECT phone_masked, notes, status FROM setup_call_requests WHERE requested_by=$1`, [G])).toEqual({ phone_masked: '••••0000', notes: null, status: 'requested' });
    expect((await one(`SELECT disabled_at IS NOT NULL AS off FROM user_totp WHERE user_id=$1`, [G])).off).toBe(true);
    expect(await num(`SELECT count(*) n FROM user_recovery_codes WHERE user_id=$1 AND retired_at IS NULL`, [G])).toBe(0);
    expect(await num(`SELECT count(*) n FROM desk_members WHERE user_id=$1 AND removed_at IS NULL`, [G])).toBe(0);
    expect(await num(`SELECT count(*) n FROM partner_memberships WHERE user_id=$1 AND is_active`, [G])).toBe(0);
    // the injected clause admits ONLY the erasure move: a live person's invite phone is still immutable
    const live = await makePerson('Live Person');
    await replica(async (c) => {
      await c.query(`INSERT INTO staff_invites (tenant_id, phone, role_id, desk_ids, invited_by, language_code, channel, token_hash, expires_at, status, accepted_user_id, accepted_at)
        SELECT $1, '+919812300002', r.id, '{}', $2, 'hi', 'sms', $3, now() + interval '7 days', 'accepted', $4, now() FROM roles r WHERE r.code='support_agent'`, [T1, inviter, sha('inv-l'), live]);
    });
    await expect(admin.query(`UPDATE staff_invites SET phone='+10000000000' WHERE accepted_user_id=$1`, [live])).rejects.toThrow(/INVITE_FINAL/);
  });

  it('the database re-checks: execute refuses a person with a blocker even if a caller skipped the check (fails closed)', async () => {
    const R = await makePerson('Ravi Kumar');
    await post(T1, 'order_payment', `dpdpr-fund:${R}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: 500n }, { account: platform(PlatformAccount.Gateway), amountMinor: -500n }]);
    await post(T1, 'refund', `dpdpr-refund:${R}`, [{ account: platform(PlatformAccount.Escrow), amountMinor: -500n }, { account: userMain(R), amountMinor: 500n }]);
    const dsr = await makeDsr(R);
    await admin.query(`UPDATE data_subject_requests SET status='in_progress' WHERE id=$1`, [dsr]);
    const c = await relay.connect();
    try {
      await c.query('BEGIN');
      await expect(c.query(`SELECT kv_dsr_erasure_execute($1, $2)`, [dsr, T1])).rejects.toThrow(/still has a blocker/);
      await c.query('ROLLBACK');
    } finally { c.release(); }
    expect((await one(`SELECT full_name FROM users WHERE id=$1`, [R])).full_name).toBe('Ravi Kumar');
  });
});
