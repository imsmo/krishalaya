// apps/web-storefront/src/components/account/AddressesScreen.tsx · PC-56 STORE-4a · C3 — canon W301 "Addresses" + the MUTATE chain (W3038 confirm
// → W3039 success / W3040 failure), under whichever chrome the person is in (one copy; `chrome` builds the hrefs). PROTECTED + dynamic.
//   • the book as cards (the API's order — default first, then newest; bounded at the API's 50): the label by code ×3, the lines, the country,
//     the receiver with the phone MASKED, the delivery note, the default badge; Edit → the form chain; Remove / Make default → the confirm;
//   • the confirm (W3038, `?confirm=remove|default&id=…`, a key minted at render, reused on Retry): remove says what is TRUE — "orders already
//     heading there keep their copy" — and, for the default, "your newest other address becomes the default"; make-default says before → after;
//   • W3039: the outcome said on the book (`?ok=…`; a copied edit → "orders already placed keep the old address", TRUE — HOTFIX-6);
//   • W3040: the named failure (not found / concurrency / server) with Retry → the same confirm, the same key;
//   • empty → "add one now — your first checkout also adds one" with the add CTA; a load error is not an empty book (Retry reloads);
//   • "Unserviceable pincode", "Flagged off", the driver's view claim refused by name.
import { randomUUID } from 'crypto';
import Link from 'next/link';
import type { Address, LookupValue } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { reloadHref } from '../../features/home/load-result';
import { accountHref, chromeField, readOne, type AccountChrome } from '../../features/store4a/account';
import { bookCard, labelText, removesDefault, readFailure, readKey, BOOK_OK, MUTATE_ACTS, type BookCard } from '../../features/store4a/addresses';
import { removeAddressAction, makeDefaultAddressAction } from '../../app/(platform)/account/addresses/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function AddressesScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  await requireSession(accountHref(chrome, 'addresses'));
  const t = getTranslator();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  let rows: Address[] = []; let failed = false;
  try { rows = await api.addresses.list(); } catch { failed = true; }
  let vocab: LookupValue[] = [];
  try { vocab = await api.lookups.values('address_label'); } catch { vocab = []; }
  const names = new Map(vocab.map((v) => [v.code, v.name] as const));
  const cards: BookCard[] = rows.map(bookCard);
  const label = (c: BookCard) => labelText(c.labelCode, c.labelCode ? names.get(c.labelCode) ?? null : null, (k) => t.t(k));
  const ok = readOne(searchParams.ok, BOOK_OK);
  const okId = one(searchParams.id);
  const confirm = readOne(searchParams.confirm, MUTATE_ACTS);
  const confirmId = one(searchParams.id);
  const target = confirm && confirmId && UUID.test(confirmId) ? cards.find((c) => c.id === confirmId) ?? null : null;
  const failure = readFailure(searchParams.failure);
  const key = readKey(searchParams.k) ?? `address:${randomUUID()}`;   // minted at render; a Retry carries the same one back
  const current = cards.find((c) => c.isDefault) ?? null;
  const cardLine = (c: BookCard) => [label(c), c.lines].filter(Boolean).join(' · ');

  const head = (
    <>
      <nav aria-label={t.t('store4a.crumb.label')}><ol className="kv-crumb"><li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li><li aria-current="page">{t.t('store4a.addresses.title')}</li></ol></nav>
      <h1>{t.t('store4a.addresses.title')}</h1>
      <p className="kv-detail__muted">{t.t('store4a.addresses.lead')}</p>
      <Link href={accountHref(chrome, 'addresses/new')} className="kv-btn" data-kv-cta="add">{t.t('store4a.addresses.add')}</Link>
    </>
  );
  if (failed) {
    return (
      <section className="kv-addresses" data-kv-screen="addresses" data-kv-chrome={chromeField(chrome)}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('account.addressesError')}</p>
          <a href={reloadHref(accountHref(chrome, 'addresses'), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="addresses" />
      </section>
    );
  }
  return (
    <section className="kv-addresses" data-kv-screen="addresses" data-kv-chrome={chromeField(chrome)}>
      {head}
      {ok && (
        <div className="kv-form__notice" role="status" data-kv-ok={ok}>
          <p>{t.t(`store4a.addresses.ok.${ok}`)}</p>
          {ok === 'copied' && <p data-kv-copied>{t.t('store4a.addresses.copiedKeep')}</p>}
          {ok === 'removed' && okId && UUID.test(okId) && <p data-kv-new-default={okId}>{t.t('store4a.addresses.newDefault')}</p>}
        </div>
      )}

      {/* W3038 the confirm — W3040 its named failure */}
      {confirm && target && (
        <div className="kv-form__card" role="region" aria-label={t.t(`store4a.mutate.${confirm}.title`)} data-kv-confirm={confirm} data-kv-target={target.id}>
          <h2>{t.t(`store4a.mutate.${confirm}.title`)}</h2>
          <p><strong>{cardLine(target)}</strong></p>
          {confirm === 'remove' && <p data-kv-keep-copy>{t.t('store4a.mutate.remove.keepCopy')}</p>}
          {confirm === 'remove' && removesDefault(cards, target.id) && <p data-kv-reassign>{t.t(cards.length > 1 ? 'store4a.mutate.remove.reassign' : 'store4a.mutate.remove.noneLeft')}</p>}
          {confirm === 'default' && (
            <dl className="kv-detail__facts" data-kv-before-after>
              <div><dt>{t.t('store4a.mutate.default.before')}</dt><dd>{current ? cardLine(current) : t.t('store4a.mutate.default.noneBefore')}</dd></div>
              <div><dt>{t.t('store4a.mutate.default.after')}</dt><dd>{cardLine(target)}</dd></div>
            </dl>
          )}
          {failure && <p className="kv-form__error" role="alert" data-kv-failure={failure}>{t.t(`store4a.failure.${failure}`)}</p>}
          <form action={confirm === 'remove' ? removeAddressAction : makeDefaultAddressAction} className="kv-inline-form">
            <input type="hidden" name="chrome" value={chromeField(chrome)} />
            <input type="hidden" name="id" value={target.id} />
            <input type="hidden" name="key" value={key} />
            <button type="submit" className="kv-btn" data-kv-proceed={confirm}>{t.t(failure ? 'store4a.mutate.retry' : `store4a.mutate.${confirm}.proceed`)}</button>
          </form>
          <Link href={accountHref(chrome, 'addresses')} className="kv-btn--link" data-kv-cancel>{t.t('store4a.mutate.cancel')}</Link>
        </div>
      )}
      {confirm && !target && <p className="kv-form__error" role="alert" data-kv-failure="not_found">{t.t('store4a.failure.not_found')}</p>}

      {cards.length === 0 ? (
        <div className="kv-state" role="status" data-kv-state="empty">
          <p>{t.t('store4a.addresses.empty')}</p>
          <Link href={accountHref(chrome, 'addresses/new')} className="kv-btn" data-kv-cta="add-empty">{t.t('store4a.addresses.add')}</Link>
        </div>
      ) : (
        <ul className="kv-address-list" data-kv-count={cards.length}>
          {cards.map((c) => (
            <li key={c.id} className="kv-address-list__item" data-kv-address={c.id} data-kv-label={c.labelCode ?? ''}>
              <p>
                {label(c) && <span className="kv-chip" data-kv-label-text>{label(c)}</span>}{' '}
                {c.isDefault && <span className="kv-badge" data-kv-default>{t.t('account.default')}</span>}{' '}
                <strong>{c.lines}</strong>{c.countryCode ? <> · <span data-kv-country>{c.countryCode}</span></> : null}
              </p>
              {(c.receiver || c.phoneMasked) && <p className="kv-detail__muted" data-kv-receiver={c.id}>{t.t('store4a.addresses.receiving', { who: [c.receiver, c.phoneMasked].filter(Boolean).join(' · ') })}</p>}
              {c.deliveryNote && <p className="kv-detail__muted" data-kv-note={c.id}>{t.t('store4a.addresses.note', { note: c.deliveryNote })}</p>}
              <div className="kv-cart__actions">
                <Link href={accountHref(chrome, { edit: c.id })} className="kv-btn--link" data-kv-edit={c.id}>{t.t('store4a.addresses.edit')}</Link>
                {!c.isDefault && <Link href={accountHref(chrome, 'addresses', { confirm: 'default', id: c.id })} className="kv-btn--link" data-kv-make-default={c.id}>{t.t('account.makeDefault')}</Link>}
                <Link href={accountHref(chrome, 'addresses', { confirm: 'remove', id: c.id })} className="kv-btn--link" data-kv-remove={c.id}>{t.t('account.remove')}</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {cards.length >= 50 && <p className="kv-detail__muted" data-kv-capped>{t.t('store4a.addresses.capped')}</p>}
      <p className="kv-detail__muted">{t.t('store4a.addresses.labelsFootnote')}</p>
      <RefusalList surface="addresses" />
    </section>
  );
}
