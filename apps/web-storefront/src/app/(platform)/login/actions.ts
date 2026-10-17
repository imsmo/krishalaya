'use server';
// apps/web-storefront/src/app/(platform)/login/actions.ts · the sign-in chain's server mutations (canon W321/W322 and their chain pages, PC-56
// STORE-1a). Each action does ONE step and redirects to the next URL-carried state (`?step=` — features/auth/login-state.ts):
//   requestCode   W321 "Send my code"       → ?step=code (W3107)        | ?step=phone&err=… (W3108, values kept)
//   verifyCode    W322 "Verify"             → ?step=done (W3132)         | ?step=2fa (TWO_FACTOR_PENDING) | ?step=code&err=… (W3133)
//   verifyTwoFactor   the 2FA sub-step       → ?step=done                 | ?step=2fa&err=…
//   resendCode    W322 "Resend"             → ?step=code&sent=1          | ?step=code&err=…
//   resetLogin    "wrong number?"            → ?step=phone
// SECURITY:
//   - Anonymous SDK calls carry the signed buyer address (lib/caller.ts). Tokens go straight into httpOnly cookies, never to the client.
//   - NO PII IN A URL: the phone, the code typed and the 2FA challenge ride httpOnly cookies (lib/login-flow.ts); `loginHref` refuses a
//     phone-shaped value.
//   - Idempotency-Key minted AT RENDER (a hidden input), so a double-submit of one rendered form reuses its key.
//   - Every refusal is NAMED (features/auth/failure.ts) — the old "a code is on its way" after a swallowed error is gone. Enumeration-safety
//     holds: the API sends a code to every number, so no refusal reveals whether an account exists.
//   - `next` is validated same-origin before any redirect (open-redirect guard).
//   - The tenant is the page's (route slug → host → platform), resolved by the API (lib/tenant-context.ts), never a build-time id.
// PC-56 HOTFIX-8 · D1 (c) — nothing personal in the cache on a shared phone (features/offline/owner.ts holds the rule):
//   - sign-out redirects THROUGH `/api/session/clear` (armed), which sends `Clear-Site-Data: "cache", "storage"` on its 303 — a Server Action
//     cannot set that header itself (Next 14), so the route handler the action redirects to does;
//   - a sign-in whose person differs from the one this device last knew (the `kvs_owner` marker + its httpOnly binding) does the same;
//     the same person signing in again does not.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import type { AuthTokens } from '@krishalaya/sdk-js';
import { publicClient, serverClient, tokenClient } from '../../../lib/api-client';
import { setSession, clearSession, getSessionToken } from '../../../lib/auth';
import { readPendingLogin, writePendingLogin, readPendingTwoFactor, writePendingTwoFactor, clearLoginFlow } from '../../../lib/login-flow';
import { resolveStorefrontTenant } from '../../../lib/tenant-context';
import { checkPhone } from '../../../features/auth/phone';
import { loginHref, type LoginHrefInput } from '../../../features/auth/login-state';
import { safeNext } from '../../../features/auth/redirect';
import { classifyRequestFailure, classifyVerifyFailure, classifyTwoFactorFailure, failureStep, type Failure } from '../../../features/auth/failure';
import { ensureBuyer } from '../../../features/auth/buyer';
import { settleOwnerAtSignIn, armClearSiteData } from '../../../lib/owner-marker';
import { clearSiteHref } from '../../../features/offline/owner';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nowSec = () => Math.floor(Date.now() / 1000);

interface Ctx { routeSlug: string | null; base: string; next: string; idem: string }
function ctxOf(formData: FormData): Ctx {
  const t = String(formData.get('t') ?? '').trim().toLowerCase();
  const routeSlug = /^[a-z0-9][a-z0-9-]{0,49}$/.test(t) ? t : null;
  const idem = String(formData.get('idem') ?? '');
  return { routeSlug, base: routeSlug ? `/${routeSlug}/login` : '/login', next: safeNext(String(formData.get('next') ?? '/')), idem: UUID.test(idem) ? idem : randomUUID() };
}
function go(c: Ctx, p: LoginHrefInput): never { redirect(loginHref(c.base, { next: c.next, ...p })); }
const failHref = (c: Ctx, f: Failure, step: 'phone' | 'code' | '2fa'): string =>
  loginHref(c.base, { step: failureStep(f, step), next: c.next, err: f.err, n: f.n ?? null, left: f.left ?? null, max: f.max ?? null });

/** W321 "Send my code". */
export async function requestCodeAction(formData: FormData): Promise<void> {
  const c = ctxOf(formData);
  const typed = String(formData.get('phone') ?? '').trim().slice(0, 32);
  writePendingLogin({ typed });                                     // the field keeps what was typed — on every outcome below
  const tenant = await resolveStorefrontTenant(c.routeSlug);
  if (!tenant.ok) go(c, { step: 'phone', err: tenant.kind === 'unavailable' ? 'unavailable' : 'tenant' });
  if (!tenant.ok) return;
  const check = checkPhone(typed, tenant.tenant.countryCode ?? tenant.tenant.phoneDefaultCountry);
  if (check.kind === 'empty') go(c, { step: 'phone', err: 'phone_empty' });
  if (check.kind === 'digits') go(c, { step: 'phone', err: 'phone_digits', need: check.need, have: check.have, dial: check.dial });
  if (check.kind !== 'ok') go(c, { step: 'phone', err: 'phone_invalid' });
  if (check.kind !== 'ok') return;
  let href: string;
  try {
    const r = await publicClient(tenant.slug).auth.requestOtp(check.e164, c.idem);
    const at = nowSec();
    writePendingLogin({ typed, phone: check.e164, sentAt: at, ttlSec: r.ttlSec, resendAt: at + Math.max(0, r.resendInSec) });
    href = loginHref(c.base, { step: 'code', next: c.next });
  } catch (e) {
    href = failHref(c, classifyRequestFailure(e), 'phone');
  }
  redirect(href);                                                    // outside the try: redirect() throws control flow
}

/** W322 "Resend" — a fresh code (the API's cooldown is the gate; the old code dies the moment the new one is born). */
export async function resendCodeAction(formData: FormData): Promise<void> {
  const c = ctxOf(formData);
  const pending = readPendingLogin();
  if (!pending?.phone) go(c, { step: 'phone', err: 'start_again' });
  const tenant = await resolveStorefrontTenant(c.routeSlug);
  if (!tenant.ok) go(c, { step: 'code', err: tenant.kind === 'unavailable' ? 'unavailable' : 'tenant' });
  if (!tenant.ok || !pending?.phone) return;
  let href: string;
  try {
    const r = await publicClient(tenant.slug).auth.requestOtp(pending.phone, c.idem);
    const at = nowSec();
    writePendingLogin({ typed: pending.typed, phone: pending.phone, sentAt: at, ttlSec: r.ttlSec, resendAt: at + Math.max(0, r.resendInSec) });
    href = loginHref(c.base, { step: 'code', next: c.next, sent: true });
  } catch (e) {
    href = failHref(c, classifyRequestFailure(e), 'code');
  }
  redirect(href);
}

/** "wrong number?" — back to the phone step, the typed number still in the field. */
export async function resetLoginAction(formData: FormData): Promise<void> {
  const c = ctxOf(formData);
  const pending = readPendingLogin();
  clearLoginFlow();
  if (pending) writePendingLogin({ typed: pending.typed });
  go(c, { step: 'phone' });
}

/** After the code (and, when asked, the second factor): make the person a buyer (D4), store the session, show the signed-in state. */
async function finish(c: Ctx, tokens: AuthTokens, tenantId: string, slug: string): Promise<string> {
  const r = await ensureBuyer(tokens, tenantId, {
    grantCustomer: (accessToken) => tokenClient(accessToken, slug).onboarding.selectRole('customer', randomUUID()),
    refresh: (refreshToken, tid) => publicClient(slug).auth.refresh(refreshToken, tid),
  });
  setSession(r.tokens, tenantId);
  clearLoginFlow();
  const done = loginHref(c.base, { step: 'done', next: c.next, buy: r.buyer });
  // HOTFIX-8 · D1 (c): a different person on this device → the done page is reached through the clear route (the header on its 303)
  return settleOwnerAtSignIn(r.tokens.accessToken) ? clearSiteHref(done) : done;
}

/** W322 "Verify". */
export async function verifyCodeAction(formData: FormData): Promise<void> {
  const c = ctxOf(formData);
  const pending = readPendingLogin();
  const code = String(formData.get('code') ?? '').replace(/\s/g, '').slice(0, 8);
  if (!pending?.phone) go(c, { step: 'phone', err: 'start_again' });
  if (!pending?.phone) return;
  writePendingLogin({ ...pending, code: /^\d{1,8}$/.test(code) ? code : undefined });   // digits stay on any refusal
  if (!/^\d{4,8}$/.test(code)) go(c, { step: 'code', err: 'code_format' });
  const tenant = await resolveStorefrontTenant(c.routeSlug);
  if (!tenant.ok) go(c, { step: 'code', err: tenant.kind === 'unavailable' ? 'unavailable' : 'tenant' });
  if (!tenant.ok) return;
  let href: string;
  try {
    const tokens = await publicClient(tenant.slug).auth.verifyOtp(pending.phone, code, c.idem, tenant.tenant.tenantId);
    href = await finish(c, tokens, tenant.tenant.tenantId, tenant.slug);
  } catch (e) {
    const f = classifyVerifyFailure(e);
    if (f.err === 'two_factor' && 'challengeToken' in f && f.challengeToken) {
      writePendingTwoFactor(f.challengeToken, f.challengeSec ?? 300);
      href = loginHref(c.base, { step: '2fa', next: c.next });
    } else {
      href = failHref(c, f as Failure, 'code');
    }
  }
  redirect(href);
}

/** The second factor (D5): a 6-digit authenticator code or one recovery code. */
export async function verifyTwoFactorAction(formData: FormData): Promise<void> {
  const c = ctxOf(formData);
  const challenge = readPendingTwoFactor();
  if (!challenge || challenge.until <= nowSec()) go(c, { step: 'phone', err: 'challenge_expired' });
  const code = String(formData.get('totp') ?? '').replace(/\s/g, '');
  const recovery = String(formData.get('recovery') ?? '').trim();
  const useCode = /^\d{6}$/.test(code);
  if (!useCode && !(recovery.length >= 10 && recovery.length <= 20)) go(c, { step: '2fa', err: 'totp_format' });
  const tenant = await resolveStorefrontTenant(c.routeSlug);
  if (!tenant.ok) go(c, { step: '2fa', err: tenant.kind === 'unavailable' ? 'unavailable' : 'tenant' });
  if (!tenant.ok || !challenge) return;
  let href: string;
  try {
    const tokens = await publicClient(tenant.slug).auth.verifyTwoFactor({
      tenantId: tenant.tenant.tenantId, challengeToken: challenge.challengeToken, ...(useCode ? { code } : { recoveryCode: recovery }),
    });
    href = await finish(c, tokens, tenant.tenant.tenantId, tenant.slug);
  } catch (e) {
    href = failHref(c, classifyTwoFactorFailure(e), '2fa');
  }
  redirect(href);
}

/** Sign out: revoke the session SERVER-SIDE (B6 — a copied refresh token dies with it), then drop every cookie. */
export async function logoutAction(): Promise<void> {
  if (getSessionToken()) {
    try { await serverClient().auth.logout(); } catch { /* the API is unreachable: the cookies still go — never trap a person signed in */ }
  }
  clearSession();
  clearLoginFlow();
  // HOTFIX-8 · D1 (c): every sign-out clears this device's caches and storage — the redirect passes the armed clear route, then home
  armClearSiteData();
  redirect(clearSiteHref('/'));
}
