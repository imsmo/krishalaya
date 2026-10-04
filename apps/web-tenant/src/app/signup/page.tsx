// apps/web-tenant/src/app/signup/page.tsx · W113 "Bring your organisation online" (PC-56 TENANT-1d-3b) + W114 "Onboarding: Organisation
// Profile" as SIGNUP STEP 2 OF THE ORGANISATION (PC-56 TENANT-SW-d, founder decision: profile = signup step with save-and-exit).
//
// **THE FIRST PUBLIC PAGE IN THIS CONSOLE.** Every other route calls `requireSession`; this one must not, because W113 is
// for somebody who has no organisation and therefore no session — and until TENANT-1d-3a there was no door for them at all
// (`VerifyOtpSchema` requires a tenant id, so they could not even authenticate).
//
// Server component, four steps driven by the URL: you → verify → ORGANISATION PROFILE → done. A farmer whose signal drops comes
// back to the step they were on rather than to the beginning, and the step cannot be skipped past its prerequisite (`resolveStep`).
//
// THE PROFILE STEP (W114) has two phases and one chain:
//   • before the organisation exists (a verified phone pair in the URL): name, type, home district, registration and tax numbers.
//     Its first submit CREATES the organisation (the same signup call as before — the OTP is spent once, here) and SAVES THE TYPED
//     VALUES AS A SERVER DRAFT, so nothing typed is lost whatever happens next;
//   • after (the session that creation — or a resume by OTP — opened): the same form, filled from the owner's draft;
//   • the chain W2693 (review: every field that will be saved, the GSTIN state advisory as a gentle confirm, a reason when a recorded
//     identifier is replaced) → W2694 (done: the REAL list of fields saved — the canon's "sharing" list was empty, F-22) / W2695
//     (failed: nothing changed; retry back to the review; "Back to the screen" is the PROFILE — the canon pointed at disputes, F-22).
//   • "Save & exit (resume later by OTP)" keeps a SERVER draft (30 days, owner-only). W114's "entries are kept in this browser and
//     retry automatically" is REFUSED BY NAME: nothing is stored in a browser — the failure screen says "saved on the server up to
//     step N".
//
// **THE DEPLOYMENT CAVEAT, STATED RATHER THAN HIDDEN**: this console resolves its tenant from the host or
// `NEXT_PUBLIC_TENANT_ID`, so a signup served from one tenant's origin issues a session for the NEW tenant (the token
// carries its id) while the surrounding deployment's own `tenantId` is something else. The profile step therefore talks to the API
// with the NEW session's token and no tenant header. Signup belongs on a shared origin (TENANT-1d-3-Q5).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { createClient, SdkError } from '@krishalaya/sdk-js';
import type { KrishalayaClient, OnboardingState, ProfileStepPreview } from '@krishalaya/sdk-js';
import { anonClient } from '../../lib/api-client';
import { setSession, getAccessToken, hasSessionCookie } from '../../lib/auth';
import { env } from '../../lib/env';
import { getTranslator, getLang } from '../../lib/i18n';
import {
  AFTER_SIGNUP_PATH, TOTAL_STEPS, buildSignup, looksLikePhone, maskForDisplay, resolveStep, stepNumber,
} from '../../features/signup/steps';
import {
  PROFILE_BACK_HREF, PROFILE_FIELDS, advisoryLine, draftPayload, isIdemKey, prefill, profileFieldKey, profileValuesFrom, savedFieldKeys, swdCodeKey,
} from '../../features/swd/console';
import { codesFrom, parseCodes } from '../../features/swc/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  // noindex like every console page: this is a product surface, and the marketing site owns discovery.
  return { title: getTranslator().t('signup.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['phone', 'code', 'name', 'org', 'orgType', 'otp', 'taken', 'plan', 'generic', 'unavailable']);
const STAGES = ['form', 'confirm', 'failure'] as const;

/** The NEW organisation's session — its token, no tenant header (the token carries the tenant; see the deployment caveat). */
function sessionClient(token?: string): KrishalayaClient {
  const tok = token ?? getAccessToken();
  return createClient({ baseUrl: env.serverApiUrl, getToken: () => tok, userAgent: 'kv-web-tenant', timeoutMs: 8000 });
}
const codesOf = (e: unknown) => { const err = e instanceof SdkError ? e : null; return codesFrom(err?.code, err?.status, err?.details); };
const profileHref = (stage: (typeof STAGES)[number], extra: Record<string, string> = {}) =>
  `/signup?${new URLSearchParams({ step: 'profile', stage, ...extra }).toString()}`;

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
  const q = new URLSearchParams({ step: 'profile', phone, code, fullName, lang });
  // **THE CODE IS NOT VERIFIED HERE, AND THAT IS DELIBERATE.** An OTP is single-use: checking it now would consume it, and
  // the real submit on the profile step would then fail with "invalid code" on a code the farmer entered correctly. It travels
  // to the one call that uses it.
  redirect(`/signup?${q.toString()}`);
}

/** The profile step's FIRST submit: create the organisation (the OTP is spent here, once), then keep everything typed as a server draft. */
async function createOrg(formData: FormData) {
  'use server';
  const phone = String(formData.get('phone') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const lang = String(formData.get('lang') ?? 'hi');
  const orgName = String(formData.get('orgName') ?? '').trim();
  const orgTypeId = String(formData.get('orgTypeId') ?? '').trim();
  const intent = String(formData.get('intent') ?? 'review') === 'save' ? 'save' : 'review';
  const values = profileValuesFrom((k) => (k === 'legalName' ? orgName : String(formData.get(k) ?? '')));

  const keep = new URLSearchParams({ step: 'profile', phone, code, fullName, lang, orgName, displayName: values.displayName ?? '', regionId: values.regionId ?? '',
    cinOrRegNo: values.cinOrRegNo ?? '', pan: values.pan ?? '', gstin: values.gstin ?? '', fssaiLicense: values.fssaiLicense ?? '' });
  const built = buildSignup({ phone, code, fullName, orgName, orgTypeId, lang });
  if (!built.ok) redirect(`/signup?${keep.toString()}&error=${built.error}`);

  let res: Awaited<ReturnType<KrishalayaClient['tenancy']['signUp']>> | null = null;
  try {
    res = await anonClient().tenancy.signUp(built.value, randomUUID());
    // The tokens are set as httpOnly cookies here and never handed to the browser's JS, the same way login does it.
    setSession(res.tokens.accessToken, res.tokens.refreshToken, res.tokens.expiresInSec);
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
  const r = res!;
  // A RESUME is not a creation: the phone already runs an organisation. If its profile step is still open, land on it with the
  // owner's saved draft (W114 "Resuming your setup"); what was just typed is NOT written over it.
  if (r.resumed) {
    if (r.onboardingStep === 'profile') redirect(profileHref('form', { resumed: '1' }));
    redirect(`/signup?${new URLSearchParams({ step: 'done', org: r.displayName, resumed: '1' }).toString()}`);
  }
  try { await sessionClient(r.tokens.accessToken).orgOnboarding.saveDraft(draftPayload(values)); } catch { /* the organisation exists; the step reopens below */ }
  if (intent === 'save') redirect(`/signup?step=saved&n=3&org=${encodeURIComponent(r.displayName)}`);
  redirect(profileHref('confirm', { created: '1', ...(r.trialEndsOn ? { trial: r.trialEndsOn } : {}) }));
}

/** The profile step in the organisation's session: Save & exit (a server draft), or review (draft, then W2693). */
async function profileDraft(formData: FormData) {
  'use server';
  const intent = String(formData.get('intent') ?? 'review') === 'save' ? 'save' : 'review';
  const values = profileValuesFrom((k) => String(formData.get(k) ?? ''));
  try { await sessionClient().orgOnboarding.saveDraft(draftPayload(values)); }
  catch (e) { redirect(profileHref('failure', { error: codesOf(e).join(','), n: '2' })); }
  if (intent === 'save') redirect('/signup?step=saved&n=3');
  redirect(profileHref('confirm'));
}

/** W2693 → W2694 / W2695: complete the step. An unconfirmed GSTIN-state advisory comes back to the review with nothing written. */
async function profileConfirm(formData: FormData) {
  'use server';
  const values = profileValuesFrom((k) => String(formData.get(k) ?? ''));
  const reason = String(formData.get('reason') ?? '').trim().slice(0, 280);
  const confirmGstState = String(formData.get('confirmGstState') ?? '') === '1';
  const k = String(formData.get('idempotencyKey') ?? '');
  let out: Awaited<ReturnType<KrishalayaClient['orgOnboarding']['save']>> | null = null;
  try {
    out = await sessionClient().orgOnboarding.save({ ...values, ...(reason ? { reason } : {}), ...(confirmGstState ? { confirmGstState: true } : {}) }, isIdemKey(k) ? k : randomUUID());
  } catch (e) { redirect(profileHref('failure', { error: codesOf(e).join(','), n: '3' })); }
  if (out!.status === 'needs_confirm') redirect(profileHref('confirm', { advisory: '1' }));
  const saved = out!.status === 'saved' ? out!.fields : [];
  redirect(`/signup?${new URLSearchParams({ step: 'done', profile: '1', fields: saved.join(',') }).toString()}`);
}

/* ---------------------------------------------------------------------------------------------------------------- */

type Search = { step?: string; stage?: string; phone?: string; code?: string; fullName?: string; lang?: string; orgName?: string; error?: string; org?: string;
  resumed?: string; trial?: string; created?: string; advisory?: string; fields?: string; profile?: string; n?: string } & Record<string, string | undefined>;

export default async function SignupPage({ searchParams }: { searchParams: Search }) {
  const t = getTranslator();
  const lang = getLang();
  const session = hasSessionCookie() && !(searchParams.phone && searchParams.code);
  const saved = searchParams.step === 'saved';
  const step = saved ? 'done' : resolveStep(searchParams, session);
  const stage = (STAGES as readonly string[]).includes(searchParams.stage ?? '') ? (searchParams.stage as (typeof STAGES)[number]) : 'form';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  const phone = (searchParams.phone ?? '').trim();
  const code = (searchParams.code ?? '').trim();
  const fullName = (searchParams.fullName ?? '').trim();
  const chosenLang = ['en', 'hi', 'gu'].includes(searchParams.lang ?? '') ? String(searchParams.lang) : lang;

  // W113: "Types come from the platform registry — more are added without app updates." A public lookup read, and it
  // degrades on its own: a signup must not die because a reference list is briefly unreachable.
  let orgTypes: Array<{ id: string; label: string }> = [];
  let typesFailed = false;
  let districts: Array<{ id: string; label: string; state: string }> = [];
  if (step === 'profile' && !session) {
    try {
      const values = await anonClient().lookups.values('tenant_type');
      // `name` is LOCALE-RESOLVED by the API, so a Gujarati console shows Gujarati type names with no mapping here.
      orgTypes = values.map((v) => ({ id: String(v.id), label: String(v.name || v.code) }));
    } catch { typesFailed = true; }
    // W114 "Home district *": the platform's district registry (states → districts), read publicly; a failure leaves the choice empty
    // and the review step names the missing district rather than guessing one.
    try {
      const states = await anonClient().lookups.regions();
      for (const s of states.slice(0, 40)) {
        const ds = await anonClient().lookups.regions({ parentId: String(s.id) }).catch(() => []);
        for (const d of ds) districts.push({ id: String(d.id), label: String(d.name), state: String(s.name) });
      }
    } catch { districts = []; }
  }

  // the organisation's own session: the step's state (the owner's draft, districts, the brand lock) and — on the review — the preview
  let state: OnboardingState | null = null; let preview: ProfileStepPreview | null = null; let stateFailed: string[] | null = null;
  if (step === 'profile' && session) {
    try { state = await sessionClient().orgOnboarding.state(); } catch (e) { stateFailed = codesOf(e); }
    if (state && stage === 'confirm') {
      const v = prefill(state.current as Record<string, string | null>, state.draft?.payload ?? null);
      try { preview = await sessionClient().orgOnboarding.preview(v); } catch (e) { stateFailed = codesOf(e); }
    }
  }
  const values = state ? prefill(state.current as Record<string, string | null>, state.draft?.payload ?? null) : null;
  const advisory = advisoryLine(preview?.advisory);
  const anonValues = (k: string) => (k === 'legalName' ? searchParams.orgName : searchParams[k]) ?? '';

  const fieldInputs = (get: (k: string) => string, lockedName: boolean) => (
    <>
      <label htmlFor="su-org" className="kv-form__label">{t.t('swd.profile.field.legalName')} *</label>
      {/* No pattern attribute: the canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની". */}
      <input id="su-org" name={session ? 'legalName' : 'orgName'} className="kv-field__input" defaultValue={get('legalName')} minLength={3} maxLength={200} required />
      <label htmlFor="su-dn" className="kv-form__label">{t.t('swd.profile.field.displayName')} *</label>
      {lockedName
        ? <><input id="su-dn" className="kv-field__input" value={get('displayName')} readOnly aria-readonly="true" /><p className="kv-detail__muted">{t.t('swd.profile.displayNameLocked')}</p></>
        : <input id="su-dn" name="displayName" className="kv-field__input" defaultValue={get('displayName')} maxLength={150} required />}
      <label htmlFor="su-region" className="kv-form__label">{t.t('swd.profile.field.regionId')} *</label>
      <select id="su-region" name="regionId" className="kv-field__input" defaultValue={get('regionId')}>
        <option value="">{t.t('swd.profile.chooseDistrict')}</option>
        {(session ? (state?.districts ?? []).map((d) => ({ id: d.id, label: d.name, state: d.stateName })) : districts)
          .map((d) => <option key={d.id} value={d.id}>{d.label}, {d.state}</option>)}
      </select>
      <p className="kv-detail__muted">{t.t('swd.profile.districtHint')}</p>
      <fieldset className="kv-field">
        <legend>{t.t('swd.profile.taxLegend')}</legend>
        {(['cinOrRegNo', 'pan', 'gstin', 'fssaiLicense'] as const).map((f) => (
          <label key={f} className="kv-field" htmlFor={`su-${f}`}><span>{t.t(profileFieldKey(f))}</span>
            <input id={`su-${f}`} name={f} className="kv-field__input" defaultValue={get(f)} maxLength={40} /></label>
        ))}
        <p className="kv-detail__muted">{t.t('swd.profile.taxHint')}</p>
      </fieldset>
    </>
  );

  return (
    <main className="kv-auth">
      <h1>{step === 'profile' ? t.t('swd.profile.title') : t.t('signup.title')}</h1>
      <p className="kv-field__hint">{step === 'profile' ? t.t('swd.profile.subtitle') : t.t('signup.subtitle')}</p>
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

      {/* ── W114 · the organisation profile, BEFORE the organisation exists (a verified phone pair) ── */}
      {step === 'profile' && !session && (
        <form action={createOrg} className="kv-form kv-form__card">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="fullName" value={fullName} />
          <input type="hidden" name="lang" value={chosenLang} />
          <p className="kv-field__hint">{t.t('swd.profile.requiredToday')}</p>
          {fieldInputs(anonValues, false)}

          <label htmlFor="su-type" className="kv-form__label">{t.t('signup.orgType')}</label>
          {typesFailed || orgTypes.length === 0 ? (
            <>
              {/* **NO HARD-CODED LIST AS A FALLBACK.** Typing the seven types into this file would be the "data, not code"
                  rule broken on the very screen whose copy promises the opposite, and a stale list here would offer a type
                  the API refuses. The step says so and offers a retry instead. */}
              <p className="kv-error" role="alert">{t.t('signup.typesUnavailable')}</p>
              <a href={`/signup?step=profile&phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}&fullName=${encodeURIComponent(fullName)}&lang=${chosenLang}`}
                 className="kv-btn kv-btn--muted kv-btn--sm">{t.t('signup.retry')}</a>
            </>
          ) : (
            <select id="su-type" name="orgTypeId" className="kv-field__input" required defaultValue="">
              <option value="" disabled>{t.t('signup.chooseType')}</option>
              {orgTypes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          <p className="kv-detail__muted">{t.t('signup.typesFromRegistry')}</p>

          {orgTypes.length > 0 && (
            <p>
              <button type="submit" name="intent" value="review" className="kv-btn">{t.t('swd.profile.createReview')}</button>{' '}
              <button type="submit" name="intent" value="save" className="kv-btn kv-btn--muted">{t.t('swd.profile.saveExit')}</button>
            </p>
          )}
          <p className="kv-detail__muted">{t.t('signup.trialNote')}</p>
          <p className="kv-detail__muted">{t.t('swd.profile.serverOnly')}</p>
        </form>
      )}

      {/* ── W114 · the organisation profile in the organisation's own session ── */}
      {step === 'profile' && session && (
        <>
          {stateFailed && stage !== 'failure' && (
            <div className="kv-error" role="alert"><ul className="kv-list">{stateFailed.map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
              <p>{t.t('swd.profile.savedUpTo', { n: 2 })}</p><a href={profileHref('form')} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('signup.retry')}</a></div>
          )}
          {state && state.step === 'done' && (
            <div className="kv-card"><strong>{t.t('swd.profile.alreadyDone')}</strong>
              <p><a href="/settings/gst" className="kv-btn--link">{t.t('swd.profile.editLater')}</a> · <a href={AFTER_SIGNUP_PATH} className="kv-btn--link">{t.t('signup.openConsole')}</a></p></div>
          )}
          {state && state.step === null && (
            <div className="kv-card kv-card--notice"><p>{t.t('swd.code.ONBOARDING_NOT_TRACKED')}</p><a href="/settings/gst" className="kv-btn--link">{t.t('swd.profile.editLater')}</a></div>
          )}
          {state && state.step === 'profile' && values && (
            <>
              {searchParams.resumed === '1' && <p className="kv-card kv-card--notice" role="status">{state.draft ? t.t('swd.profile.resumed', { at: state.draft.savedAt.slice(0, 10) }) : t.t('swd.profile.resumedNoDraft')}</p>}
              {state.draftOwnedByOther && <p className="kv-card kv-card--notice">{t.t('swd.profile.ownerOnly')}</p>}
              {searchParams.created === '1' && <p className="kv-card kv-success" role="status">{t.t('swd.profile.created')}{searchParams.trial ? ` ${t.t('signup.trialUntil', { d: searchParams.trial })}` : ''}</p>}

              {stage === 'form' && (
                <form action={profileDraft} className="kv-form kv-form__card">
                  <p className="kv-field__hint">{t.t('swd.profile.requiredToday')}</p>
                  {fieldInputs((k) => (values as Record<string, string>)[k] ?? '', state.displayNameLocked)}
                  {state.displayNameLocked && <input type="hidden" name="displayName" value={values.displayName} />}
                  <p>
                    <button type="submit" name="intent" value="review" className="kv-btn">{t.t('swd.profile.review')}</button>{' '}
                    <button type="submit" name="intent" value="save" className="kv-btn kv-btn--muted">{t.t('swd.profile.saveExit')}</button>
                  </p>
                  <p className="kv-detail__muted">{t.t('swd.profile.serverOnly')}</p>
                </form>
              )}

              {/* W2693 · the confirm step: what will be saved, the advisory as a CONFIRM, a reason when a recorded identifier is replaced */}
              {stage === 'confirm' && preview && (
                <form action={profileConfirm} className="kv-form kv-form__card">
                  <h2>{t.t('swd.profile.confirmTitle')}</h2>
                  <p className="kv-field__hint">{t.t('mutate.step.confirm')} · {t.t('swd.profile.confirmLede')}</p>
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  {PROFILE_FIELDS.map((f) => <input key={f} type="hidden" name={f} value={(values as Record<string, string>)[f] ?? ''} />)}
                  <table className="kv-table"><thead><tr><th>{t.t('swd.profile.col.field')}</th><th>{t.t('swd.profile.col.value')}</th></tr></thead>
                    <tbody>{PROFILE_FIELDS.filter((f) => (values as Record<string, string>)[f]).map((f) => (
                      <tr key={f}><td>{t.t(profileFieldKey(f))}</td><td>{f === 'regionId' ? (state!.districts.find((d) => d.id === values.regionId)?.name ?? values.regionId) : (values as Record<string, string>)[f]}</td></tr>))}</tbody></table>
                  {preview.errors.length > 0 && (
                    <div className="kv-error" role="alert"><p>{t.t('swd.profile.errorsLede')}</p>
                      <ul className="kv-list">{preview.errors.map((e) => <li key={`${e.field}-${e.reason}`}>{t.t(profileFieldKey(e.field))}: {t.t(`swd.profile.reason.${['required', 'district_invalid', 'malformed', 'too_long', 'not_plain_text', 'brand_owned'].includes(e.reason) ? e.reason : 'other'}`)}</li>)}</ul></div>
                  )}
                  {advisory && (
                    <div className="kv-card kv-card--notice" role="status">
                      <p>{t.t(advisory.key, advisory.vars)}</p>
                      {preview.advisory.kind === 'confirm' && <label className="kv-check"><input type="checkbox" name="confirmGstState" value="1" /> {t.t('swd.profile.advisory.continue')}</label>}
                    </div>
                  )}
                  {searchParams.advisory === '1' && <p className="kv-field__hint">{t.t('swd.profile.advisory.nothingSaved')}</p>}
                  {preview.reasonRequired && (
                    <label className="kv-field" htmlFor="su-reason"><span>{t.t('swd.profile.reasonLabel')}</span>
                      <textarea id="su-reason" name="reason" className="kv-textarea" rows={2} maxLength={280} required /></label>
                  )}
                  <p className="kv-field__hint">{t.t('swd.profile.auditNote')}</p>
                  {preview.errors.length === 0 && <button type="submit" className="kv-btn kv-btn--primary">{t.t('swd.profile.proceed')}</button>}{' '}
                  <a href={profileHref('form')} className="kv-btn--link">{t.t('swd.profile.cancel')}</a>
                </form>
              )}
            </>
          )}

          {/* W2695 · failed — nothing was changed; retry goes back to the confirm; "Back to the screen" is the PROFILE (F-22) */}
          {stage === 'failure' && (
            <div className="kv-error" role="alert">
              <strong>{t.t('swd.profile.failureTitle')}</strong>
              <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swdCodeKey(c))}</li>)}</ul>
              <p>{t.t('swd.profile.failureUntouched')} {t.t('swd.profile.savedUpTo', { n: Number(searchParams.n ?? '2') === 3 ? 3 : 2 })}</p>
              <p><a href={profileHref('confirm')} className="kv-btn--link">{t.t('swd.profile.retry')}</a> · <a href={PROFILE_BACK_HREF} className="kv-btn--link">{t.t('swd.profile.backToProfile')}</a></p>
              <p className="kv-field__hint">{t.t('swd.profile.noBrowserStore')}</p>
            </div>
          )}
        </>
      )}

      {step === 'done' && (
        <div className="kv-card">
          {saved ? (
            <>
              {/* SAVE & EXIT: the draft is on the SERVER (owner-only, 30 days) — resume by signing up again with the same phone (OTP). */}
              <strong>{t.t('swd.profile.savedExit')}</strong>
              <p className="kv-detail__muted">{t.t('swd.profile.savedUpTo', { n: 3 })} {t.t('swd.profile.resumeHow')}</p>
            </>
          ) : searchParams.profile === '1' ? (
            <>
              {/* W2694 · the change is applied — and the REAL list of fields saved (the canon's list was empty, F-22). */}
              <strong role="status">{t.t('swd.profile.doneTitle')}</strong>
              <ul className="kv-list">{savedFieldKeys((searchParams.fields ?? '').split(',').filter(Boolean)).map((k, i) => <li key={`${k}-${i}`}>{t.t(k)}</li>)}</ul>
              {(searchParams.fields ?? '') === '' && <p className="kv-detail__muted">{t.t('swd.profile.doneNoChange')}</p>}
              <p className="kv-detail__muted">{t.t('swd.profile.auditNote')} <a href={PROFILE_BACK_HREF} className="kv-btn--link">{t.t('swd.profile.backToProfile')}</a></p>
            </>
          ) : searchParams.resumed === '1' ? (
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
