// Unit tests for the framework-free REACTIVE refresh-on-401 executor factory (createRefreshExecutor). This is
// the logic auth.store.tsx registers with the API client (registerRefreshExecutor) so the SDK
// (packages/sdk-js/src/http.ts) can call it reactively when a request 401s mid-session — the boot-time proactive
// refresh in auth.store only covers app-open; without this, a token that expires after boot (900s TTL) 401s
// every request until the app restarts. No React/expo import here by design — this file runs in the
// framework-free jest.config.js harness (roots: src/core/__tests__), mirroring session.reducer.spec.ts.
import { createRefreshExecutor, type RefreshExecutorDeps } from '../auth/refresh-executor';
import type { AuthTokens } from '@krishalaya/sdk-js';

const tokens: AuthTokens = { accessToken: 'fresh-access', refreshToken: 'fresh-refresh', expiresInSec: 900 };

interface Recorder {
  saved: Array<{ tokens: AuthTokens; nowMs: number }>;
  refreshed: Array<{ tokens: AuthTokens; nowMs: number }>;
  failedCalls: number[];      // pushed to (not just counted) so `.length` reads live, unlike a plain number copy
  refreshCalls: Array<{ refreshToken: string; tenantId: string | undefined }>;
}

function makeDeps(overrides: Partial<RefreshExecutorDeps> = {}): { deps: RefreshExecutorDeps; rec: Recorder } {
  const rec: Recorder = { saved: [], refreshed: [], failedCalls: [], refreshCalls: [] };
  const deps: RefreshExecutorDeps = {
    getRefreshToken: () => 'stored-refresh-token',
    tenantId: 't1',
    refresh: async (refreshToken, tenantId) => { rec.refreshCalls.push({ refreshToken, tenantId }); return tokens; },
    saveTokens: async (t, nowMs) => { rec.saved.push({ tokens: t, nowMs }); },
    onRefreshed: (t, nowMs) => { rec.refreshed.push({ tokens: t, nowMs }); },
    onRefreshFailed: async () => { rec.failedCalls.push(1); },
    now: () => 1_000_000,
    ...overrides,
  };
  return { deps, rec };
}

describe('createRefreshExecutor', () => {
  it('refreshes, saves + applies the fresh tokens, and resolves true on success', async () => {
    const { deps, rec } = makeDeps();
    const result = await createRefreshExecutor(deps)();
    expect(result).toBe(true);
    expect(rec.refreshCalls).toEqual([{ refreshToken: 'stored-refresh-token', tenantId: 't1' }]);
    expect(rec.saved).toEqual([{ tokens, nowMs: 1_000_000 }]);
    expect(rec.refreshed).toEqual([{ tokens, nowMs: 1_000_000 }]);
    expect(rec.failedCalls.length).toBe(0);
  });

  it('passes the tenantId through to the refresh call (the API scopes refresh to a tenant)', async () => {
    const { deps, rec } = makeDeps({ tenantId: 'tenant-xyz' });
    await createRefreshExecutor(deps)();
    expect(rec.refreshCalls[0].tenantId).toBe('tenant-xyz');
  });

  it('resolves false without calling refresh when there is no refresh token (anonymous/signed-out)', async () => {
    const { deps, rec } = makeDeps({ getRefreshToken: () => undefined });
    const result = await createRefreshExecutor(deps)();
    expect(result).toBe(false);
    expect(rec.refreshCalls).toEqual([]);
    expect(rec.failedCalls.length).toBe(0);   // nothing to refresh with is not a signed-out-worthy failure
  });

  it('on a failed refresh call (rotated/expired/revoked/network) clears the session (SIGNED_OUT) and resolves false', async () => {
    const { deps, rec } = makeDeps({ refresh: async () => { throw new Error('INVALID_REFRESH_TOKEN'); } });
    const result = await createRefreshExecutor(deps)();
    expect(result).toBe(false);
    expect(rec.failedCalls.length).toBe(1);
    expect(rec.saved).toEqual([]);
    expect(rec.refreshed).toEqual([]);
  });

  it('never signs out when there is simply no refresh token to use, but DOES sign out when a refresh attempt fails', async () => {
    const noToken = makeDeps({ getRefreshToken: () => undefined });
    await createRefreshExecutor(noToken.deps)();
    expect(noToken.rec.failedCalls.length).toBe(0);

    const failing = makeDeps({ refresh: async () => { throw new Error('network'); } });
    await createRefreshExecutor(failing.deps)();
    expect(failing.rec.failedCalls.length).toBe(1);
  });

  it('propagates neither the refresh error nor a rejection — the executor never throws', async () => {
    const { deps } = makeDeps({ refresh: async () => { throw new Error('boom'); } });
    await expect(createRefreshExecutor(deps)()).resolves.toBe(false);
  });
});
