// apps/web-storefront/src/components/account/AddressFormScreen.tsx · PC-56 STORE-4a · C3 — the address FORM chain (canon W3034 form-error → W3035
// review → W3036 success / W3037 failure) for "+ Add address" and "Edit", under whichever chrome the person is in (one copy). PROTECTED.
//   • the form: the label (a select from `lookups.values('address_label')`, worded by code ×3), the lines, the postal code by the ONE rule
//     (features/address/form.ts — 2c's), the country (ISO-2; default from the person's own country or the session store's — never a literal),
//     the receiver and phone, the delivery note (≤ 280); a key minted at render (`address:<uuid>`) carried through the whole chain;
//   • W3034: every field's refusal at once, by name, the values kept (a server-held httpOnly draft — never the URL);
//   • W3035 (`?step=review`): everything read-only; for an EDIT the diff against the CURRENT row, field by field (server values — the phone masked);
//   • W3037 (`?step=review&failure=…`): the named failure (validation / unknown label / not found / concurrency / server), values kept, the SAME
//     key on Submit (Retry), Back to edit — never to W316;
//   • "Unserviceable pincode" and the driver's-view claim refused by name.
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { Address, LookupValue, UserProfile } from '@krishalaya/sdk-js';
import { serverClient, sessionTenantClient, publicClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { accountHref, chromeField, type AccountChrome } from '../../features/store4a/account';
import { labelText, readFailure, readKey } from '../../features/store4a/addresses';
import {
  ADDRESS_DRAFT_COOKIE, DELIVERY_NOTE_MAX, decodeAddressDraft, valuesOfAddress, addressDiff, accountAddressFieldKey, withKeptPhone, type AccountAddressValues, type AccountAddressErrors,
} from '../../features/address/form';
import { maskForDisplay } from '../../features/chain/mask';
import { reviewAddressAction, submitAddressAction } from '../../app/(platform)/account/addresses/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FIELD_KEYS: Record<keyof AccountAddressValues, string> = {
  labelId: 'store4a.form.label', line1: 'account.line1', line2: 'account.line2', village: 'account.village', pincode: 'store4a.form.pincode',
  countryCode: 'account.countryCode', contactName: 'account.contactName', contactPhone: 'account.contactPhone', deliveryNote: 'store4a.form.note',
};

export async function AddressFormScreen({ chrome, id, searchParams }: { chrome: AccountChrome; id: string | null; searchParams: SP }) {
  const self = id ? accountHref(chrome, { edit: id }) : accountHref(chrome, 'addresses/new');
  await requireSession(self);
  const t = getTranslator();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  const mode = id ? 'edit' : 'create';
  let currentRow: Address | null = null; let missing = false;
  if (id) { try { currentRow = await api.addresses.get(id); } catch { missing = true; } }
  let vocab: LookupValue[] = [];
  try { vocab = await api.lookups.values('address_label'); } catch { vocab = []; }
  // the country's default: the person's own country, else the session store's (Rule Zero — from the data; unreadable → blank, typed)
  let defaultCountry = '';
  if (!id) {
    try { defaultCountry = String(((await api.auth.me()) as UserProfile).countryCode ?? '').toUpperCase(); } catch { defaultCountry = ''; }
    if (!/^[A-Z]{2}$/.test(defaultCountry)) {
      try { defaultCountry = String((await (chrome.kind === 'tenant' ? publicClient(chrome.slug) : sessionTenantClient()).storefront.tenant()).countryCode ?? '').toUpperCase(); } catch { defaultCountry = ''; }
    }
    if (!/^[A-Z]{2}$/.test(defaultCountry)) defaultCountry = '';
  }
  const draft = decodeAddressDraft(cookies().get(ADDRESS_DRAFT_COOKIE)?.value, mode, id);
  const current = currentRow ? valuesOfAddress(currentRow) : null;
  // an edit never pre-fills the receiver's phone (PII — printed masked as a hint; blank keeps it)
  const values: AccountAddressValues = draft?.values ?? (current ? { ...current, contactPhone: '' } : null) ?? { labelId: '', line1: '', line2: '', village: '', pincode: '', countryCode: defaultCountry, contactName: '', contactPhone: '', deliveryNote: '' };
  const errors: AccountAddressErrors = one(searchParams.error) === 'form' ? (draft?.errors ?? {}) : {};
  const key = readKey(searchParams.k) ?? `address:${randomUUID()}`;   // minted at render; the chain carries it to Submit and back on Retry
  const review = one(searchParams.step) === 'review' && !!draft && Object.keys(draft.errors).length === 0;
  const failure = review ? readFailure(searchParams.failure) : null;
  const labelOf = (lid: string) => { const v = vocab.find((x) => x.id === lid); return v ? labelText(v.code, v.name, (k) => t.t(k)) : null; };
  const title = t.t(id ? 'store4a.form.editTitle' : 'store4a.form.addTitle');

  const crumbs = (
    <nav aria-label={t.t('store4a.crumb.label')}>
      <ol className="kv-crumb">
        <li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li>
        <li><Link href={accountHref(chrome, 'addresses')}>{t.t('store4a.addresses.title')}</Link></li>
        <li aria-current="page">{title}</li>
      </ol>
    </nav>
  );
  if (id && missing) {
    return (
      <section className="kv-address-form" data-kv-screen="address-form" data-kv-mode={mode} data-kv-chrome={chromeField(chrome)}>
        {crumbs}<h1>{title}</h1>
        <p className="kv-form__error" role="alert" data-kv-failure="not_found">{t.t('store4a.failure.not_found')}</p>
        <Link href={accountHref(chrome, 'addresses')} className="kv-btn">{t.t('store4a.form.backToBook')}</Link>
      </section>
    );
  }

  if (review && draft) {
    const next = withKeptPhone(current, draft.values);
    const diff = current ? addressDiff(current, next) : null;
    const show = (f: keyof AccountAddressValues, v: string) => (f === 'labelId' ? (v ? labelOf(v) ?? '' : '') : f === 'contactPhone' && v ? maskForDisplay(v) : v);
    return (
      <section className="kv-address-form" data-kv-screen="address-review" data-kv-mode={mode} data-kv-chrome={chromeField(chrome)}>
        {crumbs}<h1>{t.t('store4a.review.title')}</h1>
        {failure && <p className="kv-form__error" role="alert" data-kv-failure={failure}>{t.t(`store4a.failure.${failure}`)}</p>}
        {diff ? (
          diff.length === 0 ? <p data-kv-diff="none">{t.t('store4a.review.noChange')}</p> : (
            <table className="kv-table" data-kv-diff={diff.length}>
              <thead><tr><th>{t.t('store4a.review.field')}</th><th>{t.t('store4a.review.from')}</th><th>{t.t('store4a.review.to')}</th></tr></thead>
              <tbody>{diff.map((d) => (
                <tr key={d.field} data-kv-diff-field={d.field}>
                  <td>{t.t(FIELD_KEYS[d.field])}</td>
                  <td>{d.field === 'labelId' ? (d.from ? labelOf(current!.labelId) ?? '' : '') : d.from || t.t('store4a.review.empty')}</td>
                  <td>{d.field === 'labelId' ? (d.to ? labelOf(next.labelId) ?? '' : '') : d.to || t.t('store4a.review.empty')}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        ) : (
          <dl className="kv-detail__facts" data-kv-review="create">
            {(Object.keys(FIELD_KEYS) as (keyof AccountAddressValues)[]).filter((f) => draft.values[f]).map((f) => (
              <div key={f} data-kv-review-field={f}><dt>{t.t(FIELD_KEYS[f])}</dt><dd>{show(f, draft.values[f])}</dd></div>
            ))}
          </dl>
        )}
        {mode === 'edit' && <p className="kv-detail__muted" data-kv-copy-rule>{t.t('store4a.review.copyRule')}</p>}
        <form action={submitAddressAction} className="kv-inline-form">
          <input type="hidden" name="chrome" value={chromeField(chrome)} />
          {id && <input type="hidden" name="id" value={id} />}
          <input type="hidden" name="key" value={key} />
          <button type="submit" className="kv-btn" data-kv-submit>{t.t(failure ? 'store4a.mutate.retry' : 'store4a.review.submit')}</button>
        </form>
        <Link href={id ? accountHref(chrome, { edit: id }, { k: key }) : accountHref(chrome, 'addresses/new', { k: key })} className="kv-btn--link" data-kv-back="edit">{t.t('store4a.review.back')}</Link>
        <RefusalList surface="address_form" />
      </section>
    );
  }

  const err = (f: keyof AccountAddressValues) => errors[f] ? <p className="kv-form__error" role="alert" data-kv-field-error={f}>{t.t(accountAddressFieldKey(errors[f]!))}</p> : null;
  return (
    <section className="kv-address-form" data-kv-screen="address-form" data-kv-mode={mode} data-kv-chrome={chromeField(chrome)}>
      {crumbs}<h1>{title}</h1>
      {Object.keys(errors).length > 0 && <p className="kv-form__error" role="alert" data-kv-state="form-error">{t.t('store4a.form.fixBelow')}</p>}
      <form action={reviewAddressAction} className="kv-form" data-kv-form="address">
        <input type="hidden" name="chrome" value={chromeField(chrome)} />
        {id && <input type="hidden" name="id" value={id} />}
        <input type="hidden" name="key" value={key} />
        <label htmlFor="ad-label" className="kv-form__label">{t.t('store4a.form.label')}</label>
        <select id="ad-label" name="labelId" className="kv-field__input" defaultValue={values.labelId}>
          <option value="">{t.t('store4a.form.noLabel')}</option>
          {vocab.map((v) => <option key={v.id} value={v.id} data-kv-label-code={v.code}>{labelText(v.code, v.name, (k) => t.t(k))}</option>)}
        </select>
        {err('labelId')}
        <label htmlFor="ad-l1" className="kv-form__label">{t.t('account.line1')}</label>
        <input id="ad-l1" name="line1" className="kv-field__input" defaultValue={values.line1} autoComplete="address-line1" />
        {err('line1')}
        <label htmlFor="ad-l2" className="kv-form__label">{t.t('account.line2')}</label>
        <input id="ad-l2" name="line2" className="kv-field__input" defaultValue={values.line2} autoComplete="address-line2" />
        <label htmlFor="ad-vil" className="kv-form__label">{t.t('account.village')}</label>
        <input id="ad-vil" name="village" className="kv-field__input" defaultValue={values.village} autoComplete="address-level2" />
        <label htmlFor="ad-pin" className="kv-form__label">{t.t('store4a.form.pincode')}</label>
        <input id="ad-pin" name="pincode" className="kv-field__input" inputMode="numeric" pattern="\d{4,10}" defaultValue={values.pincode} autoComplete="postal-code" />
        {err('pincode')}
        <label htmlFor="ad-cc" className="kv-form__label">{t.t('account.countryCode')}</label>
        <input id="ad-cc" name="countryCode" className="kv-field__input" defaultValue={values.countryCode} maxLength={2} autoCapitalize="characters" autoComplete="country" />
        {err('countryCode')}
        <label htmlFor="ad-cn" className="kv-form__label">{t.t('account.contactName')}</label>
        <input id="ad-cn" name="contactName" className="kv-field__input" defaultValue={values.contactName} autoComplete="name" />
        <label htmlFor="ad-cp" className="kv-form__label">{t.t('account.contactPhone')}</label>
        <input id="ad-cp" name="contactPhone" className="kv-field__input" inputMode="tel" defaultValue={values.contactPhone} autoComplete="tel" />
        {current?.contactPhone && <p className="kv-detail__muted" data-kv-phone-kept>{t.t('store4a.form.phoneKept', { masked: maskForDisplay(current.contactPhone) })}</p>}
        {err('contactPhone')}
        <label htmlFor="ad-note" className="kv-form__label">{t.t('store4a.form.note')}</label>
        <textarea id="ad-note" name="deliveryNote" className="kv-field__input" maxLength={DELIVERY_NOTE_MAX + 20} defaultValue={values.deliveryNote} />
        <p className="kv-detail__muted">{t.t('store4a.form.noteHint', { max: String(DELIVERY_NOTE_MAX) })}</p>
        {err('deliveryNote')}
        <button type="submit" className="kv-btn" data-kv-review-cta>{t.t('store4a.form.review')}</button>
      </form>
      <Link href={accountHref(chrome, 'addresses')} className="kv-btn--link">{t.t('store4a.form.backToBook')}</Link>
      <RefusalList surface="address_form" />
    </section>
  );
}
