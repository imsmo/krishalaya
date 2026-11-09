// apps/api/src/__tests__/hotfix13-her-money.integration.spec.ts · PC-56 HOTFIX-13 — NOBODY SPENDS HER MONEY OR READS HER ANIMAL'S RECORD
// BUT HER, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as
// kv_app, migration 0236.
// FLAGS: `equipment` and `livestock` are seeded OFF and switched ON for THIS organisation only (an allow-list fixture,
// `rules.tenant_ids`), restored in afterAll — the module routes 404 otherwise, and the rules under test live behind them.
// `AUTH_EXPOSE_OTP=false` for the whole run: the renter's start code must reach her WITHOUT the identity module's test switch (B4).
//
// Founder Q1-A (2026-11-09): nothing beyond the deposit leaves the renter's wallet until she confirms the hours herself, in her own
// session; until then the owner can be paid only from the deposit. Nobody but the payer spends the payer's money (the hire deposit,
// the vet fee). An animal's health record opens only to its owner and the vet of a booking on that animal; writes are recorded.
// Survey §7 `hotfix13-her-money` items, verbatim:
//   (1) Hire: request → quote (deposit 300) → confirm by her → start → complete 6 h (total 900) → settle without her confirmation →
//       SETTLE_HOURS_NOT_CONFIRMED, no ledger row, no audit row; her confirm-usage → settle → owner +900, her −600 net beyond the
//       deposit, zero-sum; the owner calling confirm-usage → refused; kv_app direct UPDATE … SET usage_confirmed_by = <owner> →
//       CHECK/trigger refused; settle with total ≤ advance and no confirmation → allowed (the deposit alone).
//   (2) Payer rule: a tenant_admin+farmer user confirms another renter's hire → EQ_CONFIRM_NOT_RENTER, no escrow_hold leg; pays
//       another farmer's vet → VET_PAY_NOT_FARMER, no service_fee leg; settles a hire on a machine not theirs → refused.
//   (3) Health file: farmer B reads farmer A's animal's health events → 404; writes one → 404, no row; the vet of a booking on that
//       animal → 200; another vet → 404; a prescription read by a non-party vet → 404; a write with a foreign vetBookingId → refused.
//   (4) The code: the renter's confirm response carries it; the owner's reads never do (AUTH_EXPOSE_OTP unset).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['equipment', 'livestock'] as const;

run('PC-56 HOTFIX-13 · nobody spends her money or reads her animal\'s record but her (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let appPool: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID();
  let O = ''; let R = ''; let R2 = ''; let A = ''; let F = ''; let B = ''; let V1 = ''; let V2 = '';
  let assetId = ''; let speciesId = ''; let animal1 = ''; let animal2 = ''; let vet1 = ''; let svc1 = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];
  let otpEnvWas: string | undefined;

  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T1 });
  const post = (token: string, path: string, body: object = {}, key: string | null = randomUUID()) =>
    request(http).post(path).set(key ? { ...H(token), 'idempotency-key': key } : H(token)).send(body);
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const bal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const escrow = async () => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`)).rows[0]?.b ?? '0');
  const txns = (key: string) => n(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [key]);
  const txnSum = async (key: string) => BigInt((await admin.query(`SELECT COALESCE(sum(e.amount_minor),0)::text s FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id WHERE t.idempotency_key = $1`, [key])).rows[0].s);
  const audits = (id: string, action: string) => n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = $2`, [id, action]);
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T1}`]) await cache.del(c);
  }
  /** kv_app, in a session that names a person — exactly what the unit of work does — rolled back whatever happens. */
  async function asKvApp(userId: string, sql: string, params: unknown[]): Promise<{ code?: string; message?: string }> {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [T1, userId]);
      await c.query(sql, params);
      return {};
    } catch (e) { return { code: (e as { code?: string }).code, message: (e as Error).message }; }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  /** One hire through the real routes, up to `completed`. Returns its id and the start code she was given. */
  async function hireTo(renterTok: string, advanceMinor: string, actual: string): Promise<{ id: string; otp: string }> {
    const scheduledAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const r = await post(renterTok, '/v1/equipment/rentals', { assetId, rateBasis: 'per_hour', estQuantity: '8.00', scheduledAt });
    expect(r.status).toBe(201);
    const id = r.body.data.id as string;
    expect((await post(tok.O, `/v1/equipment/rentals/${id}/quote`, { advanceMinor }, null)).status).toBe(201);
    const c = await post(renterTok, `/v1/equipment/rentals/${id}/confirm`);
    expect(c.status).toBe(201);
    const otp = c.body.data.startOtp as string;
    expect((await post(tok.O, `/v1/equipment/rentals/${id}/start`, { otp }, null)).status).toBe(201);
    expect((await post(tok.O, `/v1/equipment/rentals/${id}/complete`, { actualQuantity: actual }, null)).status).toBe(201);
    return { id, otp };
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    otpEnvWas = process.env.AUTH_EXPOSE_OTP; process.env.AUTH_EXPOSE_OTP = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL }); appPool = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, T1, `HF13 ${T1.slice(0, 4)}`);
    [O, R, R2, A, F, B, V1, V2] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, T1, code]);
    await role(O, 'equipment_owner'); for (const u of [R, R2, F, B]) await role(u, 'farmer');
    await role(A, 'tenant_admin'); await role(A, 'farmer'); await role(V1, 'vet'); await role(V2, 'vet');

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));   // seeded OFF
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T1] })]);

    // FOUND ON THE WAY (reported): the `animal_health_event` vocabulary has its TYPE row (seed 0005) and NO VALUES, so every health
    // write is refused 400 "unknown health event type" on a seeded database. One platform value, admin-realm fixture, for this run.
    await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
      SELECT 'animal_health_event', NULL, 'treatment', 'Treatment', '{}'::jsonb, 1
       WHERE NOT EXISTS (SELECT 1 FROM lookup_values WHERE type_code = 'animal_health_event' AND tenant_id IS NULL AND code = 'treatment')`);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    for (const u of [R, R2, F]) {   // her wallet, funded through the wallet port (never a ledger INSERT)
      await uow.run(T1, (tx) => wallet.post(tx, { tenantId: T1, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
        legs: [{ account: userMain(u), amountMinor: 1_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -1_000_000n }] }), { userId: 'system' });
    }
    tok.O = mintToken(app, { userId: O, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage'] });
    tok.R = mintToken(app, { userId: R, tenantId: T1, roles: ['farmer'], perms: ['equipment.rent', 'animal.manage', 'vet.book'] });
    tok.R2 = mintToken(app, { userId: R2, tenantId: T1, roles: ['farmer'], perms: ['equipment.rent', 'animal.manage', 'vet.book'] });
    // F-2's person: an organisation administrator who is ALSO a farmer — every permission the old escapes needed.
    tok.A = mintToken(app, { userId: A, tenantId: T1, roles: ['tenant_admin', 'farmer'], perms: ['booking.manage', 'equipment.manage', 'equipment.rent', 'vet.book', 'vet.manage', 'animal.manage'] });
    tok.F = mintToken(app, { userId: F, tenantId: T1, roles: ['farmer'], perms: ['animal.manage', 'vet.book'] });
    tok.B = mintToken(app, { userId: B, tenantId: T1, roles: ['farmer'], perms: ['animal.manage', 'vet.book'] });
    tok.V1 = mintToken(app, { userId: V1, tenantId: T1, roles: ['vet'], perms: ['vet.manage', 'animal.manage'] });
    tok.V2 = mintToken(app, { userId: V2, tenantId: T1, roles: ['vet'], perms: ['vet.manage', 'animal.manage'] });

    // The machine and its rate, through the real routes (₹150/hour).
    const categoryId = (await admin.query(`SELECT id FROM categories ORDER BY id LIMIT 1`)).rows[0].id;
    const a = await post(tok.O, '/v1/equipment/assets', { categoryId, hpRating: 45 });
    expect(a.status).toBe(201); assetId = a.body.data.id;
    expect((await post(tok.O, `/v1/equipment/assets/${assetId}/rates`, { rateBasis: 'per_hour', rateMinor: '15000', includesOperator: true, includesFuel: false }, null)).status).toBe(201);

    // The animals, the vets and a vet's service, through the real routes.
    speciesId = (await admin.query(`SELECT id FROM animal_species WHERE code = 'cattle'`)).rows[0].id;
    animal1 = (await post(tok.F, '/v1/livestock/animals', { speciesId, sex: 'female' })).body.data.id;
    animal2 = (await post(tok.F, '/v1/livestock/animals', { speciesId, sex: 'female' })).body.data.id;
    vet1 = (await post(tok.V1, '/v1/livestock/vets', { registrationNo: `VCI-${randomUUID().slice(0, 6)}` })).body.data.id;
    expect((await post(tok.V2, '/v1/livestock/vets', { registrationNo: `VCI-${randomUUID().slice(0, 6)}` })).status).toBe(201);
    svc1 = (await post(tok.V1, '/v1/livestock/vets/services', { serviceTypeCode: 'consult', priceMinor: '30000', pricingUnit: 'per_visit' }, null)).body.data.id;
    expect([assetId, animal1, animal2, vet1, svc1].every(Boolean)).toBe(true);
  }, 180_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    if (otpEnvWas === undefined) delete process.env.AUTH_EXPOSE_OTP; else process.env.AUTH_EXPOSE_OTP = otpEnvWas;
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await appPool?.end(); await admin?.end();
  }, 40_000);

  let hire1 = ''; let otp1 = '';
  it('(1a)+(4) her hire: deposit ₹300 escrowed from HER wallet by HER confirm, whose response carries the start code (AUTH_EXPOSE_OTP=false); 6 h completed → ₹900', async () => {
    const before = await bal(R);
    const h = await hireTo(tok.R, '30000', '6.00');
    hire1 = h.id; otp1 = h.otp;
    expect(otp1).toMatch(/^\d{6}$/);
    expect(before - (await bal(R))).toBe(30000n);
    const row = (await admin.query(`SELECT status, total_minor::text t, advance_minor::text a, usage_confirmed_by, usage_confirmed_at FROM equipment_bookings WHERE id = $1`, [hire1])).rows[0];
    expect(row).toEqual({ status: 'completed', t: '90000', a: '30000', usage_confirmed_by: null, usage_confirmed_at: null });
  });

  it('(4) the start code is in no owner read, no list, no event payload, no audit row', async () => {
    const one = await get(tok.O, `/v1/equipment/rentals/${hire1}`);
    const list = await get(tok.O, '/v1/equipment/rentals?box=owner');
    const mine = await get(tok.R, `/v1/equipment/rentals/${hire1}`);
    for (const r of [one, list, mine]) {
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain(otp1);
      expect(JSON.stringify(r.body)).not.toMatch(/otp/i);
    }
    expect(await n(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND payload::text LIKE $2`, [hire1, `%${otp1}%`])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND (new_value::text LIKE $2 OR old_value::text LIKE $2)`, [hire1, `%${otp1}%`])).toBe(0);
  });

  it('(1b) the owner settles WITHOUT her confirmation → 409 SETTLE_HOURS_NOT_CONFIRMED by name: no ledger row, no audit row, nothing moved', async () => {
    const r0 = await bal(R); const o0 = await bal(O); const e0 = await escrow();
    const r = await post(tok.O, `/v1/equipment/rentals/${hire1}/settle`);
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'SETTLE_HOURS_NOT_CONFIRMED',
      'Not settled: the renter has not confirmed these hours in her own app. Nothing beyond the deposit leaves the renter\'s wallet until she confirms those hours in her own app.']);
    for (const k of ['eqbook-release', 'eqbook-refund', 'eqbook-collect']) expect(await txns(`${k}:${hire1}`)).toBe(0);
    expect(await audits(hire1, 'equipment.booking.settled')).toBe(0);
    expect([await bal(R), await bal(O), await escrow()]).toEqual([r0, o0, e0]);
    expect((await admin.query(`SELECT status FROM equipment_bookings WHERE id = $1`, [hire1])).rows[0].status).toBe('completed');
  });

  it('(1c) the owner, an administrator and another renter calling confirm-usage → 403 USAGE_CONFIRM_NOT_RENTER by name, nothing stamped, no audit row', async () => {
    for (const t of [tok.A, tok.R2]) {
      const r = await post(t, `/v1/equipment/rentals/${hire1}/confirm-usage`);
      expect([r.status, r.body.error?.code]).toEqual([403, 'USAGE_CONFIRM_NOT_RENTER']);
    }
    // the owner holds equipment.manage, not equipment.rent: the permission check refuses first (403, the guard) — and with
    // equipment.rent added the service refuses him by name
    const ownerRent = mintToken(app, { userId: O, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage', 'equipment.rent'] });
    expect((await post(tok.O, `/v1/equipment/rentals/${hire1}/confirm-usage`)).status).toBe(403);
    const r = await post(ownerRent, `/v1/equipment/rentals/${hire1}/confirm-usage`);
    expect([r.status, r.body.error?.code]).toEqual([403, 'USAGE_CONFIRM_NOT_RENTER']);
    expect((await admin.query(`SELECT usage_confirmed_by FROM equipment_bookings WHERE id = $1`, [hire1])).rows[0].usage_confirmed_by).toBeNull();
    expect(await audits(hire1, 'equipment.booking.usage_confirmed')).toBe(0);
  });

  it('(1d) the database, as kv_app: confirming as the owner, as anyone in another session, or settling the shortfall unconfirmed → refused (CHECK / trigger)', async () => {
    const asOwner = await asKvApp(O, `UPDATE equipment_bookings SET usage_confirmed_by = $2, usage_confirmed_at = now() WHERE id = $1`, [hire1, O]);
    expect(asOwner.code).toBe('23514');
    // the renter's id written from the OWNER's session → the guard: the confirmer is the person in this session
    const herIdHisSession = await asKvApp(O, `UPDATE equipment_bookings SET usage_confirmed_by = $2, usage_confirmed_at = now() WHERE id = $1`, [hire1, R]);
    expect([herIdHisSession.code, herIdHisSession.message]).toEqual(['23514', expect.stringContaining('(0236)')]);
    // rewriting the renter to yourself in the same write, then confirming as "the renter" → the guard: only the row's renter confirms
    const takeOver = await asKvApp(O, `UPDATE equipment_bookings SET renter_user_id = $2, usage_confirmed_by = $2, usage_confirmed_at = now() WHERE id = $1`, [hire1, O]);
    expect([takeOver.code, takeOver.message]).toEqual(['23514', expect.stringContaining('only the renter confirms the hours (0236)')]);
    // a session with no person cannot confirm
    const noOne = await asKvApp('system', `UPDATE equipment_bookings SET usage_confirmed_by = $2, usage_confirmed_at = now() WHERE id = $1`, [hire1, R]);
    expect(noOne.code).toBe('23514');
    // settling a shortfall unconfirmed, directly → the CHECK
    const settle = await asKvApp(O, `UPDATE equipment_bookings SET status = 'settled' WHERE id = $1`, [hire1]);
    expect([settle.code, settle.message]).toEqual(['23514', expect.stringContaining('ck_eqbook_settled_shortfall_confirmed')]);
    // positive control: HER confirmation in HER session is what the database accepts (rolled back)
    expect(await asKvApp(R, `UPDATE equipment_bookings SET usage_confirmed_by = $2, usage_confirmed_at = now() WHERE id = $1`, [hire1, R])).toEqual({});
    // kv_app has no DELETE on hires (0079)
    expect((await asKvApp(O, `DELETE FROM equipment_bookings WHERE id = $1`, [hire1])).code).toBe('42501');
  });

  let confirmKey = ''; let confirmBody: unknown = null;
  it('(1e) SHE confirms the hours in her own session → 201, stamped, ONE audit row with the hours and the total; a same-key replay → the same answer, no second row', async () => {
    confirmKey = randomUUID();
    const r = await post(tok.R, `/v1/equipment/rentals/${hire1}/confirm-usage`, {}, confirmKey);
    expect(r.status).toBe(201); confirmBody = r.body.data;
    expect(r.body.data).toMatchObject({ status: 'completed', actualQuantity: '6.00', totalMinor: '90000' });
    expect(r.body.data.usageConfirmedAt).toBeTruthy();
    const row = (await admin.query(`SELECT usage_confirmed_by FROM equipment_bookings WHERE id = $1`, [hire1])).rows[0];
    expect(row.usage_confirmed_by).toBe(R);
    const a = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE entity_id = $1 AND action = 'equipment.booking.usage_confirmed'`, [hire1])).rows;
    expect(a).toHaveLength(1);
    expect(a[0].actor_user_id).toBe(R);
    expect(a[0].new_value).toMatchObject({ actualQuantity: '6.00', totalMinor: '90000', advanceMinor: '30000' });
    const again = await post(tok.R, `/v1/equipment/rentals/${hire1}/confirm-usage`, {}, confirmKey);
    expect(again.status).toBe(201); expect(again.body.data).toEqual(confirmBody);
    expect(await audits(hire1, 'equipment.booking.usage_confirmed')).toBe(1);
    // a NEW key → already confirmed, by name
    const third = await post(tok.R, `/v1/equipment/rentals/${hire1}/confirm-usage`);
    expect([third.status, third.body.error?.code]).toEqual([409, 'USAGE_ALREADY_CONFIRMED']);
  });

  it('(1f) after her confirmation the database freezes what she confirmed: the hours, the bill, the confirmation itself', async () => {
    for (const sql of [
      `UPDATE equipment_bookings SET actual_quantity = 7.00 WHERE id = $1`,
      `UPDATE equipment_bookings SET total_minor = 120000 WHERE id = $1`,
      // [lead QA, HOTFIX-13] the deposit is frozen too: changing it after she confirms changes what settle takes beyond it
      // (the lead's mutant dropped advance_minor from 0236's freeze and this spec stayed green until this line).
      `UPDATE equipment_bookings SET advance_minor = 0 WHERE id = $1`,
      `UPDATE equipment_bookings SET usage_confirmed_by = NULL, usage_confirmed_at = NULL WHERE id = $1`,
      `UPDATE equipment_bookings SET usage_confirmed_at = now() - interval '1 day' WHERE id = $1`,
    ]) expect((await asKvApp(O, sql, [hire1])).code).toBe('23514');
  });

  it('(1g) settle after her confirmation → owner +₹900, her −₹600 beyond the deposit, escrow −₹300; every leg zero-sum; ONE audit row', async () => {
    const r0 = await bal(R); const o0 = await bal(O); const e0 = await escrow();
    const r = await post(tok.O, `/v1/equipment/rentals/${hire1}/settle`);
    expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ status: 'settled', settledTotalMinor: '90000' });
    expect((await bal(O)) - o0).toBe(90000n);
    expect(r0 - (await bal(R))).toBe(60000n);
    expect((await escrow()) - e0).toBe(-30000n);
    for (const k of ['eqbook-release', 'eqbook-collect']) { expect(await txns(`${k}:${hire1}`)).toBe(1); expect(await txnSum(`${k}:${hire1}`)).toBe(0n); }
    expect(await txns(`eqbook-refund:${hire1}`)).toBe(0);
    expect(await audits(hire1, 'equipment.booking.settled')).toBe(1);
  });

  it('(1h) a bill WITHIN the deposit settles with no confirmation: the deposit pays the owner the ₹150 bill, ₹150 goes back to her, nothing else leaves her wallet', async () => {
    const h = await hireTo(tok.R, '30000', '1.00');
    const r0 = await bal(R); const o0 = await bal(O);
    const r = await post(tok.O, `/v1/equipment/rentals/${h.id}/settle`);
    expect(r.status).toBe(201);
    expect((await bal(O)) - o0).toBe(15000n);
    expect((await bal(R)) - r0).toBe(15000n);   // the unused half of her deposit, back
    expect(await txns(`eqbook-collect:${h.id}`)).toBe(0);
    expect((await admin.query(`SELECT usage_confirmed_by FROM equipment_bookings WHERE id = $1`, [h.id])).rows[0].usage_confirmed_by).toBeNull();
  });

  it('(2a) an administrator who is also a farmer confirming ANOTHER renter\'s hire → 403 EQ_CONFIRM_NOT_RENTER: no escrow_hold leg, her wallet untouched', async () => {
    const scheduledAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const id = (await post(tok.R2, '/v1/equipment/rentals', { assetId, rateBasis: 'per_hour', estQuantity: '2.00', scheduledAt })).body.data.id as string;
    expect((await post(tok.O, `/v1/equipment/rentals/${id}/quote`, { advanceMinor: '10000' }, null)).status).toBe(201);
    const r0 = await bal(R2);
    const r = await post(tok.A, `/v1/equipment/rentals/${id}/confirm`);
    expect([r.status, r.body.error?.code]).toEqual([403, 'EQ_CONFIRM_NOT_RENTER']);
    expect(await txns(`eqbook-hold:${id}`)).toBe(0);
    expect(await bal(R2)).toBe(r0);
    expect((await admin.query(`SELECT status FROM equipment_bookings WHERE id = $1`, [id])).rows[0].status).toBe('quoted');
    // and quoting / settling a hire on a machine not theirs → by name
    const q = await post(tok.A, `/v1/equipment/rentals/${id}/quote`, { advanceMinor: '5000' }, null);
    expect([q.status, q.body.error?.code]).toEqual([403, 'EQ_NOT_MACHINE_OWNER']);
  });

  it('(2b) an administrator settling a completed hire on a machine not theirs → 403 EQ_NOT_MACHINE_OWNER, no ledger leg', async () => {
    const h = await hireTo(tok.R2, '30000', '1.00');
    const r = await post(tok.A, `/v1/equipment/rentals/${h.id}/settle`);
    expect([r.status, r.body.error?.code]).toEqual([403, 'EQ_NOT_MACHINE_OWNER']);
    expect(await txns(`eqbook-release:${h.id}`)).toBe(0);
  });

  let vb1 = ''; let vb2 = '';
  it('(2c) an administrator who books vets paying ANOTHER farmer\'s vet → 403 VET_PAY_NOT_FARMER, no service_fee leg; driving her booking → refused', async () => {
    vb1 = (await post(tok.F, '/v1/livestock/vet-bookings', { vetId: vet1, serviceId: svc1, animalId: animal1, urgency: 'routine', mode: 'visit' })).body.data.id;
    expect((await post(tok.V1, `/v1/livestock/vet-bookings/${vb1}/progress`, { action: 'accept' }, null)).status).toBe(201);
    const adminDrive = await post(tok.A, `/v1/livestock/vet-bookings/${vb1}/progress`, { action: 'in_consult' }, null);
    expect([adminDrive.status, adminDrive.body.error?.code]).toEqual([403, 'LIVESTOCK_FORBIDDEN']);
    expect((await post(tok.V1, `/v1/livestock/vet-bookings/${vb1}/progress`, { action: 'in_consult' }, null)).status).toBe(201);
    const f0 = await bal(F);
    const r = await post(tok.A, `/v1/livestock/vet-bookings/${vb1}/complete`);
    expect([r.status, r.body.error?.code]).toEqual([403, 'VET_PAY_NOT_FARMER']);
    expect(await txns(`vetfee:${vb1}`)).toBe(0);
    expect(await bal(F)).toBe(f0);
  });

  it('(3a) the owner writes her animal\'s health record (one audit row, as owner); farmer B reads → 404, writes → 404 and no row', async () => {
    const w = await post(tok.F, `/v1/livestock/animals/${animal1}/health-events`, { eventTypeCode: 'treatment', diagnosis: 'HF13 private note' }, null);
    expect(w.status).toBe(201);
    expect((await admin.query(`SELECT new_value FROM audit_log WHERE entity_id = $1 AND action = 'livestock.health_event.recorded'`, [w.body.data.id])).rows.map((x) => x.new_value))
      .toEqual([{ animalId: animal1, eventTypeCode: 'treatment', vetBookingId: null, recordedAs: 'owner' }]);
    expect((await get(tok.F, `/v1/livestock/animals/${animal1}/health-events`)).status).toBe(200);
    const rows0 = await n(`SELECT count(*)::int n FROM animal_health_events WHERE animal_id = $1`, [animal1]);
    expect((await get(tok.B, `/v1/livestock/animals/${animal1}/health-events`)).status).toBe(404);
    expect((await post(tok.B, `/v1/livestock/animals/${animal1}/health-events`, { eventTypeCode: 'treatment' }, null)).status).toBe(404);
    expect(await n(`SELECT count(*)::int n FROM animal_health_events WHERE animal_id = $1`, [animal1])).toBe(rows0);
    // an administrator (animal.manage + vet.manage + booking.manage) → 404 too
    expect((await get(tok.A, `/v1/livestock/animals/${animal1}/health-events`)).status).toBe(404);
  });

  it('(3b) the vet of a booking on that animal → 200 and writes (recorded as vet); another vet → 404', async () => {
    const r = await get(tok.V1, `/v1/livestock/animals/${animal1}/health-events`);
    expect(r.status).toBe(200); expect(r.body.data.length).toBeGreaterThan(0);
    const w = await post(tok.V1, `/v1/livestock/animals/${animal1}/health-events`, { eventTypeCode: 'treatment', vetBookingId: vb1 }, null);
    expect(w.status).toBe(201);
    expect(await audits(w.body.data.id, 'livestock.health_event.recorded')).toBe(1);
    expect((await get(tok.V2, `/v1/livestock/animals/${animal1}/health-events`)).status).toBe(404);
    expect((await post(tok.V2, `/v1/livestock/animals/${animal1}/health-events`, { eventTypeCode: 'treatment' }, null)).status).toBe(404);
    // the vet of record on animal1 has no booking on animal2 → 404 there
    expect((await get(tok.V1, `/v1/livestock/animals/${animal2}/health-events`)).status).toBe(404);
  });

  it('(3c) a prescription: the farmer and the vet of record read it; a non-party vet and an administrator → 404', async () => {
    expect((await post(tok.V1, `/v1/livestock/vet-bookings/${vb1}/prescription`, { items: [{ drugName: 'HF13 drug', dosage: '1 tab' }] }, null)).status).toBe(201);
    expect((await get(tok.F, `/v1/livestock/vet-bookings/${vb1}/prescription`)).status).toBe(200);
    expect((await get(tok.V1, `/v1/livestock/vet-bookings/${vb1}/prescription`)).status).toBe(200);
    expect((await get(tok.V2, `/v1/livestock/vet-bookings/${vb1}/prescription`)).status).toBe(404);
    expect((await get(tok.A, `/v1/livestock/vet-bookings/${vb1}/prescription`)).status).toBe(404);
  });

  it('(3d) a write naming a foreign vetBookingId (a booking on ANOTHER animal) → 422 HEALTH_BOOKING_NOT_THIS_ANIMAL, no row', async () => {
    vb2 = (await post(tok.F, '/v1/livestock/vet-bookings', { vetId: vet1, serviceId: svc1, animalId: animal2, urgency: 'routine', mode: 'visit' })).body.data.id;
    const rows0 = await n(`SELECT count(*)::int n FROM animal_health_events WHERE animal_id = $1`, [animal1]);
    const r = await post(tok.F, `/v1/livestock/animals/${animal1}/health-events`, { eventTypeCode: 'treatment', vetBookingId: vb2 }, null);
    expect([r.status, r.body.error?.code]).toEqual([422, 'HEALTH_BOOKING_NOT_THIS_ANIMAL']);
    expect(await n(`SELECT count(*)::int n FROM animal_health_events WHERE animal_id = $1`, [animal1])).toBe(rows0);
  });

  it('(2d) the farmer who booked pays her own vet → 201, her wallet → the vet, zero-sum', async () => {
    const f0 = await bal(F); const v0 = await bal(V1);
    const r = await post(tok.F, `/v1/livestock/vet-bookings/${vb1}/complete`);
    expect(r.status).toBe(201);
    expect(f0 - (await bal(F))).toBe(30000n); expect((await bal(V1)) - v0).toBe(30000n);
    expect(await txnSum(`vetfee:${vb1}`)).toBe(0n);
  });
});
