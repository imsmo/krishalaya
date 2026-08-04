'use server';
// apps/web-partner/src/app/login/actions.ts · phone-OTP login Server Actions. Step 1 requests an OTP
// (enumeration-safe by API contract — same next step regardless). Step 2 verifies → the API returns tokens →
// stored in httpOnly cookies (never exposed to JS) → redirect into the portal. Errors surface as a query flag,
// never leaking whether the phone exists. The token's partner-scoped perms decide what the portal can see (the API
// is the authority). 'use server' files export ONLY async functions.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { anonClient } from '../../lib/api-client';
import { setSession } from '../../lib/partner-auth';
import { SdkError } from '@krishalaya/sdk-js';

const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

export async function requestOtpAction(formData: FormData): Promise<void> {
  const phone = str(formData, 'phone');
  try { await anonClient().auth.requestOtp(phone, randomUUID()); } catch { /* enumeration-safe: same next step regardless */ }
  redirect(`/login?step=verify&phone=${enc(phone)}`);
}

export async function verifyOtpAction(formData: FormData): Promise<void> {
  const phone = str(formData, 'phone');
  const code = str(formData, 'code');
  try {
    const t = await anonClient().auth.verifyOtp(phone, code, randomUUID());
    setSession(t.accessToken, t.refreshToken, t.expiresInSec);
  } catch (e) {
    const msg = e instanceof SdkError ? e.code : 'LOGIN_FAILED';
    redirect(`/login?step=verify&phone=${enc(phone)}&error=${enc(msg)}`);
  }
  redirect('/dashboard');
}
