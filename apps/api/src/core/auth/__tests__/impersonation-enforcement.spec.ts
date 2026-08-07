// apps/api/src/core/auth/__tests__/impersonation-enforcement.spec.ts · PC-56 ADMIN-9b.
//
// The guard, the gate and the interceptor — the three pieces that turn a minted token into a session somebody can be
// held to. Four properties matter more than the rest, and each is a promise W008 makes that nothing kept:
//
//   1. A MUTATING METHOD IS REFUSED, and the refusal is RECORDED before it is thrown.
//   2. A REVOKED GRANT REFUSES THE NEXT REQUEST — "immediately" rather than "when the token expires".
//   3. EVERY REQUEST IS LOGGED BY THE PLATFORM, and a failure to log fails the request.
//   4. A TOKEN THAT DOES NOT MATCH ITS GRANT IS REFUSED, so a signature is not a licence to name any target.
import { createHmac } from 'node:crypto';
import { lastValueFrom, of, throwError } from 'rxjs';
import { ImpersonationGate } from '../impersonation.gate';
import { ImpersonationReadOnlyGuard } from '../impersonation-read-only.guard';
import { ImpersonationInterceptor } from '../impersonation.interceptor';
import { runWithContext, RequestContext } from '../../tenancy-context/request-context';
import { TenantResolver } from '../../tenancy-context/tenant-resolver';

const IMP = {
  grantId: 'grant-1', actorAdminId: 'operator-1', scope: 'read_only' as const,
  reason: null, expiresAt: new Date(Date.now() + 900_000),
};

function context(over: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-1', userId: 'target-user', sessionId: '', requestId: 'req-1', lang: 'en-IN',
    roles: [], permissions: new Set<string>(), shardId: 0, impersonation: IMP, ...over,
  };
}

const execCtx = (method = 'GET', url = '/v1/orders/abc', route = '/v1/orders/:id') => ({
  getType: () => 'http',
  switchToHttp: () => ({
    getRequest: () => ({ method, url, originalUrl: url, route: { path: route } }),
    getResponse: () => ({ statusCode: 200 }),
  }),
}) as any;

const handler = (value: unknown = { ok: true }) => ({ handle: () => of(value) }) as any;

function gateStub(over: Record<string, unknown> = {}) {
  return {
    check: jest.fn().mockResolvedValue({ live: true, reason: 'billing dispute check', expiresAt: IMP.expiresAt }),
    recordAction: jest.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as ImpersonationGate & { check: jest.Mock; recordAction: jest.Mock };
}

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-9b · read-only is enforced at request time', () => {
  it('lets an ordinary (non-impersonated) request straight through', async () => {
    const gate = gateStub();
    const guard = new ImpersonationReadOnlyGuard(gate);
    await runWithContext(context({ impersonation: undefined }), async () => {
      expect(await guard.canActivate(execCtx('POST'))).toBe(true);
    });
    // No branch, no read, no write: the cost of this guard on normal traffic is one property check.
    expect(gate.recordAction).not.toHaveBeenCalled();
  });

  it('lets an impersonated GET through', async () => {
    const gate = gateStub();
    const guard = new ImpersonationReadOnlyGuard(gate);
    await runWithContext(context(), async () => {
      expect(await guard.canActivate(execCtx('GET'))).toBe(true);
    });
    expect(gate.recordAction).not.toHaveBeenCalled();   // the interceptor logs the served read, not the guard
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('REFUSES %s and records the attempt', async (method) => {
    const gate = gateStub();
    const guard = new ImpersonationReadOnlyGuard(gate);
    await runWithContext(context(), async () => {
      await expect(guard.canActivate(execCtx(method, '/v1/listings/1', '/v1/listings/:id')))
        .rejects.toThrow(/read-only support session/);
    });
    // **W008 RENDERS EXACTLY THIS ROW** — "write attempt blocked — listings.update denied (scope read_only)" — and a
    // blocked write that left no trace would be the most interesting event in the log going unrecorded.
    expect(gate.recordAction).toHaveBeenCalledTimes(1);
    expect(gate.recordAction.mock.calls[0][0]).toMatchObject({
      outcome: 'refused_write', statusCode: 403, grantId: 'grant-1', actorAdminId: 'operator-1',
    });
  });

  it('fails the request when the refusal cannot be recorded', async () => {
    // Fails closed in the only direction that matters: the write was going to be refused anyway, so the caller loses
    // nothing they were entitled to, and no unrecorded attempt is possible.
    const gate = gateStub({ recordAction: jest.fn().mockRejectedValue(new Error('log is down')) });
    const guard = new ImpersonationReadOnlyGuard(gate);
    await runWithContext(context(), async () => {
      await expect(guard.canActivate(execCtx('POST'))).rejects.toThrow(/log is down/);
    });
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-9b · the interceptor records what the platform served', () => {
  it('checks the grant and logs a served read', async () => {
    const gate = gateStub();
    const interceptor = new ImpersonationInterceptor(gate);
    await runWithContext(context(), async () => {
      const out = await lastValueFrom(interceptor.intercept(execCtx(), handler({ id: 'abc' })));
      expect(out).toEqual({ id: 'abc' });
    });
    expect(gate.check).toHaveBeenCalledTimes(1);
    // Checked against the CONTEXT's user and tenant, not against anything the token said afterwards.
    expect(gate.check.mock.calls[0][0]).toEqual({
      grantId: 'grant-1', targetUserId: 'target-user', targetTenantId: 'tenant-1', actorAdminId: 'operator-1',
    });
    expect(gate.recordAction).toHaveBeenCalledTimes(1);
    expect(gate.recordAction.mock.calls[0][0]).toMatchObject({
      outcome: 'served', statusCode: 200,
      // The ROUTE PATTERN, so a hundred order reads are one legible line, with the resolved path beside it.
      action: '/v1/orders/:id', path: '/v1/orders/abc',
    });
  });

  it('leaves a non-impersonated request completely alone', async () => {
    const gate = gateStub();
    const interceptor = new ImpersonationInterceptor(gate);
    await runWithContext(context({ impersonation: undefined }), async () => {
      await lastValueFrom(interceptor.intercept(execCtx(), handler()));
    });
    expect(gate.check).not.toHaveBeenCalled();
    expect(gate.recordAction).not.toHaveBeenCalled();
  });

  // **"THEIR SESSION ENDS IMMEDIATELY" BECOMES TRUE.** Before this, revoking a grant changed a row and the token kept
  // working for the rest of its TTL, because nothing read the row.
  it.each([
    ['revoked', 'this act-as session was revoked'],
    ['expired', 'this act-as session has expired'],
    ['ended', 'this act-as session has ended'],
    ['mismatch', 'this token does not match its grant'],
  ])('refuses a %s grant on the very next request', async (code, detail) => {
    const gate = gateStub({ check: jest.fn().mockResolvedValue({ live: false, code, detail }) });
    const interceptor = new ImpersonationInterceptor(gate);
    await runWithContext(context(), async () => {
      await expect(lastValueFrom(interceptor.intercept(execCtx(), handler()))).rejects.toThrow(new RegExp(detail));
    });
    // Recorded as `refused_grant` — the row 0119's trigger deliberately exempts from the live-grant rule, because
    // "somebody used a token after the grant ended" is the single most important thing this table can hold.
    expect(gate.recordAction).toHaveBeenCalledTimes(1);
    expect(gate.recordAction.mock.calls[0][0]).toMatchObject({ outcome: 'refused_grant', statusCode: 403 });
  });

  it('never calls the handler when the grant is not live', async () => {
    const gate = gateStub({ check: jest.fn().mockResolvedValue({ live: false, code: 'revoked', detail: 'revoked' }) });
    const interceptor = new ImpersonationInterceptor(gate);
    const handle = jest.fn(() => of({}));
    await runWithContext(context(), async () => {
      await expect(lastValueFrom(interceptor.intercept(execCtx(), { handle } as any))).rejects.toThrow();
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('records a read that FAILED, with the status it failed on', async () => {
    const gate = gateStub();
    const interceptor = new ImpersonationInterceptor(gate);
    const failing = { handle: () => throwError(() => Object.assign(new Error('not found'), { status: 404 })) } as any;
    await runWithContext(context(), async () => {
      await expect(lastValueFrom(interceptor.intercept(execCtx(), failing))).rejects.toThrow('not found');
    });
    // The operator reached the data path, which is the fact the target tenant cares about — so it is a `served` row
    // carrying a 404 rather than a fourth outcome invented for "the handler threw".
    expect(gate.recordAction.mock.calls[0][0]).toMatchObject({ outcome: 'served', statusCode: 404, detail: 'not found' });
  });

  it('FAILS THE REQUEST when the action cannot be logged', async () => {
    // The ADMIN-8b lesson one plane over: a control whose work leaves no trace is a control nobody can prove held. The
    // asymmetry is what makes it safe — the operator loses a read they can retry; the farmer would otherwise lose the
    // record that somebody looked.
    const gate = gateStub({ recordAction: jest.fn().mockRejectedValue(new Error('log is down')) });
    const interceptor = new ImpersonationInterceptor(gate);
    await runWithContext(context(), async () => {
      await expect(lastValueFrom(interceptor.intercept(execCtx(), handler()))).rejects.toThrow(/log is down/);
    });
  });

  it('fails closed when the grant check itself throws', async () => {
    const gate = gateStub({ check: jest.fn().mockRejectedValue(new Error('db down')) });
    const interceptor = new ImpersonationInterceptor(gate);
    await runWithContext(context(), async () => {
      await expect(lastValueFrom(interceptor.intercept(execCtx(), handler()))).rejects.toThrow(/db down/);
    });
  });
});


/* ------------------------------------------------------------------------------------------------ */
describe('ADMIN-9b · TenantResolver — the act-as branch', () => {
  const SECRET = 'an-impersonation-secret-that-is-long-enough';
  const cfg = (over: Record<string, unknown> = {}) => ({
    impersonation: { enabled: true, secret: SECRET, issuer: 'krishalaya-admin', audience: 'krishalaya-api', ...over },
  }) as any;
  const tokens = { verifyAccessToken: jest.fn().mockReturnValue({ sub: 'u1', tid: 't1', sid: 's1', roles: ['farmer'], perms: ['listing.create'] }) } as any;

  // Minted the way admin-api mints, so this exercises the real branch rather than a shape invented for the test.
  const mint = (over: Record<string, unknown> = {}, secret = SECRET) => {
    const b64 = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const now = Math.floor(Date.now() / 1000);
    const h = b64(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const p = b64(Buffer.from(JSON.stringify({
      iss: 'krishalaya-admin', aud: 'krishalaya-api', sub: 'target-user', tid: 'target-tenant',
      act: { sub: 'operator-1' }, jti: 'grant-1', scope: 'read_only', typ: 'impersonation', iat: now, exp: now + 900, ...over,
    })));
    return `${h}.${p}.${b64(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`;
  };

  it('resolves an act-as token to the TARGET, carrying the actor separately', () => {
    const r = new TenantResolver(tokens, cfg()).fromAuthHeader(`Bearer ${mint()}`);
    expect(r).toMatchObject({ userId: 'target-user', tenantId: 'target-tenant' });
    expect(r?.impersonation).toMatchObject({ actorAdminId: 'operator-1', grantId: 'grant-1' });
    // **NO ROLES AND NO PERMISSIONS FROM THE TOKEN.** They are resolved from the database for the target user by the
    // middleware, so an operator inside somebody's account can never see more than that person sees.
    expect(r?.roles).toEqual([]);
    expect(r?.permissions).toEqual([]);
    // NO SESSION ID: an act-as token carries a grant, not a session. Reusing `sid` would make an impersonated request
    // appear in the target's own session list as though they had signed in.
    expect(r?.sessionId).toBe('');
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  // **TWO INDEPENDENT LAYERS, ASSERTED SEPARATELY — and the reason is a survived mutation.** Deleting the resolver's
  // `enabled` check first passed every test, because the verifier ALSO refuses an empty secret. Defence in depth is only
  // defence if each layer is verified on its own; otherwise one of them can be removed and nothing notices.
  it('is ANONYMOUS — not an error — when the kill-switch is off, EVEN WITH A USABLE SECRET', () => {
    // Layer 1: the switch alone. Exactly how this realm behaved before the verifier existed — fail-closed, with no hint
    // about which secret was missing. `AuthGuard` then produces the ordinary 401 for a protected route.
    expect(new TenantResolver(tokens, cfg({ enabled: false })).fromAuthHeader(`Bearer ${mint()}`)).toBeNull();
  });

  it('is anonymous when the secret is missing, EVEN IF something claims honouring is enabled', () => {
    // Layer 2: the verifier alone. An empty key must never verify anything — without this, an empty secret would still
    // produce a valid HMAC over attacker-controlled bytes and every forged token would be accepted.
    expect(new TenantResolver(tokens, cfg({ enabled: true, secret: '' })).fromAuthHeader(`Bearer ${mint()}`)).toBeNull();
  });

  it('is anonymous for a forged or expired act-as token', () => {
    expect(new TenantResolver(tokens, cfg()).fromAuthHeader(`Bearer ${mint({}, 'attacker-key')}`)).toBeNull();
    const past = Math.floor(Date.now() / 1000) - 5;
    expect(new TenantResolver(tokens, cfg()).fromAuthHeader(`Bearer ${mint({ exp: past })}`)).toBeNull();
  });

  it('still resolves an ordinary access token exactly as before', () => {
    const r = new TenantResolver(tokens, cfg()).fromAuthHeader('Bearer an.access.token');
    expect(r).toMatchObject({ userId: 'u1', tenantId: 't1', sessionId: 's1', roles: ['farmer'] });
    expect(r?.impersonation).toBeUndefined();
  });
});
