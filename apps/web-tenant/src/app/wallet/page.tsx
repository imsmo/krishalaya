// apps/web-tenant/src/app/wallet/page.tsx · the tenant's wallet (balance + ledger statement). Server-first,
// requireSession-gated. Read-only CQRS projection of the wallet-service double-entry ledger (Law 2/11 — this NEVER
// moves money): wallet.balance gives the reconciled available + held figure (server-truth, never computed here),
// wallet.ledger gives the per-entry statement with a server-computed running balance (balanceAfterMinor). Money via
// formatMoneyMinor from bigint minor-unit strings (signed). Each read degrades independently (Law 12); noindex.
//
// P1-6: previously this shipped the payments list only with a "balance unavailable" note, because the seller SDK
// exposed no wallet-balance/ledger read. The SDK now has wallet.balance + wallet.ledger (both the caller's OWN
// wallet, server re-resolves the subject from the token — zero IDOR), so the real ledger-derived balance and the
// running-balance statement are shown. No figure is computed client-side; the held amount is shown but flagged as
// reserved (not withdrawable).
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { WalletBalance, WalletLedgerEntry } from '@krishalaya/sdk-js';
import { presentLedgerEntry, totalWalletMinor } from '../../features/wallet/ledger';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wallet.title'), robots: { index: false, follow: false } };
}

export default async function WalletPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/wallet');
  const t = getTranslator();
  const lang = getLang();

  let balance: WalletBalance | null = null;
  let items: WalletLedgerEntry[] = []; let nextCursor: string | null = null; let failed = false;
  const [balRes, ledRes] = await Promise.allSettled([
    tenantClient().wallet.balance(),
    tenantClient().wallet.ledger(searchParams.cursor, 50),
  ]);
  if (balRes.status === 'fulfilled') balance = balRes.value;
  if (ledRes.status === 'fulfilled') { items = ledRes.value.items; nextCursor = ledRes.value.nextCursor; } else { failed = true; }

  const ccy = balance?.currencyCode ?? 'INR';

  return (
    <section>
      <h1>{t.t('wallet.title')}</h1>
      <p className="kv-muted">{t.t('wallet.intro')}</p>

      <div className="kv-card kv-wallet__balance">
        <h2 className="kv-card__title">{t.t('wallet.balanceTitle')}</h2>
        {balance ? (
          <>
            <p className="kv-wallet__total">{formatMoneyMinor(totalWalletMinor(balance.availableMinor, balance.heldMinor), ccy, lang)}
              {balance.isFrozen && <span className="kv-badge kv-badge--frozen">{t.t('wallet.frozen')}</span>}
            </p>
            <dl className="kv-wallet__split">
              <div><dt>{t.t('wallet.available')}</dt><dd>{formatMoneyMinor(balance.availableMinor, ccy, lang)}</dd></div>
              <div><dt>{t.t('wallet.held')}</dt><dd>{formatMoneyMinor(balance.heldMinor, ccy, lang)}</dd></div>
            </dl>
            <p className="kv-field__hint kv-note">{t.t('wallet.heldHint')}</p>
          </>
        ) : (
          <p className="kv-muted">{t.t('wallet.balanceLoadError')}</p>
        )}
      </div>

      <h2 className="kv-section-title">{t.t('wallet.statement')}</h2>
      {failed ? <p className="kv-error" role="alert">{t.t('wallet.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('wallet.empty')}
          columns={[
            { header: t.t('wallet.colDate'), cell: (e) => (e.createdAt ? formatDate(e.createdAt, lang) : t.t('common.dash')) },
            { header: t.t('wallet.colType'), cell: (e) => <span className="kv-badge">{e.txnType ?? e.description ?? t.t('common.dash')}</span> },
            { header: t.t('wallet.colAmount'), cell: (e) => {
              const v = presentLedgerEntry(e);
              return <span className={v.tone === 'credit' ? 'kv-amount--credit' : v.tone === 'debit' ? 'kv-amount--debit' : ''}>{formatMoneyMinor(v.amountMinor, e.currencyCode, lang)}</span>;
            } },
            { header: t.t('wallet.colBalance'), cell: (e) => formatMoneyMinor(e.balanceAfterMinor, e.currencyCode, lang) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/wallet?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
