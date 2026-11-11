// apps/web-gov/src/components/gov1/LoginViews.tsx · PC-56 GOV-1a — W355 (`/login`) and the login chain (W3229–W3232), presentational (rendered by
// app/login/page.tsx and by the render tests). GOV-1 Q2-A + Q5-A: the person signs in to a GOVERNMENT AUTHORITY — phone → code → (the chooser,
// when the phone holds a role in several authorities) → the authenticator code; an account without a confirmed authenticator is shown its
// set-up key, confirms a code, sees its recovery codes once, and signs in again. There is no other way in, and nothing here offers one.
// The phone NEVER travels in a URL or a field (a short-lived httpOnly cookie set by the Server Action; shown here only MASKED); the chooser's
// token, the challenge and the enrol token are cookies too, never fields. All copy via i18n; no inline styles; no physical direction.
import type { ReactNode } from 'react';
import { Gov1Chain, Gov1Refusals } from './Gov1Chain';
import { LOGIN_ERRORS, type LoginStep } from '../../features/gov1/login';
import type { Tr } from '../../features/gov1/refusals';
import { ltrText } from '../../features/rtl/span';

type Action = string | ((fd: FormData) => Promise<void>);
export interface LoginActions { requestOtp: Action; verifyOtp: Action; choose: Action; twoFactor: Action; enrol: Action; confirmEnrol: Action; startOver: Action }
export interface LoginViewProps {
  t: Tr;
  step: LoginStep;
  /** `?act=` — a login chain state, or null for the page itself. */
  act?: 'form-error' | 'review' | 'success' | 'failure' | null;
  /** A named refusal CODE (never a phone, never a token). */
  error?: string | null;
  left?: number | null;
  wait?: number | null;
  /** `••••••318` — the pending phone, masked (from the httpOnly cookie). */
  phoneMasked?: string | null;
  choices?: Array<{ id: string; name: string }>;
  /** The set-up key exactly as the API gave it (enrol-confirm only). */
  enrolKey?: { secret: string; otpauthUri: string } | null;
  /** The recovery codes exactly as the API gave them, once (enrolled only). */
  recoveryCodes?: string[] | null;
  /** On the success state: the authority the API says this session is in (`GET /v1/gov/me`), or null when it could not be read. */
  signedInTo?: string | null;
  actions: LoginActions;
  /** PC-56 RTL-1f: the page language — under a preview (rtl) language the masked phone is isolated left-to-right inside its sentence. */
  lang?: string;
}

const form = (a: Action) => a as never;

export function LoginError({ t, error, left, wait }: { t: Tr; error: string; left?: number | null; wait?: number | null }) {
  const e = LOGIN_ERRORS[error] ?? LOGIN_ERRORS.LOGIN_FAILED;
  return <p className="kv-error" role="alert" data-kv-error={LOGIN_ERRORS[error] ? error : 'LOGIN_FAILED'}>{t.t(e.key, { left: left ?? 0, minutes: wait ?? 1 })}</p>;
}

function PhoneForm({ t, actions }: { t: Tr; actions: LoginActions }) {
  return (
    <form action={form(actions.requestOtp)} className="kv-form" data-kv-form="phone">
      <label htmlFor="phone" className="kv-field__label">{t.t('login.phoneLabel')}</label>
      <input id="phone" className="kv-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t.t('login.phonePlaceholder')} required />
      <button className="kv-btn" type="submit">{t.t('login.sendOtp')}</button>
    </form>
  );
}
function CodeForm({ t, phoneMasked, actions, lang = 'en' }: { t: Tr; phoneMasked?: string | null; actions: LoginActions; lang?: string }) {
  return (
    <form action={form(actions.verifyOtp)} className="kv-form" data-kv-form="verify">
      <p className="kv-muted">{t.t('gov1.login.codeSent', { phone: phoneMasked ? ltrText(phoneMasked, lang) : '' })}</p>
      <label htmlFor="code" className="kv-field__label">{t.t('login.otpLabel')}</label>
      <input id="code" className="kv-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{4,8}" required />
      <button className="kv-btn" type="submit">{t.t('gov1.login.continue')}</button>
    </form>
  );
}
function ChooseForm({ t, choices, actions }: { t: Tr; choices?: Array<{ id: string; name: string }>; actions: LoginActions }) {
  return (
    <form action={form(actions.choose)} className="kv-form" data-kv-form="choose">
      <h2 className="kv-card__title">{t.t('gov1.login.chooseTitle')}</h2>
      <p className="kv-muted">{t.t('gov1.login.chooseLead')}</p>
      <fieldset className="kv-fieldset">
        <legend>{t.t('gov1.login.chooseLegend')}</legend>
        {(choices ?? []).map((c) => (
          <label key={c.id} className="kv-radio"><input type="radio" name="authorityId" value={c.id} required /> {c.name}</label>
        ))}
      </fieldset>
      <button className="kv-btn" type="submit">{t.t('gov1.login.chooseSubmit')}</button>
    </form>
  );
}
function TwoFactorForm({ t, actions }: { t: Tr; actions: LoginActions }) {
  return (
    <form action={form(actions.twoFactor)} className="kv-form" data-kv-form="2fa">
      <h2 className="kv-card__title">{t.t('gov1.login.twoFactorTitle')}</h2>
      <label htmlFor="totp" className="kv-field__label">{t.t('gov1.login.twoFactorLabel')}</label>
      <input id="totp" className="kv-input" name="code" type="text" inputMode="text" autoComplete="one-time-code" minLength={6} maxLength={20} required />
      <p className="kv-field__hint">{t.t('gov1.login.twoFactorHint')}</p>
      <button className="kv-btn" type="submit">{t.t('gov1.login.signIn')}</button>
    </form>
  );
}
function EnrolStart({ t, actions }: { t: Tr; actions: LoginActions }) {
  return (
    <form action={form(actions.enrol)} className="kv-form" data-kv-form="enrol">
      <h2 className="kv-card__title">{t.t('gov1.login.enrolTitle')}</h2>
      <p>{t.t('gov1.login.enrolLead')}</p>
      <button className="kv-btn" type="submit">{t.t('gov1.login.enrolShow')}</button>
    </form>
  );
}
function EnrolConfirm({ t, enrolKey, actions }: { t: Tr; enrolKey?: { secret: string; otpauthUri: string } | null; actions: LoginActions }) {
  return (
    <form action={form(actions.confirmEnrol)} className="kv-form" data-kv-form="enrol-confirm">
      <h2 className="kv-card__title">{t.t('gov1.login.enrolTitle')}</h2>
      {enrolKey ? (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('gov1.login.enrolKey')}</dt><dd><code data-kv-secret="">{enrolKey.secret}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('gov1.login.enrolLink')}</dt><dd><a className="kv-link" href={enrolKey.otpauthUri} data-kv-otpauth="">{t.t('gov1.login.enrolOpen')}</a></dd></div>
        </dl>
      ) : <p className="kv-muted" data-kv-enrol-key="missing">{t.t('gov1.login.enrolKeyGone')}</p>}
      <p className="kv-field__hint">{t.t('gov1.login.enrolNoImage')}</p>
      <label htmlFor="enrol-code" className="kv-field__label">{t.t('gov1.login.enrolCodeLabel')}</label>
      <input id="enrol-code" className="kv-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" required />
      <button className="kv-btn" type="submit">{t.t('gov1.login.enrolConfirm')}</button>
    </form>
  );
}
function Enrolled({ t, recoveryCodes, actions }: { t: Tr; recoveryCodes?: string[] | null; actions: LoginActions }) {
  return (
    <section className="kv-card" data-kv-form="enrolled">
      <h2 className="kv-card__title">{t.t('gov1.login.enrolledTitle')}</h2>
      <p>{t.t('gov1.login.enrolledLead')}</p>
      {recoveryCodes && recoveryCodes.length > 0
        ? <ul className="kv-account-list" data-kv-recovery={recoveryCodes.length}>{recoveryCodes.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
        : <p className="kv-muted" data-kv-recovery="gone">{t.t('gov1.login.enrolledGone')}</p>}
      <form action={form(actions.startOver)} className="kv-inline-form">
        <button className="kv-btn" type="submit">{t.t('gov1.login.signInAgain')}</button>
      </form>
    </section>
  );
}

/** The form a step shows (also the form a form-error state shows again). */
export function StepForm(p: LoginViewProps): ReactNode {
  switch (p.step) {
    case 'verify': return <CodeForm t={p.t} phoneMasked={p.phoneMasked} actions={p.actions} lang={p.lang} />;
    case 'choose': return <ChooseForm t={p.t} choices={p.choices} actions={p.actions} />;
    case '2fa': return <TwoFactorForm t={p.t} actions={p.actions} />;
    case 'enrol': return <EnrolStart t={p.t} actions={p.actions} />;
    case 'enrol-confirm': return <EnrolConfirm t={p.t} enrolKey={p.enrolKey} actions={p.actions} />;
    case 'enrolled': return <Enrolled t={p.t} recoveryCodes={p.recoveryCodes} actions={p.actions} />;
    default: return <PhoneForm t={p.t} actions={p.actions} />;
  }
}

function StartOver({ t, actions }: { t: Tr; actions: LoginActions }) {
  return (
    <form action={form(actions.startOver)} className="kv-inline-form">
      <button className="kv-btn kv-btn--muted" type="submit">{t.t('gov1.login.startOver')}</button>
    </form>
  );
}

export function LoginView(p: LoginViewProps) {
  const { t, act } = p;
  if (act) {
    return (
      <section className="kv-auth" data-kv-login={act}>
        <Gov1Chain t={t} chain="login_form" state={act}>
          {act === 'form-error' || act === 'failure' ? <LoginError t={t} error={p.error ?? 'LOGIN_FAILED'} left={p.left} wait={p.wait} /> : null}
          {act === 'form-error' ? <StepForm {...p} /> : null}
          {act === 'review' ? <p className="kv-muted">{t.t('gov1.refusal.loginReview')}</p> : null}
          {act === 'success' ? (
            <>
              <p data-kv-signed-in={p.signedInTo ? 'authority' : 'unknown'}>{p.signedInTo ? t.t('gov1.login.signedInTo', { authority: p.signedInTo }) : t.t('gov1.login.signedIn')}</p>
              <p className="kv-pager"><a className="kv-btn" href="/dashboard" data-kv-real="console">{t.t('gov1.login.openConsole')}</a></p>
            </>
          ) : null}
        </Gov1Chain>
      </section>
    );
  }
  if (p.step === 'off') {
    return (
      <section className="kv-auth" data-kv-login="off">
        <h1>{t.t('login.title')}</h1>
        <p className="kv-muted">{t.t('gov1.login.off')}</p>
      </section>
    );
  }
  return (
    <section className="kv-auth" data-kv-login={p.step}>
      <h1>{t.t('login.title')}</h1>
      <p className="kv-muted">{t.t('gov1.login.lead')}</p>
      <p className="kv-statement" data-kv-statement="gov1.login.q5">{t.t('gov1.login.q5')}</p>
      <StepForm {...p} />
      {p.step !== 'phone' && p.step !== 'enrolled' ? <StartOver t={t} actions={p.actions} /> : null}
      <Gov1Refusals t={t} surface="login" />
    </section>
  );
}
