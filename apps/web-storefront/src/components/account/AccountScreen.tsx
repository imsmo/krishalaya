// apps/web-storefront/src/components/account/AccountScreen.tsx · PC-56 STORE-4a · C2 — canon W300 "Account", under WHICHEVER chrome the person is in
// (the platform's /account and an organisation's /<slug>/account render THIS component — one copy; `chrome` builds the hrefs). PROTECTED +
// dynamic. Each panel degrades on its own (Law 12): a failed read says so — it is never drawn as "none".
//   • profile — the name (from `fullName`, never "—" for a name held), the phone and email MASKED ("Reveal" refused by name, founder D7; the
//     number is changed from the app's change-phone screen), the account language as a LABEL beside this site's language, and what notices use;
//   • business details — the legal name, the masked GSTIN and its review status; "on every invoice automatically" ONLY when verified (founder
//     D5); the `kyc` switch OFF → said; nothing on file → said; the auctions / licence claims refused by name;
//   • what organisations see — your name on their order list, never your phone ("buying history" refused);
//   • shortcuts — Addresses (n, "50+" at the API's cap), Notification preferences (the existing door), Orders · offers · bids (the doors);
//   • saved payment methods — the masked mandates and payout instruments (founder D6), cards refused by name;
//   • the wallet line — "Wallet balance <amount>" in the currency of the person's own money (founder D8), read-only;
//   • the data rights — "Download my data" (W3029 / W3030), "Delete my account…" (the deletion request), the request history;
//   • the profile edit (labels, not codes) with the audit sentence (TRUE: `user.profile_updated`);
//   • a load error with a Retry that reloads (W3031–W3033 DECOR).
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { UserProfile, Address, PrivacyRequest, PrivacyCommitments, SavedInstruments, WalletBalance } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { serverClient, sessionTenantClient, publicClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { moneyText } from '../../features/discovery/money';
import { reloadHref } from '../../features/home/load-result';
import {
  accountHref, chromeField, shortcutHrefs, profileView, businessView, methodRows, walletCurrency, addressCount, readOne, languageKey,
  dsrStatusKey, dsrKindKey, ACCOUNT_LANGUAGES, ACCOUNT_OK, ACCOUNT_ERRORS, type AccountChrome,
} from '../../features/store4a/account';
import { updateProfileAction } from '../../app/(platform)/account/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
type Loaded<T> = { ok: true; value: T } | { ok: false; status: number | null };
async function load<T>(p: Promise<T>): Promise<Loaded<T>> {
  try { return { ok: true, value: await p }; } catch (e) { return { ok: false, status: e instanceof SdkError ? e.status : null }; }
}

export async function AccountScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  await requireSession(accountHref(chrome));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  const [meR, addrR, kycR, instR, reqR, comR] = await Promise.all([
    load<UserProfile>(api.auth.me()), load<Address[]>(api.addresses.list()), load(api.kyc.businessStatus()),
    load<SavedInstruments>(api.wallet.instruments()), load<PrivacyRequest[]>(api.privacy.myRequests()), load<PrivacyCommitments>(api.privacy.commitments()),
  ]);
  // the wallet line's currency (founder D8): the person's own money's currency, else the store's — named; never a literal
  let storeCurrency: string | null = null;
  if (!(comR.ok && comR.value.currencyCode)) {
    try { storeCurrency = (await (chrome.kind === 'tenant' ? publicClient(chrome.slug) : sessionTenantClient()).storefront.profile()).currencyCode ?? null; } catch { storeCurrency = null; }
  }
  const wc = walletCurrency(comR.ok ? comR.value.currencyCode : null, storeCurrency);
  const balR: Loaded<WalletBalance> | null = wc ? await load(api.wallet.balance(wc.currency)) : null;

  const me = meR.ok ? profileView(meR.value) : null;
  const business = businessView(kycR.ok ? { ok: true, value: kycR.value } : { ok: false, status: kycR.status });
  const methods = instR.ok ? methodRows(instR.value) : [];
  const count = addrR.ok ? addressCount(addrR.value.length) : null;
  const requests = reqR.ok ? reqR.value : [];
  const links = shortcutHrefs(chrome);
  const okKey = readOne(searchParams.ok, ACCOUNT_OK);
  const errKey = readOne(searchParams.error, ACCOUNT_ERRORS);
  const uiLangKey = languageKey(lang);
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium' }) : '');

  return (
    <section className="kv-account" data-kv-screen="account" data-kv-chrome={chromeField(chrome)}>
      <h1>{t.t('account.title')}</h1>
      {okKey && <p className="kv-form__notice" role="status" data-kv-ok={okKey}>{t.t(`account.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-form__error" role="alert" data-kv-error={errKey}>{t.t(`account.error.${errKey}`)}</p>}

      {/* PROFILE */}
      <h2>{t.t('account.profile')}</h2>
      {me ? (
        <dl className="kv-detail__facts" data-kv-panel="profile">
          <div><dt>{t.t('account.name')}</dt><dd data-kv-name>{me.name ?? t.t('store4a.profile.notSet')}</dd></div>
          <div><dt>{t.t('store4a.profile.phone')}</dt><dd data-kv-phone>{me.phone ?? t.t('store4a.profile.notSet')}</dd></div>
          <div><dt>{t.t('account.email')}</dt><dd data-kv-email>{me.email ?? t.t('store4a.profile.notSet')}</dd></div>
          <div><dt>{t.t('account.language')}</dt><dd data-kv-language={me.languageCode ?? ''}>{me.languageKey ? t.t(me.languageKey) : (me.languageCode ?? t.t('store4a.profile.notSet'))}</dd></div>
          <div><dt>{t.t('store4a.profile.siteLanguage')}</dt><dd data-kv-site-language={lang}>{uiLangKey ? t.t(uiLangKey) : lang}</dd></div>
        </dl>
      ) : (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="profile-error">
          <p>{t.t('account.profileError')}</p>
          <a href={reloadHref(accountHref(chrome), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
      )}
      {me && <p className="kv-detail__muted" data-kv-notices="account-language">{t.t('store4a.profile.noticesLanguage')}</p>}
      {me && <p className="kv-detail__muted" data-kv-change-phone>{t.t('store4a.profile.changePhone')}</p>}

      {/* BUSINESS DETAILS (founder D5) */}
      <h2>{t.t('store4a.business.title')}</h2>
      <div data-kv-panel="business" data-kv-business={business.state}>
        {business.state === 'off' && <p className="kv-detail__muted">{t.t('store4a.business.off')}</p>}
        {business.state === 'error' && <p className="kv-form__error" role="alert">{t.t('store4a.business.error')}</p>}
        {business.state === 'none' && <p className="kv-detail__muted">{t.t('store4a.business.none')}</p>}
        {(['pending', 'verified', 'rejected', 'expired'] as const).includes(business.state as 'pending') && (
          <dl className="kv-detail__facts">
            {business.legalName && <div><dt>{t.t('store4a.business.legalName')}</dt><dd>{business.legalName}</dd></div>}
            {business.gstinMasked && <div><dt>{t.t('store4a.business.gstin')}</dt><dd><code className="kv-mono" data-kv-gstin>{business.gstinMasked}</code></dd></div>}
            <div><dt>{t.t('store4a.business.status')}</dt><dd><span className="kv-chip" data-kv-kyc-status={business.state}>{t.t(`store4a.business.state.${business.state}`)}</span></dd></div>
          </dl>
        )}
        {business.onInvoice && <p data-kv-on-invoice>{t.t('store4a.business.onInvoice')}</p>}
        {(business.state === 'pending' || business.state === 'rejected' || business.state === 'expired') && <p className="kv-detail__muted" data-kv-not-on-invoice>{t.t('store4a.business.notOnInvoice')}</p>}
      </div>
      <p className="kv-detail__muted" data-kv-seen-by="organisations">{t.t('store4a.seenBy')}</p>

      {/* SHORTCUTS */}
      <h2>{t.t('store4a.shortcuts.title')}</h2>
      <ul className="kv-account__shortcuts" data-kv-panel="shortcuts">
        <li><Link href={accountHref(chrome, 'addresses')} data-kv-shortcut="addresses">
          {count ? t.t(count.capped ? 'store4a.shortcuts.addressesCapped' : 'store4a.shortcuts.addresses', { n: formatNumber(count.n, lang) }) : t.t('store4a.shortcuts.addressesUnknown')}
        </Link></li>
        <li><Link href={links.preferences} data-kv-shortcut="preferences">{t.t('store4a.shortcuts.preferences')}</Link></li>
        <li>
          <Link href={links.orders} data-kv-shortcut="orders">{t.t('store4a.shortcuts.orders')}</Link>{' · '}
          <Link href={links.offers} data-kv-shortcut="offers">{t.t('store4a.shortcuts.offers')}</Link>{' · '}
          <Link href={links.bids} data-kv-shortcut="bids">{t.t('store4a.shortcuts.bids')}</Link>
        </li>
      </ul>

      {/* SAVED PAYMENT METHODS (founder D6) */}
      <h2>{t.t('store4a.methods.title')}</h2>
      <div data-kv-panel="methods">
        {!instR.ok ? <p className="kv-form__error" role="alert">{t.t('store4a.methods.error')}</p>
          : methods.length === 0 ? <p className="kv-detail__muted" data-kv-methods="none">{t.t('store4a.methods.none')}</p>
          : (
            <ul>
              {methods.map((m) => (
                <li key={m.id} data-kv-method={m.kind}>
                  {t.t(`store4a.methods.kind.${m.kind}`, { masked: m.masked })}
                  {m.detail ? <> · <code className="kv-mono">{m.detail}</code></> : null}
                </li>
              ))}
            </ul>
          )}
      </div>

      {/* THE WALLET LINE (founder D8) — read-only; no wallet page in this wave */}
      <div data-kv-panel="wallet">
        {!wc ? <p className="kv-detail__muted" data-kv-wallet="none">{t.t('store4a.wallet.none')}</p>
          : !balR || !balR.ok ? <p className="kv-form__error" role="alert" data-kv-wallet="error">{t.t('store4a.wallet.error')}</p>
          : (
            <p data-kv-wallet={wc.source} data-kv-money={balR.value.currencyCode}>
              {t.t('store4a.wallet.balance', { amount: moneyText(balR.value.availableMinor, balR.value.currencyCode, lang) ?? t.t('money.unavailable') })}
              {wc.source === 'store' && <span className="kv-detail__muted"> {t.t('store4a.wallet.storeCurrency')}</span>}
            </p>
          )}
        {comR.ok && comR.value.multiCurrency && <p className="kv-detail__muted" data-kv-wallet="multi">{t.t('store4a.wallet.multiCurrency')}</p>}
        <p className="kv-detail__muted">{t.t('store4a.wallet.payoutOnly')}</p>
      </div>

      {/* DATA RIGHTS */}
      <h2>{t.t('store4a.rights.title')}</h2>
      <ul data-kv-panel="rights">
        <li><Link href={accountHref(chrome, 'data')} className="kv-btn" data-kv-cta="download">{t.t('store4a.rights.download')}</Link></li>
        <li><Link href={accountHref(chrome, 'delete')} className="kv-btn--link" data-kv-cta="delete">{t.t('store4a.rights.delete')}</Link></li>
      </ul>
      {!reqR.ok ? <p className="kv-form__error" role="alert">{t.t('store4a.rights.historyError')}</p>
        : requests.length === 0 ? <p className="kv-detail__muted" data-kv-history="none">{t.t('store4a.rights.historyNone')}</p>
        : (
          <ul className="kv-account__history" data-kv-history={requests.length}>
            {requests.map((r) => (
              <li key={r.id} data-kv-dsr={r.kind} data-kv-dsr-status={r.status}>
                {t.t(dsrKindKey(r.kind))} · <span className="kv-chip">{t.t(dsrStatusKey(r.status))}</span>
                {r.requestedAt ? <> · {t.t('store4a.rights.requestedOn', { date: date(r.requestedAt) })}</> : null}
                {r.kind === 'deletion' && r.coolingEndsAt ? <> · {t.t('store4a.rights.coolingUntil', { date: date(r.coolingEndsAt) })}</> : null}
                {r.kind === 'export' && r.export?.receipt ? <> · {t.t('store4a.rights.receiptLine', { rows: formatNumber(r.export.receipt.rowCount, lang) })} <code className="kv-mono">{r.export.receipt.sha256.slice(0, 12)}…</code></> : null}
              </li>
            ))}
          </ul>
        )}

      {/* THE PROFILE EDIT — audited */}
      <details className="kv-form__card">
        <summary>{t.t('account.editProfile')}</summary>
        <form action={updateProfileAction} className="kv-form" data-kv-form="profile">
          <input type="hidden" name="chrome" value={chromeField(chrome)} />
          <label htmlFor="a-name" className="kv-form__label">{t.t('account.name')}</label>
          <input id="a-name" name="fullName" className="kv-field__input" autoComplete="name" />
          <label htmlFor="a-email" className="kv-form__label">{t.t('account.email')}</label>
          <input id="a-email" name="email" type="email" inputMode="email" autoComplete="email" className="kv-field__input" />
          <label htmlFor="a-lang" className="kv-form__label">{t.t('account.language')}</label>
          <select id="a-lang" name="languageCode" className="kv-field__input" defaultValue="">
            <option value="">{t.t('account.unchanged')}</option>
            {ACCOUNT_LANGUAGES.map((l) => <option key={l} value={l}>{t.t(`store4a.lang.${l}`)}</option>)}
          </select>
          <p className="kv-detail__muted" data-kv-audit>{t.t('store4a.profile.auditSentence')}</p>
          <button type="submit" className="kv-btn">{t.t('account.save')}</button>
        </form>
      </details>
      <RefusalList surface="account" />
    </section>
  );
}
