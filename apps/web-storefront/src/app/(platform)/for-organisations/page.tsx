// apps/web-storefront/src/app/(platform)/for-organisations/page.tsx · PC-56 STORE-1c — canon W307 "Open your organisation's storefront" (route
// comment `(public)/for-organisations`) and its 14 chain pages, as ONE route whose steps are URL-carried (features/signup/flow.ts) and whose
// values are server-held (lib/signup-flow.ts — never PII in a URL). Door B (founder D4): the storefront hosts the same OTP + `tenancy.signUp`
// flow web-tenant W113 runs — an instant TRIAL organisation and a signed-in owner.
//
//   • BEFORE THE FORM: the platform switch `org_self_signup` (storefront.flags(), founder D1). OFF → "switched off — a platform switch", and
//     no form (the API refuses anyway, BEFORE the code is spent). A failed flags read does not hide the form: the API is the gate.
//   • THE GLANCE (D4): the LIVE count of verified organisations (storefront.stats(), precomputed) with its "as of" — or nothing while not
//     counted yet. "Anand FPO's 1,240 members" is not printed (refusals.ts anand_proof).
//   • WHAT YOU GET: only what is true today — your own storefront (the "Powered by" mark rule stated as it is), your own address on the
//     platform (custom domains later), a free trial with no card (its length from the platform's policy via storefront.plans(), else said
//     unknown), nothing live to buyers until verified (TRUE since STORE-1b), public per-plan pricing (/pricing).
//   • THE FORM (D4): organisation name · type (the public `tenant_type` registry) · your full name · work phone (SMS code) · console
//     language. No member-count field (refused in one line); the district belongs to the console's profile step (said under the form).
//   • THE CHAIN: form-error (W2466/W3064) · code · review (W2467/W3065, key minted at render) · done (W2468/W3066) · failure (W2469/W3067,
//     Retry = the same key — W2470–W2472 / W3068–W3070 are that replay, PARITY-DECOR).
//   • REFUSED BY NAME, ALWAYS PRINTED (kv-refused): every claim of brief §E (features/home/refusals.ts STORE1C_REFUSALS).
// Dynamic, noindex: a signup screen carries state and has no SEO value of its own.
import type { Metadata } from 'next';
import { randomUUID } from 'crypto';
import type { LookupValue, StorefrontFlags, StorefrontPlans, StorefrontStats } from '@krishalaya/sdk-js';
import { formatNumber, resolveLanguage } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { getLang, getTranslator } from '../../../lib/i18n';
import { readPendingSignup } from '../../../lib/signup-flow';
import { loadResult } from '../../../features/home/load-result';
import { STORE1C_REFUSALS } from '../../../features/home/refusals';
import { maskForDisplay } from '../../../features/chain/mask';
import {
  NAME_RULES, REFUSAL_FIELD, SIGNUP_LANGS, formatDay, readSignupParams, resolveSignupStep,
  type FieldRefusal, type PendingSignup, type SignupParams,
} from '../../../features/signup/flow';
import { AsOf } from '../../../components/AsOf';
import { SubmitButton } from '../../../components/SubmitButton';
import { ResendButton } from '../../../components/ResendButton';
import {
  confirmCodeAction, editFormAction, resendCodeAction, restartSignupAction, startSignupAction, submitSignupAction,
} from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('signup.title'), description: t.t('signup.lead'), robots: { index: false, follow: false } };
}

type T = ReturnType<typeof getTranslator>;
const minutes = (sec: number | null) => Math.max(1, Math.ceil((sec ?? 60) / 60));

/** The sentence for a named refusal — each with its own numbers (never a generic "something went wrong"). */
function signupErrorText(t: T, p: SignupParams): string | null {
  switch (p.err) {
    case null: return null;
    case 'rate_cooldown': return t.t('signup.err.rate_cooldown', { n: p.n ?? 30 });
    case 'rate_hourly': return t.t('signup.err.rate_hourly', { max: p.max ?? 0, minutes: minutes(p.n) });
    case 'rate_ip': return t.t('signup.err.rate_ip', { n: p.n ?? 60 });
    case 'code_wrong': return t.t('signup.err.code_wrong', { left: p.left ?? 0 });
    case 'code_locked': return t.t('signup.err.code_locked', { minutes: minutes(p.n) });
    case 'rate_signup': return t.t('signup.err.rate_signup', { minutes: minutes(p.n) });
    case 'rate_verify': return t.t('signup.err.rate_verify', { minutes: minutes(p.n) });
    default: return t.t(`signup.err.${p.err}`);
  }
}

function fieldText(t: T, r: FieldRefusal, p: SignupParams): string {
  switch (r) {
    case 'phone_digits': return t.t('signup.field.phone_digits', { need: p.need ?? 0, have: p.have ?? 0, dial: p.dial ?? '' });
    case 'org_short': return t.t('signup.field.org_short', { min: NAME_RULES.orgMin });
    case 'org_long': return t.t('signup.field.org_long', { max: NAME_RULES.orgMax });
    case 'name_short': return t.t('signup.field.name_short', { min: NAME_RULES.nameMin });
    case 'name_long': return t.t('signup.field.name_long', { max: NAME_RULES.nameMax });
    default: return t.t(`signup.field.${r}`);
  }
}

export default async function ForOrganisationsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const lang = getLang();
  const intl = resolveLanguage(lang).intlLocale;
  const platform = t.t('brand.platform');
  const p = readSignupParams(searchParams);
  const pending: PendingSignup | null = readPendingSignup();
  const step = resolveSignupStep(p.step, pending);
  const api = publicClient();

  const [flags, stats, plans] = await Promise.all([
    loadResult<StorefrontFlags>(() => api.storefront.flags()),
    loadResult<StorefrontStats>(() => api.storefront.stats()),
    env.platformCountry ? loadResult<StorefrontPlans>(() => api.storefront.plans(env.platformCountry as string)) : Promise.resolve(null),
  ]);
  const switchedOff = (flags.ok && flags.data.org_self_signup === false) || (step === 'failure' && p.err === 'disabled');
  const trialDays = plans && plans.ok ? plans.data.trialDays : null;
  const needTypes = !switchedOff && (step === 'form' || step === 'review');
  const types = needTypes ? await loadResult<LookupValue[]>(() => api.lookups.values('tenant_type')) : null;
  const typeList = types && types.ok ? types.data : [];
  const typeName = (id: string) => typeList.find((x) => String(x.id) === id)?.name ?? null;

  const error = signupErrorText(t, p);
  const alert = error ? <p id="kv-su-error" className="kv-form__error" role="alert" data-kv-err={p.err ?? ''}>{error}</p> : null;
  const v = pending ?? { orgName: '', orgTypeId: '', fullName: '', typed: '', lang: (SIGNUP_LANGS as readonly string[]).includes(lang) ? lang : 'en' };
  const bad = (field: string) => p.fields.filter((r) => REFUSAL_FIELD[r] === field);
  const fieldError = (field: string) => {
    const list = bad(field);
    return list.length ? <p id={`kv-su-${field}-err`} className="kv-form__error" data-kv-refusal-field={field}>{list.map((r) => fieldText(t, r, p)).join(' ')}</p> : null;
  };
  const invalid = (field: string) => (bad(field).length ? { 'aria-invalid': true as const, 'aria-describedby': `kv-su-${field}-err` } : {});
  const asOfLabels = {
    asOf: t.t('asOf.asOf'), now: t.t('asOf.now'), minutes: t.t('asOf.minutes'), hours: t.t('asOf.hours'), days: t.t('asOf.days'),
    ago: t.t('asOf.ago'), stale: t.t('asOf.stale'), staleCell: t.t('asOf.stale'), refresh: t.t('asOf.refresh'),
  };

  let body: React.ReactNode;
  if (switchedOff) {
    body = (
      <div className="kv-card kv-state" role="status" data-kv-state="flagged-off">
        <h2>{t.t('signup.off.title')}</h2>
        <p>{t.t('signup.off.body')}</p>
        {step === 'failure' && <p>{t.t('signup.off.codeKept')}</p>}
      </div>
    );
  } else if (step === 'code' && pending?.phone) {
    const left = Math.max(0, (pending.resendAt ?? 0) - Math.floor(Date.now() / 1000));
    const masked = maskForDisplay(pending.phone);
    body = (
      <div className="kv-card" data-kv-step="code">
        <h2>{t.t('signup.code.title')}</h2>
        <p>
          {t.t('signup.code.sentTo', { phone: masked })}
          {pending.ttlSec ? <> · {t.t('signup.code.validFor', { minutes: minutes(pending.ttlSec) })}</> : null}
        </p>
        {p.sent && !error && <p className="kv-form__notice" role="status">{t.t('signup.code.resent')}</p>}
        {alert}
        <form action={confirmCodeAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="signupCode" className="kv-form">
          <div className="kv-field">
            <label htmlFor="kv-su-code" className="kv-field__label">{t.t('signup.code.label')}</label>
            <input id="kv-su-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" maxLength={8}
              className="kv-field__input" required autoFocus aria-describedby="kv-su-code-hint" />
            <p id="kv-su-code-hint" className="kv-field__hint">{t.t('signup.code.hint')}</p>
          </div>
          <SubmitButton idle={t.t('signup.code.continue')} busy={t.t('auth.sending')} />
        </form>
        <form action={resendCodeAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="signupCode" className="kv-form">
          <ResendButton secondsLeft={left} idle={t.t('auth.code.resend')} waiting={t.t('auth.code.resendIn')} busy={t.t('auth.sending')} />
        </form>
        <form action={editFormAction} className="kv-form">
          <button type="submit" className="kv-btn--link">{t.t('signup.code.wrongNumber')}</button>
        </form>
        <p className="kv-field__hint">{t.t('auth.refused.voice')}</p>
      </div>
    );
  } else if (step === 'review' && pending?.phone) {
    const typeLabel = typeName(pending.orgTypeId);
    body = (
      <div className="kv-card" data-kv-step="review">
        <h2>{t.t('signup.review.title')}</h2>
        <p>{t.t('signup.review.lede')}</p>
        <dl className="kv-summary">
          <dt>{t.t('signup.form.orgName')}</dt><dd data-kv-review="orgName">{pending.orgName}</dd>
          <dt>{t.t('signup.form.orgType')}</dt><dd data-kv-review="orgType">{typeLabel ?? t.t('signup.review.typeUnread')}</dd>
          <dt>{t.t('signup.form.fullName')}</dt><dd data-kv-review="fullName">{pending.fullName}</dd>
          <dt>{t.t('signup.review.phone')}</dt><dd data-kv-review="phone">{maskForDisplay(pending.phone)}</dd>
          <dt>{t.t('signup.form.lang')}</dt><dd data-kv-review="lang">{resolveLanguage(pending.lang).nameNative}</dd>
        </dl>
        <p data-kv-review="trial">{trialDays ? t.t('signup.review.trial', { days: formatNumber(trialDays, lang) }) : t.t('signup.review.trialUnknown')}</p>
        <p>{t.t('signup.review.status')}</p>
        <form action={submitSignupAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="signupCode" className="kv-form">
          {/* the Idempotency-Key, minted AT RENDER (survey F-14): a double-submit of this form is ONE request */}
          <input type="hidden" name="idem" value={randomUUID()} />
          <SubmitButton idle={t.t('signup.review.submit')} busy={t.t('signup.review.busy')} />
        </form>
        <p className="kv-field__hint">{t.t('signup.review.once')}</p>
        <form action={editFormAction} className="kv-form">
          <button type="submit" className="kv-btn--link">{t.t('signup.review.back')}</button>
        </form>
      </div>
    );
  } else if (step === 'done' && pending?.done) {
    const d = pending.done;
    const consoleUrl = env.tenantAppUrl ? `${env.tenantAppUrl.replace(/\/+$/, '')}/login` : null;
    body = (
      <div className="kv-card" data-kv-step="done" data-kv-outcome={d.resumed ? 'resumed' : 'created'}>
        {d.resumed ? (
          <>
            <h2 role="status">{t.t('signup.done.resumed', { org: d.org })}</h2>
            <p>{t.t('signup.done.resumedNote')}</p>
          </>
        ) : (
          <>
            <h2 role="status">{t.t('signup.done.created', { org: d.org })}</h2>
            <p>{t.t('signup.done.address', { address: `/${d.slug}` })}</p>
            {d.trialEndsOn && <p data-kv-trial-ends={d.trialEndsOn}>{t.t('signup.done.trial', { date: formatDay(d.trialEndsOn, intl) })}</p>}
            <p>{t.t('signup.done.next')}</p>
          </>
        )}
        <p>{t.t('signup.done.signedIn')}</p>
        {consoleUrl
          ? <p><a href={consoleUrl} className="kv-btn" data-kv-console="link">{t.t('signup.done.console')}</a> <span className="kv-field__hint">{t.t('signup.done.consoleHow')}</span></p>
          : <p className="kv-state" data-kv-console="missing">{t.t('signup.done.consoleMissing')}</p>}
      </div>
    );
  } else if (step === 'failure' && pending?.phone) {
    body = (
      <div className="kv-card" data-kv-step="failure">
        <h2>{t.t('signup.failure.title')}</h2>
        {alert}
        <p>{t.t('signup.failure.lede')}</p>
        <form action={submitSignupAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="signupCode" className="kv-form">
          {/* W2470–W2472: the Retry is the SAME request again — the key the first attempt carried (remembered server-side) */}
          <input type="hidden" name="idem" value={pending.idem ?? randomUUID()} />
          <SubmitButton idle={t.t('signup.failure.retry')} busy={t.t('signup.review.busy')} />
        </form>
        <p className="kv-field__hint">{t.t('signup.failure.retryNote')}</p>
        <form action={editFormAction} className="kv-form">
          <button type="submit" className="kv-btn--link">{t.t('signup.failure.back')}</button>
        </form>
        <form action={restartSignupAction} className="kv-form">
          <button type="submit" className="kv-btn--link">{t.t('signup.failure.restart')}</button>
        </form>
      </div>
    );
  } else {
    // the form (W307) — and, with refusals, W2466 / W3064 (the same form, every refusal against its field, every value kept)
    body = (
      <form action={startSignupAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="signupCode" className="kv-form kv-card" aria-labelledby="kv-su-form-h" data-kv-step="form">
        <h2 id="kv-su-form-h">{t.t('signup.form.title')}</h2>
        {p.fields.length > 0 && <p className="kv-form__error" role="alert" data-kv-state="form-error">{t.t('signup.form.fixFields')}</p>}
        {alert}
        <div className="kv-field">
          <label htmlFor="kv-su-org" className="kv-field__label">{t.t('signup.form.orgName')}</label>
          <input id="kv-su-org" name="orgName" type="text" maxLength={200} defaultValue={v.orgName} className="kv-field__input" required {...invalid('orgName')} />
          <p className="kv-field__hint">{t.t('signup.form.orgNameHint')}</p>
          {fieldError('orgName')}
        </div>
        <div className="kv-field">
          <label htmlFor="kv-su-type" className="kv-field__label">{t.t('signup.form.orgType')}</label>
          {typeList.length > 0 ? (
            <select id="kv-su-type" name="orgTypeId" className="kv-field__input" defaultValue={v.orgTypeId} required {...invalid('orgTypeId')}>
              <option value="">{t.t('signup.form.chooseType')}</option>
              {typeList.map((o) => <option key={String(o.id)} value={String(o.id)}>{String(o.name || o.code)}</option>)}
            </select>
          ) : (
            // NO hard-coded list as a fallback (web-tenant W113's rule): the registry is data, and a stale list would offer a type the API refuses
            <p className="kv-form__error" role="alert" data-kv-state="types-unavailable">{t.t('signup.form.typesUnavailable')}</p>
          )}
          <p className="kv-field__hint">{t.t('signup.form.orgTypeHint')}</p>
          {fieldError('orgTypeId')}
        </div>
        <div className="kv-field">
          <label htmlFor="kv-su-name" className="kv-field__label">{t.t('signup.form.fullName')}</label>
          <input id="kv-su-name" name="fullName" type="text" maxLength={200} autoComplete="name" defaultValue={v.fullName} className="kv-field__input" required {...invalid('fullName')} />
          {fieldError('fullName')}
        </div>
        <div className="kv-field">
          <label htmlFor="kv-su-phone" className="kv-field__label">{t.t('signup.form.phone')}</label>
          <input id="kv-su-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32} defaultValue={v.typed} className="kv-field__input" required {...invalid('phone')} />
          <p className="kv-field__hint">{t.t('auth.refused.voice')}</p>
          {fieldError('phone')}
        </div>
        <div className="kv-field">
          <label htmlFor="kv-su-lang" className="kv-field__label">{t.t('signup.form.lang')}</label>
          <select id="kv-su-lang" name="lang" className="kv-field__input" defaultValue={v.lang}>
            {SIGNUP_LANGS.map((l) => <option key={l} value={l} lang={l}>{resolveLanguage(l).nameNative}</option>)}
          </select>
        </div>
        {typeList.length > 0 && <SubmitButton idle={t.t('signup.form.submit')} busy={t.t('auth.sending')} />}
        <p className="kv-field__hint">{t.t('signup.form.district')}</p>
        <p className="kv-field__hint" data-kv-refusal="member_count_field">{t.t('signup.form.members')}</p>
        <p className="kv-field__hint">{t.t('signup.get.verified')}</p>
        <p className="kv-field__hint">{t.t('signup.form.verifyTeam')}</p>
      </form>
    );
  }

  return (
    <article className="kv-signup" data-kv-screen="W307">
      <nav aria-label={t.t('signup.crumbLabel')}>
        <ol className="kv-crumb"><li><a href="/">{t.t('nav.home')}</a></li><li aria-current="page">{t.t('signup.crumb')}</li></ol>
      </nav>
      <section className="kv-hero" aria-labelledby="kv-su-h">
        <div>
          <h1 id="kv-su-h">{t.t('signup.title')}</h1>
          <p className="kv-prose__lead">{t.t('signup.lead')}</p>
          {stats.ok && stats.data.computedAt && (
            <>
              <p data-kv-glance="verified-orgs">{t.t('signup.glance', { count: formatNumber(stats.data.verifiedOrganisations, lang), platform })}</p>
              <AsOf at={stats.data.computedAt} labels={asOfLabels} />
            </>
          )}
        </div>
      </section>

      <div className="kv-signup__layout">
        <section aria-labelledby="kv-su-get">
          <h2 id="kv-su-get">{t.t('signup.get.title')}</h2>
          <ul className="kv-bullets" data-kv-region="what-you-get">
            <li>{t.t('signup.get.storefront', { platform })}</li>
            <li>{t.t('signup.get.address', { platform })}</li>
            <li>{t.t('signup.get.trial')}{trialDays ? ` ${t.t('signup.get.trialDays', { days: formatNumber(trialDays, lang) })}` : ''}</li>
            <li>{t.t('signup.get.verified')}</li>
            <li>{t.t('signup.get.pricing')} <a href="/pricing" className="kv-btn--link">{t.t('signup.get.pricingLink')}</a></li>
          </ul>
        </section>
        <section aria-label={t.t('signup.title')}>{body}</section>
      </div>

      <section className="kv-refused" aria-labelledby="kv-su-refused" data-kv-refused="W307">
        <h2 id="kv-su-refused">{t.t('signup.refused.title')}</h2>
        <ul>
          {STORE1C_REFUSALS.filter((r) => r.answer === 'rendered' && r.key).map((r) => (
            <li key={r.id} data-kv-refusal={r.id}>{t.t(r.key as string, { platform })}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}
