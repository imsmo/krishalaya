// apps/api/src/__tests__/ops1b-aeps-biometric.integration.spec.ts · PC-56 OPS-1b — AePS AND BIOMETRICS THE PLATFORM DOES NOT RUN, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures.
//
// FLAGS: `ambassadors` is seeded OFF. This spec switches it ON for ITS OWN two organisations only (an allow-list, `rules.tenant_ids`) — the
// only way the AePS routes answer at all since HOTFIX-10 — and restores the seed row in afterAll. `labour` is switched ON the same way for (4),
// so that `POST /v1/labour/attendance/face` answering 404 proves the ROUTE is absent, not that the module is off. The `aeps_enabled` profiles
// are fixture SQL (enrolment is itself behind the flag and is not what this spec proves).
//
// What it proves (brief_ops1b §C; founder Q1-A, Q5-A, Q7-A):
//   (1) Q7-A: a body carrying `aadhaarLast4` → 400 AEPS_AADHAAR_NOT_RECORDED by name, nothing written (no event, no audit, no idempotency row);
//       `customerUserId` → 400 AEPS_CUSTOMER_LINK_NOT_RECORDED, the same; presence is enough (null / '' / a valid value), and the refusal comes
//       before the schema (an otherwise-invalid body still gets the NAMED refusal). A clean record → 201, ONE row with BOTH columns NULL, ONE
//       `ambassadors.aeps_event_recorded` audit row.
//   (2) `/events/mine` returns only the caller's own events and no body carries an `aadhaarLast4` or `customerUserId` key at ANY depth — a
//       legacy row written by SQL with both columns set included (no backfill; the read drops them). Another ambassador's events never appear.
//       Tenant B's supervisor sees none of tenant A's. One supervisor read → ONE `ambassadors.aeps_events_read` audit row.
//   (3) No money: after 20 records, no `ledger_entries`, `ledger_transactions`, `payouts` or `ambassador_earnings` row references an event,
//       the operator, the organisation or the time window.
//   (4) Absence → 404: AePS receipts, withdrawals, summary; a face clock-in; any `/v1/biometrics/*` or `/v1/face/*`.
//   (5) `pg_attribute` holds no column named like %template% / %biometric% / %face% / %fingerprint% on any table, apart from the named
//       allow-list below (message templates, branding colours, the audit read-log's UI surface, session-device fingerprints).
//   (6) `ambassadors` OFF → 404 on all three AePS routes (a Q7-A body included: the kill-switch answers before the refusal).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { AEPS_AADHAAR_NOT_RECORDED_SENTENCE, AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE } from '../modules/ambassadors/domain/ambassadors.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const ACCOUNT4 = '4321';
const LEGACY_AADHAAR4 = '5150';
const Q7A_KEYS = ['aadhaarLast4', 'customerUserId', 'aadhaar_last4', 'customer_user_id'];

/** Every key at every depth of a JSON value. */
function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
}

/** (5) The columns that legitimately match a biometric-looking name today — each named, each NOT biometric. A new one turns the spec red. */
const KNOWN_NAME_MATCHES: ReadonlyArray<[table: string, column: string, why: string]> = [
  ['contract_templates', 'body_template', 'a contract document template'],
  ['bids', 'device_fingerprint', 'a session-device fingerprint (fraud signal), not a finger'],
  ['login_events', 'device_fingerprint', 'a session-device fingerprint, not a finger'],
  ['devices', 'fingerprint', 'a session-device fingerprint, not a finger'],
  ['notification_template_versions', 'provider_template_ref', 'a message template'],
  ['notification_templates', 'provider_template_ref', 'a message template'],
  ['audit_read_log', 'surface', 'the UI surface a read came from ("sur-FACE")'],
  ['tenant_branding', 'surface_color', 'a branding colour'],
  ['tenant_branding_history', 'surface_color', 'a branding colour'],
  ['tenant_branding_proposals', 'surface_color', 'a branding colour'],
  ['desks', 'template_code', 'a desk template'],
  ['dunning_policy_steps', 'template_code', 'a message template'],
  ['twin_scenarios', 'template_code', 'a scenario template'],
  ['farming_contracts', 'template_id', 'a contract template'],
  ['notification_template_versions', 'template_id', 'a message template'],
  ['notifications', 'template_id', 'a message template'],
  ['notifications', 'template_version_id', 'a message template'],
];

run('PC-56 OPS-1b · AePS and biometrics the platform does not run (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  let ambUser = ''; let ambUser2 = ''; let supA = ''; let supB = ''; let ambB = '';
  let amb1 = ''; let amb2 = ''; let ambProfileB = '';
  const T: Record<string, string> = {};
  const backups: Record<string, { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = {};

  const H = (token: string, tenantId = A) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const post = (token: string, path: string, body: unknown, tenantId = A) => request(http).post(path).set({ ...H(token, tenantId), 'idempotency-key': randomUUID() }).send(body as object);
  const get = (token: string, path: string, tenantId = A) => request(http).get(path).set(H(token, tenantId));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function setFlag(key: 'ambassadors' | 'labour', on: boolean): Promise<void> {
    const b = backups[key];
    if (on) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [key, JSON.stringify({ tenant_ids: [A, B] })]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${A}`, `flagctx:${B}`]) await cache.del(c);
  }
  const aeps = (over: Record<string, unknown> = {}) => ({ serviceKind: 'cash_withdrawal', amountMinor: '250000', bankName: 'Test Bank', accountLast4: ACCOUNT4,
    status: 'success', attemptNo: 1, deviceCertified: true, npciRrn: `RRN-1B-${randomUUID().slice(0, 8)}`, ...over });
  const eventRows = (ambassadorId: string) => n(`SELECT count(*)::int n FROM aeps_service_events WHERE ambassador_id = $1`, [ambassadorId]);
  const auditRows = (action: string, actor: string) => n(`SELECT count(*)::int n FROM audit_log WHERE action = $1 AND actor_user_id = $2`, [action, actor]);
  const idemRows = (userId: string) => n(`SELECT count(*)::int n FROM idempotency_keys WHERE user_id = $1`, [userId]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops1b Org A ${A.slice(0, 4)}`); await makeTenant(admin, B, `Ops1b Org B ${B.slice(0, 4)}`);
    [ambUser, ambUser2, supA, supB, ambB] = await Promise.all(Array.from({ length: 5 }, () => makeUser(admin)));
    await role(ambUser, A, 'ambassador'); await role(ambUser2, A, 'ambassador'); await role(supA, A, 'tenant_admin');
    await role(supB, B, 'tenant_admin'); await role(ambB, B, 'ambassador');
    const prof = async (u: string, t: string) => (await admin.query(`INSERT INTO ambassador_profiles (user_id, tenant_id, kiosk_enabled, aeps_enabled, is_active) VALUES ($1, $2, true, true, true) RETURNING id`, [u, t])).rows[0].id as string;
    amb1 = await prof(ambUser, A); amb2 = await prof(ambUser2, A); ambProfileB = await prof(ambB, B);
    for (const key of ['ambassadors', 'labour']) {
      backups[key] = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect({ key, present: !!backups[key], seededOff: backups[key]?.is_enabled === false }).toEqual({ key, present: true, seededOff: true });
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    T.amb = mintToken(app, { userId: ambUser, tenantId: A, roles: ['ambassador'], perms: [] });
    T.amb2 = mintToken(app, { userId: ambUser2, tenantId: A, roles: ['ambassador'], perms: [] });
    T.ambB = mintToken(app, { userId: ambB, tenantId: B, roles: ['ambassador'], perms: [] });
    T.supA = mintToken(app, { userId: supA, tenantId: A, roles: ['tenant_admin'], perms: ['ambassador.manage', 'labour.desk'] });
    T.supB = mintToken(app, { userId: supB, tenantId: B, roles: ['tenant_admin'], perms: ['ambassador.manage'] });
    await setFlag('ambassadors', true);
  }, 120_000);

  afterAll(async () => {
    for (const b of Object.values(backups)) {
      try { await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) Q7-A: aadhaarLast4 / customerUserId → 400 BY NAME, nothing written; a clean record → 201, one row with BOTH columns NULL, one audit row', async () => {
    const before = { rows: await eventRows(amb1), audit: await auditRows('ambassadors.aeps_event_recorded', ambUser), idem: await idemRows(ambUser) };
    const refused: Array<[Record<string, unknown>, string, string]> = [
      [aeps({ aadhaarLast4: '9876' }), 'AEPS_AADHAAR_NOT_RECORDED', AEPS_AADHAAR_NOT_RECORDED_SENTENCE],
      [aeps({ aadhaarLast4: null }), 'AEPS_AADHAAR_NOT_RECORDED', AEPS_AADHAAR_NOT_RECORDED_SENTENCE],
      [aeps({ aadhaarLast4: '' }), 'AEPS_AADHAAR_NOT_RECORDED', AEPS_AADHAAR_NOT_RECORDED_SENTENCE],
      [aeps({ aadhaarLast4: '123456789012' }), 'AEPS_AADHAAR_NOT_RECORDED', AEPS_AADHAAR_NOT_RECORDED_SENTENCE],
      [{ aadhaarLast4: '9876', serviceKind: 'no_such_kind' }, 'AEPS_AADHAAR_NOT_RECORDED', AEPS_AADHAAR_NOT_RECORDED_SENTENCE],   // before the schema
      [aeps({ customerUserId: randomUUID() }), 'AEPS_CUSTOMER_LINK_NOT_RECORDED', AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE],
      [aeps({ customerUserId: ambUser2 }), 'AEPS_CUSTOMER_LINK_NOT_RECORDED', AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE],          // a REAL person's id
      [aeps({ customerUserId: null }), 'AEPS_CUSTOMER_LINK_NOT_RECORDED', AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE],
      [{ customerUserId: 'not-a-uuid', attemptNo: 9 }, 'AEPS_CUSTOMER_LINK_NOT_RECORDED', AEPS_CUSTOMER_LINK_NOT_RECORDED_SENTENCE],
    ];
    for (const [body, code, sentence] of refused) {
      const r = await post(T.amb, '/v1/ambassadors/aeps/events', body);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([400, code, sentence]);
      expect(r.body.data).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toContain('9876');
    }
    expect({ rows: await eventRows(amb1), audit: await auditRows('ambassadors.aeps_event_recorded', ambUser), idem: await idemRows(ambUser) }).toEqual(before);

    const ok = await post(T.amb, '/v1/ambassadors/aeps/events', aeps({ npciRrn: 'RRN-1B-CLEAN' }));
    expect([ok.status, ok.body.error?.code, ok.body.data]).toEqual([201, undefined, { recorded: true }]);
    const rows = (await admin.query(`SELECT aadhaar_last4, customer_user_id, account_last4, amount_minor::text AS amount FROM aeps_service_events WHERE npci_rrn = 'RRN-1B-CLEAN'`)).rows;
    expect(rows).toEqual([{ aadhaar_last4: null, customer_user_id: null, account_last4: ACCOUNT4, amount: '250000' }]);
    expect(await eventRows(amb1)).toBe(before.rows + 1);
    expect(await auditRows('ambassadors.aeps_event_recorded', ambUser)).toBe(before.audit + 1);
  }, 60_000);

  it('(2) own events only, no Aadhaar / customer key at any depth (a legacy row included); tenant B sees none of A; one audit row per supervisor read', async () => {
    for (const body of [aeps(), aeps({ status: 'failed', exceptionCode: 'finger_fail', attemptNo: 2 })]) expect((await post(T.amb, '/v1/ambassadors/aeps/events', body)).status).toBe(201);
    expect((await post(T.amb2, '/v1/ambassadors/aeps/events', aeps({ npciRrn: 'RRN-1B-OTHER' }))).status).toBe(201);
    expect((await post(T.ambB, '/v1/ambassadors/aeps/events', aeps({ npciRrn: 'RRN-1B-TENANTB' }), B)).status).toBe(201);
    // a LEGACY row (as HOTFIX-10's form could write): both Q7-A columns set — no backfill; the read must not return either
    const legacyCustomer = randomUUID();
    await admin.query(`INSERT INTO aeps_service_events (tenant_id, ambassador_id, customer_user_id, service_kind, bank_name, account_last4, aadhaar_last4, amount_minor, status, attempt_no, device_certified, npci_rrn)
      VALUES ($1, $2, $3, 'cash_withdrawal', 'Test Bank', $4, $5, 100000, 'success', 1, true, 'RRN-1B-LEGACY')`, [A, amb1, legacyCustomer, ACCOUNT4, LEGACY_AADHAAR4]);
    const expectedMine = await eventRows(amb1);

    const mine = await get(T.amb, '/v1/ambassadors/aeps/events/mine?limit=200');
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBe(expectedMine);
    expect(mine.body.data.every((e: { ambassadorId: string }) => e.ambassadorId === amb1)).toBe(true);
    expect(mine.body.data.some((e: { npciRrn: string }) => e.npciRrn === 'RRN-1B-LEGACY')).toBe(true);
    expect(Q7A_KEYS.filter((k) => keysDeep(mine.body).includes(k))).toEqual([]);
    for (const leak of [LEGACY_AADHAAR4, legacyCustomer, 'RRN-1B-OTHER', 'RRN-1B-TENANTB']) expect(JSON.stringify(mine.body)).not.toContain(leak);

    const mine2 = await get(T.amb2, '/v1/ambassadors/aeps/events/mine');
    expect(mine2.body.data.map((e: { npciRrn: string }) => e.npciRrn)).toEqual(['RRN-1B-OTHER']);       // another ambassador's events never appear

    const readsBefore = await auditRows('ambassadors.aeps_events_read', supA);
    const sup = await get(T.supA, '/v1/ambassadors/aeps/events?limit=200');
    expect(sup.status).toBe(200);
    expect(await auditRows('ambassadors.aeps_events_read', supA)).toBe(readsBefore + 1);
    expect(Q7A_KEYS.filter((k) => keysDeep(sup.body).includes(k))).toEqual([]);
    for (const leak of [LEGACY_AADHAAR4, legacyCustomer, 'RRN-1B-TENANTB']) expect(JSON.stringify(sup.body)).not.toContain(leak);
    expect(sup.body.data.some((e: { npciRrn: string }) => e.npciRrn === 'RRN-1B-LEGACY')).toBe(true);
    expect(sup.body.data.every((e: { ambassadorId: string }) => [amb1, amb2].includes(e.ambassadorId))).toBe(true);

    const supBRead = await get(T.supB, '/v1/ambassadors/aeps/events?limit=200', B);
    expect(supBRead.status).toBe(200);
    expect(supBRead.body.data.map((e: { npciRrn: string }) => e.npciRrn)).toEqual(['RRN-1B-TENANTB']);
    expect(supBRead.body.data.every((e: { ambassadorId: string }) => e.ambassadorId === ambProfileB)).toBe(true);
    expect(Q7A_KEYS.filter((k) => keysDeep(supBRead.body).includes(k))).toEqual([]);
  }, 60_000);

  it('(3) no money: after 20 records nothing in ledger_entries / ledger_transactions / payouts / ambassador_earnings references an event, the operator, the organisation or the window', async () => {
    const t0 = (await admin.query(`SELECT now() - interval '1 second' AS t`)).rows[0].t as Date;
    const before = await eventRows(amb1);
    for (let i = 0; i < 20; i++) {
      const body = i % 4 === 0 ? aeps({ serviceKind: 'balance_enquiry', amountMinor: undefined, balanceAfterMinor: '500000' })
        : i % 4 === 1 ? aeps({ status: 'declined', exceptionCode: 'bank_declined' })
          : aeps({ amountMinor: String(100000 + i * 1000), balanceAfterMinor: String(900000 - i * 1000) });
      const r = await post(T.amb, '/v1/ambassadors/aeps/events', JSON.parse(JSON.stringify(body)));
      expect([i, r.status]).toEqual([i, 201]);
    }
    expect(await eventRows(amb1)).toBe(before + 20);
    const ids = (await admin.query(`SELECT id::text FROM aeps_service_events WHERE ambassador_id = $1`, [amb1])).rows.map((r) => r.id as string);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    const operators = [ambUser, ambUser2, amb1, amb2];
    expect({
      txnWindow: await n(`SELECT count(*)::int n FROM ledger_transactions WHERE created_at >= $1`, [t0]),
      txnRefs: await n(`SELECT count(*)::int n FROM ledger_transactions WHERE tenant_id = $1 OR initiated_by = ANY($2::uuid[]) OR reference_id = ANY($2::uuid[])
                          OR reference_type ILIKE '%aeps%' OR idempotency_key ILIKE '%aeps%' OR description ILIKE '%aeps%'`, [A, operators]),
      entriesWindow: await n(`SELECT count(*)::int n FROM ledger_entries WHERE created_at >= $1`, [t0]),
      entriesOrg: await n(`SELECT count(*)::int n FROM ledger_entries WHERE tenant_id = $1`, [A]),
      payouts: await n(`SELECT count(*)::int n FROM payouts WHERE tenant_id = $1 OR user_id = ANY($2::uuid[]) OR reference_id = ANY($2::uuid[]) OR reference_type ILIKE '%aeps%'`, [A, operators]),
      earnings: await n(`SELECT count(*)::int n FROM ambassador_earnings WHERE tenant_id = $1 OR ambassador_id = ANY($2::uuid[]) OR created_at >= $3 OR reference_type ILIKE '%aeps%'`, [A, operators, t0]),
    }).toEqual({ txnWindow: 0, txnRefs: 0, entriesWindow: 0, entriesOrg: 0, payouts: 0, earnings: 0 });
    // (an event id is a bigint; no money table's reference column could name one — the window and the organisation are the reachable references)
  }, 90_000);

  it('(4) absence → 404: AePS receipts / withdrawals / summary, a face clock-in, any /v1/biometrics/* or /v1/face/*', async () => {
    await setFlag('labour', true);
    try {
      const absent = [
        await get(T.amb, `/v1/ambassadors/aeps/receipts/${randomUUID()}`),
        await post(T.amb, '/v1/ambassadors/aeps/withdrawals', aeps()),
        await get(T.amb, '/v1/ambassadors/aeps/summary'),
        await get(T.supA, '/v1/ambassadors/aeps/summary'),
        await post(T.supA, '/v1/labour/attendance/face', { image: 'x' }),
        await post(T.amb, '/v1/biometrics/enroll', { template: 'x' }),
        await get(T.amb, '/v1/biometrics/templates'),
        await post(T.amb, '/v1/face/enroll', { image: 'x' }),
        await post(T.amb, '/v1/face/match', { image: 'x' }),
        await get(T.amb, '/v1/face/templates'),
      ];
      expect(absent.map((r) => r.status)).toEqual(absent.map(() => 404));
      // positive controls: the module IS on (a sibling route answers), so each 404 is an absent ROUTE, not a switched-off module
      expect((await get(T.amb, '/v1/ambassadors/aeps/events/mine')).status).toBe(200);
      expect((await get(T.supA, '/v1/labour/attendance/summary')).status).toBe(200);
    } finally { await setFlag('labour', false); }
  }, 60_000);

  it('(5) no biometric-looking column exists on any table, apart from the named allow-list (a face_template column would turn this red)', async () => {
    const found = (await admin.query(`SELECT c.relname AS t, a.attname AS c
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
         AND a.attnum > 0 AND NOT a.attisdropped
         AND (a.attname ILIKE '%template%' OR a.attname ILIKE '%biometric%' OR a.attname ILIKE '%face%' OR a.attname ILIKE '%fingerprint%')
       ORDER BY 1, 2`)).rows.map((r) => `${r.t}.${r.c}`);
    const known = KNOWN_NAME_MATCHES.map(([t, c]) => `${t}.${c}`).sort();
    expect(found.filter((x) => !known.includes(x))).toEqual([]);
    expect(found.some((x) => /biometric|face_?template|fingerprint_(template|image|data)|face_(image|embedding|vector)/.test(x.split('.')[1]))).toBe(false);
    // positive control: the probe sees what it should (so an empty result cannot pass silently)
    expect(found).toContain('devices.fingerprint');
  }, 30_000);

  it('(6) ambassadors OFF → 404 on all three AePS routes (a Q7-A body included — the kill-switch answers first)', async () => {
    await setFlag('ambassadors', false);
    const before = await eventRows(amb1);
    const off = [
      await post(T.amb, '/v1/ambassadors/aeps/events', aeps()),
      await post(T.amb, '/v1/ambassadors/aeps/events', aeps({ aadhaarLast4: '9876' })),
      await get(T.amb, '/v1/ambassadors/aeps/events/mine'),
      await get(T.supA, '/v1/ambassadors/aeps/events'),
    ];
    expect(off.map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(await eventRows(amb1)).toBe(before);
  }, 60_000);
});
