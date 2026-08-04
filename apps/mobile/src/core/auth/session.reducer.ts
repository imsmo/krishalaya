// apps/mobile/src/core/auth/session.reducer.ts · the PURE state machine for the app session. No React, no I/O —
// just (state, action) → state, so it is fully unit-testable (see __tests__/session.reducer.spec.ts). The auth
// store (React) and token store (secure storage) are thin shells around this. Keeping the transition logic pure
// is the mobile analogue of the API's domain state machines (Law 5): one place owns "what a session can become".
import type { AuthTokens, UserProfile } from '@krishalaya/sdk-js';

export type SessionStatus = 'booting' | 'anonymous' | 'authenticated';

export interface SessionState {
  status: SessionStatus;
  accessToken?: string;
  refreshToken?: string;
  /** epoch ms when the access token expires; used to refresh proactively. */
  expiresAtMs?: number;
  profile?: UserProfile;
  /** the role the user is currently acting as (a user may hold several). */
  activeRole?: string;
  /** active UI language code (hi/en/gu). */
  language: string;
}

export type SessionAction =
  | { type: 'BOOT_RESTORED'; tokens?: AuthTokens & { expiresAtMs: number }; language: string; activeRole?: string }
  | { type: 'SIGNED_IN'; tokens: AuthTokens; nowMs: number }
  | { type: 'TOKENS_REFRESHED'; tokens: AuthTokens; nowMs: number }
  | { type: 'PROFILE_LOADED'; profile: UserProfile }
  | { type: 'ROLE_SELECTED'; role: string }
  | { type: 'LANGUAGE_SET'; language: string }
  | { type: 'SIGNED_OUT' };

export const initialSession: SessionState = { status: 'booting', language: 'en' };

const withTokens = (s: SessionState, tokens: AuthTokens, nowMs: number): SessionState => ({
  ...s,
  status: 'authenticated',
  accessToken: tokens.accessToken,
  refreshToken: tokens.refreshToken,
  expiresAtMs: nowMs + tokens.expiresInSec * 1000,
});

/** True when a restored-tokens payload has the two required string fields. Guards against a corrupt/partial
 * SecureStore write (interrupted save, or a legacy/pre-shape blob) resurrecting a broken session — discard rather
 * than crash (fail closed, mirrors tokenStore.readTokens's own guard; defence-in-depth since the reducer must be
 * safe on its own, e.g. under direct unit test). */
function hasValidTokenShape(t: unknown): t is AuthTokens & { expiresAtMs: number } {
  if (!t || typeof t !== 'object') return false;
  const { accessToken, refreshToken } = t as Record<string, unknown>;
  return typeof accessToken === 'string' && accessToken.length > 0 && typeof refreshToken === 'string' && refreshToken.length > 0;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'BOOT_RESTORED': {
      const base: SessionState = { ...state, language: action.language, activeRole: action.activeRole };
      if (!hasValidTokenShape(action.tokens)) return { ...base, status: 'anonymous' };
      const expiresAtMs = typeof action.tokens.expiresAtMs === 'number' && Number.isFinite(action.tokens.expiresAtMs)
        ? action.tokens.expiresAtMs : undefined;
      return {
        ...base, status: 'authenticated',
        accessToken: action.tokens.accessToken, refreshToken: action.tokens.refreshToken, expiresAtMs,
      };
    }
    case 'SIGNED_IN':
      return withTokens(state, action.tokens, action.nowMs);
    case 'TOKENS_REFRESHED':
      // never resurrect a signed-out session via a late refresh
      return state.status === 'authenticated' ? withTokens(state, action.tokens, action.nowMs) : state;
    case 'PROFILE_LOADED': {
      // Defence-in-depth: the auth store already normalises the server's profile response before dispatching
      // (see auth.store.tsx loadProfile), but the reducer must never trust action.profile's shape either —
      // `roles` missing/non-array (root cause: the API's current /users/me response carries no `roles` field,
      // a contract gap vs. the SDK's UserProfile type) used to crash here with `undefined[0]`.
      const roles = Array.isArray(action.profile?.roles) ? action.profile.roles : [];
      return { ...state, profile: action.profile ?? state.profile, activeRole: state.activeRole ?? roles[0] };
    }
    case 'ROLE_SELECTED':
      return { ...state, activeRole: action.role };
    case 'LANGUAGE_SET':
      return { ...state, language: action.language };
    case 'SIGNED_OUT':
      return { status: 'anonymous', language: state.language };
    default:
      return state;
  }
}

/** True when the access token is missing or within `skewMs` of expiry (refresh proactively). */
export function needsRefresh(state: SessionState, nowMs: number, skewMs = 60_000): boolean {
  if (state.status !== 'authenticated' || !state.refreshToken) return false;
  if (!state.expiresAtMs) return true;
  return state.expiresAtMs - nowMs <= skewMs;
}
