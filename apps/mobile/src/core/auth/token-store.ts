// apps/mobile/src/core/auth/token-store.ts · durable, ENCRYPTED storage for the session tokens. Uses
// expo-secure-store (iOS Keychain / Android Keystore) — tokens are never in plain AsyncStorage and never in JS
// global state beyond the in-memory auth store. Non-secret preferences (language, active role) go in plain
// AsyncStorage. The access token's absolute expiry is persisted so we can refresh proactively at boot.
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthTokens } from '@krishalaya/sdk-js';

const K_ACCESS = 'kv.access';
const K_REFRESH = 'kv.refresh';
const K_EXPIRES = 'kv.expiresAt';
const K_LANG = 'kv.lang';
const K_ROLE = 'kv.role';

export interface PersistedTokens extends AuthTokens { expiresAtMs: number; }

export const tokenStore = {
  async saveTokens(tokens: AuthTokens, nowMs: number): Promise<void> {
    const expiresAtMs = nowMs + tokens.expiresInSec * 1000;
    await Promise.all([
      SecureStore.setItemAsync(K_ACCESS, tokens.accessToken),
      SecureStore.setItemAsync(K_REFRESH, tokens.refreshToken),
      SecureStore.setItemAsync(K_EXPIRES, String(expiresAtMs)),
    ]);
  },
  async readTokens(): Promise<PersistedTokens | undefined> {
    const [accessToken, refreshToken, expires] = await Promise.all([
      SecureStore.getItemAsync(K_ACCESS), SecureStore.getItemAsync(K_REFRESH), SecureStore.getItemAsync(K_EXPIRES),
    ]);
    // Validate the persisted shape rather than trust it: a partial write (app killed mid-`saveTokens`) or a blob
    // from a pre-shape-change build must be DISCARDED, never fed into the session state half-formed (fail closed
    // — the boot effect then falls back to anonymous instead of crashing on a malformed restore).
    if (!accessToken || !refreshToken || typeof accessToken !== 'string' || typeof refreshToken !== 'string') return undefined;
    const parsedExpiry = Number(expires);
    const expiresAtMs = Number.isFinite(parsedExpiry) && parsedExpiry > 0 ? parsedExpiry : 0;
    return { accessToken, refreshToken, expiresInSec: 0, expiresAtMs };
  },
  async clearTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(K_ACCESS), SecureStore.deleteItemAsync(K_REFRESH), SecureStore.deleteItemAsync(K_EXPIRES),
    ]);
  },
  // --- non-secret preferences ---
  async saveLanguage(code: string): Promise<void> { await AsyncStorage.setItem(K_LANG, code); },
  async readLanguage(): Promise<string | undefined> { return (await AsyncStorage.getItem(K_LANG)) ?? undefined; },
  async saveRole(role: string): Promise<void> { await AsyncStorage.setItem(K_ROLE, role); },
  async readRole(): Promise<string | undefined> { return (await AsyncStorage.getItem(K_ROLE)) ?? undefined; },
};
