// apps/web-partner/src/components/LoginSteps.tsx · PC-56 PARTNER-0 · founder D8 — the sign-in TO THE PARTNER, presentational (rendered by
// app/login/page.tsx and by the render test). The steps: phone → code → (a chooser when the phone belongs to several partner organisations)
// → (the second factor when the person has confirmed TOTP). F-9: the phone NEVER travels in a URL — it rides a short-lived httpOnly cookie
// set by the Server Action; this markup shows it only MASKED, and no link, action or field here carries it. The chooser's single-use token
// is likewise a cookie, never a field. All copy via i18n; no inline styles.
import type { Tr } from './NotYet';

export type LoginStep = 'phone' | 'verify' | 'choose' | '2fa' | 'off';
type Action = string | ((fd: FormData) => Promise<void>);
export interface LoginStepsProps {
  t: Tr;
  step: LoginStep;
  /** `••••••318` — the pending phone, masked (from the httpOnly cookie). */
  phoneMasked?: string | null;
  choices?: Array<{ id: string; name: string }>;
  /** An API error CODE (never a phone, never a token). */
  error?: string | null;
  actions: { requestOtp: Action; verifyOtp: Action; choose: Action; twoFactor: Action; startOver: Action };
}

const ERRORS: Record<string, string> = {
  NOT_A_PARTNER: 'partner.login.notAPartner',
  PARTNER_ACCESS_NONE: 'partner.login.noAccess',
  PARTNER_CHOICE_INVALID: 'partner.login.choiceExpired',
  PHONE_MISSING: 'partner.login.phoneMissing',
};
export const loginErrorKey = (code?: string | null): string | null => (code ? ERRORS[code] ?? 'login.failed' : null);

export function LoginSteps({ t, step, phoneMasked, choices, error, actions }: LoginStepsProps) {
  const errKey = loginErrorKey(error);
  if (step === 'off') {
    return (
      <section className="kv-login">
        <h1>{t.t('partner.off.title')}</h1>
        <p className="kv-muted">{t.t('partner.off.body')}</p>
      </section>
    );
  }
  return (
    <section className="kv-login">
      <h1>{t.t('login.title')}</h1>
      <p className="kv-muted">{t.t('login.lead')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(errKey)}</p>}
      {step === 'phone' && (
        <form action={actions.requestOtp as never} className="kv-form">
          <label htmlFor="phone" className="kv-field__label">{t.t('login.phoneLabel')}</label>
          <input id="phone" className="kv-input" name="phone" inputMode="tel" placeholder={t.t('login.phoneHint')} autoComplete="tel" required />
          <button className="kv-btn" type="submit">{t.t('login.sendOtp')}</button>
        </form>
      )}
      {step === 'verify' && (
        <form action={actions.verifyOtp as never} className="kv-form">
          <p className="kv-muted">{t.t('partner.login.verifyLead', { phone: phoneMasked ?? '' })}</p>
          <label htmlFor="code" className="kv-field__label">{t.t('login.verify')}</label>
          <input id="code" className="kv-input" name="code" inputMode="numeric" autoComplete="one-time-code" required />
          <button className="kv-btn" type="submit">{t.t('login.verify')}</button>
        </form>
      )}
      {step === 'choose' && (
        <form action={actions.choose as never} className="kv-form">
          <h2 className="kv-card__title">{t.t('partner.login.chooseTitle')}</h2>
          <p className="kv-muted">{t.t('partner.login.chooseLead')}</p>
          <fieldset className="kv-choices">
            {(choices ?? []).map((c) => (
              <label key={c.id} className="kv-choice"><input type="radio" name="partnerId" value={c.id} required /> {c.name}</label>
            ))}
          </fieldset>
          <button className="kv-btn" type="submit">{t.t('partner.login.chooseSubmit')}</button>
        </form>
      )}
      {step === '2fa' && (
        <form action={actions.twoFactor as never} className="kv-form">
          <h2 className="kv-card__title">{t.t('partner.login.twoFactorTitle')}</h2>
          <label htmlFor="totp" className="kv-field__label">{t.t('partner.login.twoFactorLead')}</label>
          <input id="totp" className="kv-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          <button className="kv-btn" type="submit">{t.t('partner.login.twoFactorSubmit')}</button>
        </form>
      )}
      {step !== 'phone' && (
        <form action={actions.startOver as never} className="kv-inline-form">
          <button className="kv-btn kv-btn--muted" type="submit">{t.t('partner.login.startOver')}</button>
        </form>
      )}
    </section>
  );
}
