// apps/web-tenant/src/app/invite/page.tsx · ACCEPT A STAFF INVITE — PC-56 TENANT-SW-c (founder decision: SMS INVITE TOKEN).
// The SMS link opens this page with the token (`?t=`), or the person types the code the SMS carries. The page shows what the invite is
// (organisation, role, the invited phone MASKED, its status — `POST /auth/invites/lookup`), sends a one-time code to the phone they type
// (it must be the invited one), and accepts with the token AND that code: the account (found or created), the role, the desks and a
// session — pending a second factor when the person already has 2FA. Refusals are named (expired, used, revoked, wrong code). noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import { anonClient } from '../../lib/api-client';
import { env } from '../../lib/env';
import { setSession } from '../../lib/auth';
import { getTranslator } from '../../lib/i18n';
import { INVITE_ACCEPT_HREF, swcCodeKey } from '../../features/swc/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.inviteAccept.title'), robots: { index: false, follow: false } };
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const back = (o: Record<string, string>) => `${INVITE_ACCEPT_HREF}?${new URLSearchParams(o).toString()}`;

async function sendCode(formData: FormData) {
  'use server';
  const token = String(formData.get('t') ?? ''); const phone = String(formData.get('phone') ?? '').trim();
  try { await anonClient().auth.requestOtp(phone, randomUUID()); } catch { /* enumeration-safe */ }
  redirect(back({ t: token, step: 'otp', phone }));
}
async function accept(formData: FormData) {
  'use server';
  const token = String(formData.get('t') ?? ''); const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim(); const fullName = String(formData.get('fullName') ?? '').trim().slice(0, 200);
  let err: string | null = null; let challenge: string | null = null;
  try {
    const tk = await anonClient().auth.acceptInvite({ tenantId: env.tenantId ?? '', token, phone, code, ...(fullName ? { fullName } : {}) });
    setSession(tk.accessToken, tk.refreshToken, tk.expiresInSec);
  } catch (e) {
    err = e instanceof SdkError ? e.code : 'unknown';
    const c = e instanceof SdkError && e.code === 'TWO_FACTOR_PENDING' ? (e.details as { challengeToken?: unknown } | undefined)?.challengeToken : null;
    if (typeof c === 'string') challenge = c;
  }
  if (challenge) {
    cookies().set('kvt_2fa', challenge, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/login', maxAge: 300 });
    redirect('/login?step=2fa&next=%2Fdashboard');
  }
  if (err) redirect(back({ t: token, step: 'otp', phone, error: err }));
  redirect('/dashboard');
}

export default async function InviteAcceptPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const t = getTranslator();
  const token = TOKEN.test(searchParams.t ?? '') ? (searchParams.t as string) : '';
  let info: { organisation: string; roleCode: string; phoneMasked: string; status: string; expiresAt: string } | null = null; let lookupErr: string | null = null;
  if (token) { try { info = await anonClient().auth.lookupInvite(env.tenantId ?? '', token); } catch (e) { lookupErr = e instanceof SdkError ? e.code : 'unknown'; } }
  const step = searchParams.step === 'otp' ? 'otp' : 'phone';
  return (
    <section className="kv-auth">
      <h1>{t.t('swc.inviteAccept.title')}</h1>
      {!token && (
        <form action={INVITE_ACCEPT_HREF} method="get" className="kv-form">
          <label htmlFor="t" className="kv-field__label">{t.t('swc.inviteAccept.code')}</label>
          <input id="t" name="t" className="kv-input" required pattern="[A-Za-z0-9_-]{43}" autoComplete="off" />
          <button className="kv-btn" type="submit">{t.t('swc.inviteAccept.open')}</button>
        </form>
      )}
      {token && lookupErr && <p className="kv-error" role="alert">{t.t(swcCodeKey(lookupErr))}</p>}
      {info && (
        <>
          <p>{t.t('swc.inviteAccept.what', { org: info.organisation, role: info.roleCode, phone: info.phoneMasked })}</p>
          {info.status !== 'pending' ? <p className="kv-error" role="alert">{t.t(info.status === 'expired' ? 'swc.code.INVITE_EXPIRED' : 'swc.code.INVITE_ALREADY_USED')}</p> : step === 'phone' ? (
            <form action={sendCode} className="kv-form">
              <input type="hidden" name="t" value={token} />
              <label htmlFor="phone" className="kv-field__label">{t.t('swc.inviteAccept.phone')}</label>
              <input id="phone" className="kv-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
              <p className="kv-field__hint">{t.t('swc.inviteAccept.phoneHint')}</p>
              <button className="kv-btn" type="submit">{t.t('login.sendOtp')}</button>
            </form>
          ) : (
            <form action={accept} className="kv-form">
              <input type="hidden" name="t" value={token} /><input type="hidden" name="phone" value={searchParams.phone ?? ''} />
              {searchParams.error && <p className="kv-error" role="alert">{t.t(swcCodeKey(searchParams.error))}</p>}
              <label htmlFor="code" className="kv-field__label">{t.t('login.otpLabel', { phone: searchParams.phone ?? '' })}</label>
              <input id="code" className="kv-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" required autoFocus />
              <label htmlFor="fullName" className="kv-field__label">{t.t('swc.field.fullName')}</label>
              <input id="fullName" className="kv-input" name="fullName" maxLength={200} />
              <button className="kv-btn kv-btn--primary" type="submit">{t.t('swc.inviteAccept.accept')}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
