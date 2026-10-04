// apps/web-tenant/src/app/login/page.tsx · phone-OTP login (two steps via Server Actions). Step 1 requests an
// OTP (enumeration-safe by the API). Step 2 verifies → the API returns tokens → stored in httpOnly cookies (never
// exposed to JS) → redirect into the console (honouring a same-origin `next`). Errors surface as a query flag,
// never leaking whether the phone exists. All copy via i18n; no secrets in the client; noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { anonClient } from '../../lib/api-client';
import { env } from '../../lib/env';
import { setSession } from '../../lib/auth';
import { cookies } from 'next/headers';
import { swcCodeKey } from '../../features/swc/console';

// PC-56 TENANT-SW-c · B3 — a person with confirmed 2FA gets TWO_FACTOR_PENDING from the OTP step; the pending session's challenge lives in
// an httpOnly cookie for its 5 minutes (never in a URL), and the second step answers with a TOTP or one recovery code.
const TFA_COOKIE = 'kvt_2fa';
const TFA_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/login', maxAge: 300 };
import { safeNext } from '../../features/nav/safe-next';
import { getTranslator } from '../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('login.title'), robots: { index: false, follow: false } };
}

async function requestOtp(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const next = safeNext(String(formData.get('next') ?? '/dashboard'));
  try { await anonClient().auth.requestOtp(phone, randomUUID()); } catch { /* enumeration-safe */ }
  redirect(`/login?step=verify&phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}`);
}
async function verifyOtp(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const next = safeNext(String(formData.get('next') ?? '/dashboard'));
  try {
    const tk = await anonClient().auth.verifyOtp(phone, code, randomUUID(), env.tenantId);
    setSession(tk.accessToken, tk.refreshToken, tk.expiresInSec);
  } catch (e) {
    const msg = e instanceof SdkError ? e.code : 'LOGIN_FAILED';
    const challenge = e instanceof SdkError && e.code === 'TWO_FACTOR_PENDING' ? (e.details as { challengeToken?: unknown } | undefined)?.challengeToken : null;
    if (typeof challenge === 'string' && challenge.length >= 20) {
      cookies().set(TFA_COOKIE, challenge, TFA_OPTS);
      redirect(`/login?step=2fa&next=${encodeURIComponent(next)}`);
    }
    redirect(`/login?step=verify&phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}&error=${encodeURIComponent(msg)}`);
  }
  redirect(next);
}
async function verifySecondFactor(formData: FormData) {
  'use server';
  const next = safeNext(String(formData.get('next') ?? '/dashboard'));
  const code = String(formData.get('code') ?? '').trim(); const recoveryCode = String(formData.get('recoveryCode') ?? '').trim();
  const challenge = cookies().get(TFA_COOKIE)?.value ?? '';
  let msg: string | null = null;
  try {
    const tk = await anonClient().auth.verifyTwoFactor({ tenantId: env.tenantId ?? '', challengeToken: challenge, ...(/^\d{6}$/.test(code) ? { code } : { recoveryCode }) });
    setSession(tk.accessToken, tk.refreshToken, tk.expiresInSec);
    cookies().delete(TFA_COOKIE);
  } catch (e) { msg = e instanceof SdkError ? e.code : 'LOGIN_FAILED'; }
  if (msg) redirect(`/login?step=2fa&next=${encodeURIComponent(next)}&error=${encodeURIComponent(msg)}`);
  redirect(next);
}

export default function LoginPage({ searchParams }: { searchParams: { step?: string; phone?: string; error?: string; next?: string } }) {
  const t = getTranslator();
  const verifying = searchParams.step === 'verify';
  const secondFactor = searchParams.step === '2fa';
  const next = safeNext(searchParams.next);
  return (
    <section className="kv-auth">
      <h1>{t.t('login.title')}</h1>
      {searchParams.error && <p className="kv-error" role="alert">{t.t(secondFactor ? swcCodeKey(searchParams.error) : 'login.error')}</p>}
      {secondFactor ? (
        <form action={verifySecondFactor} className="kv-form">
          <input type="hidden" name="next" value={next} />
          <p>{t.t('swc.login.tfaLede')}</p>
          <label htmlFor="tfa" className="kv-field__label">{t.t('swc.tfa.panel.code')}</label>
          <input id="tfa" className="kv-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus />
          <label htmlFor="rec" className="kv-field__label">{t.t('swc.login.recovery')}</label>
          <input id="rec" className="kv-input" name="recoveryCode" type="text" autoComplete="off" maxLength={20} />
          <button className="kv-btn" type="submit">{t.t('login.verify')}</button>
          <a href={`/login?next=${encodeURIComponent(next)}`} className="kv-btn--link">{t.t('swc.login.startOver')}</a>
        </form>
      ) : !verifying ? (
        <form action={requestOtp} className="kv-form">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="phone" className="kv-field__label">{t.t('login.phoneLabel')}</label>
          <input id="phone" className="kv-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t.t('login.phonePlaceholder')} required />
          <p className="kv-field__hint">{t.t('login.phoneHint')}</p>
          <button className="kv-btn" type="submit">{t.t('login.sendOtp')}</button>
        </form>
      ) : (
        <form action={verifyOtp} className="kv-form">
          <input type="hidden" name="phone" value={searchParams.phone ?? ''} />
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code" className="kv-field__label">{t.t('login.otpLabel', { phone: searchParams.phone ?? '' })}</label>
          <input id="code" className="kv-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" required autoFocus />
          <button className="kv-btn" type="submit">{t.t('login.verify')}</button>
          <a href={`/login?next=${encodeURIComponent(next)}`} className="kv-btn--link">{t.t('login.changeNumber')}</a>
        </form>
      )}
    </section>
  );
}
