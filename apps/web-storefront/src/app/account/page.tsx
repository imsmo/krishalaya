// apps/web-storefront/src/app/account/page.tsx · the buyer's account surface (PC-24b). PROTECTED + dynamic.
// Two sections, each degrading independently (Law 12):
//   1. Profile — auth.me() (name/roles/locale); an edit <details> form posts the PII-minimal patch through
//      updateProfileAction (users.updateMe — token-resolved subject, no IDOR).
//   2. Address book — addresses.list() (caller-scoped server-side) with add / remove / make-default actions.
//      Checkout keeps working without this page; this is the buyer's standing address management.
// All copy via i18n; noindex.
import type { Metadata } from 'next';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { updateProfileAction, addAddressAction, removeAddressAction, makeDefaultAddressAction } from './actions';
import type { UserProfile, Address } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('account.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['profile', 'address', 'removed', 'default']);
const ERR = new Set(['email', 'empty', 'profile', 'line1', 'pincode', 'phone', 'address']);

export default async function AccountPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/account');
  const t = getTranslator();

  let me: UserProfile | null = null;
  try { me = await serverClient().auth.me(); } catch { me = null; }

  let addresses: Address[] = []; let addressesFailed = false;
  try { addresses = await serverClient().addresses.list(); } catch { addressesFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section className="kv-account">
      <h1>{t.t('account.title')}</h1>
      {okKey && <p className="kv-form__notice" role="status">{t.t(`account.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-form__error" role="alert">{t.t(`account.error.${errKey}`)}</p>}

      <h2>{t.t('account.profile')}</h2>
      {me ? (
        <dl className="kv-detail__facts">
          <div><dt>{t.t('account.name')}</dt><dd>{me.displayName ?? '—'}</dd></div>
          <div><dt>{t.t('account.locale')}</dt><dd>{me.locale || '—'}</dd></div>
        </dl>
      ) : <p className="kv-form__error" role="alert">{t.t('account.profileError')}</p>}

      <details className="kv-form__card">
        <summary>{t.t('account.editProfile')}</summary>
        <form action={updateProfileAction} className="kv-form">
          <label htmlFor="a-name" className="kv-form__label">{t.t('account.name')}</label>
          <input id="a-name" name="fullName" className="kv-field__input" autoComplete="name" />
          <label htmlFor="a-email" className="kv-form__label">{t.t('account.email')}</label>
          <input id="a-email" name="email" type="email" inputMode="email" autoComplete="email" className="kv-field__input" />
          <label htmlFor="a-lang" className="kv-form__label">{t.t('account.language')}</label>
          <select id="a-lang" name="languageCode" className="kv-field__input" defaultValue="">
            <option value="">{t.t('account.unchanged')}</option>
            {['en', 'hi', 'gu'].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <button type="submit" className="kv-btn">{t.t('account.save')}</button>
        </form>
      </details>

      <h2>{t.t('account.addresses')}</h2>
      {addressesFailed ? (
        <p className="kv-form__error" role="alert">{t.t('account.addressesError')}</p>
      ) : addresses.length === 0 ? (
        <p className="kv-detail__muted">{t.t('account.addressesEmpty')}</p>
      ) : (
        <ul className="kv-address-list">
          {addresses.map((a) => (
            <li key={a.id} className="kv-address-list__item">
              <p>
                {a.isDefault && <span className="kv-badge">{t.t('account.default')}</span>}{' '}
                <strong>{a.line1}</strong>{a.line2 ? `, ${a.line2}` : ''}{a.village ? `, ${a.village}` : ''}{a.pincode ? ` — ${a.pincode}` : ''}
              </p>
              {(a.contactName || a.contactPhone) && <p className="kv-detail__muted">{[a.contactName, a.contactPhone].filter(Boolean).join(' · ')}</p>}
              <div className="kv-cart__actions">
                {!a.isDefault && (
                  <form action={makeDefaultAddressAction} className="kv-inline-form">
                    <input type="hidden" name="id" value={a.id} />
                    <button type="submit" className="kv-btn--link">{t.t('account.makeDefault')}</button>
                  </form>
                )}
                <form action={removeAddressAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="kv-btn--link">{t.t('account.remove')}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <details className="kv-form__card">
        <summary>{t.t('account.addAddress')}</summary>
        <form action={addAddressAction} className="kv-form">
          <label htmlFor="ad-l1" className="kv-form__label">{t.t('account.line1')}</label>
          <input id="ad-l1" name="line1" className="kv-field__input" required minLength={3} autoComplete="address-line1" />
          <label htmlFor="ad-l2" className="kv-form__label">{t.t('account.line2')}</label>
          <input id="ad-l2" name="line2" className="kv-field__input" autoComplete="address-line2" />
          <label htmlFor="ad-vil" className="kv-form__label">{t.t('account.village')}</label>
          <input id="ad-vil" name="village" className="kv-field__input" autoComplete="address-level2" />
          <label htmlFor="ad-pin" className="kv-form__label">{t.t('account.pincode')}</label>
          <input id="ad-pin" name="pincode" className="kv-field__input" inputMode="numeric" pattern="\d{6}" autoComplete="postal-code" />
          <label htmlFor="ad-cn" className="kv-form__label">{t.t('account.contactName')}</label>
          <input id="ad-cn" name="contactName" className="kv-field__input" autoComplete="name" />
          <label htmlFor="ad-cp" className="kv-form__label">{t.t('account.contactPhone')}</label>
          <input id="ad-cp" name="contactPhone" className="kv-field__input" inputMode="tel" autoComplete="tel" />
          <label className="kv-form__label" htmlFor="ad-def">
            <input id="ad-def" type="checkbox" name="isDefault" value="1" /> {t.t('account.setDefault')}
          </label>
          <button type="submit" className="kv-btn">{t.t('account.addBtn')}</button>
        </form>
      </details>
    </section>
  );
}
