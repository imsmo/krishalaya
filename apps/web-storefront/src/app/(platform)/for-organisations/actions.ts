'use server';
// apps/web-storefront/src/app/(platform)/for-organisations/actions.ts · PC-56 STORE-1c — the organisation-signup chain's server mutations
// (canon W307 and its 14 chain pages). Each action does ONE step and redirects to the next URL-carried state (features/signup/flow.ts):
//   startSignupAction   W307 "Create my storefront — free trial"  → ?step=code (a code sent)  | ?step=form&e=…  (W2466 / W3064)
//   resendCodeAction    "Send a new code"                           → ?step=code&sent=1           | ?step=code&err=…
//   editFormAction      "wrong number?" / "Back to edit"            → ?step=form (values kept)
//   confirmCodeAction   the code step's "Continue"                  → ?step=review (W2467 / W3065)| ?step=code&err=code_format
//   submitSignupAction  the review's Submit — and the failure's Retry (W2470–W2472 / W3068–W3070: the SAME key, an idempotent replay)
//                                                                   → ?step=done (W2468 / W3066)  | ?step=failure&err=… (W2469 / W3067)
//                                                                     | back to the field / the code it is about
//   restartSignupAction "Start again"                               → ?step=form (the cookie cleared)
// SECURITY / LAWS:
//   - NO PII IN A URL (E5): every value rides the httpOnly `kv_signup` cookie (lib/signup-flow.ts); `signupHref` refuses a phone-shaped value.
//   - The Idempotency-Key is minted AT RENDER on the review (a hidden input, survey F-14) and remembered in the cookie on submit, so the
//     failure page's Retry re-sends the SAME key: the API keys it `${key}:${phone}` (tenant-signup.controller.ts) and returns the first
//     organisation if the first attempt did land.
//   - The OTP is requested exactly as web-tenant W113 does (`auth.requestOtp`, no tenant — the code request is tenant-free) on SMS only;
//     the code is verified ONCE, by the signup call (web-tenant's rule: verifying earlier would spend the single-use code).
//   - The switch `org_self_signup` is the API's (TenantSignupService, founder D1); the page reads it only to say so BEFORE the form.
//   - The tokens a signup returns go straight into the storefront's httpOnly session cookies (lib/auth.ts setSession) — never to the browser.
//   - No money moves anywhere in this file (a trial is created with no card; the plans read is read-only).
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { publicClient } from '../../../lib/api-client';
import { setSession } from '../../../lib/auth';
import { env } from '../../../lib/env';
import { getLang } from '../../../lib/i18n';
import { readPendingSignup, writePendingSignup, clearSignupFlow } from '../../../lib/signup-flow';
import {
  checkSignupForm, classifyCodeRequestFailure, classifySignupFailure, isIdemKey, signupHref, signupLang,
  type PendingSignup, type SignupValues,
} from '../../../features/signup/flow';

const nowSec = () => Math.floor(Date.now() / 1000);

function valuesOf(fd: FormData): SignupValues {
  return {
    orgName: String(fd.get('orgName') ?? '').trim().slice(0, 200),
    orgTypeId: String(fd.get('orgTypeId') ?? '').trim().slice(0, 36),
    fullName: String(fd.get('fullName') ?? '').trim().slice(0, 200),
    typed: String(fd.get('phone') ?? '').trim().slice(0, 32),
    lang: signupLang(fd.get('lang'), getLang()),
  };
}

/** W307 "Create my storefront — free trial": every refusal at once, else a code by SMS. */
export async function startSignupAction(formData: FormData): Promise<void> {
  const v = valuesOf(formData);
  const before = readPendingSignup();
  const check = checkSignupForm(v, env.platformCountry);
  if (!check.ok) {
    writePendingSignup({ ...v });                                      // W2466: the values are preserved, nothing was saved
    redirect(signupHref('form', { fields: check.refusals, ...(check.digits ?? {}) }));
  }
  if (!check.ok) return;
  // The same number with a code still alive (the person came back from the review to fix a name): no second SMS — the cooldown would
  // refuse it anyway, and the code they already have is still good.
  if (before?.phone === check.e164 && before.sentAt && before.ttlSec && nowSec() < before.sentAt + before.ttlSec) {
    writePendingSignup({ ...before, ...v });
    redirect(signupHref(before.code ? 'review' : 'code'));
  }
  let href: string;
  try {
    const r = await publicClient().auth.requestOtp(check.e164, randomUUID());
    const at = nowSec();
    writePendingSignup({ ...v, phone: check.e164, sentAt: at, ttlSec: r.ttlSec, resendAt: at + Math.max(0, r.resendInSec) });
    href = signupHref('code');
  } catch (e) {
    writePendingSignup({ ...v });
    const f = classifyCodeRequestFailure(e);
    href = signupHref('form', { err: f.err, n: f.n, max: f.max });
  }
  redirect(href);                                                      // outside the try: redirect() throws control flow
}

/** "Send a new code" — the API's cooldown is the gate; the old code dies the moment the new one is born. */
export async function resendCodeAction(): Promise<void> {
  const p = readPendingSignup();
  if (!p?.phone) redirect(signupHref('form', { err: 'start_again' }));
  if (!p?.phone) return;
  let href: string;
  try {
    const r = await publicClient().auth.requestOtp(p.phone, randomUUID());
    const at = nowSec();
    writePendingSignup({ ...p, code: undefined, sentAt: at, ttlSec: r.ttlSec, resendAt: at + Math.max(0, r.resendInSec) });
    href = signupHref('code', { sent: true });
  } catch (e) {
    const f = classifyCodeRequestFailure(e);
    href = signupHref('code', { err: f.err === 'unavailable' ? 'unavailable' : f.err, n: f.n, max: f.max });
  }
  redirect(href);
}

/** "wrong number?" / "Back to edit" — the form again, every value as typed. */
export async function editFormAction(): Promise<void> {
  redirect(signupHref('form'));
}

/** The code step's "Continue": the code is KEPT (not verified — a single-use code is spent once, by the signup call). */
export async function confirmCodeAction(formData: FormData): Promise<void> {
  const p = readPendingSignup();
  if (!p?.phone) redirect(signupHref('form', { err: 'start_again' }));
  if (!p?.phone) return;
  const code = String(formData.get('code') ?? '').replace(/\s/g, '').slice(0, 8);
  if (!/^\d{4,8}$/.test(code)) redirect(signupHref('code', { err: 'code_format' }));
  writePendingSignup({ ...p, code });
  redirect(signupHref('review'));
}

/** W2467's Submit and W2469's Retry: create the organisation — with the key minted at render, or the remembered one on a Retry. */
export async function submitSignupAction(formData: FormData): Promise<void> {
  const p = readPendingSignup();
  if (!p?.phone || !p.code) redirect(signupHref('form', { err: 'start_again' }));
  if (!p?.phone || !p.code) return;
  const sent = String(formData.get('idem') ?? '');
  const key = isIdemKey(sent) ? sent : randomUUID();
  const withKey: PendingSignup = { ...p, idem: key };
  writePendingSignup(withKey);                                         // remembered BEFORE the call: a Retry after a dropped answer reuses it
  let href: string;
  try {
    const r = await publicClient().tenancy.signUp({
      phone: p.phone, code: p.code, fullName: p.fullName, orgName: p.orgName, orgTypeId: p.orgTypeId, lang: p.lang,
      ...(env.platformCountry ? { countryCode: env.platformCountry } : {}),
    }, key);
    setSession(r.tokens, r.tenantId);                                  // 1a's session helpers: httpOnly, never handed to the browser
    // the outcome only — the phone and the code are dropped the moment they are no longer needed
    writePendingSignup({ orgName: p.orgName, orgTypeId: p.orgTypeId, fullName: p.fullName, typed: '', lang: p.lang,
      done: { org: r.displayName || p.orgName, slug: r.slug, trialEndsOn: r.trialEndsOn, resumed: r.resumed } });
    href = signupHref('done');
  } catch (e) {
    const f = classifySignupFailure(e);
    // a refused code goes back to the code step without the code (it is dead or wrong). A name refused AFTER the code was checked
    // (taken / reserved — the API verifies the code first, and a single-use code is then spent) drops the code AND the send, so fixing the
    // name asks for a fresh code instead of walking into "expired". Every other refusal keeps everything for a Retry with the same key.
    if (f.step === 'code') writePendingSignup({ ...withKey, code: undefined });
    if (f.err === 'taken' || f.err === 'reserved') writePendingSignup({ ...withKey, code: undefined, sentAt: undefined, ttlSec: undefined, resendAt: undefined });
    href = signupHref(f.step, { err: f.err, n: f.n, left: f.left, max: f.max });
  }
  redirect(href);
}

/** "Start again" — everything typed is forgotten (the cookie cleared). */
export async function restartSignupAction(): Promise<void> {
  clearSignupFlow();
  redirect(signupHref('form'));
}
