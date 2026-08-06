// apps/web-admin/src/lib/admin-auth.ts · god-mode session. The admin access token (issued by the admin IdP
// AFTER a FIDO2/hardware-key ceremony — that strong-auth flow lives in the IdP, not in this UI) is held in an
// HTTPONLY, Secure, SameSite=Strict cookie (Strict, not Lax — no cross-site navigation should carry a god-mode
// token). admin-api independently re-enforces owner-RBAC + hardware-key + step-up on every call, so this cookie
// is convenience, never the authority. requireAdmin() gates server components.
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from './env';

export const ADMIN_COOKIE = 'kva_session';
const OPTS = { httpOnly: true, secure: env.isProduction, sameSite: 'strict' as const, path: '/' };

export function getAdminToken(): string | undefined { return cookies().get(ADMIN_COOKIE)?.value; }
export function setAdminSession(token: string, maxAgeSec: number): void { cookies().set(ADMIN_COOKIE, token, { ...OPTS, maxAge: maxAgeSec }); }
export function clearAdminSession(): void { cookies().delete(ADMIN_COOKIE); }
export function isAdminAuthenticated(): boolean { return !!getAdminToken(); }
export function requireAdmin(): void { if (!isAdminAuthenticated()) redirect('/login'); }

/**
 * The operator's own user id, read from the UNVERIFIED `sub` claim of the session token (PC-56 ADMIN-1b).
 *
 * DISPLAY GATING ONLY — READ THIS BEFORE USING IT. The signature is NOT checked here; this value must never be an
 * authorization decision. Its single purpose is maker-checker ERGONOMICS: knowing which adjustment requests are the
 * viewer's own so their own request shows no approve/apply controls. The authority lives in two places that cannot be
 * fooled by a forged cookie — a database CHECK (`ck_billing_adj_maker_ne_checker`, migration 0093) and admin-api's
 * 403 on self-approval. A tampered token can therefore change what this console DRAWS and nothing about what the
 * platform DOES.
 *
 * Why bother at all: the alternative is rendering approve buttons on your own request and letting the server refuse
 * them, which teaches an operator that the control is decorative — the exact attitude maker-checker exists to prevent.
 *
 * Returns null when there is no token or the payload is unreadable; callers must treat null as "cannot tell", which
 * for this control means showing the buttons and letting the server decide. That is the safe direction: a redundant
 * refusal is recoverable, a hidden control that should have been offered blocks legitimate work.
 */
export function adminUserId(): string | null {
  const token = getAdminToken();
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.trim() ? sub : null;
  } catch { return null; }
}
