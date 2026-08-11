// apps/web-tenant/src/app/signup/page.tsx · W113 "Bring your organisation online" (PC-56 TENANT-1d-3b).
//
// **THE FIRST PUBLIC PAGE IN THIS CONSOLE.** Every other route calls `requireSession`; this one must not, because W113 is
// for somebody who has no organisation and therefore no session — and until TENANT-1d-3a there was no door for them at all
// (`VerifyOtpSchema` requires a tenant id, so they could not even authenticate).
//
// Server component, four steps driven by the URL: a farmer whose signal drops comes back to the step they were on rather
// than to the beginning, and the step cannot be skipped past its prerequisite (`resolveStep`).
//
// **THE DEPLOYMENT CAVEAT, STATED RATHER THAN HIDDEN**: this console resolves its tenant from the host or
// `NEXT_PUBLIC_TENANT_ID`, so a signup served from one tenant's origin issues a session for the NEW tenant (the token
// carries its id) while the surrounding deployment's own `tenantId` is something else. That works for the API, and it is
// still the wrong shape long-term: signup belongs on a shared origin that redirects into the new organisation's own console.
// Named as TENANT-1d-3-Q5 rather than papered over.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { anonClient } from '../../lib/api-client';
import { setSession } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import {
  AFTER_SIGNUP_PATH, TOTAL_STEPS, buildSignup, looksLikePhone, maskForDisplay, resolveStep, stepNumber,
} from '../../features/signup/steps';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  // noindex like every console page: this is a product surface, and the marketing site owns discovery.
  return { title: getTranslator().t('signup.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['phone', 'code', 'name', 'org', 'orgType', 'otp', 'taken', 'plan', 'generic', 'unavailable']);

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE ACTIONS                                                                                                       */
/* ---------------------------------------------------------------------------------------------------------------- */

async function sendOtp(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const lang = String(formData.get('lang') ?? 'hi');
  if (!looksLikePhone(phone)) redirect(`/signup?step=you&error=phone&fullName=${encodeURIComponent(fullName)}`);
  // Enumeration-safe, exactly as the login page is: the same response whether or not this number is known. A signup form
  // that answered differently for a registered number would be a free directory of every organisation on the platform.
  try { await anonClient().auth.requestOtp(phone, randomUUID()); } catch { /* deliberately silent */ }
  redirect(`/signup?step=verify&phone=${encodeURIComponent(phone)}&fullName=${encodeURIComponent(fullName)}&lang=${encodeURIComponent(lang)}`);
}

async function toOrgStep(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const lang = String(formData.get('lang') ?? 'hi');
  const q = new URLSearchParams({ step: 'org', phone, code, fullName, lang });
  // **THE CODE IS NOT VERIFIED HERE, AND THAT IS DELIBERATE.** An OTP is single-use: checking it now would consume it, and
  // the real submit two steps later would then fail with "invalid code" on a code the farmer entered correctly. It travels
  // to the one call that uses it.
  redirect(`/signup?${q.toString()}`);
}

async function createOrg(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const lang = String(formData.get('lang') ?? 'hi');
  const orgName = String(formData.get('orgName') ?? '').trim();
  const orgTypeId = String(formData.get('orgTypeId') ?? '').trim();

  const keep = new URLSearchParams({ step: 'org', phone, code, fullName, lang, orgName });
  const built = buildSignup({ phone, code, fullName, orgName, orgTypeId, lang });
  if (!built.ok) redirect(`/signup?${keep.toString()}&error=${built.error}`);

  let outcome: { resumed: boolean; displayName: string; trialEndsOn: string | null } | null = null;
  try {
    const res = await anonClient().tenancy.signUp(built.value, randomUUID());
    // The tokens are set as httpOnly cookies here and never handed to the browser's JS, the same way login does it.
    setSession(res.tokens.accessToken, res.tokens.refreshToken, res.tokens.expiresInSec);
    outcome = { resumed: res.resumed, displayName: res.displayName, trialEndsOn: res.trialEndsOn };
  } catch (e) {
    const code2 = e instanceof SdkError ? (e.code ?? '') : '';
    const status = e instanceof SdkError ? e.status : 0;
    const key = code2 === 'AUTH_INVALID_OTP' || status === 401 ? 'otp'
      : code2 === 'SIGNUP_SLUG_UNAVAILABLE' ? 'taken'
      : code2 === 'SIGNUP_TRIAL_PLAN_UNAVAILABLE' || code2 === 'SIGNUP_ROLE_MISSING' ? 'plan'
      : status === 503 ? 'unavailable'
      : status === 400 || status === 422 ? 'org'
      : 'generic';
    // **THE FORM COMES BACK FILLED IN.** A co-operative secretary who mistyped one digit must not retype their
    // organisation's name — and W113's own form-error state says "values you entered are preserved, nothing was saved".
    redirect(`/signup?${keep.toString()}&error=${key}`);
  }

  const q = new URLSearchParams({ step: 'done', org: outcome.displayName, resumed: outcome.resumed ? '1' : '0' });
  if (outcome.trialEndsOn) q.set('trial', outcome.trialEndsOn);
  redirect(`/signup?${q.toString()}`);
}

/* ---------------------------------------------------------------------------------------------------------------- */

export default async function SignupPage({ searchParams }: {
  searchParams: { step?: string; phone?: string; code?: string; fullName?: string; lang?: string; orgName?: string; error?: string; org?: string; resumed?: string; trial?: string };
}) {
  const t = getTranslator();
  const lang = getLang();
  const step = resolveStep(searchParams);
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const phone = (searchParams.phone ?? '').trim();
  const code = (searchParams.code ?? '').trim();
  const fullName = (searchParams.fullName ?? '').trim();
  const chosenLang = ['en', 'hi', 'gu'].includes(searchParams.lang ?? '') ? String(searchParams.lang) : lang;

  // W113: "Types come from the platform registry — more are added without app updates." A public lookup read, and it
  // degrades on its own: a signup must not die because a reference list is briefly unreachable.
  let orgTypes: Array<{ id: string; label: string }> = [];
  let typesFailed = false;
  if (step === 'org') {
    try {
      const values = await anonClient().lookups.values('tenant_type');
      // `name` is LOCALE-RESOLVED by the API, so a Gujarati console shows Gujarati type names with no mapping here.
      orgTypes = values.map((v) => ({ id: String(v.id), label: String(v.name || v.code) }));
    } catch { typesFailed = true; }
  }

  return (
    <main className="kv-auth">
      <h1>{t.t('signup.title')}</h1>
      <p className="kv-field__hint">{t.t('signup.subtitle')}</p>
      <p className="kv-detail__muted">{t.t('signup.step', { n: stepNumber(step), of: TOTAL_STEPS })}</p>

      {errKey && <p className="kv-error" role="alert">{t.t(`signup.error.${errKey}`)}</p>}

      {step === 'you' && (
        <form action={sendOtp} className="kv-form kv-form__card">
          <label htmlFor="su-name" className="kv-form__label">{t.t('signup.yourName')}</label>
          <input id="su-name" name="fullName" className="kv-field__input" defaultValue={fullName} minLength={2} maxLength={200} required />

          <label htmlFor="su-phone" className="kv-form__label">{t.t('signup.mobile')}</label>
          <input id="su-phone" name="phone" type="tel" inputMode="tel" className="kv-field__input" defaultValue={phone} required />
          <p className="kv-detail__muted">{t.t('signup.mobileHint')}</p>

          <label htmlFor="su-lang" className="kv-form__label">{t.t('signup.language')}</label>
          <select id="su-lang" name="lang" className="kv-field__input" defaultValue={chosenLang}>
            <option value="en">English</option>
            <option value="hi">हिन्दी</option>
            <option value="gu">ગુજરાતી</option>
          </select>

          <button type="submit" className="kv-btn">{t.t('signup.sendOtp')}</button>
          <p className="kv-detail__muted">{t.t('signup.terms')}</p>
          <p className="kv-detail__muted">{t.t('signup.haveAccount')} <a href="/login">{t.t('signup.signIn')}</a></p>
        </form>
      )}

      {step === 'verify' && (
        <>
          <form action={toOrgStep} className="kv-form kv-form__card">
            <p>{t.t('signup.sentTo', { phone: maskForDisplay(phone) })}</p>
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="fullName" value={fullName} />
            <input type="hidden" name="lang" value={chosenLang} />
            <label htmlFor="su-code" className="kv-form__label">{t.t('signup.enterCode')}</label>
            <input id="su-code" name="code" inputMode="numeric" autoComplete="one-time-code" className="kv-field__input"
                   pattern="\d{4,8}" required />
            <button type="submit" className="kv-btn">{t.t('signup.continue')}</button>
          </form>
          {/* Resend is its own form, so it cannot be confused with submitting the code. W113's automatic voice fallback is
              NOT claimed: no voice provider is configured anywhere in this platform (TENANT-1d-3-Q4). */}
          <form action={sendOtp} className="kv-inline-form">
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="fullName" value={fullName} />
            <input type="hidden" name="lang" value={chosenLang} />
            <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('signup.resend')}</button>
          </form>
          <p className="kv-detail__muted">{t.t('signup.smsDelayed')}</p>
        </>
      )}

      {step === 'org' && (
        <form action={createOrg} className="kv-form kv-form__card">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="fullName" value={fullName} />
          <input type="hidden" name="lang" value={chosenLang} />

          <label htmlFor="su-org" className="kv-form__label">{t.t('signup.orgName')}</label>
          {/* No pattern attribute: the canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની". */}
          <input id="su-org" name="orgName" className="kv-field__input" defaultValue={searchParams.orgName ?? ''}
                 minLength={3} maxLength={200} required />

          <label htmlFor="su-type" className="kv-form__label">{t.t('signup.orgType')}</label>
          {typesFailed || orgTypes.length === 0 ? (
            <>
              {/* **NO HARD-CODED LIST AS A FALLBACK.** Typing the seven types into this file would be the "data, not code"
                  rule broken on the very screen whose copy promises the opposite, and a stale list here would offer a type
                  the API refuses. The step says so and offers a retry instead. */}
              <p className="kv-error" role="alert">{t.t('signup.typesUnavailable')}</p>
              <a href={`/signup?step=org&phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}&fullName=${encodeURIComponent(fullName)}&lang=${chosenLang}`}
                 className="kv-btn kv-btn--muted kv-btn--sm">{t.t('signup.retry')}</a>
            </>
          ) : (
            <select id="su-type" name="orgTypeId" className="kv-field__input" required defaultValue="">
              <option value="" disabled>{t.t('signup.chooseType')}</option>
              {orgTypes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <p className="kv-detail__muted">{t.t('signup.typesFromRegistry')}</p>

          {orgTypes.length > 0 && <button type="submit" className="kv-btn">{t.t('signup.create')}</button>}
          <p className="kv-detail__muted">{t.t('signup.trialNote')}</p>
        </form>
      )}

      {step === 'done' && (
        <div className="kv-card">
          {searchParams.resumed === '1' ? (
            <>
              {/* **A RESUME IS NOT A SUCCESS.** W113: "This mobile runs Junagadh Kisan Producer Co. — sign in instead."
                  Saying "your organisation is ready" would send somebody looking for an FPO they never created. */}
              <strong>{t.t('signup.outcome.resumed', { org: searchParams.org ?? '' })}</strong>
              <p className="kv-detail__muted">{t.t('signup.resumedNote')}</p>
            </>
          ) : (
            <>
              <strong>{t.t('signup.outcome.created', { org: searchParams.org ?? '' })}</strong>
              {searchParams.trial
                ? <p className="kv-detail__muted">{t.t('signup.trialUntil', { d: searchParams.trial })}</p>
                : null}
              <p className="kv-detail__muted">{t.t('signup.nextSteps')}</p>
            </>
          )}
          <a href={AFTER_SIGNUP_PATH} className="kv-btn">{t.t('signup.openConsole')}</a>
        </div>
      )}

      {/* The proof panel W113 carries down the right-hand side. Kept as words, with no invented counts: "2,847
          organisations" is a number this page cannot verify, and a signup screen inventing social proof is the one place a
          platform asking for trust should not. */}
      <aside className="kv-note">
        <p>{t.t('signup.proof.languages')}</p>
        <p>{t.t('signup.proof.oneplace')}</p>
        <p>{t.t('signup.proof.dataOwnership')}</p>
      </aside>

      {/* No variables: this sentence is prose about how the form behaves. The repo's own i18n-parity suite caught the
          first version passing `{total}` and `{steps}` that no catalogue used — a caller and a string disagreeing about an
          interpolation is exactly the drift that guard exists for, and it found it before a reviewer did. */}
      <p className="kv-field__hint kv-note">{t.t('signup.footerNote')}</p>
    </main>
  );
}
