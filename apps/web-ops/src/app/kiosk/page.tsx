// apps/web-ops/src/app/kiosk/page.tsx · kiosk-assisted farmer onboarding (PC-31 OW-1). The ops staff CREATES
// the farmer's account here; every personal step after that — OTP sign-in, KYC documents, the first listing —
// happens in the FARMER'S OWN session on their (or the kiosk's) phone. Assisted, never impersonated: there are
// deliberately NO on-behalf KYC/listing writes (consent law; an `assisted-onboarding` on-behalf surface, if ever
// wanted, is a PC-54 decision — recorded, not faked). The guided checklist below is that honest handoff.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { KIOSK_LANGS } from '../../features/kiosk/form';
import { createFarmerAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kiosk.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['created']);
const ERR = new Set(['phone', 'name', 'lang', 'exists', 'create']);
const STEPS = ['create', 'login', 'kyc', 'listing'] as const;

export default async function KioskPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/kiosk');
  const t = getTranslator();
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('kiosk.title')}</h1>
      <p className="kv-field__hint">{t.t('kiosk.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t('kiosk.ok.created')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`kiosk.error.${errKey}`)}</p>}

      <form action={createFarmerAction} className="kv-card kv-form">
        <h2 className="kv-card__title">{t.t('kiosk.create')}</h2>
        <label htmlFor="k-phone" className="kv-field__label">{t.t('kiosk.phone')}</label>
        <input id="k-phone" name="phone" className="kv-input" inputMode="tel" autoComplete="off" required placeholder="+91…" />
        <p className="kv-field__hint">{t.t('kiosk.phoneHint')}</p>
        <label htmlFor="k-name" className="kv-field__label">{t.t('kiosk.name')}</label>
        <input id="k-name" name="fullName" className="kv-input" maxLength={120} autoComplete="off" />
        <label htmlFor="k-lang" className="kv-field__label">{t.t('kiosk.lang')}</label>
        <select id="k-lang" name="languageCode" className="kv-input" defaultValue="hi">
          {KIOSK_LANGS.map((l) => <option key={l} value={l}>{t.t(`kiosk.lang.${l}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn">{t.t('kiosk.createBtn')}</button>
      </form>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('kiosk.steps')}</h2>
        <p className="kv-field__hint">{t.t('kiosk.stepsHint')}</p>
        <ol className="kv-steps">
          {STEPS.map((s, i) => (
            <li key={s}><strong>{i + 1}.</strong> {t.t(`kiosk.step.${s}`)}</li>
          ))}
        </ol>
        <p className="kv-field__hint kv-note">{t.t('kiosk.consent')}</p>
      </div>
    </section>
  );
}
