// modules/gov-console/__tests__/gov-members.refusal-order.spec.ts · PC-56 GOV-0 · E14 — THE REFUSAL ORDER, pinned with a spy: every refusal of
// a membership act comes AFTER the permission guard and the key check and BEFORE `idem.remember` and any write — a refused act never reserves
// its idempotency key and never opens a write transaction. And the happy path DOES go through `idem.remember` (so the spy proves something).
import { GovMembersService } from '../services/gov-members.service';
import { GovSession } from '../guards/gov-session.guard';

const AUTH = 'a0000000-0000-7000-8000-000000000001';
const B = 'b0000000-0000-7000-8000-000000000001';
const C = 'c0000000-0000-7000-8000-000000000001';
const D = 'd0000000-0000-7000-8000-000000000001';
const M = 'e0000000-0000-7000-8000-000000000001';
const session = (userId: string): GovSession => ({ userId, authorityId: AUTH, sessionId: 's', roles: ['authority_head'], permissions: new Set(['authority.members.approve', 'authority.members.remove', 'authority.members.request']), expiresAt: null, ip: null, requestId: null });

function build(facts: Record<string, unknown> | null, phoneUser: string | null = D) {
  const writes: string[] = [];
  const repo = {
    membershipTx: jest.fn(async () => facts),
    userIdByPhoneTx: jest.fn(async () => phoneUser),
    requestTx: jest.fn(async () => { writes.push('request'); return M; }),
    approveTx: jest.fn(async () => { writes.push('approve'); return true; }),
    removeTx: jest.fn(async () => { writes.push('remove'); return true; }),
    expiresAtTx: jest.fn(async () => '2027-11-10T00:00:00.000Z'),
    isLiveMemberTx: jest.fn(async () => false),
  };
  const uow = { run: jest.fn(async (_a: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ query: jest.fn() })) };
  const audit = { write: jest.fn(async () => undefined) };
  const auth = { revokeGovSessionsIn: jest.fn(async () => { writes.push('cut'); return 1; }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => Promise<unknown>) => fn()) };
  const svc = new GovMembersService(repo as any, uow as any, audit as any, auth as any, idem as any);
  return { svc, repo, idem, writes, auth };
}
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? String(e));
const pending = { id: M, userId: D, roleCode: 'authority_officer', status: 'requested', requestedBy: B, expiresAt: null };

describe('PC-56 GOV-0 · the refusal order (E14): refusals before idem.remember, never a write', () => {
  it('approve: B approving the request B made → GOV_APPROVER_IS_REQUESTER; the key is never reserved, nothing written', async () => {
    const t = build(pending);
    expect(await codeOf(t.svc.approve(session(B), M, 'k1'))).toBe('GOV_APPROVER_IS_REQUESTER');
    expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('approve: the grantee approving → GOV_APPROVER_IS_GRANTEE; not reserved, nothing written', async () => {
    const t = build(pending);
    expect(await codeOf(t.svc.approve(session(D), M, 'k1'))).toBe('GOV_APPROVER_IS_GRANTEE');
    expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('approve: no key → GOV_IDEMPOTENCY_KEY_REQUIRED before the row is even read', async () => {
    const t = build(pending);
    expect(await codeOf(t.svc.approve(session(C), M, undefined))).toBe('GOV_IDEMPOTENCY_KEY_REQUIRED');
    expect(t.repo.membershipTx).not.toHaveBeenCalled(); expect(t.idem.remember).not.toHaveBeenCalled();
  });
  it('approve: C (the second person) → through idem.remember, one write', async () => {
    const t = build(pending);
    expect(await t.svc.approve(session(C), M, 'k1')).toEqual({ id: M, status: 'active', expiresAt: '2027-11-10T00:00:00.000Z' });
    expect(t.idem.remember).toHaveBeenCalledTimes(1); expect(t.writes).toEqual(['approve']);
  });
  it('remove: your own row → GOV_REMOVE_SELF; a short reason → GOV_REASON_REQUIRED; neither reserves the key', async () => {
    const t = build({ ...pending, status: 'active', userId: C });
    expect(await codeOf(t.svc.remove(session(C), M, 'leaving the department', 'k2'))).toBe('GOV_REMOVE_SELF');
    expect(await codeOf(t.svc.remove(session(B), M, 'short', 'k2'))).toBe('GOV_REASON_REQUIRED');
    expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
  });
  it('remove: one head, at once — the write AND the session cut, through idem.remember', async () => {
    const t = build({ ...pending, status: 'active' });
    expect(await t.svc.remove(session(B), M, 'left the department on transfer', 'k2')).toEqual({ id: M, status: 'removed', sessionsEnded: 1 });
    expect(t.writes).toEqual(['remove', 'cut']); expect(t.auth.revokeGovSessionsIn).toHaveBeenCalledWith(expect.anything(), D, AUTH);
  });
  it('request: a bad role / term / reason / phone and an unknown person are refused before idem.remember', async () => {
    const ok = { phone: '+919712345678', roleCode: 'authority_officer', termMonths: 6, reason: 'district scheme officer' };
    for (const [dto, code] of [
      [{ ...ok, roleCode: 'tenant_admin' }, 'GOV_ROLE_REQUIRED'], [{ ...ok, termMonths: 13 }, 'GOV_TERM_INVALID'],
      [{ ...ok, reason: 'x' }, 'GOV_REASON_REQUIRED'], [{ ...ok, phone: 'abc' }, 'GOV_PHONE_INVALID'],
    ] as const) {
      const t = build(null);
      expect(await codeOf(t.svc.request(session(B), dto as any, 'k3'))).toBe(code);
      expect(t.idem.remember).not.toHaveBeenCalled(); expect(t.writes).toEqual([]);
    }
    const unknown = build(null, null);
    expect(await codeOf(unknown.svc.request(session(B), ok, 'k3'))).toBe('GOV_PERSON_UNKNOWN');
    expect(unknown.idem.remember).not.toHaveBeenCalled();
    const fine = build(null);
    expect(await fine.svc.request(session(B), ok, 'k3')).toMatchObject({ id: M, status: 'requested' });
    expect(fine.idem.remember).toHaveBeenCalledTimes(1); expect(fine.writes).toEqual(['request']);
  });
});
