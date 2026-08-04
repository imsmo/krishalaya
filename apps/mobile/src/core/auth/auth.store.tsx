// apps/mobile/src/core/auth/auth.store.tsx · the React-facing session store. It owns the in-memory SessionState
// (via the pure sessionReducer), persists tokens to encrypted secure storage, registers the live access-token
// getter with the API client, and keeps the i18n runtime's language in sync. Screens consume `useAuth()`.
//
// Security notes (Law 4): tokens live in the Keychain/Keystore (token-store), never in AsyncStorage or logs.
// A proactive refresh runs at boot if the access token is near expiry; a failed refresh signs the user out
// (fail closed). The client always re-enforces RBAC server-side — the role here is a UI convenience only.
//
// REACTIVE refresh-on-401 (S6-prep P0): the boot-time refresh above is proactive-only — it does nothing once
// the app has been open longer than the access token's 900s TTL, so every request used to 401 until restart.
// This store also registers a refresh EXECUTOR with the API client (mirrors registerAccessTokenGetter): the SDK
// calls it reactively on a 401 (single-flighted + retried once — see packages/sdk-js/src/http.ts), and it signs
// the user out if the refresh itself fails (the access token is by then confirmed dead, so there's no safe
// degrade — only login recovers the session).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AuthTokens, UserProfile } from '@krishalaya/sdk-js';
import { sessionReducer, initialSession, needsRefresh, type SessionState } from './session.reducer';
import { tokenStore } from './token-store';
import { createRefreshExecutor } from './refresh-executor';
import { apiClient, anonClient, registerAccessTokenGetter, registerRefreshExecutor } from '../api/client';
import { setCacheScope, clearCacheScope } from '../offline/scope';
import { setCrashUser, track, EVENTS } from '../observability';
import { i18n } from '../i18n/i18n';
import { config } from '../config';

interface AuthApi {
  state: SessionState;
  /** Persist tokens + flip to authenticated (used by the OTP verify screen). */
  signIn: (tokens: AuthTokens) => Promise<void>;
  signOut: () => Promise<void>;
  selectRole: (role: string) => Promise<void>;
  setLanguage: (code: string) => Promise<void>;
  /** Fetch the profile for the bottom-tab greeting etc.; degrades silently on failure. */
  loadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSession);
  // keep a ref so the client's token getter always reads the latest token without re-registering
  const tokenRef = useRef<string | undefined>(undefined);
  tokenRef.current = state.accessToken;
  useEffect(() => { registerAccessTokenGetter(() => tokenRef.current); }, []);

  // keep a ref to the current refresh token so the reactive-refresh executor (registered once, below) always
  // reads the LATEST one without re-registering on every token rotation.
  const refreshTokenRef = useRef<string | undefined>(undefined);
  refreshTokenRef.current = state.refreshToken;

  // REACTIVE refresh-on-401: registered once so the SDK's single-flight (packages/sdk-js/src/http.ts) always
  // targets the SAME executor reference across the app's lifetime. The decision logic itself lives in the
  // framework-free `createRefreshExecutor` (refresh-executor.ts, unit-tested directly) — this wires it to the
  // live refs/actions dispatch/anonClient/tokenStore need.
  useEffect(() => {
    registerRefreshExecutor(createRefreshExecutor({
      getRefreshToken: () => refreshTokenRef.current,
      tenantId: config.tenantId,
      refresh: (refreshToken, tenantId) => anonClient().auth.refresh(refreshToken, tenantId),
      saveTokens: (tokens, nowMs) => tokenStore.saveTokens(tokens, nowMs),
      onRefreshed: (tokens, nowMs) => dispatch({ type: 'TOKENS_REFRESHED', tokens, nowMs }),
      onRefreshFailed: async () => {
        await tokenStore.clearTokens();
        dispatch({ type: 'SIGNED_OUT' });
      },
    }));
  }, []);

  // Boot: restore language + tokens, refresh if near expiry, else go anonymous.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lang, role, tokens] = await Promise.all([tokenStore.readLanguage(), tokenStore.readRole(), tokenStore.readTokens()]);
      const language = lang ?? i18n.lang;
      i18n.setLanguage(language);
      if (cancelled) return;
      // S6-prep BOOT-RACE FIX: BOOT_RESTORED used to dispatch BEFORE the proactive refresh, so screens
      // mounted immediately and fired authed requests (users/me) with the about-to-be-rotated token —
      // one guaranteed 401 on every app open with an aged token (default greeting flash). Now: when a
      // refresh is needed we complete it FIRST, then restore the session with the FRESH tokens, so the
      // first authed request a screen makes already carries a valid token. Refresh failure falls through
      // to the old degrade-never-die path (restore with old tokens if still valid, else signed out).
      let bootTokens = tokens ?? undefined;
      if (tokens && needsRefresh({ ...initialSession, status: 'authenticated', refreshToken: tokens.refreshToken, expiresAtMs: tokens.expiresAtMs }, Date.now())) {
        try {
          // S6-prep fix: the API's RefreshSchema REQUIRES tenantId (session is tenant-scoped) — omitting it
          // 422'd every proactive refresh, silently killing the session on each app boot until re-login.
          const fresh = await anonClient().auth.refresh(tokens.refreshToken, config.tenantId);
          const now = Date.now();
          await tokenStore.saveTokens(fresh, now);
          // BOOT_RESTORED's tokens carry the persisted expiresAtMs; compute it the same way saveTokens does.
          bootTokens = { ...fresh, expiresAtMs: now + fresh.expiresInSec * 1000 };
        } catch {
          // A failed PROACTIVE refresh must not evict a user whose access token is still valid — only sign out when
          // the token has actually expired. This keeps the session across app restarts on flaky networks / a
          // transient refresh error (degrade-never-die); the client refreshes again on its next 401.
          const stillValid = typeof tokens.expiresAtMs === 'number' && Date.now() < tokens.expiresAtMs;
          if (!stillValid) {
            await tokenStore.clearTokens();
            bootTokens = undefined;   // expired + refresh failed → restore signed-out
          }
        }
      }
      if (!cancelled) dispatch({ type: 'BOOT_RESTORED', language, activeRole: role, tokens: bootTokens });
    })();
    return () => { cancelled = true; };
  }, []);

  // S6-prep RENDER-LOOP FIX: the api object was memoized on [state], so EVERY dispatch minted new
  // function identities. Screens that (correctly) depend on e.g. `loadProfile` in a useCallback/useEffect
  // then refired on every state change — loadProfile() → dispatch → new loadProfile → effect refires →
  // an infinite fetch loop (users/me + wallet + addresses hammered several times per second on home).
  // None of these actions read `state` (dispatch/tokenStore/apiClient/i18n are all stable), so they are
  // created ONCE ([] deps); the context value then only re-wraps { state, ...actions } — the FUNCTION
  // references stay identical across state changes, which is what consumers' dep arrays key on.
  const actions = useMemo(() => ({
    async signIn(tokens: AuthTokens) {
      const now = Date.now();
      await tokenStore.saveTokens(tokens, now);
      track(EVENTS.loginSuccess); // funnel (consent-gated, no PII) — §6
      dispatch({ type: 'SIGNED_IN', tokens, nowMs: now });
    },
    async signOut() {
      await tokenStore.clearTokens();
      await clearCacheScope();        // wipe this user's cached reads so the next user can't see them
      setCrashUser(null);             // clear the crash user context (no PII lingers)
      dispatch({ type: 'SIGNED_OUT' });
    },
    async selectRole(role: string) {
      await tokenStore.saveRole(role);
      dispatch({ type: 'ROLE_SELECTED', role });
    },
    async setLanguage(code: string) {
      await tokenStore.saveLanguage(code);
      i18n.setLanguage(code);
      dispatch({ type: 'LANGUAGE_SET', language: i18n.lang });
    },
    async loadProfile() {
      try {
        const raw = await apiClient().auth.me();
        // ROOT CAUSE of the boot crash (TypeError: Cannot convert undefined value to object): the API's current
        // GET /users/me response (identity's User.toPublic()) does not carry a `roles` field at all — a contract
        // gap vs. this SDK's UserProfile type, which promises {id, displayName, roles, locale}. Trusting that type
        // without runtime validation meant `action.profile.roles[0]` in the reducer crashed on `undefined[0]` the
        // moment a real server response reached it (i.e. right after login, on the very next boot/profile load).
        // Never trust an external response's shape — normalise at the boundary (mirrors how tokenStore validates
        // persisted tokens) so a missing/malformed field degrades instead of crashing.
        const profile: UserProfile = {
          id: typeof raw?.id === 'string' ? raw.id : '',
          displayName: typeof raw?.displayName === 'string' ? raw.displayName : null,
          roles: Array.isArray(raw?.roles) ? raw.roles : [],
          locale: typeof raw?.locale === 'string' && raw.locale ? raw.locale : i18n.lang,
        };
        if (!profile.id) return; // no usable identity in the response — degrade-never-die, keep the prior state
        setCacheScope(profile.id);    // scope the read-cache to this user (anti-IDOR across accounts)
        setCrashUser(profile.id);     // crash/analytics user context = id ONLY (no phone/name/email) — §4/§6
        dispatch({ type: 'PROFILE_LOADED', profile });
      } catch { /* degrade-never-die: the greeting falls back to a default */ }
    },
  }), []);
  const api = useMemo<AuthApi>(() => ({ state, ...actions }), [state, actions]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
