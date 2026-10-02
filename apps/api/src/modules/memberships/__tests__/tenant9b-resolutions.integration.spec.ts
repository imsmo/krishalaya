// modules/memberships/__tests__/tenant9b-resolutions.integration.spec.ts · PC-56 TENANT-9b · THE RESOLUTIONS, live.
//
// Real PG16, the harness's test database (the real migrations + seeds), every tenant-realm query as `kv_app` under RLS.
// Run under TZ=Asia/Kolkata AND TZ=UTC: the window is typed as the cooperative's civil time and turned into an instant by
// the database in `countries.timezone`, never by the process zone. What this proves:
//   1. F-13 · THE SURVEY'S PROBE RE-RUN: a member added after close (and a quorum bylaw changed after close) does NOT move a
//      closed resolution's result — the old path (today's roll) is computed beside it to show what it would have printed;
//   2. F-13 · a ballot with an undeclared choice is refused 422 (BALLOT_CHOICE_UNDECLARED) and 23514 underneath;
//   3. 0182 · a special / dividend-class resolution closed by its opener: SECOND_PERSON_REQUIRED, and 23514 underneath;
//   4. F-14 · the dividend run refused on a FAILED and on an ORDINARY resolution (typed code, and 23514 underneath); paid
//      only on a passed dividend, prepared by one person and confirmed by ANOTHER (the maker confirming → refused);
//   5. TENANT-1e's rule · a resolution closed before 0130 prints "not recorded" — never a recomputed number;
//   6. F-12 class · another tenant's resolutions and ballots are invisible (service and kv_app across the wall);
//   7. Law 3 · an idempotent replay: one key → one resolution, one audit row; one act key → one move, one audit row;
//   8. 9c · an auditor cannot open or close (the global guard, recorded) and holds no governance.manage;
//   9. the record · every act's audit row (actor · reason · before/after · IP), the outbox notices with every member as a
//      recipient, the catalogued templates en/hi/gu with a serving version and every variable present in the payload;
//  10. a closed vote is a FACT · no ballot, no edit, no re-close after close (409 / 23514);
//  11. F-7 class · the list's keyset loses no row created in the same millisecond;
//  12. the TypeScript result and 0182's SQL result are the same rule over a fact matrix.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Reflector } from '@nestjs/core';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { AuditorReadOnlyGuard } from '../../../core/auth/auditor-read-only.guard';
import { runWithContext, type RequestContext } from '../../../core/tenancy-context/request-context';
import { GovernanceRepository } from '../repositories/governance.repository';
import { CoopPayoutRepository } from '../repositories/coop-payout.repository';
import { GovernanceService, GovActor } from '../services/governance.service';
import { CoopPayoutService } from '../services/coop-payout.service';
import { GovernanceController } from '../controllers/v1/governance.controller';
import { tally as oldTally, bylawsFrom } from '../domain/voting-eligibility';
import { outcomeOf } from '../domain/resolution-rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('TENANT-9b · the resolutions (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork; let repo: GovernanceRepository;
  let gov: GovernanceService; let payouts: CoopPayoutService; let auditWriter: AuditWriter;
  const tA = randomUUID(); const tB = randomUUID();
  const adminA = randomUUID(); const admin2A = randomUUID(); const auditorA = randomUUID(); const staffB = randomUUID();
  const members = Array.from({ length: 5 }, () => randomUUID());
  const late = Array.from({ length: 5 }, () => randomUUID());
  let adminPerms: Set<string>; let auditorPerms: Set<string>;
  const actor = (userId: string, permissions: Set<string>): GovActor => ({ userId, permissions, ip: '203.0.113.9', requestId: 'req-9b' });
  const A = () => actor(adminA, adminPerms); const A2 = () => actor(admin2A, adminPerms);
  const civil = (daysAhead: number) => {   // a civil time in IST, `daysAhead` from now — as the form sends it
    const d = new Date(Date.now() + daysAhead * 86_400_000 + 5.5 * 3_600_000);
    return d.toISOString().slice(0, 16);
  };
  const note = 'as minuted at the general meeting';

  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const refusals = async (p: Promise<unknown>) => { try { await p; return ['ok']; } catch (e) { const d = (e as any).details?.refusals; return d ? d.map((r: any) => r.code) : [(e as any).code ?? String(e)]; } };
  const codeOf = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return `${(e as any).httpStatus ?? (e as any).status ?? ''} ${(e as any).code ?? String(e)}`.trim(); } };
  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const permsOf = async (role: string) => new Set<string>((await admin.query(
    `SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((r) => r.p));
  /** A MEMBER of a year's standing with 20 shares (₹4,000 holding) — eligible under 0130's default bylaws. */
  const member = async (u: string, t: string = tA, bank = true) => {
    await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, kyc_status, created_at)
                       SELECT $1, $2, id, true, 'verified', now() - interval '1 year' FROM roles WHERE code = 'farmer'`, [u, t]);
    await admin.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor) VALUES ($1, $2, 20, 400000)`, [t, u]);
    if (bank) await admin.query(`INSERT INTO bank_accounts (user_id, account_kind, account_last4, ifsc, holder_name, vault_ref, penny_verified_at, is_primary)
                                 VALUES ($1, 'bank', '4417', 'KKBK0000001', 'Member', $2, now(), true)`, [u, `vault/${u}`]);
  };
  const staff = (u: string, code: string, t = tA) => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, kyc_status) SELECT $1, $2, id, true, 'none' FROM roles WHERE code = $3`, [u, t, code]);
  const draft = async (over: Record<string, string> = {}, who = A()) =>
    (await gov.create(tA, who, randomUUID(), { title: 'Adopt digital AGM notices', resolutionType: 'agm_vote', votingCloses: civil(7), ...over })).id;
  const act = (id: string, a: 'open' | 'close' | 'withdraw', who = A(), reasonCode?: string) =>
    gov.transition(tA, who, id, a, { note, reasonCode: reasonCode ?? (a === 'close' ? 'agm_declared' : a === 'withdraw' ? 'drafting_error' : undefined) }, randomUUID());
  /** Ballots from the members in order (the five founders, then the five who join in the F-13 probe). */
  const voteAll = async (id: string, choices: string[]) => { const v = [...members, ...late]; for (let i = 0; i < choices.length; i++) await gov.vote(tA, v[i], id, choices[i]); };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tA, 'Anand FPO'); await makeTenant(admin, tB, 'B');
    for (const u of [adminA, admin2A, auditorA, staffB]) await makeUser(admin, u);
    await staff(adminA, 'tenant_admin'); await staff(admin2A, 'tenant_admin'); await staff(auditorA, 'auditor'); await staff(staffB, 'tenant_admin', tB);
    for (const m of members) await member(m, tA, members.indexOf(m) < 3);
    adminPerms = await permsOf('tenant_admin'); auditorPerms = await permsOf('auditor');

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    auditWriter = new AuditWriter(pools);
    repo = new GovernanceRepository(replica as never);
    gov = new GovernanceService(uow, new PgIdempotencyService(pools), repo, auditWriter, new PgOutboxWriter(), new UiMessageRepository(replica as never));
    payouts = new CoopPayoutService(uow, new CoopPayoutRepository(replica as never), auditWriter);
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); await app?.end(); });

  it('0182 · governance.manage is a real row held by tenant_admin; the auditor holds none of it', async () => {
    expect(adminPerms.has('governance.manage')).toBe(true);
    expect(auditorPerms.has('governance.manage')).toBe(false);
    const holders = (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'governance.manage' ORDER BY 1`)).rows.map((x) => x.code);
    expect(holders).toEqual(['tenant_admin']);
  });

  it('F-13 · THE SURVEY\'S PROBE RE-RUN: a member added after close does NOT change a closed resolution\'s result', async () => {
    const id = await draft();
    await act(id, 'open');
    await voteAll(id, ['for', 'for', 'for', 'against']);       // 4 of 5 eligible cast; 3 for
    const closed = await act(id, 'close');
    expect(closed).toMatchObject({ status: 'closed', outcome: 'passed' });
    const before = await gov.results(tA, id);

    // The roll and the bylaws move AFTER the close: five new eligible members, and a 90% quorum.
    for (const u of late) await member(u, tA, false);
    await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'governance.quorum_bp', '9000'::jsonb)`, [tA]);
    const after = await gov.results(tA, id);

    // What d8543fa's results() computed for the same resolution, today: today's roll, today's quorum (`tally` is unchanged).
    const b = bylawsFrom(await repo.bylawSettings(tA));
    const oldPath = oldTally(await repo.tally(tA, id), await repo.eligibleCount(tA, b.minShares, b.minMembershipMonths), b.quorumBp);
    const line = (t: any, o?: string | null) => `eligible ${t.eligible} · cast ${t.cast} · turnout ${t.turnoutBp}bp · quorum ${t.quorumBp}bp ${t.quorumMet ? 'met' : 'NOT met'} · passed ${t.passed}${o ? ` · outcome ${o}` : ''}`;
    // eslint-disable-next-line no-console
    console.log(`[9b F-13 probe] closed resolution ${id}\n  at close            → ${line(before.tally, before.result.outcome)}\n  +5 members, quorum 90% (after close):\n  9b results()        → ${line(after.tally, after.result.outcome)}  [basis ${after.result.basis}]\n  d8543fa path (today's roll) → ${line(oldPath)}`);
    expect(before.result.basis).toBe('snapshot');
    expect(after.tally).toEqual(before.tally);
    expect(after.result.outcome).toBe('passed');
    expect(after.tally).toMatchObject({ eligible: 5, cast: 4, turnoutBp: 8000, quorumBp: 3300, quorumMet: true, passed: true });
    expect(oldPath).toMatchObject({ eligible: 10, turnoutBp: 4000, quorumBp: 9000, quorumMet: false, passed: false });   // the old answer moved
    await admin.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'governance.quorum_bp'`, [tA]);
  });

  it('F-13 · a ballot with an undeclared choice is refused 422 — and 23514 underneath', async () => {
    const id = await draft({ title: 'Choose a new MCC timing' });
    await act(id, 'open');
    const e = await gov.vote(tA, members[0], id, 'yes').then(() => null, (x) => x);
    expect(e).toMatchObject({ code: 'BALLOT_CHOICE_UNDECLARED', httpStatus: 422, details: { choice: 'yes', declared: ['for', 'against', 'abstain'], reason: 'CHOICE_UNDECLARED' } });
    expect(await asApp(tA, (q) => pgCode(q(`INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1, $2, 'yes', $3)`, [id, members[0], tA])))).toBe('23514');
    expect(await gov.vote(tA, members[0], id, 'for')).toMatchObject({ changed: false });
    expect(await gov.vote(tA, members[0], id, 'abstain')).toMatchObject({ changed: true });
    expect(await asApp(tA, (q) => pgCode(q(`UPDATE coop_votes SET choice = 'maybe' WHERE resolution_id = $1`, [id])))).toBe('23514');
  });

  it('0182 · a SPECIAL resolution closed by its opener: SECOND_PERSON_REQUIRED — and 23514 underneath; a second person closes it', async () => {
    const id = await draft({ title: 'Amend bye-law 12 (special)', majority: 'special' });
    await act(id, 'open');
    await voteAll(id, ['for', 'for', 'for', 'for', 'against', 'against']);   // 4/6 = 2/3 of cast — a special majority exactly; 6/10 turnout
    expect(await refusals(act(id, 'close', A()))).toEqual(['SECOND_PERSON_REQUIRED']);
    // Underneath the service: the opener writing the close directly, as kv_app.
    const direct = await asApp(tA, (q) => pgCode(q(
      `UPDATE coop_resolutions SET status='closed', closed_at=now(), closed_by=$2, close_reason='agm_declared', eligible_at_close=5 WHERE id=$1`, [id, adminA])));
    // eslint-disable-next-line no-console
    console.log(`[9b 0182 probe] special resolution closed by its own opener, direct UPDATE as kv_app → ${direct}`);
    expect(direct).toBe('23514');
    expect(await act(id, 'close', A2())).toMatchObject({ status: 'closed', outcome: 'passed' });
    const row = (await admin.query(`SELECT opened_by, closed_by, pass_num, pass_den, pass_strict, rule_fixed_at FROM coop_resolutions WHERE id=$1`, [id])).rows[0];
    expect(row).toEqual({ opened_by: adminA, closed_by: admin2A, pass_num: 2, pass_den: 3, pass_strict: false, rule_fixed_at: 'open' });
  });

  it('F-14 · the dividend run: refused on a FAILED dividend and on an ORDINARY resolution; paid only on a passed one, by two people', async () => {
    // a dividend that FAILED
    const failed = await draft({ title: 'Dividend 12% FY 2025-26', resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '12' });
    await act(failed, 'open');
    await voteAll(failed, ['for', 'against', 'against', 'against']);
    expect(await refusals(act(failed, 'close', A()))).toEqual(['SECOND_PERSON_REQUIRED']);    // dividend-class → a second person
    expect(await act(failed, 'close', A2())).toMatchObject({ outcome: 'failed' });
    const payer = { userId: adminA, canManage: true }; const checker = { userId: admin2A, canManage: true };
    const f1 = await payouts.prepare(tA, payer, failed, randomUUID(), null).then(() => null, (e) => e);
    expect(f1).toMatchObject({ code: 'RESOLUTION_NOT_PAYABLE', httpStatus: 422, details: { reason: 'not_passed' } });
    // an ordinary (agm_vote) resolution that PASSED
    const motion = await draft({ title: 'Adopt the audited accounts' });
    await act(motion, 'open'); await voteAll(motion, ['for', 'for', 'for', 'for']); await act(motion, 'close');
    expect(await payouts.prepare(tA, payer, motion, randomUUID(), null).then(() => null, (e) => e)).toMatchObject({ code: 'RESOLUTION_NOT_PAYABLE', details: { reason: 'not_dividend_class' } });
    // underneath: a run row on the failed dividend, written directly as kv_app
    const direct = await asApp(tA, (q) => pgCode(q(
      `INSERT INTO coop_payout_runs (tenant_id, resolution_id, purpose_code, status, prepared_by) VALUES ($1, $2, 'dividend', 'prepared', $3)`, [tA, failed, adminA])));
    // eslint-disable-next-line no-console
    console.log(`[9b F-14 probe] payout run on a FAILED dividend resolution, direct INSERT as kv_app → ${direct}`);
    expect(direct).toBe('23514');

    // a dividend that PASSED — W198's "Dividend 8%": 8% of each member's ₹4,000 holding = ₹320
    const passed = await draft({ title: 'Dividend 8% FY 2024-25', resolutionType: 'dividend', formulaMode: 'per_share_rate', ratePct: '8' });
    await act(passed, 'open'); await voteAll(passed, ['for', 'for', 'for', 'for']);   // 4 of 10 eligible — quorum met
    expect(await act(passed, 'close', A2())).toMatchObject({ outcome: 'passed' });
    const prep = await payouts.prepare(tA, payer, passed, randomUUID(), '203.0.113.9');
    expect(prep).toMatchObject({ status: 'prepared', purpose: 'dividend' });
    expect((await admin.query(`SELECT count(*)::int AS n FROM payouts WHERE reference_id = $1`, [prep.id])).rows[0].n).toBe(0);   // nothing owed yet
    expect(await codeOf(payouts.confirm(tA, payer, prep.id, null))).toBe('403 PAYOUT_RUN_MAKER_IS_CHECKER');
    // ...and the database refuses a maker-confirmed run whatever the service says
    expect(await asApp(tA, (q) => pgCode(q(`UPDATE coop_payout_runs SET status='queued', confirmed_by=prepared_by, confirmed_at=now() WHERE id=$1`, [prep.id])))).toBe('23514');
    const conf = await payouts.confirm(tA, checker, prep.id, null);
    expect(conf).toMatchObject({ status: 'queued', queuedCount: 3, queuedTotalMinor: '96000' });
    const runRow = (await admin.query(`SELECT r.status, r.prepared_by, r.confirmed_by, b.status AS batch_status FROM coop_payout_runs r JOIN payout_batches b ON b.id = r.batch_id WHERE r.id=$1`, [prep.id])).rows[0];
    expect(runRow).toEqual({ status: 'queued', prepared_by: adminA, confirmed_by: admin2A, batch_status: 'open' });   // TENANT-4b's gate is next
    const lines = (await admin.query(`SELECT amount_minor::text AS a, status, currency_code FROM payouts WHERE reference_id=$1 ORDER BY user_id`, [prep.id])).rows;
    expect(lines).toEqual(Array(3).fill({ a: '32000', status: 'queued', currency_code: 'INR' }));
    const skipped = (await admin.query(`SELECT skipped_detail FROM coop_payout_runs WHERE id=$1`, [prep.id])).rows[0].skipped_detail;
    expect(skipped.map((s: any) => s.reason).sort()).toEqual(Array(skipped.length).fill('skipped_no_bank_account'));
  });

  it('TENANT-1e\'s rule · a resolution closed before 0130 prints "not recorded" — never a recomputed number', async () => {
    const id = randomUUID();
    const c = await admin.connect();
    try {   // history the API cannot write: 0182's guards are off for THIS transaction only (superuser, replica role)
      await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
      await c.query(`INSERT INTO coop_resolutions (id, tenant_id, title, resolution_type, status, outcome, created_at) VALUES ($1, $2, 'AGM 2023 accounts', 'agm_vote', 'closed', 'not_recorded', now() - interval '3 years')`, [id, tA]);
      for (const m of members.slice(0, 3)) await c.query(`INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1, $2, 'for', $3)`, [id, m, tA]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const r = await gov.results(tA, id);
    // eslint-disable-next-line no-console
    console.log(`[9b 1e probe] pre-0130 closed resolution → basis ${r.result.basis}, outcome ${r.result.outcome}, tally ${JSON.stringify(r.tally)}`);
    expect(r.result).toMatchObject({ basis: 'not_recorded', outcome: 'not_recorded' });
    expect(r.tally).toBeNull();
    const row = (await gov.list(tA, { status: 'closed', year: new Date().getUTCFullYear() - 3 })).items.find((x) => x.id === id);
    expect(row?.result).toMatchObject({ basis: 'not_recorded', outcome: 'not_recorded', turnoutBp: null, quorumMet: null });
  });

  it('F-12 class · another tenant\'s resolutions and ballots are invisible — the service and kv_app across the wall', async () => {
    const id = await draft({ title: 'A private matter of Anand FPO' });
    await act(id, 'open'); await gov.vote(tA, members[0], id, 'for');
    expect((await gov.list(tB, {})).items.map((x) => x.id)).not.toContain(id);
    expect(await codeOf(gov.results(tB, id))).toMatch(/NOT_FOUND|404/);
    expect(await refusals(gov.transition(tB, actor(staffB, adminPerms), id, 'close', { note, reasonCode: 'agm_declared' }, randomUUID()))).not.toEqual(['ok']);
    expect(await asApp(tB, (q) => q(`SELECT count(*)::int AS n FROM coop_resolutions WHERE id = $1`, [id]))).toMatchObject({ rows: [{ n: 0 }] });
    expect(await asApp(tB, (q) => q(`SELECT count(*)::int AS n FROM coop_votes WHERE resolution_id = $1`, [id]))).toMatchObject({ rows: [{ n: 0 }] });
    // B's context writing a ballot into A's resolution: the trigger cannot even SEE the resolution under B's RLS.
    expect(await asApp(tB, (q) => pgCode(q(`INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1, $2, 'for', $3)`, [id, members[1], tB])))).not.toBe('ok');
    // A NULL- or other-tenant resolution cannot be written from A's context (0175's split, 0182).
    expect(await asApp(tA, (q) => pgCode(q(`INSERT INTO coop_resolutions (tenant_id, title, resolution_type) VALUES ($1, 'forged', 'agm_vote')`, [tB])))).toBe('42501');
    expect(await asApp(tA, (q) => pgCode(q(`DELETE FROM coop_resolutions WHERE id = $1`, [id])))).toBe('42501');
  });

  it('Law 3 · an idempotent replay: one key → one resolution and one audit row; one act key → one move', async () => {
    const key = randomUUID();
    const body = { title: 'Replay-safe motion', resolutionType: 'agm_vote', votingCloses: civil(7) };
    const a = await gov.create(tA, A(), key, body); const b = await gov.create(tA, A(), key, body);
    expect(b).toEqual(a);
    expect((await admin.query(`SELECT count(*)::int AS n FROM coop_resolutions WHERE tenant_id=$1 AND title='Replay-safe motion'`, [tA])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='governance.resolution.created'`, [tA, a.id])).rows[0].n).toBe(1);
    const k2 = randomUUID();
    const o1 = await gov.transition(tA, A(), a.id, 'open', { note }, k2); const o2 = await gov.transition(tA, A(), a.id, 'open', { note }, k2);
    expect(o2).toEqual(o1);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 AND action='governance.resolution.opened'`, [tA, a.id])).rows[0].n).toBe(1);
  });

  it('9c · an auditor cannot open or close — refused at the global guard (recorded) and without governance.manage at the service', async () => {
    const id = await draft({ title: 'An auditor must not open this' });
    const roles = (await admin.query(`SELECT r.code FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id WHERE u.user_id = $1 AND u.tenant_id = $2`, [auditorA, tA])).rows.map((x) => x.code);
    const ctx: RequestContext = { tenantId: tA, userId: auditorA, sessionId: 's', requestId: 'req-9b-aud', lang: 'en', roles, permissions: auditorPerms, shardId: 0 };
    const guard = new AuditorReadOnlyGuard(new Reflector(), auditWriter);
    for (const a of ['open', 'close']) {
      const exec = { getType: () => 'http', getHandler: () => GovernanceController.prototype.act, getClass: () => GovernanceController,
        switchToHttp: () => ({ getRequest: () => ({ method: 'POST', originalUrl: `/v1/governance/resolutions/${id}/acts/${a}` }) }) } as never;
      const err = await runWithContext(ctx, () => guard.canActivate(exec).then(() => null, (e) => e as { code: string; httpStatus: number }));
      expect(err).toMatchObject({ code: 'AUDITOR_READ_ONLY', httpStatus: 403 });
    }
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id=$1 AND actor_user_id=$2 AND action='auditor.write_refused'`, [tA, auditorA])).rows[0].n).toBe(2);
    expect(await refusals(gov.transition(tA, actor(auditorA, auditorPerms), id, 'open', { note }, randomUUID()))).toEqual(['NO_PERMISSION']);
    // …and the auditor's governance.read still reads.
    expect((await gov.list(tA, { status: 'draft' })).items.map((x) => x.id)).toContain(id);
  });

  it('the record · every act audited (actor · reason · before/after · IP); open and close tell every member, in en/hi/gu', async () => {
    const id = await draft({ title: 'Patronage bonus FY 2025-26', resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1.2', capAmount: '2500', fiscalYear: '2025' });
    await gov.update(tA, A(), id, randomUUID(), { title: 'Patronage bonus FY 2025-26', resolutionType: 'patronage_bonus', formulaMode: 'patronage_pct', ratePct: '1.2', capAmount: '2500', fiscalYear: '2025', votingCloses: civil(9) });
    await act(id, 'open'); await voteAll(id, ['for', 'for', 'for', 'for']); await act(id, 'close', A2());
    const rows = (await admin.query(`SELECT action, actor_user_id, reason, host(ip) AS ip, old_value, new_value FROM audit_log WHERE tenant_id=$1 AND entity_id=$2 ORDER BY id`, [tA, id])).rows;
    expect(rows.map((r) => r.action)).toEqual(['governance.resolution.created', 'governance.resolution.edited', 'governance.resolution.opened', 'governance.resolution.closed']);
    expect(rows.every((r) => r.ip === '203.0.113.9')).toBe(true);
    expect(rows[1].new_value.diff).toEqual([expect.objectContaining({ field: 'votingCloses' })]);
    expect(rows[2]).toMatchObject({ actor_user_id: adminA, reason: note, old_value: { status: 'draft' }, new_value: { status: 'open', ruleFixedAt: 'open', rule: { quorumBp: 3300, num: 1, den: 2, strict: true } } });
    expect(rows[3]).toMatchObject({ actor_user_id: admin2A, old_value: { status: 'open', openedBy: adminA }, new_value: { status: 'closed', outcome: 'passed', reasonCode: 'agm_declared', secondPerson: true } });
    expect(rows[0].new_value.payload).toEqual({ mode: 'patronage_pct', rateBp: 120, capMinor: '250000', fiscalYear: 2025, currencyCode: 'INR' });

    const ev = (await admin.query(`SELECT event_type, payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY id`, [tA, id])).rows;
    expect(ev.map((e) => e.event_type)).toEqual(['governance.resolution_opened', 'governance.resolution_closed']);
    const everyMember = [...members, ...late].sort();
    expect([...ev[0].payload.recipientUserIds].sort()).toEqual(everyMember);
    expect(ev[1].payload).toMatchObject({ outcome: 'passed', for: '4', against: '0', abstain: '0', result: { en: 'passed', hi: 'पारित', gu: 'પસાર' } });
    expect(ev[0].payload.closes).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    // The catalogue: both events, push + inapp × en/hi/gu, each with a SERVING version (0122's send gate), every {{var}} in the payload.
    const tpl = (await admin.query(`SELECT t.event_code, t.channel, t.language_code, t.body, t.serving_version_id IS NOT NULL AS serving
                                       FROM notification_templates t WHERE t.event_code IN ('resolution.opened','resolution.closed') AND t.tenant_id IS NULL ORDER BY 1,2,3`)).rows;
    expect(tpl).toHaveLength(12);
    expect(tpl.every((t) => t.serving)).toBe(true);
    for (const t of tpl) {
      const payload = t.event_code === 'resolution.opened' ? ev[0].payload : ev[1].payload;
      for (const v of [...String(t.body).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])) expect([t.event_code, v, v in payload]).toEqual([t.event_code, v, true]);
    }
    expect((await admin.query(`SELECT count(*)::int AS n FROM notification_events WHERE code = 'resolution.closing_soon'`)).rows[0].n).toBe(0);   // named, not catalogued
  });

  it('a closed vote is a FACT — no ballot, no edit, no re-close, no re-open after close (409 / 23514)', async () => {
    const id = await draft({ title: 'Closed means closed' });
    await act(id, 'open'); await gov.vote(tA, members[0], id, 'for'); await act(id, 'close');
    expect(await codeOf(gov.vote(tA, members[1], id, 'for'))).toMatch(/409/);
    expect(await refusals(act(id, 'close'))).toEqual(['ALREADY_DECIDED']);
    expect(await refusals(act(id, 'open'))).toEqual(['ALREADY_DECIDED']);
    expect(await refusals(gov.update(tA, A(), id, randomUUID(), { title: 'Rewritten after the fact', resolutionType: 'agm_vote' }))).toEqual(['NOT_A_DRAFT']);
    for (const sql of [`UPDATE coop_resolutions SET title='edited' WHERE id=$1`, `UPDATE coop_resolutions SET status='open' WHERE id=$1`,
                       `UPDATE coop_resolutions SET eligible_at_close = 9999 WHERE id=$1`, `UPDATE coop_resolutions SET outcome='failed' WHERE id=$1`]) {
      expect([sql, await asApp(tA, (q) => pgCode(q(sql, [id])))]).toEqual([sql, '23514']);
    }
    expect(await asApp(tA, (q) => pgCode(q(`UPDATE coop_votes SET choice='against' WHERE resolution_id=$1`, [id])))).toBe('23514');
    expect(await asApp(tA, (q) => pgCode(q(`INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1,$2,'for',$3)`, [id, members[2], tA])))).toBe('23514');
    // withdraw: a draft, with a declared reason; then final too
    const w = await draft({ title: 'Drafted in error' });
    expect(await act(w, 'withdraw')).toMatchObject({ status: 'withdrawn', outcome: null });
    expect(await refusals(act(w, 'open'))).toEqual(['ALREADY_DECIDED']);
  });

  it('board_election · refused by name — at drafting, and at open underneath (no candidate table)', async () => {
    expect(await refusals(gov.create(tA, A(), randomUUID(), { title: 'Board election — 2 seats', resolutionType: 'board_election', votingCloses: civil(5) })))
      .toEqual(['BOARD_ELECTION_NOT_MODELLED']);
    const c = await admin.connect(); const id = randomUUID();
    try { await c.query(`INSERT INTO coop_resolutions (id, tenant_id, title, resolution_type) VALUES ($1, $2, 'legacy board election', 'board_election')`, [id, tA]); } finally { c.release(); }
    expect(await asApp(tA, (q) => pgCode(q(`UPDATE coop_resolutions SET status='open', opened_at=now(), opened_by=$2, quorum_bp=3300, pass_num=1, pass_den=2, pass_strict=true, rule_fixed_at='open' WHERE id=$1`, [id, adminA])))).toBe('23514');
  });

  it('F-7 class · the list\'s keyset loses no row created in the same millisecond', async () => {
    const ids: string[] = [randomUUID(), randomUUID(), randomUUID()];
    const stamps = ['2026-01-10 10:00:00.123100+00', '2026-01-10 10:00:00.123400+00', '2026-01-10 10:00:00.123700+00'];
    for (let i = 0; i < 3; i++) await admin.query(`INSERT INTO coop_resolutions (id, tenant_id, title, resolution_type, created_at) VALUES ($1, $2, $3, 'agm_vote', $4)`, [ids[i], tB, `same-ms ${i}`, stamps[i]]);
    const seen: string[] = []; let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const { decodeKeyset, UUID_RE } = await import('../../../shared/pagination/us-keyset');
      const r = await gov.list(tB, { year: 2026 }, cursor ? decodeKeyset(cursor, UUID_RE) : undefined, 1);
      seen.push(...r.items.map((x) => x.id));
      if (!r.nextCursor) break; cursor = r.nextCursor;
    }
    expect(seen.filter((x) => ids.includes(x))).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('the TypeScript result and 0182\'s SQL result are the same rule (a fact matrix)', async () => {
    const cases: Array<[number, number, number, number, number, number, number, boolean]> = [
      // for, against, abstain, eligible, quorumBp, num, den, strict
      [3, 1, 0, 5, 3300, 1, 2, true], [2, 2, 0, 5, 3300, 1, 2, true], [1, 0, 0, 3, 3300, 1, 2, true], [1, 0, 0, 4, 3300, 1, 2, true],
      [2, 1, 0, 9, 3300, 2, 3, false], [6, 0, 4, 10, 3300, 2, 3, false], [7, 0, 3, 10, 3300, 2, 3, false], [0, 0, 0, 5, 3300, 1, 2, true],
      [3, 0, 0, 0, 3300, 1, 2, true], [5, 4, 1, 10, 10000, 1, 2, true], [10, 0, 0, 10, 10000, 3, 4, false], [3, 1, 0, 4, 3300, 3, 4, false],
    ];
    const voters = [...members, ...late];
    for (const [f, a, ab, eligible, q, num, den, strict] of cases) {
      const id = randomUUID();
      const c = await admin.connect();
      try {
        await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
        await c.query(`INSERT INTO coop_resolutions (id, tenant_id, title, resolution_type, status) VALUES ($1, $2, 'matrix', 'agm_vote', 'open')`, [id, tA]);
        const choices = [...Array(f).fill('for'), ...Array(a).fill('against'), ...Array(ab).fill('abstain')];
        for (let i = 0; i < choices.length; i++) await c.query(`INSERT INTO coop_votes (resolution_id, member_user_id, choice, tenant_id) VALUES ($1,$2,$3,$4)`, [id, voters[i], choices[i], tA]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      const sql = (await admin.query(`SELECT coop_resolution_outcome($1, $2, $3, $4, $5, $6) AS o`, [id, eligible, q, num, den, strict])).rows[0].o;
      const ts = outcomeOf([{ choice: 'for', votes: f }, { choice: 'against', votes: a }, { choice: 'abstain', votes: ab }].filter((x) => x.votes > 0), ['for'], eligible, { quorumBp: q, num, den, strict });
      expect([f, a, ab, eligible, q, `${num}/${den}${strict ? '>' : '≥'}`, sql]).toEqual([f, a, ab, eligible, q, `${num}/${den}${strict ? '>' : '≥'}`, ts]);
    }
  });
});
