// apps/web-tenant/src/app/payouts/my/page.tsx · MOVED HERE BY PC-56 TENANT-4b, unchanged in behaviour.
// This is the signed-in user's OWN withdrawal surface (request money from your wallet to your bank, manage
// your tokenised destinations). It used to sit at /payouts, under a sidebar reading "Money > Payouts", where
// W145's subject is the ORGANISATION's outbound queue — 42 farmers, the wage lane, the milk-bill cycle. Same
// wrong-subject defect TENANT-4a found on the wallet, so the org queue took /payouts and this kept working.
// apps/web-tenant/src/app/payouts/page.tsx · the tenant's money-OUT surface. Server-first, requireSession-gated.
// Loads the payout history (payouts.list, keyset) + the tokenised destinations (bankAccounts.list) in parallel,
// each degrading independently (Law 12). Offers: add a destination (by its gateway vaultRef — never a raw account
// number) and request a payout to a chosen destination (amount in major units, parsed float-free → minor string).
// Money via formatMoneyMinor; all copy via i18n; noindex.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { bankLabel } from '../../../features/payouts/form';
import { requestPayoutAction, addBankAccountAction } from './actions';
import type { PayoutSummary, BankAccount } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('payouts.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['amount', 'account', 'payout', 'bank_kind', 'bank_vaultRef', 'bank_upi', 'bank_bank', 'bank_failed']);
const OK = new Set(['requested', 'bank_added']);

export default async function PayoutsPage({ searchParams }: { searchParams: { cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/payouts/my');
  const t = getTranslator();
  const lang = getLang();

  let payouts: PayoutSummary[] = []; let nextCursor: string | null = null; let payoutsFailed = false;
  let accounts: BankAccount[] = []; let accountsFailed = false;
  const [pRes, aRes] = await Promise.allSettled([
    tenantClient().payouts.list(searchParams.cursor, 50),
    tenantClient().bankAccounts.list(),
  ]);
  if (pRes.status === 'fulfilled') { payouts = pRes.value.items; nextCursor = pRes.value.nextCursor; } else { payoutsFailed = true; }
  if (aRes.status === 'fulfilled') { accounts = aRes.value; } else { accountsFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('payouts.title')}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`payouts.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`payouts.error.${errorKey}`)}</p>}

      <h2 className="kv-section-title">{t.t('payouts.accounts')}</h2>
      {accountsFailed ? <p className="kv-error" role="alert">{t.t('payouts.accountsError')}</p> : accounts.length === 0 ? (
        <p className="kv-empty-state">{t.t('payouts.noAccounts')}</p>
      ) : (
        <ul className="kv-account-list">
          {accounts.map((a) => (
            <li key={a.id} className="kv-account">
              <span>{bankLabel(a)}{a.holderName ? ` · ${a.holderName}` : ''}</span>
              {a.isPrimary && <span className="kv-badge">{t.t('payouts.primary')}</span>}
            </li>
          ))}
        </ul>
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('payouts.addAccount')}</summary>
        <p className="kv-field__hint">{t.t('payouts.vaultHint')}</p>
        <form action={addBankAccountAction} className="kv-form">
          <label htmlFor="accountKind" className="kv-field__label">{t.t('payouts.kind')}</label>
          <select id="accountKind" name="accountKind" className="kv-select" defaultValue="bank">
            <option value="bank">{t.t('payouts.kindBank')}</option>
            <option value="upi">{t.t('payouts.kindUpi')}</option>
          </select>
          <label htmlFor="vaultRef" className="kv-field__label">{t.t('payouts.vaultRef')}</label>
          <input id="vaultRef" name="vaultRef" className="kv-input" required />
          <label htmlFor="upiId" className="kv-field__label">{t.t('payouts.upiId')}</label>
          <input id="upiId" name="upiId" className="kv-input" inputMode="email" placeholder="name@bank" />
          <label htmlFor="ifsc" className="kv-field__label">{t.t('payouts.ifsc')}</label>
          <input id="ifsc" name="ifsc" className="kv-input" pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" />
          <label htmlFor="accountLast4" className="kv-field__label">{t.t('payouts.last4')}</label>
          <input id="accountLast4" name="accountLast4" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} />
          <label htmlFor="holderName" className="kv-field__label">{t.t('payouts.holder')}</label>
          <input id="holderName" name="holderName" className="kv-input" />
          <label className="kv-check"><input type="checkbox" name="isPrimary" /> {t.t('payouts.makePrimary')}</label>
          <button type="submit" className="kv-btn">{t.t('payouts.saveAccount')}</button>
        </form>
      </details>

      {accounts.length > 0 && (
        <form action={requestPayoutAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('payouts.request')}</h2>
          <label htmlFor="amountMajor" className="kv-field__label">{t.t('payouts.amount')}</label>
          <input id="amountMajor" name="amountMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" className="kv-input" required />
          <label htmlFor="bankAccountId" className="kv-field__label">{t.t('payouts.toAccount')}</label>
          <select id="bankAccountId" name="bankAccountId" className="kv-select" required defaultValue="">
            <option value="" disabled>{t.t('payouts.selectAccount')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{bankLabel(a)}</option>)}
          </select>
          <button type="submit" className="kv-btn">{t.t('payouts.requestBtn')}</button>
        </form>
      )}

      <h2 className="kv-section-title">{t.t('payouts.history')}</h2>
      {payoutsFailed ? <p className="kv-error" role="alert">{t.t('payouts.historyError')}</p> : (
        <DataTable
          rows={payouts}
          empty={t.t('payouts.noHistory')}
          columns={[
            { header: t.t('payouts.colAmount'), cell: (p) => formatMoneyMinor(p.amountMinor, p.currencyCode, lang) },
            { header: t.t('payouts.colStatus'), cell: (p) => <span className="kv-badge">{p.status}</span> },
            { header: t.t('payouts.colPurpose'), cell: (p) => p.purpose ?? t.t('common.dash') },
            { header: t.t('payouts.colDate'), cell: (p) => (p.createdAt ? formatDate(p.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/payouts?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
