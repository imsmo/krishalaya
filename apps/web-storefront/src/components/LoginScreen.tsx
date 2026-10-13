// apps/web-storefront/src/components/LoginScreen.tsx · PC-56 STORE-1a — THE STOREFRONT SIGN-IN (canon W321 Sign In, W322 Enter Code, and
// the six login/OTP chain pages as states of ONE route — features/auth/login-state.ts). Server component: every state renders from the
// URL (`?step=` + a named error + small numbers) and two httpOnly cookies (the typed phone / code, the 2FA challenge) — never PII in a URL.
// Mounted by /login (the platform's tenant, or a verified tenant host) and /[tenantSlug]/login (a path-mode tenant store).
//
//   phone  W321 — "Send my code"; the field keeps what was typed; named refusals (W3108): digit rule from the tenant's country, the
//          cooldown / hourly cap / per-connection limit with the server's own wait, service unavailable. Voice, missed-call, USSD and the
//          helpline are REFUSED BY NAME (no gateway exists), never offered.
//   code   W322 (= W3107 "code sent") — masked phone, the server's TTL, resend gated by the server's seconds, wrong (tries left) / expired /
//          locked / suspended named (W3133), digits kept, anti-phishing, "Listen instead" refused by name.
//   2fa    W3132's second-factor sub-state (TWO_FACTOR_PENDING): authenticator code or one recovery code.
//   done   W3132 — signed in; the buyer account state (D4); the other-session notice (device family + last active, never a city — D5).
// W3106 / W3131 (confirm pages) are not built: DELTA — a confirm before sending a code confirms nothing, the "Sending…" lock is the guard.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { getTranslator } from '../lib/i18n';
import { resolveSessionToken } from '../lib/session';
import { serverClient } from '../lib/api-client';
import { readPendingLogin, readPendingTwoFactor } from '../lib/login-flow';
import { resolveStorefrontTenant } from '../lib/tenant-context';
import { readLoginParams, type LoginParams, type LoginError } from '../features/auth/login-state';
import { phoneRuleFor } from '../features/auth/phone';
import { otherSessionNotice, type OtherSessionNotice } from '../features/auth/sessions-notice';
import { maskForDisplay } from '../features/chain/mask';
import { requestCodeAction, verifyCodeAction, verifyTwoFactorAction, resendCodeAction, resetLoginAction } from '../app/(platform)/login/actions';
import { SubmitButton } from './SubmitButton';
import { ResendButton } from './ResendButton';
import { OnlineGuard } from './OnlineGuard';

type T = ReturnType<typeof getTranslator>;
const ERR_ID = 'kv-login-error';
const PHONE_ERRORS: readonly LoginError[] = ['phone_empty', 'phone_digits', 'phone_invalid'];
const CODE_ERRORS: readonly LoginError[] = ['code_format', 'code_wrong', 'code_expired', 'code_locked'];
const TWO_FA_ERRORS: readonly LoginError[] = ['totp_format', 'totp_invalid', 'totp_replay', 'recovery_invalid', 'recovery_used'];
const minutes = (sec: number | null) => Math.max(1, Math.ceil((sec ?? 60) / 60));

/** The sentence for a named failure — every one with its own numbers, never a generic "something went wrong". */
export function errorText(t: T, p: LoginParams, tenantName: string): string | null {
  switch (p.err) {
    case null: return null;
    case 'phone_digits': return t.t('auth.err.phone_digits', { need: p.need ?? 0, have: p.have ?? 0, dial: p.dial ?? '' });
    case 'rate_cooldown': return t.t('auth.err.rate_cooldown', { n: p.n ?? 30 });
    case 'rate_hourly': return t.t('auth.err.rate_hourly', { max: p.max ?? 0, minutes: minutes(p.n) });
    case 'rate_ip': return t.t('auth.err.rate_ip', { n: p.n ?? 60 });
    case 'code_wrong': return t.t('auth.err.code_wrong', { left: p.left ?? 0 });
    case 'code_locked': return t.t('auth.err.code_locked', { minutes: minutes(p.n) });
    case 'rate_verify': return t.t('auth.err.rate_verify', { minutes: minutes(p.n) });
    case 'suspended': return t.t('auth.err.suspended', { tenant: tenantName });
    default: return t.t(`auth.err.${p.err}`);
  }
}

export interface LoginScreenProps { routeSlug: string | null; searchParams: Record<string, string | string[] | undefined> }

export async function LoginScreen({ routeSlug, searchParams }: LoginScreenProps) {
  const t = getTranslator();
  const p = readLoginParams(searchParams);
  const signalLabels = {
    banner: t.t('auth.offline.banner'), detail: t.t('auth.offline.detail'), needsSignal: t.t('auth.offline.needsSignal'),
    policy: t.t('auth.offline.policy'), policyHref: '/offline',
  };

  const tenant = await resolveStorefrontTenant(routeSlug);
  if (!tenant.ok) {
    return (
      <section className="kv-auth" aria-labelledby="kv-auth-h">
        <h1 id="kv-auth-h">{t.t('auth.title')}</h1>
        <p className="kv-form__error" role="alert">{t.t(`auth.tenant.${tenant.kind}`)}</p>
      </section>
    );
  }
  const tenantName = tenant.tenant.displayName;

  // Already signed in (or silently refreshable)? Skip the form — except on the signed-in state itself.
  if (p.step !== 'done' && (await resolveSessionToken())) redirect(p.next);

  const pending = readPendingLogin();
  // A step whose server-held half is gone (cookie expired / another browser) falls back to the phone step, said in words.
  let step = p.step;
  let err = p.err;
  if (step === 'code' && !pending?.phone) { step = 'phone'; err = err ?? 'start_again'; }
  if (step === '2fa' && !readPendingTwoFactor()) { step = 'phone'; err = err ?? 'challenge_expired'; }
  const shown: LoginParams = { ...p, step, err };
  const error = errorText(t, shown, tenantName);
  const idem = randomUUID();   // minted AT RENDER: a double-submit of this form is one request (Law 3)
  const hidden = (
    <>
      <input type="hidden" name="t" value={routeSlug ?? ''} />
      <input type="hidden" name="next" value={p.next} />
      <input type="hidden" name="idem" value={idem} />
    </>
  );
  const alert = error ? <p id={ERR_ID} className="kv-form__error" role="alert">{error}</p> : null;

  if (step === 'done') {
    let notice: OtherSessionNotice | null = null;
    try { notice = otherSessionNotice(await serverClient().auth.sessions(), Date.now()); } catch { notice = null; }
    const buy = p.buy ?? 'ready';
    return (
      <section className="kv-auth" aria-labelledby="kv-auth-h">
        <h1 id="kv-auth-h">{t.t('auth.done.heading')}</h1>
        <p className={buy === 'ready' || buy === 'granted' ? 'kv-form__notice' : 'kv-form__error'} role="status">{t.t(`auth.done.buy.${buy}`, { tenant: tenantName })}</p>
        {notice && (
          <div className="kv-auth__note" role="note">
            <p>
              {t.t('auth.done.other', { device: t.t(notice.familyKey), ago: t.t(notice.agoKey, { n: notice.agoN }) })}{' '}
              <a role="link" aria-disabled="true" className="kv-auth__soon">{t.t('auth.done.accountSoon')}</a>
            </p>
            <p className="kv-field__hint">{t.t('auth.refused.city')}</p>
          </div>
        )}
        <p><a href={p.next} className="kv-btn">{t.t('auth.done.continue')}</a></p>
      </section>
    );
  }

  if (step === '2fa') {
    const bad = err !== null && TWO_FA_ERRORS.includes(err);
    return (
      <section className="kv-auth" aria-labelledby="kv-auth-h">
        <OnlineGuard labels={signalLabels} />
        <h1 id="kv-auth-h">{t.t('auth.2fa.heading')}</h1>
        <p className="kv-prose__lead">{t.t('auth.2fa.lead')}</p>
        {alert}
        <form action={verifyTwoFactorAction} className="kv-form">
          {hidden}
          <div className="kv-field">
            <label htmlFor="kv-totp" className="kv-field__label">{t.t('auth.2fa.codeLabel')}</label>
            <input id="kv-totp" name="totp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
              className="kv-field__input" aria-invalid={bad || undefined} aria-describedby={bad ? ERR_ID : undefined} autoFocus />
          </div>
          <div className="kv-field">
            <label htmlFor="kv-recovery" className="kv-field__label">{t.t('auth.2fa.recoveryLabel')}</label>
            <input id="kv-recovery" name="recovery" type="text" autoComplete="off" maxLength={20} className="kv-field__input"
              aria-invalid={bad || undefined} aria-describedby={bad ? ERR_ID : undefined} />
          </div>
          <SubmitButton idle={t.t('auth.2fa.verify')} busy={t.t('auth.verifying')} />
        </form>
        <form action={resetLoginAction} className="kv-form">
          {hidden}
          <button type="submit" className="kv-btn--link">{t.t('auth.2fa.startAgain')}</button>
        </form>
      </section>
    );
  }

  if (step === 'code' && pending?.phone) {
    const bad = err !== null && CODE_ERRORS.includes(err);
    const left = Math.max(0, (pending.resendAt ?? 0) - Math.floor(Date.now() / 1000));
    const masked = maskForDisplay(pending.phone);
    return (
      <section className="kv-auth" aria-labelledby="kv-auth-h">
        <OnlineGuard labels={signalLabels} />
        <h1 id="kv-auth-h">{t.t('auth.code.heading')}</h1>
        <p className="kv-prose__lead">
          {t.t('auth.code.sentTo', { phone: masked })}
          {pending.ttlSec ? <> · {t.t('auth.code.validFor', { minutes: minutes(pending.ttlSec) })}</> : null}
        </p>
        {p.sent && !error && <p className="kv-form__notice" role="status">{t.t('auth.code.resent')}</p>}
        {!p.sent && !error && <p className="kv-form__notice" role="status">{t.t('auth.code.sentNotice', { phone: masked })}</p>}
        {alert}
        <form action={verifyCodeAction} className="kv-form">
          {hidden}
          <div className="kv-field">
            <label htmlFor="kv-code" className="kv-field__label">{t.t('auth.code.label')}</label>
            {/* DELTA (canon W322: six one-digit boxes): ONE one-time-code field — the OS autofill fills it, a screen reader reads it once. */}
            <input id="kv-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" maxLength={8}
              defaultValue={pending.code ?? ''} className="kv-field__input" required autoFocus
              aria-invalid={bad || undefined} aria-describedby={bad ? `kv-code-hint ${ERR_ID}` : 'kv-code-hint'} />
            <p id="kv-code-hint" className="kv-field__hint">{t.t('auth.code.hint')}</p>
          </div>
          <SubmitButton idle={t.t('auth.code.verify')} busy={t.t('auth.verifying')} />
        </form>
        <form action={resendCodeAction} className="kv-form">
          {hidden}
          <ResendButton secondsLeft={left} idle={t.t('auth.code.resend')} waiting={t.t('auth.code.resendIn')} busy={t.t('auth.sending')} />
        </form>
        <form action={resetLoginAction} className="kv-form">
          {hidden}
          <button type="submit" className="kv-btn--link">{t.t('auth.code.wrongNumber')}</button>
        </form>
        <p className="kv-field__hint">{t.t('auth.refused.listen')}</p>
        <div className="kv-auth__note" role="note">
          <p><strong>{t.t('auth.antiPhish.title')}</strong></p>
          <p>{t.t('auth.antiPhish.body', { tenant: tenantName })}</p>
        </div>
      </section>
    );
  }

  // phone (W321)
  const bad = err !== null && PHONE_ERRORS.includes(err);
  const rule = phoneRuleFor(tenant.tenant.countryCode ?? tenant.tenant.phoneDefaultCountry);
  return (
    <section className="kv-auth" aria-labelledby="kv-auth-h">
      <OnlineGuard labels={signalLabels} />
      <h1 id="kv-auth-h">{t.t('auth.phone.heading')}</h1>
      <p className="kv-prose__lead">{t.t('auth.lead')}</p>
      {alert}
      <form action={requestCodeAction} className="kv-form">
        {hidden}
        <div className="kv-field">
          <label htmlFor="kv-phone" className="kv-field__label">{t.t('auth.phone.label')}</label>
          <input id="kv-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={32}
            placeholder={rule ? t.t('auth.phone.placeholderDigits', { n: rule.nationalDigits }) : t.t('auth.phone.placeholder')}
            defaultValue={pending?.typed ?? ''} className="kv-field__input" required
            aria-invalid={bad || undefined} aria-describedby={bad ? `kv-phone-hint ${ERR_ID}` : 'kv-phone-hint'} />
          <p id="kv-phone-hint" className="kv-field__hint">{rule ? t.t('auth.phone.hintRule', { dial: rule.dial }) : t.t('auth.phone.hint')}</p>
        </div>
        <SubmitButton idle={t.t('auth.phone.send')} busy={t.t('auth.sending')} />
      </form>
      <p className="kv-field__hint">{t.t('auth.refused.voice')}</p>
      <div className="kv-auth__note" role="note">
        <p><strong>{t.t('auth.phone.newHereTitle')}</strong> {t.t('auth.phone.newHere', { tenant: tenantName })}</p>
        <p>{t.t('auth.refused.ussd')}</p>
      </div>
    </section>
  );
}
