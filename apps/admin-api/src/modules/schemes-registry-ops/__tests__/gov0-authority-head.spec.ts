// apps/admin-api/src/modules/schemes-registry-ops/__tests__/gov0-authority-head.spec.ts · PC-56 GOV-0 — the platform appoints an authority's
// FIRST head: the route is FIDO2 + step-up + schemes.registry.manage (Law 11); the service refuses a bad term / reason / phone, an authority
// that already has a current head and an unknown phone BEFORE any insert; the happy path inserts ONE row and writes ONE audit row in the
// same transaction; 0239's `[GOV_AUTHORITY_HAS_HEAD]` (the race) is named.
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { HardwareKeyGuard } from '../../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../../core/auth/step-up-reauth.guard';
import { SchemesRegistryOpsController } from '../schemes-registry-ops.controller';
import { AuthorityHeadService, headAppointmentRefusal } from '../services/authority-head.service';

const AUTH = 'a0000000-0000-7000-8000-000000000001';
const actor = { userId: 'f0000000-0000-7000-8000-000000000001', roles: ['platform_schemes_ops'], ip: '127.0.0.1', requestId: 'r1' } as any;
const ok = { phone: '+919712345678', termMonths: 12, reason: 'first head named by the department order' };

function build(o: { authority?: boolean; heads?: number; user?: string | null; insertError?: Error } = {}) {
  const sql: string[] = [];
  const client = {
    query: jest.fn(async (q: string) => {
      sql.push(q.trim().split(/\s+/).slice(0, 3).join(' '));
      if (q.includes('FROM scheme_authorities')) return { rows: o.authority === false ? [] : [{ id: AUTH }] };
      if (q.includes('gov_authority_live_heads')) return { rows: [{ n: o.heads ?? 0 }] };
      if (q.includes('FROM users')) return { rows: o.user === null ? [] : [{ id: o.user ?? 'u1' }] };
      if (q.includes('INSERT INTO authority_memberships')) { if (o.insertError) throw o.insertError; return { rows: [{ id: 'm1', expires_at: '2027-11-10T00:00:00Z' }] }; }
      return { rows: [] };
    }),
  };
  const pool = { withTx: jest.fn(async (fn: (c: unknown) => Promise<unknown>) => fn(client)) };
  const audit = { write: jest.fn(async () => undefined) };
  return { svc: new AuthorityHeadService(pool as any, audit as any), sql, audit, pool };
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: any) => e?.getResponse?.().code ?? String(e));

describe('PC-56 GOV-0 · the platform appoints an authority\'s first head (admin realm)', () => {
  it('the route carries FIDO2 + step-up (Law 11)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SchemesRegistryOpsController.prototype.appointHead) ?? [];
    expect(guards).toEqual(expect.arrayContaining([HardwareKeyGuard, StepUpReauthGuard]));
  });
  it('a bad term / reason, a malformed id or phone are refused before any transaction', async () => {
    expect(headAppointmentRefusal({ termMonths: 13, reason: ok.reason })).toBe('GOV_TERM_INVALID');
    expect(headAppointmentRefusal({ termMonths: 0, reason: ok.reason })).toBe('GOV_TERM_INVALID');
    expect(headAppointmentRefusal({ termMonths: 6, reason: 'short' })).toBe('GOV_REASON_REQUIRED');
    const t = build();
    expect(await codeOf(t.svc.appoint(actor, AUTH, { ...ok, termMonths: 13 }))).toBe('GOV_TERM_INVALID');
    expect(await codeOf(t.svc.appoint(actor, 'nope', ok))).toBe('AUTHORITY_NOT_FOUND');
    expect(await codeOf(t.svc.appoint(actor, AUTH, { ...ok, phone: '12345' }))).toBe('GOV_PERSON_UNKNOWN');
    expect(t.pool.withTx).not.toHaveBeenCalled();
  });
  it('an authority with a current head, an unknown authority and an unknown phone → refused, nothing inserted, nothing audited', async () => {
    for (const [o, code] of [[{ heads: 1 }, 'GOV_AUTHORITY_HAS_HEAD'], [{ authority: false }, 'AUTHORITY_NOT_FOUND'], [{ user: null }, 'GOV_PERSON_UNKNOWN']] as const) {
      const t = build(o as any);
      expect(await codeOf(t.svc.appoint(actor, AUTH, ok))).toBe(code);
      expect(t.sql.some((q) => q.startsWith('INSERT INTO authority_memberships'))).toBe(false);
      expect(t.audit.write).not.toHaveBeenCalled();
    }
  });
  it('the happy path: ONE insert (the end date is the database\'s) and ONE audit row, the phone masked', async () => {
    const t = build();
    const out = await t.svc.appoint(actor, AUTH, ok);
    expect(out.data).toEqual({ id: 'm1', authorityId: AUTH, roleCode: 'authority_head', status: 'active', expiresAt: '2027-11-10T00:00:00.000Z', phoneMasked: '••••••678' });
    expect(t.sql.filter((q) => q.startsWith('INSERT INTO authority_memberships'))).toHaveLength(1);
    expect(t.audit.write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify((t.audit.write.mock.calls as any)[0][1])).not.toContain(ok.phone);
  });
  it('the 0239 guard\'s race refusal is named', async () => {
    const t = build({ insertError: new Error('[GOV_AUTHORITY_HAS_HEAD] this authority already has a current head — PC-56 GOV-0') });
    expect(await codeOf(t.svc.appoint(actor, AUTH, ok))).toBe('GOV_AUTHORITY_HAS_HEAD');
  });
});
