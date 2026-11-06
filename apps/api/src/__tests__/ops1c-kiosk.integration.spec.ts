// apps/api/src/__tests__/ops1c-kiosk.integration.spec.ts · PC-56 OPS-1c — THE KIOSK, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures.
//
// FLAGS: `ambassadors` is seeded OFF. This spec switches it ON for ITS OWN two organisations only (an allow-list, `rules.tenant_ids`) — the
// only way the ambassador routes answer at all — and `assisted_doc_prefill` the same way, so the on-behalf SUGGEST path reaches its service and
// a B7 refusal there proves the gate, not the flag. Both seed rows are restored in afterAll. The ambassador profiles and the earning rows are
// fixture SQL (enrolment and accrual are not what this spec proves).
//
// What it proves (brief_ops1c §C; founder Q4-A′, Q8-A, Q9-A):
//   (1) `/ambassadors/me` and `/me/earnings` return only the caller's own; amounts are digit strings; another ambassador's rows never appear; a
//       staff member with no ambassador profile gets the NAMED 404 AMBASSADOR_NOT_FOUND (the page's "no ambassador profile here").
//   (2) OPS1-B7: an active ambassador with kiosk mode off, or with training not recorded, is refused BY NAME (403 AMBASSADOR_KIOSK_NOT_ENABLED /
//       AMBASSADOR_TRAINING_INCOMPLETE) on assisted onboarding and on BOTH on-behalf listing routes, and nothing is written (users, consents,
//       referrals, listings, audit, idempotency). Both gates set → 201.
//   (3) Q4-A′ pinned: after `POST /v1/users` from a staff session → no referral and no ambassador earning for that person, and exactly one
//       `user.created_assisted` audit row (the summary's "pays the helper nothing" is true).
//   (4) Q9-A: an existing phone (same organisation, and another organisation) → 409 USER_PHONE_ALREADY_REGISTERED; the body carries no name,
//       phone, village or id at ANY depth.
//   (5) Q8-A: no route records `on_behalf_listing` with a helper named — `POST /v1/consents` from her OWN session is refused by name (422
//       CONSENT_HELPER_NOT_RECORDED, nothing written), assisted onboarding still refuses the purpose (HOTFIX-10); the same purpose WITHOUT a
//       helper is hers to record; and on-behalf listing for a fresh farmer is refused (403 ON_BEHALF_CONSENT_REQUIRED, no listing).
//   (6) Own-only: `POST /v1/kyc/ekyc/start` and `POST /v1/bank-accounts` from an ambassador's session carrying another person's id are refused
//       (strict schema) and nothing is written for that person; a clean bank-account add is answered on the CALLER's own KYC (403 for her).
//   (7) Absence → 404: `POST /v1/kiosk/sessions`, `/v1/ambassadors/sessions`, `POST /v1/bank-accounts/:id/penny-drop`, `POST /v1/ambassadors/on-behalf/kyc`.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE, AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE } from '../modules/ambassadors/domain/ambassadors.errors';
import { CONSENT_HELPER_NOT_RECORDED_SENTENCE } from '../modules/identity/domain/identity.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const PERSON_NAME = 'Hemlataben Kiosktest Odedrani';            // distinctive: if it appears in a refusal, the desk learned it
const PERSON_VILLAGE = 'Testgamvillage';
const PERSON_FIELDS = ['id', 'userId', 'fullName', 'displayName', 'name', 'phone', 'village', 'languageCode', 'locale', 'countryCode', 'email', 'status',
  'hasAadhaar', 'hasPan', 'lastActiveAt', 'roles'];
const phoneSeq = () => '+9196' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));

/** Every key at every depth of a JSON value. */
function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

run('PC-56 OPS-1c · the kiosk (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  let staff = ''; let ambOk = ''; let ambOk2 = ''; let ambKioskOff = ''; let ambUntrained = ''; let person = ''; let personB = ''; let other = '';
  let profOk = ''; let profOk2 = '';
  const T: Record<string, string> = {};
  const backups: Record<string, { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = {};

  const H = (token: string, tenantId = A) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const post = (token: string, path: string, body: unknown, tenantId = A) => request(http).post(path).set({ ...H(token, tenantId), 'idempotency-key': randomUUID() }).send(body as object);
  const get = (token: string, path: string, tenantId = A) => request(http).get(path).set(H(token, tenantId));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function setFlag(key: string, on: boolean): Promise<void> {
    const b = backups[key];
    if (on) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [key, JSON.stringify({ tenant_ids: [A, B] })]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${A}`, `flagctx:${B}`]) await cache.del(c);
  }
  const listingBody = (farmerUserId: string) => ({ farmerUserId, listing: { productId: randomUUID(), categoryId: randomUUID(), title: 'Groundnut ops1c', quantityTotal: 10, unitCode: 'quintal', priceMinor: '650000' } });
  /** Every row an assisted act could write, for one ambassador (and the phone it was given). */
  const writes = async (ambUser: string, phone: string) => ({
    users: await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [phone]),
    consents: await n(`SELECT count(*)::int n FROM consents WHERE assisted_by = $1`, [ambUser]),
    referrals: await n(`SELECT count(*)::int n FROM referrals WHERE referrer_user_id = $1`, [ambUser]),
    audit: await n(`SELECT count(*)::int n FROM audit_log WHERE actor_user_id = $1`, [ambUser]),
    listings: await n(`SELECT count(*)::int n FROM listings WHERE seller_user_id = $1`, [person]),
    idem: await n(`SELECT count(*)::int n FROM idempotency_keys WHERE user_id = $1`, [ambUser]),
    activity: await n(`SELECT count(*)::int n FROM ambassador_profiles WHERE user_id = $1 AND last_activity_at IS NOT NULL`, [ambUser]),
  });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops1c Org A ${A.slice(0, 4)}`); await makeTenant(admin, B, `Ops1c Org B ${B.slice(0, 4)}`);
    [staff, ambOk, ambOk2, ambKioskOff, ambUntrained, person, personB, other] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = $2, language_code = 'gu' WHERE id = $1`, [person, PERSON_NAME]);
    await admin.query(`INSERT INTO addresses (user_id, line1, village, country_code) VALUES ($1, 'Plot 1', $2, 'IN')`, [person, PERSON_VILLAGE]);
    await role(staff, A, 'tenant_admin'); await role(person, A, 'farmer'); await role(personB, B, 'farmer'); await role(other, A, 'farmer');
    for (const u of [ambOk, ambOk2, ambKioskOff, ambUntrained]) await role(u, A, 'ambassador');
    const prof = async (u: string, kiosk: boolean, trained: boolean) => (await admin.query(
      `INSERT INTO ambassador_profiles (user_id, tenant_id, kiosk_enabled, aeps_enabled, is_active, training_completed_at) VALUES ($1, $2, $3, false, true, ${trained ? "now() - interval '30 days'" : 'NULL'}) RETURNING id`,
      [u, A, kiosk])).rows[0].id as string;
    profOk = await prof(ambOk, true, true); profOk2 = await prof(ambOk2, true, true);
    await prof(ambKioskOff, false, true); await prof(ambUntrained, true, false);
    // her own earnings (fixture SQL; accrual is not what this spec proves) — and another ambassador's, which must never appear
    const earn = async (amb: string, code: string, minor: string) => admin.query(
      `INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor) VALUES ($1, $2, $3, $4, 'referral', $5, $6)`,
      [A, amb, randomUUID(), code, randomUUID(), minor]);
    await earn(profOk, 'farmer_onboarded', '2500'); await earn(profOk, 'listing_assist', '2500'); await earn(profOk2, 'farmer_onboarded', '9900');
    for (const key of ['ambassadors', 'assisted_doc_prefill']) {
      backups[key] = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect({ key, present: !!backups[key], seededOff: backups[key]?.is_enabled === false }).toEqual({ key, present: true, seededOff: true });
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    T.staff = mintToken(app, { userId: staff, tenantId: A, roles: ['tenant_admin'], perms: ['user.approve', 'ambassador.manage'] });
    for (const [k, u] of [['ok', ambOk], ['ok2', ambOk2], ['kioskOff', ambKioskOff], ['untrained', ambUntrained]] as const) T[k] = mintToken(app, { userId: u, tenantId: A, roles: ['ambassador'], perms: [] });
    T.person = mintToken(app, { userId: person, tenantId: A, roles: ['farmer'], perms: [] });
    await setFlag('ambassadors', true); await setFlag('assisted_doc_prefill', true);
  }, 120_000);

  afterAll(async () => {
    for (const b of Object.values(backups)) {
      try { await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) /ambassadors/me and /me/earnings are the caller\'s own; amounts are digit strings; a staff member with no profile gets the NAMED 404', async () => {
    const me = await get(T.ok, '/v1/ambassadors/me');
    expect([me.status, me.body.data?.id, me.body.data?.userId, me.body.data?.kioskEnabled, typeof me.body.data?.trainingCompletedAt]).toEqual([200, profOk, ambOk, true, 'string']);
    const mine = await get(T.ok, '/v1/ambassadors/me/earnings');
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBe(2);
    for (const e of mine.body.data) expect([e.ambassadorId, /^\d+$/.test(e.amountMinor)]).toEqual([profOk, true]);
    expect(JSON.stringify(mine.body)).not.toContain('9900');                                    // the other ambassador's row never appears
    expect(mine.body.meta.nextCursor).toBeNull();                                               // rows and a cursor — no total exists
    expect(keysDeep(mine.body).filter((k) => /total|sum/i.test(k))).toEqual([]);
    const theirs = await get(T.ok2, '/v1/ambassadors/me/earnings');
    expect([theirs.status, theirs.body.data.length, theirs.body.data[0].ambassadorId]).toEqual([200, 1, profOk2]);
    for (const path of ['/v1/ambassadors/me', '/v1/ambassadors/me/earnings']) {
      const r = await get(T.staff, path);
      expect([path, r.status, r.body.error?.code]).toEqual([path, 404, 'AMBASSADOR_NOT_FOUND']);
    }
    // the own-only earnings read has no "whose" parameter to abuse: a query naming another ambassador is refused by the strict schema
    const pry = await get(T.ok, `/v1/ambassadors/me/earnings?ambassadorId=${profOk2}`);
    expect(pry.status).toBeGreaterThanOrEqual(400); expect(JSON.stringify(pry.body)).not.toContain('9900');
  }, 60_000);

  it('(2) OPS1-B7: kiosk off, or training not recorded → refused BY NAME on assisted onboarding and BOTH on-behalf routes; nothing written; both set → 201', async () => {
    const cases: Array<[string, string, string, string]> = [
      ['kioskOff', ambKioskOff, 'AMBASSADOR_KIOSK_NOT_ENABLED', AMBASSADOR_KIOSK_NOT_ENABLED_SENTENCE],
      ['untrained', ambUntrained, 'AMBASSADOR_TRAINING_INCOMPLETE', AMBASSADOR_TRAINING_INCOMPLETE_SENTENCE],
    ];
    for (const [tk, u, code, sentence] of cases) {
      const phone = phoneSeq();
      const before = await writes(u, phone);
      const acts = [
        await post(T[tk], '/v1/ambassadors/assisted-onboarding', { phone, fullName: 'New Farmer B7', languageCode: 'gu', consents: [{ purposeCode: 'terms', granted: true }] }),
        await post(T[tk], '/v1/ambassadors/on-behalf/listings', listingBody(person)),
        await post(T[tk], '/v1/ambassadors/on-behalf/listings/suggest', { farmerUserId: person, docText: 'groundnut 10 quintal', locale: 'gu' }),
      ];
      for (const r of acts) {
        expect([tk, r.status, r.body.error?.code]).toEqual([tk, 403, code]);
        expect(r.body.error.message).toBe(sentence);
      }
      expect([tk, await writes(u, phone)]).toEqual([tk, before]);
    }
    // both gates set → the act proceeds (201) — the gate refuses only what it names
    const phone = phoneSeq();
    const ok = await post(T.ok, '/v1/ambassadors/assisted-onboarding', { phone, fullName: 'New Farmer Ok', languageCode: 'gu', consents: [{ purposeCode: 'terms', granted: true }] });
    expect([ok.status, ok.body.error?.code]).toEqual([201, undefined]);
    expect(await n(`SELECT count(*)::int n FROM users WHERE phone = $1`, [phone])).toBe(1);
  }, 90_000);

  it('(3) Q4-A′: the staff create (POST /v1/users) writes no referral and no ambassador earning — exactly one user.created_assisted', async () => {
    const before = { referrals: await n(`SELECT count(*)::int n FROM referrals WHERE tenant_id = $1`, [A]), earnings: await n(`SELECT count(*)::int n FROM ambassador_earnings WHERE tenant_id = $1`, [A]) };
    const phone = phoneSeq();
    const r = await post(T.staff, '/v1/users', { phone, fullName: 'Desk Created Person', languageCode: 'gu' });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    const id = r.body.data.id as string;
    expect(await n(`SELECT count(*)::int n FROM referrals WHERE referee_user_id = $1 OR referrer_user_id = $1`, [id])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM ambassador_earnings WHERE subject_user_id = $1 OR reference_id = $1`, [id])).toBe(0);
    expect({ referrals: await n(`SELECT count(*)::int n FROM referrals WHERE tenant_id = $1`, [A]), earnings: await n(`SELECT count(*)::int n FROM ambassador_earnings WHERE tenant_id = $1`, [A]) }).toEqual(before);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE action = 'user.created_assisted' AND entity_id = $1 AND actor_user_id = $2`, [id, staff])).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1`, [id])).toBe(1);
    // and no membership: the account is not made a member of the organisation (the summary never says "member")
    expect(await n(`SELECT count(*)::int n FROM user_tenant_roles WHERE user_id = $1`, [id])).toBe(0);
  }, 60_000);

  it('(4) Q9-A: an existing phone — same organisation and another organisation — → 409, and nothing about the person at any depth', async () => {
    for (const who of [person, personB]) {
      const phone = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [who])).rows[0].phone as string;
      for (const typed of [phone, phone.replace(/^\+91/, '')]) {
        const r = await post(T.staff, '/v1/users', { phone: typed, fullName: 'Typed At The Kiosk', languageCode: 'hi' });
        expect([r.status, r.body.error?.code]).toEqual([409, 'USER_PHONE_ALREADY_REGISTERED']);
        expect(r.body.error.message).toBe('This number already has an account. She signs in herself, on her own phone.');
        expect(r.body.data).toBeUndefined();
        expect(PERSON_FIELDS.filter((k) => keysDeep(r.body).includes(k))).toEqual([]);
        const text = JSON.stringify(r.body);
        for (const leak of [PERSON_NAME, 'Hemlataben', PERSON_VILLAGE, who, phone.slice(-6)]) expect([leak, text.includes(leak)]).toEqual([leak, false]);
      }
    }
  }, 60_000);

  it('(5) Q8-A: no route records on_behalf_listing with a helper named; her own grant without one is hers; on-behalf listing stays refused', async () => {
    const rows = () => n(`SELECT count(*)::int n FROM consents WHERE user_id = $1 AND purpose_code = 'on_behalf_listing'`, [person]);
    const before = await rows();
    for (const body of [
      { purposeCode: 'on_behalf_listing', granted: true, channel: 'ambassador_assisted', assistedBy: ambOk },
      { purposeCode: 'on_behalf_listing', granted: true, channel: 'app', assistedBy: ambOk },
      { purposeCode: 'ON_BEHALF_LISTING', granted: true, assistedBy: ambOk },
    ]) {
      const r = await post(T.person, '/v1/consents', body);
      expect([r.status, r.body.error?.code]).toEqual([422, 'CONSENT_HELPER_NOT_RECORDED']);
      expect(r.body.error.message).toBe(CONSENT_HELPER_NOT_RECORDED_SENTENCE);
    }
    expect(await rows()).toBe(before);
    expect(await n(`SELECT count(*)::int n FROM consents WHERE assisted_by = $1 AND purpose_code ILIKE 'on_behalf%'`, [ambOk])).toBe(0);
    // assisted onboarding still refuses the purpose by name (HOTFIX-10 H10-3), with B7 passed
    const viaDesk = await post(T.ok, '/v1/ambassadors/assisted-onboarding', { phone: phoneSeq(), languageCode: 'gu', consents: [{ purposeCode: 'terms', granted: true }, { purposeCode: 'on_behalf_listing', granted: true }] });
    expect([viaDesk.status, viaDesk.body.error?.code]).toEqual([422, 'ASSISTED_CONSENT_NOT_GRANTABLE']);
    // the same purpose with NO helper named is her own to give (the tenant staff desk's gate reads it without a helper)
    const own = await post(T.person, '/v1/consents', { purposeCode: 'on_behalf_listing', granted: true, channel: 'app' });
    expect([own.status, own.body.error?.code]).toEqual([201, undefined]);
    expect(await rows()).toBe(before + 1);
    // …and it does not let an ambassador list for her: the gate needs a grant naming THAT ambassador, which no route can now record
    const listing = await post(T.ok, '/v1/ambassadors/on-behalf/listings', listingBody(person));
    expect([listing.status, listing.body.error?.code]).toEqual([403, 'ON_BEHALF_CONSENT_REQUIRED']);
    // a fresh farmer the ambassador just onboarded: refused too
    const phone = phoneSeq();
    const onboarded = await post(T.ok, '/v1/ambassadors/assisted-onboarding', { phone, languageCode: 'gu', consents: [{ purposeCode: 'terms', granted: true }] });
    expect(onboarded.status).toBe(201);
    const fresh = onboarded.body.data.user.id as string;
    const l2 = await post(T.ok, '/v1/ambassadors/on-behalf/listings', listingBody(fresh));
    expect([l2.status, l2.body.error?.code]).toEqual([403, 'ON_BEHALF_CONSENT_REQUIRED']);
    expect(await n(`SELECT count(*)::int n FROM listings WHERE seller_user_id = ANY($1::uuid[])`, [[person, fresh]])).toBe(0);
  }, 90_000);

  it('(6) own-only: eKYC start and a bank account carrying another person\'s id are refused and write nothing for her; a clean add is the caller\'s own', async () => {
    const ekycFor = (u: string) => n(`SELECT count(*)::int n FROM ekyc_sessions WHERE user_id = $1`, [u]);
    const banksFor = (u: string) => n(`SELECT count(*)::int n FROM bank_accounts WHERE user_id = $1`, [u]);
    const before = { ekyc: await ekycFor(other), banks: await banksFor(other), mine: await banksFor(ambOk) };
    for (const field of ['userId', 'farmerUserId', 'subjectUserId']) {
      const k = await post(T.ok, '/v1/kyc/ekyc/start', { docType: 'pan', idNumber: 'ABCDE1234F', [field]: other });
      expect([field, k.status >= 400 && k.status < 500]).toEqual([field, true]);
      const b = await post(T.ok, '/v1/bank-accounts', { accountKind: 'upi', upiId: 'farmer@upi', vaultRef: `tok_${randomUUID().slice(0, 8)}`, [field]: other });
      expect([field, b.status >= 400 && b.status < 500]).toEqual([field, true]);
    }
    expect({ ekyc: await ekycFor(other), banks: await banksFor(other), mine: await banksFor(ambOk) }).toEqual(before);
    // a clean add is answered on the CALLER's own facts: the route needs the CALLER's own verified KYC (403 BANK_ACCOUNT_KYC_REQUIRED for this
    // unverified ambassador) — no body field names anyone else, so nothing can land on the other person.
    const clean = await post(T.ok, '/v1/bank-accounts', { accountKind: 'upi', upiId: 'helper@upi', vaultRef: `tok_${randomUUID().slice(0, 8)}` });
    expect([clean.status, clean.body.error?.code]).toEqual([403, 'BANK_ACCOUNT_KYC_REQUIRED']);
    expect([await banksFor(ambOk), await banksFor(other)]).toEqual([before.mine, before.banks]);
  }, 60_000);

  it('(7) absence → 404: kiosk sessions, ambassador sessions, a penny-drop, an on-behalf KYC', async () => {
    const r = [
      await post(T.ok, '/v1/kiosk/sessions', { phone: phoneSeq() }),
      await post(T.ok, '/v1/ambassadors/sessions', { phone: phoneSeq() }),
      await post(T.ok, `/v1/bank-accounts/${randomUUID()}/penny-drop`, {}),
      await post(T.ok, '/v1/ambassadors/on-behalf/kyc', { farmerUserId: person, docType: 'aadhaar' }),
    ];
    expect(r.map((x) => x.status)).toEqual([404, 404, 404, 404]);
    const asManager = await get(T.staff, '/v1/ambassadors/sessions');          // GET reaches `:id` — a non-UUID names no ambassador
    expect(asManager.status).toBe(404);
  }, 60_000);
});
