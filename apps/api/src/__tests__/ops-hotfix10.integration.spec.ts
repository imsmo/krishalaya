// apps/api/src/__tests__/ops-hotfix10.integration.spec.ts · PC-56 HOTFIX-10 — THE DESK LEARNS NOTHING IT SHOULD NOT, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures.
// `ambassadors` stays at its seed value (OFF) for (2)'s first half and is then switched ON for THIS organisation only (an allow-list),
// restored in afterAll.
//
// What it proves (brief §C, survey §7 `ops-hotfix10`; founder Q9-A, Q7 + Law 10, Q8-A):
//   (1) tenant A's administrator `POST /v1/users` with a phone owned by a person registered under tenant B → 409 USER_PHONE_ALREADY_REGISTERED,
//       the body holding no person field at any depth and not her distinctive name/phone/id; no users / audit_log / consents /
//       user_tenant_roles row written. A new phone → 201 + exactly one `user.created_assisted`. The race (a self-signup landing between the
//       check and the insert — the TENANT-10a F-4 shape) → the same 409, and only the self-signup's row exists.
//   (2) `ambassadors` OFF for the tenant: POST …/aeps/events, GET …/events/mine, GET …/events → the flag-off 404 a sibling answers (the
//       `aeps_enabled` profile is created by fixture SQL — NO route can create it with the flag off: enrolment is itself behind the flag).
//       ON: a record → 1 event row + 1 `ambassadors.aeps_event_recorded` audit row; a supervisor read → 1 `ambassadors.aeps_events_read` row,
//       masked fields only, and neither audit row carries a customer digit.
//   (3) assisted onboarding with `on_behalf_listing` → 422 ASSISTED_CONSENT_NOT_GRANTABLE, nothing written (no user, consent, referral);
//       the same person onboarded with her own purposes only → then `POST /v1/ambassadors/on-behalf/listings` for her → 403
//       ON_BEHALF_CONSENT_REQUIRED (the helper cannot list as her).
//   (4) today's truth pinned (unchanged rules): an uncertified device with status success → 400; a third finger-fail without a note → 400;
//       a balance enquiry with an amount → 400 — each writes nothing.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UserRepository } from '../modules/identity/repositories/user.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const PERSON_NAME = 'Zarinabanu Odhavji Kanjariya';           // distinctive: if it appears anywhere in a refusal, the desk learned it
const PERSON_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'phone', 'languageCode', 'locale', 'countryCode', 'email', 'status',
  'hasAadhaar', 'hasPan', 'lastActiveAt', 'kycStatus', 'roles'];
const AADHAAR4 = '9876'; const ACCOUNT4 = '4321';

/** Every key at every depth of a JSON value. */
function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}
const phoneSeq = () => '+9197' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));

run('PC-56 HOTFIX-10 · the desk learns nothing it should not (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  let adminA = ''; let person = ''; let personPhone = ''; let ambUser = ''; let supervisor = ''; let ambassadorId = '';
  const T: Record<string, string> = {};
  let flagBackup: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown } | undefined;

  const H = (token: string, tenantId = A) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const post = (token: string, path: string, body: unknown) => request(http).post(path).set({ ...H(token), 'idempotency-key': randomUUID() }).send(body as object);
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function setAmbassadorsFlag(on: boolean): Promise<void> {
    if (on) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'ambassadors'`, [JSON.stringify({ tenant_ids: [A] })]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = 'ambassadors'`, [flagBackup!.is_enabled, flagBackup!.rollout_pct, JSON.stringify(flagBackup!.rules ?? {})]);
    for (const c of ['flag:ambassadors', 'flagstale:ambassadors', 'flags:all', `flagctx:${A}`, `flagctx:${B}`]) await cache.del(c);
  }
  // NAMED UPDATE (PC-56 OPS-1b, founder Q7-A 2026-11-05): the record no longer accepts `aadhaarLast4` (a body carrying it is refused BY NAME,
  // 400 AEPS_AADHAAR_NOT_RECORDED — pinned in ops1b-aeps-biometric (1)). Without this edit (4)'s three bodies would be refused by Q7-A instead of
  // by the rule each one pins, and (2)'s record would never be written. AADHAAR4 stays in the leak lists below: the digits must still appear nowhere.
  const aeps = (over: Record<string, unknown> = {}) => ({ serviceKind: 'cash_withdrawal', amountMinor: '200000', bankName: 'Bank of Baroda', accountLast4: ACCOUNT4,
    status: 'success', attemptNo: 1, deviceCertified: true, npciRrn: 'RRN-HF10-1', ...over });
  const aepsRows = () => n(`SELECT count(*)::int n FROM aeps_service_events WHERE ambassador_id = $1`, [ambassadorId]);
  const auditRows = (action: string, actor: string) => n(`SELECT count(*)::int n FROM audit_log WHERE action = $1 AND actor_user_id = $2`, [action, actor]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Anand FPO hf10 ${A.slice(0, 4)}`); await makeTenant(admin, B, `Kisan Sathi hf10 ${B.slice(0, 4)}`);
    [adminA, person, ambUser, supervisor] = await Promise.all(Array.from({ length: 4 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = $2, language_code = 'gu', email = 'zarina.k@example.in', aadhaar_last4 = '5150' WHERE id = $1`, [person, PERSON_NAME]);
    personPhone = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [person])).rows[0].phone;
    await role(adminA, A, 'tenant_admin'); await role(supervisor, A, 'tenant_admin');
    await role(person, B, 'farmer');                                   // she belongs to ANOTHER organisation
    await role(ambUser, A, 'ambassador');
    // the aeps_enabled profile is fixture SQL on purpose: enrolment (`POST /v1/ambassadors`) is behind `ambassadors` — with the flag
    // OFF no route can create it, which is exactly the state (2) starts in (a tenant that had the module ON and turned it OFF).
    // NAMED UPDATE (PC-56 OPS-1c · OPS1-B7): assisted onboarding and on-behalf listing now refuse an ambassador whose training is not recorded
    // (403 AMBASSADOR_TRAINING_INCOMPLETE). (3) proves H10-3 with a FULLY ENABLED ambassador — kiosk mode was already ON here, so the fixture now
    // records training too; without it (3)'s onboarding would be answered by B7 instead of by the consent rule it pins. B7 itself is pinned live
    // in ops1c-kiosk (2). The AePS record (2)/(4) is not gated by B7 and is unchanged.
    ambassadorId = (await admin.query(`INSERT INTO ambassador_profiles (user_id, tenant_id, kiosk_enabled, aeps_enabled, is_active, training_completed_at) VALUES ($1, $2, true, true, true, now() - interval '30 days') RETURNING id`, [ambUser, A])).rows[0].id;
    flagBackup = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'ambassadors'`)).rows[0];
    expect({ present: !!flagBackup, seededOff: flagBackup?.is_enabled === false }).toEqual({ present: true, seededOff: true });
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:ambassadors', 'flagstale:ambassadors', 'flags:all', `flagctx:${A}`]) await cache.del(c);
    T.adminA = mintToken(app, { userId: adminA, tenantId: A, roles: ['tenant_admin'], perms: ['user.approve'] });
    T.amb = mintToken(app, { userId: ambUser, tenantId: A, roles: ['ambassador'], perms: [] });
    T.sup = mintToken(app, { userId: supervisor, tenantId: A, roles: ['tenant_admin'], perms: ['ambassador.manage'] });
  }, 120_000);

  afterAll(async () => {
    try { if (flagBackup) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [flagBackup.key, flagBackup.is_enabled, flagBackup.rollout_pct, JSON.stringify(flagBackup.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) an existing phone (a person of ANOTHER organisation) → 409, nothing about her, nothing written; a new phone → 201 + one user.created_assisted; the race → the same 409', async () => {
    const before = {
      users: await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [personPhone]),
      audit: await n(`SELECT count(*)::int n FROM audit_log WHERE actor_user_id = $1`, [adminA]),
      consents: await n(`SELECT count(*)::int n FROM consents WHERE user_id = $1`, [person]),
      utr: await n(`SELECT count(*)::int n FROM user_tenant_roles WHERE user_id = $1`, [person]),
    };
    for (const phone of [personPhone, personPhone.replace(/^\+91/, '')]) {          // E.164 and the bare national form
      const r = await post(T.adminA, '/v1/users', { phone, fullName: 'Typed At The Desk', languageCode: 'hi' });
      expect([r.status, r.body.error?.code]).toEqual([409, 'USER_PHONE_ALREADY_REGISTERED']);
      expect(r.body.error.message).toBe('This number already has an account. She signs in herself, on her own phone.');
      expect(r.body.data).toBeUndefined();
      const keys = keysDeep(r.body);
      expect(PERSON_FIELDS.filter((k) => keys.includes(k))).toEqual([]);
      const text = JSON.stringify(r.body);
      for (const leak of [PERSON_NAME, 'Zarinabanu', person, personPhone.slice(-6), 'zarina', '5150']) expect(text).not.toContain(leak);
    }
    expect({
      users: await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [personPhone]),
      audit: await n(`SELECT count(*)::int n FROM audit_log WHERE actor_user_id = $1`, [adminA]),
      consents: await n(`SELECT count(*)::int n FROM consents WHERE user_id = $1`, [person]),
      utr: await n(`SELECT count(*)::int n FROM user_tenant_roles WHERE user_id = $1`, [person]),
    }).toEqual(before);
    expect((await admin.query(`SELECT full_name FROM users WHERE id = $1`, [person])).rows[0].full_name).toBe(PERSON_NAME);   // untouched

    // a new phone → 201 and exactly one user.created_assisted
    const fresh = phoneSeq();
    const c = await post(T.adminA, '/v1/users', { phone: fresh, fullName: 'Hemiben Kiosk', languageCode: 'gu' });
    expect([c.status, c.body.error?.code]).toEqual([201, undefined]);
    const newId = c.body.data.id as string;
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE action = 'user.created_assisted' AND entity_id = $1 AND actor_user_id = $2`, [newId, adminA])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [fresh])).toBe(1);

    // the race: the check runs before a self-signup lands, the insert after it → users.phone UNIQUE → the same 409, nothing of ours survives
    const raced = phoneSeq(); const selfSigned = randomUUID();
    const repo = app.get(UserRepository, { strict: false });
    const spy = jest.spyOn(repo, 'getByPhoneForUpdate').mockImplementationOnce(async () => {
      await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, 'Self Signed Up')`, [selfSigned, raced]);   // committed, another connection
      return null;                                                                                                             // what the check saw a moment earlier
    });
    const auditBefore = await n(`SELECT count(*)::int n FROM audit_log WHERE actor_user_id = $1`, [adminA]);
    try {
      const r = await post(T.adminA, '/v1/users', { phone: raced, languageCode: 'hi' });
      expect([r.status, r.body.error?.code]).toEqual([409, 'USER_PHONE_ALREADY_REGISTERED']);
      expect(JSON.stringify(r.body)).not.toContain(selfSigned);
      expect(JSON.stringify(r.body)).not.toContain('Self Signed Up');
    } finally { spy.mockRestore(); }
    expect((await admin.query(`SELECT id FROM users WHERE phone = $1`, [raced])).rows.map((x) => x.id)).toEqual([selfSigned]);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE actor_user_id = $1`, [adminA])).toBe(auditBefore);
  }, 60_000);

  it('(2) ambassadors OFF → the AePS log answers the flag-off 404 a sibling answers; ON → one audit row per record and per supervisor read, no customer digit', async () => {
    const sibling = await get(T.amb, '/v1/ambassadors/me/earnings');                       // a sibling controller under the same flag
    expect(sibling.status).toBe(404);
    const off = [
      await post(T.amb, '/v1/ambassadors/aeps/events', aeps()),
      await get(T.amb, '/v1/ambassadors/aeps/events/mine'),
      await get(T.sup, '/v1/ambassadors/aeps/events'),
    ];
    expect(off.map((r) => [r.status, r.body.error?.code])).toEqual(off.map(() => [404, sibling.body.error?.code]));
    expect(await aepsRows()).toBe(0);
    expect(await auditRows('ambassadors.aeps_events_read', supervisor)).toBe(0);

    await setAmbassadorsFlag(true);
    const rec = await post(T.amb, '/v1/ambassadors/aeps/events', aeps());
    expect([rec.status, rec.body.error?.code]).toEqual([201, undefined]);
    expect(await aepsRows()).toBe(1);
    const recAudit = (await admin.query(`SELECT entity_type, entity_id, new_value, tenant_id FROM audit_log WHERE action = 'ambassadors.aeps_event_recorded' AND actor_user_id = $1`, [ambUser])).rows;
    expect(recAudit).toHaveLength(1);
    expect(recAudit[0]).toMatchObject({ entity_type: 'ambassador_profile', entity_id: ambassadorId, tenant_id: A });
    expect(recAudit[0].new_value).toMatchObject({ serviceKind: 'cash_withdrawal', status: 'success', attemptNo: 1, deviceCertified: true });
    for (const leak of [AADHAAR4, ACCOUNT4, 'Bank of Baroda', '200000', 'RRN-HF10-1']) expect(JSON.stringify(recAudit[0])).not.toContain(leak);

    const mine = await get(T.amb, '/v1/ambassadors/aeps/events/mine');
    expect([mine.status, mine.body.data.length]).toEqual([200, 1]);
    expect(await auditRows('ambassadors.aeps_events_read', ambUser)).toBe(0);              // her own log is not a supervisor read

    const read = await get(T.sup, '/v1/ambassadors/aeps/events');
    expect([read.status, read.body.data.length]).toEqual([200, 1]);
    for (const row of read.body.data) {                                                    // masked fields only
      // NAMED UPDATE (OPS-1b Q7-A): the read no longer returns the Aadhaar or customer key at all (was: null or four digits) — stronger.
      expect(['aadhaarLast4', 'customerUserId'].filter((k) => k in row)).toEqual([]);
      expect(row.accountLast4 === null || /^\d{4}$/.test(row.accountLast4)).toBe(true);
      expect(JSON.stringify(row)).not.toMatch(/"(aadhaar|account)[A-Za-z0-9]*":"\d{5,}"/);
    }
    const readAudit = (await admin.query(`SELECT entity_type, new_value, tenant_id FROM audit_log WHERE action = 'ambassadors.aeps_events_read' AND actor_user_id = $1`, [supervisor])).rows;
    expect(readAudit).toHaveLength(1);
    expect(readAudit[0]).toMatchObject({ entity_type: 'aeps_service_events', tenant_id: A });
    expect(readAudit[0].new_value).toMatchObject({ rows: 1, windowDays: 90 });
    for (const leak of [AADHAAR4, ACCOUNT4, 'Bank of Baroda']) expect(JSON.stringify(readAudit[0])).not.toContain(leak);

    await get(T.sup, '/v1/ambassadors/aeps/events?status=failed');
    expect(await auditRows('ambassadors.aeps_events_read', supervisor)).toBe(2);            // one per read
  }, 60_000);

  it('(3) assisted onboarding refuses on_behalf_listing by name and writes nothing; the helper still cannot list as her', async () => {
    await setAmbassadorsFlag(true);
    const phone = phoneSeq();
    const consentRows = () => n(`SELECT count(*)::int n FROM consents WHERE assisted_by = $1`, [ambUser]);
    const referralRows = () => n(`SELECT count(*)::int n FROM referrals WHERE referrer_user_id = $1`, [ambUser]);
    const before = { consents: await consentRows(), referrals: await referralRows(), created: await auditRows('user.created_assisted', ambUser) };
    for (const consents of [[{ purposeCode: 'on_behalf_listing', granted: true }], [{ purposeCode: 'terms', granted: true }, { purposeCode: 'privacy', granted: true }, { purposeCode: 'on_behalf_listing', granted: true }]]) {
      const r = await post(T.amb, '/v1/ambassadors/assisted-onboarding', { phone, fullName: 'Jashoda Ben R', languageCode: 'gu', consents });
      expect([r.status, r.body.error?.code]).toEqual([422, 'ASSISTED_CONSENT_NOT_GRANTABLE']);
      expect(r.body.error.message).toBe('A consent that lets the helper act for her cannot be recorded by the helper. She gives it herself, on her own phone.');
    }
    expect(await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [phone])).toBe(0);
    expect({ consents: await consentRows(), referrals: await referralRows(), created: await auditRows('user.created_assisted', ambUser) }).toEqual(before);

    // with her own purposes only she is onboarded — and the helper still cannot list as her
    const ok = await post(T.amb, '/v1/ambassadors/assisted-onboarding', { phone, fullName: 'Jashoda Ben R', languageCode: 'gu', consents: [{ purposeCode: 'terms', granted: true }, { purposeCode: 'privacy', granted: true }] });
    expect([ok.status, ok.body.error?.code]).toEqual([201, undefined]);
    const farmer = ok.body.data.user.id as string;
    expect(await n(`SELECT count(*)::int n FROM consents WHERE user_id = $1 AND purpose_code = 'on_behalf_listing'`, [farmer])).toBe(0);
    const listing = await post(T.amb, '/v1/ambassadors/on-behalf/listings', { farmerUserId: farmer, listing: {
      productId: randomUUID(), categoryId: randomUUID(), title: 'Groundnut hf10', quantityTotal: 10, unitCode: 'quintal', priceMinor: '650000' } });
    expect([listing.status, listing.body.error?.code]).toEqual([403, 'ON_BEHALF_CONSENT_REQUIRED']);
    expect(await n(`SELECT count(*)::int n FROM listings WHERE seller_user_id = $1`, [farmer])).toBe(0);
  }, 60_000);

  it('(4) today\'s truth pinned: uncertified success, a third finger-fail without a note, a balance enquiry with an amount → 400 each, nothing written', async () => {
    await setAmbassadorsFlag(true);
    const rows = await aepsRows(); const audits = await auditRows('ambassadors.aeps_event_recorded', ambUser);
    const bad = [
      aeps({ deviceCertified: false, status: 'success' }),
      aeps({ status: 'failed', exceptionCode: 'finger_fail', attemptNo: 3 }),
      aeps({ serviceKind: 'balance_enquiry', amountMinor: '100000' }),
    ];
    for (const body of bad) {
      const r = await post(T.amb, '/v1/ambassadors/aeps/events', body);
      expect(r.status).toBe(400);
    }
    expect([await aepsRows(), await auditRows('ambassadors.aeps_event_recorded', ambUser)]).toEqual([rows, audits]);
  }, 60_000);
});
