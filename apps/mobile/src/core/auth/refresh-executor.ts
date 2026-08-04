// apps/mobile/src/core/auth/refresh-executor.ts · pure, framework-free factory for the REACTIVE refresh-on-401
// executor the auth store registers with the API client (see ../api/client.ts's registerRefreshExecutor and
// packages/sdk-js/src/http.ts's onUnauthorized). Kept dependency-injected and React/expo-free — mirrors
// session.reducer.ts's split of "pure decision logic" from the React shell — so the retry/sign-out branching is
// unit-testable without a React Native test harness (this app's jest.config.js scopes to framework-free
// src/core/__tests__ only; RN screens run under jest-expo in CI).
//
// Context: access tokens expire in 900s. Before this executor existed, the ONLY refresh was the boot-time
// proactive one in auth.store.tsx — once a token expired mid-session, every request 401'd until the app
// restarted. This executor is what the SDK calls reactively on a 401 (at most once per request, single-flighted
// across concurrent 401s — see http.ts's `refreshOnce`).
import type { AuthTokens } from '@krishalaya/sdk-js';

export interface RefreshExecutorDeps {
  /** Reads the CURRENT refresh token (a ref in the real store, so it always reads the live value even though
   * the executor itself is registered once on mount). Undefined means anonymous/signed-out — nothing to refresh. */
  getRefreshToken: () => string | undefined;
  /** The tenant this session was minted for (the API's RefreshSchema requires it — session is tenant-scoped). */
  tenantId?: string;
  /** Calls the anonymous refresh endpoint. Throws on failure (rotation already consumed, expired, revoked, or a
   * network error) — the executor treats ANY throw the same way: give up and sign out (see below). */
  refresh: (refreshToken: string, tenantId?: string) => Promise<AuthTokens>;
  /** Persists the new tokens to secure storage. */
  saveTokens: (tokens: AuthTokens, nowMs: number) => Promise<void>;
  /** Flips the in-memory session to authenticated with the new tokens (TOKENS_REFRESHED). */
  onRefreshed: (tokens: AuthTokens, nowMs: number) => void;
  /** Wipes the session to signed-out. Called when the refresh call itself fails: unlike the boot-time PROACTIVE
   * refresh (which tolerates a transient failure while the OLD access token is still valid, see auth.store.tsx's
   * boot effect), this executor only ever runs AFTER a request has already been 401'd — the access token is
   * confirmed dead already, so a failed refresh means there is no valid path forward. Fail closed: send the user
   * to login rather than looping 401s forever. */
  onRefreshFailed: () => Promise<void>;
  /** Injectable clock (tests only). Defaults to Date.now. */
  now?: () => number;
}

/**
 * Builds the `onUnauthorized` executor for `registerRefreshExecutor` / the SDK's `SdkConfig.onUnauthorized`.
 * Resolves true iff a fresh token was saved + applied (the SDK then retries the original request once);
 * resolves false if there was nothing to refresh with or the refresh failed (the SDK rethrows the original 401).
 */
export function createRefreshExecutor(deps: RefreshExecutorDeps): () => Promise<boolean> {
  return async () => {
    const refreshToken = deps.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const fresh = await deps.refresh(refreshToken, deps.tenantId);
      const now = (deps.now ?? Date.now)();
      await deps.saveTokens(fresh, now);
      deps.onRefreshed(fresh, now);
      return true;
    } catch {
      await deps.onRefreshFailed();
      return false;
    }
  };
}
