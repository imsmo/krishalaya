// apps/web-storefront/src/features/auth/buyer.ts · PC-56 STORE-1a · C7 (founder D4) — "Buying needs nothing more", made TRUE.
//
// A person who signs in for the first time holds no role in this organisation, so the cart and checkout (`order.create`) answered 403
// and the canon's promise was false (survey F-3). After a successful sign-in the storefront now grants `customer` through the API's own
// self-serve route (`POST /v1/onboarding/roles`, flag `selfserve_onboarding`, idempotent) and REFRESHES the token in the same action, so
// the very first page after sign-in can buy. No buyer KYC (D4). The flag OFF is a named state ('off'): the person is signed in, told
// that buying is not switched on here, and never shown a fake success.
//
// The roles are read from the access token only to decide whether to ASK — the API decides what the token may do. Pure, with the two
// network calls injected (the server action passes the SDK), so the rule is tested without a server.
import type { BuyerState } from './login-state';

export interface TokenPair { accessToken: string; refreshToken: string; expiresInSec: number }

/** The `roles` claim of an access token (unverified — a decision about whether to ask, never an authorisation). */
export function tokenRoles(accessToken: string): string[] {
  try {
    const seg = String(accessToken ?? '').split('.')[1] ?? '';
    const json = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { roles?: unknown };
    return Array.isArray(json.roles) ? json.roles.filter((r): r is string => typeof r === 'string') : [];
  } catch { return []; }
}
export function needsCustomerGrant(accessToken: string): boolean {
  return !tokenRoles(accessToken).includes('customer');
}

export interface BuyerDeps {
  /** POST /v1/onboarding/roles { role: 'customer' } with this access token (idempotent). */
  grantCustomer(accessToken: string): Promise<unknown>;
  /** POST /v1/auth/refresh for the tenant the session belongs to. */
  refresh(refreshToken: string, tenantId: string): Promise<TokenPair>;
}

const statusOf = (e: unknown) => Number((e as { status?: unknown } | null)?.status ?? 0);

/** Make the freshly signed-in person a buyer of `tenantId` (if they are not one), and return the tokens to store. */
export async function ensureBuyer(tokens: TokenPair, tenantId: string, deps: BuyerDeps): Promise<{ tokens: TokenPair; buyer: BuyerState }> {
  if (!needsCustomerGrant(tokens.accessToken)) return { tokens, buyer: 'ready' };
  try { await deps.grantCustomer(tokens.accessToken); }
  catch (e) { return { tokens, buyer: statusOf(e) === 404 ? 'off' : 'unavailable' }; }
  try { return { tokens: await deps.refresh(tokens.refreshToken, tenantId), buyer: 'granted' }; }
  catch { return { tokens, buyer: 'unavailable' }; }
}
