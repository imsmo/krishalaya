// apps/web-gov/src/app/login/page.tsx · phone-OTP login (two steps via Server Actions). Step 1 requests an
// OTP (enumeration-safe by the API). Step 2 verifies → the API returns tokens → stored in httpOnly cookies (never
// exposed to JS) → redirect into the console (honouring a same-origin `next`). Errors surface as a query flag,
// never leaking whether the phone exists. All copy via i18n; no secrets in the client; noindex.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { anonClient } from '../../lib/api-client';
import { env } from '../../lib/env';
import { setSession } from '../../lib/auth';
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
    redirect(`/login?step=verify&phone=${encodeURIComponent(phone)}&next=${encodeURIComponent(next)}&error=${encodeURIComponent(msg)}`);
  }
  redirect(next);
}

export default function LoginPage({ searchParams }: { searchParams: { step?: string; phone?: string; error?: string; next?: string } }) {
  const t = getTranslator();
  const verifying = searchParams.step === 'verify';
  const next = safeNext(searchParams.next);
  return (
    <section className="kv-auth">
      <h1>{t.t('login.title')}</h1>
      {searchParams.error && <p className="kv-error" role="alert">{t.t('login.error')}</p>}
      {!verifying ? (
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
