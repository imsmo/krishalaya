// apps/admin-api/src/modules/partner-ops/__tests__/partner-ops.spec.ts · PC-56 PARTNER-1a (founder D2 + D3).
//
// Pure / mocked — no database. What is pinned: the DTO bounds (the reason floor lives on one line), the SLA merge that
// owns one key, the invite token shape (and its parity with apps/api), the controller's permission + elevation metadata,
// and the service's single-transaction writes — including that the raw token reaches the response and nothing else.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HttpException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InvitePartnerAdminSchema, SetPartnerSlaSchema } from '../dto/partner-ops.dto';
import { PARTNER_OPS_REASON_MIN, newInviteToken, nextSla } from '../domain/partner-ops.rules';
import { namedPartnerOpsError } from '../domain/partner-ops.errors';
import { toRegistryRow, PartnerOpsRepository } from '../repositories/partner-ops.repository';
import { PartnerOpsService } from '../services/partner-ops.service';
import { PartnerOpsController } from '../partner-ops.controller';
import { REQUIRE_OWNER_PERMISSION } from '../../../core/rbac/owner-roles';
import { HardwareKeyGuard } from '../../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../../core/auth/step-up-reauth.guard';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';

const PARTNER = '0190f0aa-1111-7111-8111-111111111111';
const ROLE = '0190f0aa-2222-7222-8222-222222222222';
const INVITE = '0190f0aa-3333-7333-8333-333333333333';
const ADMIN = '0190f0aa-4444-7444-8444-444444444444';
const REASON = 'the partner signed the onboarding agreement today';
const PHONE = '+919812345678';

const actor = {
  userId: ADMIN, roles: ['platform_partners_ops'], ip: '127.0.0.1', requestId: 'req-1',
} as unknown as AdminRequestContext;

/* ------------------------------------------------------------------------------------------------ */
describe('PARTNER-1a · DTO bounds', () => {
  it('refuses a reason of 19 characters after trim and accepts 20', () => {
    expect(PARTNER_OPS_REASON_MIN).toBe(20);
    const r19 = '  ' + 'x'.repeat(19) + '   ';
    const r20 = '  ' + 'x'.repeat(20) + '   ';
    expect(SetPartnerSlaSchema.safeParse({ decisionHours: 48, reason: r19 }).success).toBe(false);
    expect(SetPartnerSlaSchema.safeParse({ decisionHours: 48, reason: r20 }).success).toBe(true);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: r19 }).success).toBe(false);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: r20 }).success).toBe(true);
  });

  it('bounds decisionHours to whole hours 1..720, and accepts null as "no promise"', () => {
    for (const bad of [0, 721, 1.5]) {
      expect(SetPartnerSlaSchema.safeParse({ decisionHours: bad, reason: REASON }).success).toBe(false);
    }
    for (const ok of [null, 1, 720]) {
      expect(SetPartnerSlaSchema.safeParse({ decisionHours: ok, reason: REASON }).success).toBe(true);
    }
  });

  it('is .strict(): an unknown key is refused', () => {
    expect(SetPartnerSlaSchema.safeParse({ decisionHours: 48, reason: REASON, proposedByAdminId: ADMIN }).success).toBe(false);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: REASON, role: 'partner_admin' }).success).toBe(false);
  });

  it('wants an E.164 phone', () => {
    expect(InvitePartnerAdminSchema.safeParse({ phone: '9812345678', reason: REASON }).success).toBe(false);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: REASON }).success).toBe(true);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: REASON, languageCode: 'fr' }).success).toBe(false);
    expect(InvitePartnerAdminSchema.safeParse({ phone: PHONE, reason: REASON, languageCode: 'gu' }).success).toBe(true);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('PARTNER-1a · nextSla owns one key', () => {
  it('sets decision_hours and keeps every other key', () => {
    expect(nextSla({ disbursal_hours: 72, claim_days: 15 }, 48)).toEqual({ disbursal_hours: 72, claim_days: 15, decision_hours: 48 });
    expect(nextSla({ decision_hours: 24, disbursal_hours: 72 }, 48)).toEqual({ decision_hours: 48, disbursal_hours: 72 });
  });
  it('REMOVES decision_hours on null and keeps the rest', () => {
    const out = nextSla({ decision_hours: 24, disbursal_hours: 72 }, null);
    expect(out).toEqual({ disbursal_hours: 72 });
    expect(Object.prototype.hasOwnProperty.call(out, 'decision_hours')).toBe(false);
  });
  it('does not mutate the old object and tolerates a non-object', () => {
    const old = { decision_hours: 24 };
    nextSla(old, null);
    expect(old).toEqual({ decision_hours: 24 });
    expect(nextSla(null, 12)).toEqual({ decision_hours: 12 });
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('PARTNER-1a · the invite token', () => {
  it('is 43 chars of base64url and a 64-hex sha256 of itself', () => {
    const { token, hash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createHash } = require('node:crypto');
    expect(createHash('sha256').update(token, 'utf8').digest('hex')).toBe(hash);
    expect(newInviteToken().token).not.toBe(token);
  });

  // The partner realm's accept path hashes the presented code exactly as apps/api mints it. If that file changes shape,
  // a platform-minted code stops being acceptable — so the two realms are pinned to each other here.
  it('has the same shape apps/api mints (parity read from disk)', () => {
    const file = path.join(__dirname, '..', '..', '..', '..', '..', 'api', 'src', 'modules', 'identity', 'domain', 'verification-team.ts');
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toContain("randomBytes(32).toString('base64url')");
    expect(src).toContain(".digest('hex')");
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('PARTNER-1a · registry row mapper', () => {
  const base = {
    id: PARTNER, code: 'example_bank', default_name: 'Example Bank', partner_kind: 'bank',
    regulator_ref: 'LIC-2026-00451', sla: { decision_hours: 48, other: 1 }, active: true,
    console_members: 3, active_admins: 1, pending_invite_id: null, pending_invite_expires_at: null,
  };
  it('masks the regulator reference to its last four characters', () => {
    expect(toRegistryRow(base).regulatorRefMasked).toBe('••••0451');
    expect(toRegistryRow({ ...base, regulator_ref: null }).regulatorRefMasked).toBeNull();
  });
  it('reads slaDecisionHours only as an integer >= 1', () => {
    expect(toRegistryRow(base).slaDecisionHours).toBe(48);
    expect(toRegistryRow({ ...base, sla: { decision_hours: 0 } }).slaDecisionHours).toBeNull();
    expect(toRegistryRow({ ...base, sla: {} }).slaDecisionHours).toBeNull();
  });
  it('maps the names, counts and the pending invite', () => {
    const row = toRegistryRow({ ...base, pending_invite_id: INVITE, pending_invite_expires_at: new Date('2026-10-25T00:00:00Z') });
    expect(row).toMatchObject({
      id: PARTNER, code: 'example_bank', name: 'Example Bank', kind: 'bank', active: true, consoleMembers: 3, activeAdmins: 1,
      pendingAdminInvite: { id: INVITE, expiresAt: '2026-10-25T00:00:00.000Z' },
    });
    expect(toRegistryRow(base).pendingAdminInvite).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('PARTNER-1a · controller metadata', () => {
  const proto = PartnerOpsController.prototype as any;
  it('demands partners.read on the reads and partners.manage on the writes', () => {
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.list)).toBe('partners.read');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.get)).toBe('partners.read');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.setSla)).toBe('partners.manage');
    expect(Reflect.getMetadata(REQUIRE_OWNER_PERMISSION, proto.adminInvite)).toBe('partners.manage');
  });
  it('puts FIDO2 + step-up on both writes and not on the reads', () => {
    expect(GUARDS_METADATA).toBe('__guards__');
    for (const h of [proto.setSla, proto.adminInvite]) {
      const guards = Reflect.getMetadata('__guards__', h) ?? [];
      expect(guards).toEqual(expect.arrayContaining([HardwareKeyGuard, StepUpReauthGuard]));
    }
    for (const h of [proto.list, proto.get]) expect(Reflect.getMetadata('__guards__', h)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------ */
type Responder = (sql: string, params: unknown[]) => { rows: any[] } | Error;

function harness(respond: Responder) {
  const queries: { client: string; sql: string; params: unknown[] }[] = [];
  let txCount = 0;
  const pool = {
    query: jest.fn(),
    withTx: jest.fn(async (fn: (c: any) => Promise<unknown>) => {
      const name = `tx${++txCount}`;
      const client = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
          queries.push({ client: name, sql, params });
          const out = respond(sql, params);
          if (out instanceof Error) throw out;
          return out;
        }),
      };
      return fn(client);
    }),
  } as unknown as AdminPool;
  const repo = new PartnerOpsRepository(pool);
  const audit = new AdminAuditWriter(pool);
  const service = new PartnerOpsService(pool, repo, audit);
  return { service, queries, pool };
}

const auditRows = <T extends { sql: string }>(qs: T[]) => qs.filter((q) => /INSERT INTO audit_log/.test(q.sql));

describe('PARTNER-1a · service: the SLA write', () => {
  it('locks, updates and audits on the SAME client, in one transaction', async () => {
    const { service, queries, pool } = harness((sql) => {
      if (/FROM financial_partners/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [{ id: PARTNER, sla: { decision_hours: 24, disbursal_hours: 72 } }] };
      return { rows: [] };
    });
    const out = await service.setSla(actor, PARTNER, { decisionHours: 48, reason: REASON });
    expect((pool as any).withTx).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ data: { id: PARTNER, slaDecisionHours: 48, previous: 24, checker: 'single_administrator' } });

    const lock = queries.find((q) => /FOR UPDATE/.test(q.sql));
    const update = queries.find((q) => /UPDATE financial_partners SET sla/.test(q.sql));
    const audits = auditRows(queries);
    expect(lock && update).toBeTruthy();
    expect(audits).toHaveLength(1);
    expect(new Set([lock!.client, update!.client, audits[0].client])).toEqual(new Set(['tx1']));
    expect(JSON.parse(String(update!.params[1]))).toEqual({ decision_hours: 48, disbursal_hours: 72 });
    expect(audits[0].params).toEqual(expect.arrayContaining(['partners.sla_set', 'financial_partner', PARTNER, REASON]));
  });

  it('404s an unknown partner and a non-uuid id', async () => {
    const { service } = harness(() => ({ rows: [] }));
    await expect(service.setSla(actor, PARTNER, { decisionHours: 1, reason: REASON }))
      .rejects.toMatchObject({ response: { code: 'PARTNER_NOT_FOUND' }, status: 404 });
    await expect(service.get('not-a-uuid')).rejects.toMatchObject({ response: { code: 'PARTNER_NOT_FOUND' }, status: 404 });
  });
});

describe('PARTNER-1a · service: the first-administrator invite', () => {
  const happy: Responder = (sql) => {
    if (/SELECT id FROM financial_partners/.test(sql)) return { rows: [{ id: PARTNER }] };
    if (/FROM partner_memberships/.test(sql)) return { rows: [{ n: 0 }] };
    if (/SELECT id, expires_at FROM partner_invites/.test(sql)) return { rows: [] };
    if (/SELECT id FROM roles/.test(sql)) return { rows: [{ id: ROLE }] };
    if (/INSERT INTO partner_invites/.test(sql)) return { rows: [{ id: INVITE, expires_at: new Date('2026-10-25T10:00:00Z') }] };
    return { rows: [] };
  };

  it('refuses a partner that already has an administrator, and inserts nothing', async () => {
    const { service, queries } = harness((sql, p) => (/FROM partner_memberships/.test(sql) ? { rows: [{ n: 1 }] } : happy(sql, p)));
    await expect(service.inviteFirstAdmin(actor, PARTNER, { phone: PHONE, reason: REASON }))
      .rejects.toMatchObject({ response: { code: 'PARTNER_HAS_ADMIN' }, status: 409 });
    expect(queries.some((q) => /INSERT/.test(q.sql))).toBe(false);
  });

  it('writes the invite, the outbox row and the audit row — and the raw token appears only in the response', async () => {
    const { service, queries } = harness(happy);
    const out = await service.inviteFirstAdmin(actor, PARTNER, { phone: PHONE, reason: REASON });
    const { token } = out.data;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.data).toMatchObject({
      inviteId: INVITE, partnerId: PARTNER, roleCode: 'partner_admin', phoneMasked: '••••••678',
      expiresAt: '2026-10-25T10:00:00.000Z', shownOnce: true, delivery: 'handover',
    });

    const invite = queries.find((q) => /INSERT INTO partner_invites/.test(q.sql))!;
    const outbox = queries.find((q) => /INSERT INTO outbox_events/.test(q.sql))!;
    const audits = auditRows(queries);
    expect(invite && outbox).toBeTruthy();
    expect(audits).toHaveLength(1);
    expect(new Set(queries.map((q) => q.client))).toEqual(new Set(['tx1']));

    // the stored value is the HASH, never the token; the trigger-owned and ungranted columns are not named
    expect(invite.params).not.toContain(token);
    expect(invite.params).toEqual(expect.arrayContaining([PARTNER, PHONE, ROLE, ADMIN, 'en']));
    const cols = invite.sql.match(/partner_invites \(([^)]*)\)/)![1];
    expect(cols).not.toMatch(/expires_at|token_sealed/);
    expect(invite.sql).not.toMatch(/\binvited_by\b(?!_admin_id)/);

    const payload = JSON.parse(String(outbox.params[1]));
    expect(payload).toEqual({ v: 1, inviteId: INVITE, partnerId: PARTNER, by: 'platform' });
    expect(JSON.stringify(outbox.params)).not.toContain(token);

    expect(JSON.stringify(audits[0].params)).not.toContain(token);
    expect(JSON.stringify(audits[0].params)).not.toContain(PHONE);
    expect(audits[0].params).toEqual(expect.arrayContaining(['partners.admin_invite_created', 'partner_invite', INVITE, REASON]));
  });

  it('maps the trigger\'s [PARTNER_ADMIN_INVITE_PENDING] to a 409 with that code', async () => {
    const { service } = harness((sql, p) => (/INSERT INTO partner_invites/.test(sql)
      ? new Error('[PARTNER_ADMIN_INVITE_PENDING] a platform invite for this partner\'s first administrator is still open — PC-56 PARTNER-1a')
      : happy(sql, p)));
    const err = await service.inviteFirstAdmin(actor, PARTNER, { phone: PHONE, reason: REASON }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({ code: 'PARTNER_ADMIN_INVITE_PENDING' });
  });

  it('maps the other named database refusals and rethrows anything else', () => {
    const code = (e: unknown) => (namedPartnerOpsError(e)?.getResponse() as any)?.code;
    expect(code(new Error('[PARTNER_HAS_ADMIN] x'))).toBe('PARTNER_HAS_ADMIN');
    expect(namedPartnerOpsError(new Error('[PARTNER_NOT_FOUND] x'))?.getStatus()).toBe(404);
    expect(code(new Error('[PARTNER_PLATFORM_ROLE] x'))).toBe('PARTNER_PLATFORM_ROLE');
    expect(code(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_pi_one_pending' }))).toBe('PARTNER_INVITE_PENDING_EXISTS');
    expect(namedPartnerOpsError(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'uq_pi_token' }))).toBeNull();
    expect(namedPartnerOpsError(new Error('connection reset'))).toBeNull();
  });
});
