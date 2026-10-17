'use server';
// apps/web-partner/src/app/login/actions.ts · PC-56 PARTNER-0 · founder D8 — SIGN-IN TO THE PARTNER (Server Actions).
//   1. requestOtp — the platform's phone OTP (enumeration-safe by API contract — same next step regardless). The phone goes into a SHORT-LIVED
//      httpOnly cookie (10 minutes), never the URL (F-9: a query string lands in access logs, history and Referer).
//   2. verifyOtp — phone (from the cookie) + code → `partner.auth.verify`. One partner → the session. Several → the API answers
//      PARTNER_CHOICE_REQUIRED with a single-use choice token and the partners' names: both go into a 5-minute httpOnly cookie and the page
//      shows the chooser. Confirmed TOTP → TWO_FACTOR_PENDING: the challenge goes into a 5-minute httpOnly cookie and the page asks the code.
//   3. choose / twoFactor finish it; startOver clears the pending cookies.
// Errors surface as an error CODE in the query (never a phone, never a token). Tokens land in the httpOnly session cookies only.
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { anonClient } from '../../lib/api-client';
import { setSession } from '../../lib/partner-auth';
import { env } from '../../lib/env';
import { SdkError } from '@krishalaya/sdk-js';

const PENDING_PHONE = 'kvp_pending_phone';
const CHOICE = 'kvp_choice';
const CHALLENGE = 'kvp_2fa';
const short = (maxAge: number) => ({ httpOnly: true, secure: env.isProduction, sameSite: 'strict' as const, path: '/login', maxAge });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const enc = encodeURIComponent;

function clearPending(): void {
  for (const k of [PENDING_PHONE, CHOICE, CHALLENGE]) cookies().set(k, '', { ...short(0) });
}
/** After a sign-in answer: a session, a chooser, or the second factor. Never returns. */
function land(e: unknown): never {
  if (e instanceof SdkError && e.code === 'PARTNER_CHOICE_REQUIRED') {
    const d = (e.details ?? {}) as { choiceToken?: string; partners?: Array<{ id: string; name: string }> };
    cookies().set(CHOICE, JSON.stringify({ token: d.choiceToken ?? '', partners: d.partners ?? [] }), short(300));
    redirect('/login?step=choose');
  }
  if (e instanceof SdkError && e.code === 'TWO_FACTOR_PENDING') {
    const d = (e.details ?? {}) as { challengeToken?: string };
    cookies().set(CHALLENGE, d.challengeToken ?? '', short(300));
    redirect('/login?step=2fa');
  }
  const code = e instanceof SdkError ? e.code : 'LOGIN_FAILED';
  redirect(`/login?step=verify&error=${enc(code)}`);
}

export async function requestOtpAction(formData: FormData): Promise<void> {
  const phone = str(formData, 'phone');
  try { await anonClient().partner.auth.otp(phone); } catch { /* enumeration-safe: same next step regardless */ }
  cookies().set(PENDING_PHONE, phone, short(600));
  redirect('/login?step=verify');
}

export async function verifyOtpAction(formData: FormData): Promise<void> {
  const phone = cookies().get(PENDING_PHONE)?.value ?? '';
  if (!phone) redirect('/login?error=PHONE_MISSING');
  let tokens;
  try { tokens = await anonClient().partner.auth.verify(phone, str(formData, 'code')); }
  catch (e) { land(e); }
  setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec);
  clearPending();
  redirect('/dashboard');
}

export async function chooseAction(formData: FormData): Promise<void> {
  let rec: { token?: string } = {};
  try { rec = JSON.parse(cookies().get(CHOICE)?.value ?? '{}') as { token?: string }; } catch { rec = {}; }
  if (!rec.token) redirect('/login?error=PARTNER_CHOICE_INVALID');
  let tokens;
  try { tokens = await anonClient().partner.auth.choose(rec.token, str(formData, 'partnerId')); }
  catch (e) { land(e); }
  setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec);
  clearPending();
  redirect('/dashboard');
}

export async function twoFactorAction(formData: FormData): Promise<void> {
  const challengeToken = cookies().get(CHALLENGE)?.value ?? '';
  if (!challengeToken) redirect('/login?error=PARTNER_CHOICE_INVALID');
  let tokens;
  try { tokens = await anonClient().partner.auth.verifyTwoFactor({ challengeToken, code: str(formData, 'code') }); }
  catch (e) { const code = e instanceof SdkError ? e.code : 'LOGIN_FAILED'; redirect(`/login?step=2fa&error=${enc(code)}`); }
  setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec);
  clearPending();
  redirect('/dashboard');
}

export async function startOverAction(): Promise<void> {
  clearPending();
  redirect('/login');
}
