'use server';
// apps/web-gov/src/app/login/actions.ts · PC-56 GOV-1a — SIGN-IN TO A GOVERNMENT AUTHORITY (Server Actions; GOV-1 Q2-A + Q5-A, the gov realm
// ONLY: `client.gov.auth.*` → `/v1/gov/auth/*`; never the organisation sign-in).
//   1. requestOtp — the platform's phone code (enumeration-safe by API contract — the same next step regardless). The phone goes into a
//      SHORT-LIVED httpOnly cookie (10 minutes, path /login), never the URL (a query string lands in access logs, history and Referer).
//   2. verifyOtp — phone (from the cookie) + code → `gov.auth.verify`. One authority → (a) no confirmed authenticator: GOV_TWO_FACTOR_REQUIRED
//      with an enrol token (no session exists) → the set-up step; (b) a confirmed authenticator: TWO_FACTOR_PENDING with a challenge → the
//      authenticator step. Several authorities → GOV_CHOICE_REQUIRED with a single-use choice token and the authorities' names → the chooser.
//   3. choose / twoFactor finish it; enrol shows the set-up key (once), confirmEnrol confirms a code and shows the recovery codes (once),
//      then the person signs in again. startOver clears every pending cookie.
// Every pending credential (the choice token, the challenge, the enrol token, the set-up key, the recovery codes) rides a short-lived
// httpOnly SameSite=Strict cookie scoped to /login — never a URL, never a field. Errors surface as a named CODE in the query (features/gov1/
// login.ts `landing`), never a phone or a token. Tokens land in the httpOnly session cookies only. 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import { anonClient } from '../../lib/api-client';
import { setSession } from '../../lib/auth';
import { landing, landingHref, secondFactorInput, type LoginStep } from '../../features/gov1/login';

const PENDING_PHONE = 'kvg_pending_phone';
const CHOICE = 'kvg_choice';
const CHALLENGE = 'kvg_2fa';
const ENROL = 'kvg_enrol';
const ENROL_KEY = 'kvg_enrol_key';
const RECOVERY = 'kvg_recovery';
const PENDING = [PENDING_PHONE, CHOICE, CHALLENGE, ENROL, ENROL_KEY, RECOVERY] as const;
const short = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/login', maxAge });
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function clearPending(): void {
  for (const k of PENDING) cookies().set(k, '', short(0));
}
/** After a sign-in answer that is not a session: a step (with its credential in a cookie), or a named refusal. Never returns. */
function land(e: unknown, step: LoginStep): never {
  const err = e instanceof SdkError ? e : null;
  const l = landing(err?.code ?? null, err?.status ?? null, err?.details ?? null);
  const d = (err?.details ?? {}) as Record<string, unknown>;
  if (l.kind === 'step' && l.step === 'choose') {
    const authorities = Array.isArray(d.authorities) ? (d.authorities as Array<{ id: string; name: string }>) : [];
    cookies().set(CHOICE, JSON.stringify({ token: String(d.choiceToken ?? ''), authorities }), short(300));
  }
  if (l.kind === 'step' && l.step === '2fa') cookies().set(CHALLENGE, String(d.challengeToken ?? ''), short(300));
  if (l.kind === 'step' && l.step === 'enrol') cookies().set(ENROL, String(d.enrolToken ?? ''), short(600));
  redirect(landingHref(l, step));
}
function signedIn(tokens: { accessToken: string; refreshToken: string; expiresInSec: number }): never {
  setSession(tokens.accessToken, tokens.refreshToken, tokens.expiresInSec);
  clearPending();
  redirect('/login?act=success');
}

export async function requestOtpAction(formData: FormData): Promise<void> {
  const phone = str(formData, 'phone');
  try { await anonClient().gov.auth.otp(phone); } catch { /* enumeration-safe: the same next step regardless */ }
  cookies().set(PENDING_PHONE, phone, short(600));
  redirect('/login?step=verify');
}

export async function verifyOtpAction(formData: FormData): Promise<void> {
  const phone = cookies().get(PENDING_PHONE)?.value ?? '';
  if (!phone) redirect('/login?act=failure&error=PHONE_MISSING');
  let tokens;
  try { tokens = await anonClient().gov.auth.verify(phone, str(formData, 'code')); }
  catch (e) { land(e, 'verify'); }
  signedIn(tokens);
}

export async function chooseAction(formData: FormData): Promise<void> {
  let rec: { token?: string } = {};
  try { rec = JSON.parse(cookies().get(CHOICE)?.value ?? '{}') as { token?: string }; } catch { rec = {}; }
  if (!rec.token) redirect('/login?act=failure&error=GOV_CHOICE_INVALID');
  let tokens;
  try { tokens = await anonClient().gov.auth.choose(rec.token, str(formData, 'authorityId')); }
  catch (e) { land(e, 'choose'); }
  signedIn(tokens);
}

export async function twoFactorAction(formData: FormData): Promise<void> {
  const challengeToken = cookies().get(CHALLENGE)?.value ?? '';
  if (!challengeToken) redirect('/login?act=failure&error=TWO_FACTOR_CHALLENGE_INVALID');
  let tokens;
  try { tokens = await anonClient().gov.auth.verifyTwoFactor({ challengeToken, ...secondFactorInput(str(formData, 'code')) }); }
  catch (e) { land(e, '2fa'); }
  signedIn(tokens);
}

export async function enrolAction(): Promise<void> {
  const enrolToken = cookies().get(ENROL)?.value ?? '';
  if (!enrolToken) redirect('/login?act=failure&error=GOV_ENROL_TOKEN_INVALID');
  let key;
  try { key = await anonClient().gov.auth.enrol(enrolToken); }
  catch (e) { land(e, 'enrol'); }
  cookies().set(ENROL_KEY, JSON.stringify({ secret: key.secret, otpauthUri: key.otpauthUri }), short(600));
  redirect('/login?step=enrol-confirm');
}

export async function confirmEnrolAction(formData: FormData): Promise<void> {
  const enrolToken = cookies().get(ENROL)?.value ?? '';
  if (!enrolToken) redirect('/login?act=failure&error=GOV_ENROL_TOKEN_INVALID');
  let out;
  try { out = await anonClient().gov.auth.confirm(enrolToken, str(formData, 'code')); }
  catch (e) { land(e, 'enrol-confirm'); }
  for (const k of [ENROL, ENROL_KEY, PENDING_PHONE, CHOICE, CHALLENGE]) cookies().set(k, '', short(0));
  cookies().set(RECOVERY, JSON.stringify(out.recoveryCodes ?? []), short(300));
  redirect('/login?step=enrolled');
}

export async function startOverAction(): Promise<void> {
  clearPending();
  redirect('/login');
}
