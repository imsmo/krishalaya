// apps/admin-api/src/modules/impersonation/__tests__/impersonation.spec.ts · unit tests (pure/mocked) for the
// HIGHEST-SENSITIVITY control. Covers: the grant state machine + entity (close-once, expiry); the scope/ttl/self
// guards (read-only only, time-box, no self-impersonation); the act-as TOKEN (round-trip, tamper/expiry/secret/
// typ checks, actor claim, NEVER typ='access'); owner-RBAC for the impersonation roles + the no-escalation / no-'*'
// property (Law 11); DTO validation; and the services proving the kill-switch, target validation (404 non-member,
// 403 privileged), audit-in-tx, illegal-transition guard, and that recordAction refuses a stale/foreign grant.
import { ImpersonationGrant } from '../domain/grant.entity';
import { canTransition, assertTransition, isTerminal, GRANT_STATUSES } from '../domain/grant.state';
import { assertScope, assertTtl, assertNotSelf } from '../domain/scope';
import { mintImpersonationToken, verifyImpersonationToken, ImpersonationTokenError } from '../domain/impersonation-token';
import { InvalidScopeError, InvalidTtlError, SelfImpersonationError, IllegalGrantTransitionError, ImpersonationDisabledError, CannotImpersonatePrivilegedError, TargetUserNotFoundError, GrantNotFoundError } from '../domain/impersonation.errors';
import { StartImpersonationService } from '../services/start-impersonation.service';
import { EndImpersonationService } from '../services/end-impersonation.service';
import { ImpersonationHistoryService } from '../services/impersonation-history.service';
import { StartGrantSchema, EndGrantSchema, RecordActionSchema, QueryGrantsSchema } from '../dto/impersonation.dto';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';

const SECRET = 's'.repeat(40);
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const TENANT = '11111111-1111-1111-1111-111111111111';
const TARGET = '22222222-2222-2222-2222-222222222222';
const actor = { userId: ADMIN, roles: ['platform_support_impersonator'], ip: '10.0.0.1', requestId: 'req1' } as any;
const cfg = (enabled = true) => ({ impersonation: { enabled, secret: SECRET, issuer: 'krishalaya-impersonation', audience: 'krishalaya-api', maxTtlSec: 1800 } }) as any;
const grant = (status: any = 'active', expiresInMs = 60000, adminId = ADMIN) => ImpersonationGrant.rehydrate({
  id: 'g1', adminUserId: adminId, targetTenantId: TENANT, targetUserId: TARGET, reason: 'investigate a bug report', scope: 'read_only',
  status, expiresAt: new Date(Date.now() + expiresInMs), endedAt: null, endedBy: null, endReason: null, createdAt: new Date('2026-06-01T00:00:00Z'),
});

describe('grant state machine + entity', () => {
  it('active→ended/expired/revoked; terminal locked', () => {
    expect(canTransition('active', 'ended')).toBe(true);
    expect(canTransition('active', 'revoked')).toBe(true);
    expect(canTransition('ended', 'active')).toBe(false);
    expect(isTerminal('revoked')).toBe(true); expect(isTerminal('active')).toBe(false);
    expect(() => assertTransition('ended', 'revoked')).toThrow(IllegalGrantTransitionError);
    expect(GRANT_STATUSES.length).toBe(4);
  });
  it('end/revoke stamp + transition; closing a closed grant throws; isExpired', () => {
    const g = grant('active');
    expect(g.end(ADMIN, 'done reproducing').to).toBe('ended');
    expect(() => g.revoke(ADMIN, 'too late')).toThrow(IllegalGrantTransitionError);
    expect(grant('active', -1000).isExpired(new Date())).toBe(true);
    expect(grant('active', 60000).isExpired(new Date())).toBe(false);
  });
});

describe('scope / ttl / self guards', () => {
  it('only read_only scope is permitted', () => {
    expect(assertScope('read_only')).toBe('read_only');
    expect(() => assertScope('full')).toThrow(InvalidScopeError);
    expect(() => assertScope('write')).toThrow(InvalidScopeError);
  });
  it('ttl must be positive within the hard cap', () => {
    expect(assertTtl(900, 1800)).toBe(900);
    expect(() => assertTtl(0, 1800)).toThrow(InvalidTtlError);
    expect(() => assertTtl(3600, 1800)).toThrow(InvalidTtlError);
  });
  it('no self-impersonation', () => {
    expect(() => assertNotSelf(ADMIN, ADMIN)).toThrow(SelfImpersonationError);
    expect(() => assertNotSelf(ADMIN, TARGET)).not.toThrow();
  });
});

describe('act-as token', () => {
  it('round-trips; carries the actor + scope; is typ=impersonation (NEVER access)', () => {
    const { token } = mintImpersonationToken({ secret: SECRET, issuer: 'krishalaya-impersonation', audience: 'krishalaya-api', grantId: 'g1', adminUserId: ADMIN, targetUserId: TARGET, targetTenantId: TENANT, ttlSec: 900 });
    const c = verifyImpersonationToken(token, SECRET, 'krishalaya-impersonation', 'krishalaya-api');
    expect(c.sub).toBe(TARGET); expect(c.tid).toBe(TENANT); expect(c.act.sub).toBe(ADMIN);
    expect(c.jti).toBe('g1'); expect(c.scope).toBe('read_only'); expect(c.typ).toBe('impersonation');
    expect((c as any).typ).not.toBe('access');     // can never be mistaken for a normal access token
  });
  it('rejects tampered signature, wrong secret, expiry, and wrong audience', () => {
    const { token } = mintImpersonationToken({ secret: SECRET, issuer: 'krishalaya-impersonation', audience: 'krishalaya-api', grantId: 'g1', adminUserId: ADMIN, targetUserId: TARGET, targetTenantId: TENANT, ttlSec: 900 });
    expect(() => verifyImpersonationToken(token + 'x', SECRET, 'krishalaya-impersonation', 'krishalaya-api')).toThrow(ImpersonationTokenError);
    expect(() => verifyImpersonationToken(token, 'другой'.repeat(8), 'krishalaya-impersonation', 'krishalaya-api')).toThrow(ImpersonationTokenError);
    expect(() => verifyImpersonationToken(token, SECRET, 'wrong-iss', 'krishalaya-api')).toThrow(ImpersonationTokenError);
    expect(() => verifyImpersonationToken(token, SECRET, 'krishalaya-impersonation', 'wrong-aud')).toThrow(ImpersonationTokenError);
    const expired = mintImpersonationToken({ secret: SECRET, issuer: 'krishalaya-impersonation', audience: 'krishalaya-api', grantId: 'g1', adminUserId: ADMIN, targetUserId: TARGET, targetTenantId: TENANT, ttlSec: 1, nowSec: Math.floor(Date.now() / 1000) - 10 });
    expect(() => verifyImpersonationToken(expired.token, SECRET, 'krishalaya-impersonation', 'krishalaya-api')).toThrow(ImpersonationTokenError);
  });
});

describe('owner roles for impersonation (no escalation, no *)', () => {
  it('support_impersonator grant+read; auditor read-only; tenant roles NOTHING; never money/god', () => {
    const ops = resolveOwnerPermissions(['platform_support_impersonator']);
    expect(hasOwnerPermission(ops, OwnerPermissions.ImpersonationGrant)).toBe(true);
    expect(hasOwnerPermission(ops, OwnerPermissions.ImpersonationRead)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_impersonation_auditor']), OwnerPermissions.ImpersonationGrant)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_impersonation_auditor']), OwnerPermissions.ImpersonationRead)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['tenant_admin']), OwnerPermissions.ImpersonationGrant)).toBe(false);
    // the impersonator role grants NO money/god/other-plane perms and never '*'
    expect(ops.has('*')).toBe(false);
    expect(hasOwnerPermission(ops, OwnerPermissions.BillingManage)).toBe(false);
    expect(hasOwnerPermission(ops, OwnerPermissions.ReconManage)).toBe(false);
  });
});

describe('dto validation', () => {
  it('start: uuids + reason min length + ttl bounds + scope default; rejects unknown keys', () => {
    const ok = { targetTenantId: TENANT, targetUserId: TARGET, reason: 'reproduce checkout bug' };
    const parsed = StartGrantSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
    if (parsed.success) { expect(parsed.data.scope).toBe('read_only'); expect(parsed.data.ttlSec).toBe(900); }
    expect(StartGrantSchema.safeParse({ ...ok, reason: 'short' }).success).toBe(false);   // min 8
    expect(StartGrantSchema.safeParse({ ...ok, ttlSec: 99999 }).success).toBe(false);
    expect(StartGrantSchema.safeParse({ ...ok, scope: 'full' }).success).toBe(false);
    expect(StartGrantSchema.safeParse({ ...ok, evil: 1 }).success).toBe(false);
  });
  it('record-action: clean path only (no query string), valid method; end requires reason', () => {
    expect(RecordActionSchema.safeParse({ method: 'GET', path: '/v1/orders' }).success).toBe(true);
    expect(RecordActionSchema.safeParse({ method: 'GET', path: '/v1/orders?evil=1' }).success).toBe(false);
    expect(RecordActionSchema.safeParse({ method: 'WIPE', path: '/v1/orders' }).success).toBe(false);
    expect(EndGrantSchema.safeParse({ reason: 'finished the session' }).success).toBe(true);
    expect(QueryGrantsSchema.safeParse({ limit: 999 }).success).toBe(false);
  });
});

function harness() {
  const client = { __c: true };
  const pool = { withTx: async (fn: any) => fn(client) } as any;
  const audit = { write: jest.fn(async () => undefined) } as any;
  return { client, pool, audit };
}

describe('StartImpersonationService', () => {
  const dto = { targetTenantId: TENANT, targetUserId: TARGET, reason: 'reproduce a bug', ttlSec: 900, scope: 'read_only' as const };

  it('kill-switch OFF ⇒ refused (fail-closed); nothing queried', async () => {
    const { pool, audit } = harness();
    const repo = { findTenantUser: jest.fn() } as any;
    await expect(new StartImpersonationService(pool, audit, repo, cfg(false)).start(actor, dto)).rejects.toBeInstanceOf(ImpersonationDisabledError);
    expect(repo.findTenantUser).not.toHaveBeenCalled();
  });
  it('self-impersonation refused', async () => {
    const { pool, audit } = harness();
    await expect(new StartImpersonationService(pool, audit, {} as any, cfg()).start(actor, { ...dto, targetUserId: ADMIN })).rejects.toBeInstanceOf(SelfImpersonationError);
  });
  it('non-member target ⇒ 404 (no cross-tenant enumeration)', async () => {
    const { pool, audit } = harness();
    const repo = { findTenantUser: jest.fn(async () => null) } as any;
    await expect(new StartImpersonationService(pool, audit, repo, cfg()).start(actor, dto)).rejects.toBeInstanceOf(TargetUserNotFoundError);
  });
  it('privileged target ⇒ refused (never act as staff/god)', async () => {
    const { pool, audit } = harness();
    const repo = { findTenantUser: jest.fn(async () => ({ isPrivileged: true })) } as any;
    await expect(new StartImpersonationService(pool, audit, repo, cfg()).start(actor, dto)).rejects.toBeInstanceOf(CannotImpersonatePrivilegedError);
  });
  it('happy path: inserts grant + audits in-tx + returns a verifiable read-only token', async () => {
    const { pool, audit, client } = harness();
    const repo = {
      findTenantUser: jest.fn(async () => ({ isPrivileged: false })),
      insertGrant: jest.fn(async () => grant('active')),
      emitNotification: jest.fn(),
    } as any;
    const out: any = await new StartImpersonationService(pool, audit, repo, cfg()).start(actor, dto);
    expect(repo.insertGrant).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'impersonation.started' }));
    const c = verifyImpersonationToken(out.token, SECRET, 'krishalaya-impersonation', 'krishalaya-api');
    expect(c.act.sub).toBe(ADMIN); expect(c.sub).toBe(TARGET); expect(c.scope).toBe('read_only');
  });

  // PC-56 ADMIN-9b · **THE TARGET IS TOLD, IN THE SAME TRANSACTION AS THE GRANT.** W008 calls tenant visibility "the
  // policy" and nothing emitted anything — no outbox type, no event code, no template. In-tx (Law 4) so a session
  // cannot exist without the notice having been queued.
  it('emits the session-started notification in the SAME transaction, with a recipient and the reason', async () => {
    const { pool, audit, client } = harness();
    const repo = {
      findTenantUser: jest.fn(async () => ({ isPrivileged: false })),
      insertGrant: jest.fn(async () => grant('active')),
      emitNotification: jest.fn(),
    } as any;
    await new StartImpersonationService(pool, audit, repo, cfg()).start(actor, dto);
    expect(repo.emitNotification).toHaveBeenCalledTimes(1);
    const [txClient, ev] = repo.emitNotification.mock.calls[0];
    expect(txClient).toBe(client);
    expect(ev).toMatchObject({ eventType: 'impersonation.session_started', targetUserId: TARGET });
    // The RECIPIENT has to be resolvable from the payload — ADMIN-6b's finding was a map row pointing at a payload
    // with no recipient, which looks fixed and delivers nothing.
    expect(ev.targetUserId).toBeTruthy();
    // And the REASON travels: a notice saying only "support accessed your account" is technically transparent and
    // practically useless to the person deciding whether to complain.
    expect(ev.payload.reason).toBe(dto.reason);
  });

  it('emits NO notification when the grant is refused', async () => {
    const { pool, audit } = harness();
    const repo = { findTenantUser: jest.fn(async () => ({ isPrivileged: true })), emitNotification: jest.fn() } as any;
    await expect(new StartImpersonationService(pool, audit, repo, cfg()).start(actor, dto)).rejects.toThrow();
    // Telling somebody their account was opened when it was not would be its own breach of trust.
    expect(repo.emitNotification).not.toHaveBeenCalled();
  });
});

describe('EndImpersonationService', () => {
  it('404 when grant missing', async () => {
    const { pool, audit } = harness();
    const repo = { getGrantForUpdate: jest.fn(async () => null) } as any;
    await expect(new EndImpersonationService(pool, audit, repo).end(actor, 'g1', 'done now')).rejects.toBeInstanceOf(GrantNotFoundError);
  });
  it('end: transitions + audits old→new in-tx', async () => {
    const { pool, audit, client } = harness();
    const repo = {
      getGrantForUpdate: jest.fn(async () => grant('active')),
      closeGrant: jest.fn(),
      emitNotification: jest.fn(),
      actionCounts: jest.fn(async () => ({ served: 7, refusedWrite: 2, refusedGrant: 0 })),
    } as any;
    await new EndImpersonationService(pool, audit, repo).end(actor, 'g1', 'finished reproducing');
    expect(repo.closeGrant).toHaveBeenCalledWith(client, 'g1', 'ended', ADMIN, 'finished reproducing', ADMIN);
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'impersonation.ended', oldValue: { status: 'active' } }));
    // PC-56 ADMIN-9b: the close notice carries WHAT HAPPENED. "7 pages were opened and nothing was changed" is a notice
    // a farmer can act on; "a session ended" is one they can only be alarmed by.
    expect(repo.emitNotification).toHaveBeenCalledWith(client, expect.objectContaining({
      eventType: 'impersonation.session_ended',
      payload: expect.objectContaining({ endKind: 'ended', actionCount: 7, blockedWrites: 2 }),
    }));
  });
  it('closing an already-closed grant throws + audits nothing', async () => {
    const { pool, audit } = harness();
    const repo = {
      getGrantForUpdate: jest.fn(async () => grant('ended')), closeGrant: jest.fn(),
      emitNotification: jest.fn(), actionCounts: jest.fn(),
    } as any;
    await expect(new EndImpersonationService(pool, audit, repo).revoke(actor, 'g1', 'too late')).rejects.toBeInstanceOf(IllegalGrantTransitionError);
    expect(audit.write).not.toHaveBeenCalled();
  });
});

describe('ImpersonationHistoryService.recordAction', () => {
  it('refuses a foreign / non-active / expired grant (404, no leak); records against own active grant', async () => {
    const { pool, audit } = harness();
    const foreign = { getGrantForUpdate: jest.fn(async () => grant('active', 60000, 'someone-else')) } as any;
    await expect(new ImpersonationHistoryService(pool, audit, foreign).recordAction(actor, 'g1', { method: 'GET', path: '/v1/orders' })).rejects.toBeInstanceOf(GrantNotFoundError);
    const expired = { getGrantForUpdate: jest.fn(async () => grant('active', -1000)) } as any;
    await expect(new ImpersonationHistoryService(pool, audit, expired).recordAction(actor, 'g1', { method: 'GET', path: '/v1/orders' })).rejects.toBeInstanceOf(GrantNotFoundError);
    const ok = { getGrantForUpdate: jest.fn(async () => grant('active')), insertAction: jest.fn(async () => ({ id: 'a1', createdAt: new Date() })) } as any;
    const out: any = await new ImpersonationHistoryService(pool, audit, ok).recordAction(actor, 'g1', { method: 'GET', path: '/v1/orders' });
    expect(out.id).toBe('a1');
    expect(ok.insertAction).toHaveBeenCalled();
  });
});
