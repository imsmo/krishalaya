// apps/web-tenant/src/app/wallet/transactions/page.tsx · W144 — the ledger view (PC-56 TENANT-4a).
// Server-first, requireSession-gated, noindex, every string via i18n. Read-only by construction: there is
// no edit control on this page, no update route in the API, and 0077 revoked UPDATE/DELETE on
// ledger_entries from kv_app and made the table append-only by trigger. W144 says it plainly — "mistakes
// are corrected by reversal transactions, so the history always tells the whole story" — and this is the
// one screen in the console where that is true three layers down rather than by convention.
//
// PARITY-DECOR, RECORDED: the canon's "‹ 1 2 … 74 ›" pager and its rows-per-page select are refused. This
// is the roster rule's SIXTH application: a page number over an append-only ledger is a promise that row
// 1,842 stays on page 74, and every new entry breaks it. Keyset only, forward and back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DataTable } from '../../../components/DataTable';
import {
  ORG_ACCOUNTS, accountFilter, defaultWindow, direction, exportBlockedBy, exportRefusalKey,
  isAllowedWindow, isIsoDate, referenceHref, LEDGER_HAS_NO_EDIT,
} from '../../../features/wallet/org-console';
import { exportLedgerAction } from './actions';
import type { OrgLedgerRow } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wal.ledgerTitle'), robots: { index: false, follow: false } };
}

export default async function WalletTransactionsPage({ searchParams }: {
  searchParams: { cursor?: string; account?: string; type?: string; from?: string; to?: string; ok?: string; error?: string };
}) {
  await requireSession('/wallet/transactions');
  const t = getTranslator();
  const lang = getLang();
  const canView = tenantHasPerm('wallet.org_view');

  if (!canView) {
    return (
      <section>
        <h1>{t.t('wal.ledgerTitle')}</h1>
        <p className="kv-empty" role="status">{t.t('wal.restricted')}</p>
      </section>
    );
  }

  const win = defaultWindow(new Date());
  const from = isIsoDate(searchParams.from) ? searchParams.from! : win.from;
  const to = isIsoDate(searchParams.to) ? searchParams.to! : win.to;
  const account = accountFilter(searchParams.account);
  const type = searchParams.type || undefined;

  let items: OrgLedgerRow[] = [];
  let nextCursor: string | null = null;
  let clamped = false;
  let failed = false;
  let types: Array<{ code: string; count: number }> = [];

  const [ledRes, typeRes] = await Promise.allSettled([
    tenantClient().orgWallet.ledger({ cursor: searchParams.cursor, limit: 50, account: account ?? undefined, type, from, to }),
    tenantClient().orgWallet.txnTypes(),
  ]);
  if (ledRes.status === 'fulfilled') {
    items = ledRes.value.items;
    nextCursor = ledRes.value.nextCursor;
    clamped = ledRes.value.window?.clamped === true;
  } else failed = true;
  if (typeRes.status === 'fulfilled') types = typeRes.value;

  const blocked = exportBlockedBy({ rowsInView: items.length, window: { from, to } }, { canView });
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { account: account ?? undefined, type, from, to, ...over };
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    return p.toString();
  };

  return (
    <section>
      <h1>{t.t('wal.ledgerTitle')}</h1>
      <p className="kv-muted">{t.t('wal.ledgerIntro')}</p>

      {/* Filters as a GET form (the house pattern) — and submitting one drops the cursor, because a filter
          applied to page four of a keyset walk would silently skip everything before it. */}
      <form method="get" className="kv-filters">
        <label htmlFor="account">{t.t('wal.filterAccount')}</label>
        <select id="account" name="account" defaultValue={account ?? ''}>
          <option value="">{t.t('wal.filterAllAccounts')}</option>
          {ORG_ACCOUNTS.map((c) => <option key={c} value={c}>{t.t(`wal.account.${c}`)}</option>)}
        </select>

        <label htmlFor="type">{t.t('wal.filterType')}</label>
        <select id="type" name="type" defaultValue={type ?? ''}>
          <option value="">{t.t('wal.filterAllTypes')}</option>
          {/* Lookup data, from this tenant's OWN rows (Law 6): a new money product appears here with no app change. */}
          {types.map((x) => <option key={x.code} value={x.code}>{`${x.code} (${x.count})`}</option>)}
        </select>

        <label htmlFor="from">{t.t('wal.filterFrom')}</label>
        <input id="from" name="from" type="date" defaultValue={from} />
        <label htmlFor="to">{t.t('wal.filterTo')}</label>
        <input id="to" name="to" type="date" defaultValue={to} />

        <button type="submit" className="kv-btn">{t.t('wal.applyFilters')}</button>
        {!isAllowedWindow(from, to) && <p className="kv-error" role="alert">{t.t('wal.err.windowTooWide')}</p>}
      </form>

      {clamped && <p className="kv-note" role="status">{t.t('wal.windowClamped')}</p>}
      {searchParams.error && <p className="kv-error" role="alert">{t.t(exportRefusalKey(searchParams.error))}</p>}
      {searchParams.ok && <p className="kv-success" role="status">{t.t('wal.exportReady', { rows: searchParams.ok })}</p>}

      {/* W2454/W2455's queued→ready pair, honestly: the export is SYNCHRONOUS here, so there is no queue
          position and no ETA to show. What is real is the receipt — row count, sha256, requester, coverage —
          and that is what the success line above carries. */}
      {blocked ? (
        <p className="kv-field__hint">{t.t(`wal.exportBlocked.${blocked}`)}</p>
      ) : (
        <form action={exportLedgerAction}>
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          {account && <input type="hidden" name="account" value={account} />}
          {type && <input type="hidden" name="type" value={type} />}
          <button type="submit" className="kv-btn">{t.t('wal.exportCsv')}</button>
        </form>
      )}

      {failed ? <p className="kv-error" role="alert">{t.t('wal.ledgerLoadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t(searchParams.cursor || account || type ? 'wal.ledgerEmptyFiltered' : 'wal.ledgerEmpty')}
          columns={[
            { header: t.t('wal.colWhen'), cell: (e) => formatDate(e.createdAt, lang) },
            { header: t.t('wal.colTxn'), cell: (e) => <span className="kv-mono">{e.txnId.slice(0, 8)}</span> },
            { header: t.t('wal.colType'), cell: (e) => <span className="kv-badge">{e.txnType ?? t.t('common.dash')}</span> },
            { header: t.t('wal.colAccount'), cell: (e) => t.t(`wal.account.${e.accountCode}`) },
            {
              header: t.t('wal.colReference'),
              cell: (e) => {
                const href = referenceHref(e.referenceType, e.referenceId);
                return href ? <Link href={href}>{e.referenceId}</Link> : (e.referenceId ?? t.t('common.dash'));
              },
            },
            {
              header: t.t('wal.colAmount'),
              cell: (e) => <span className={`kv-amount--${direction(e.amountMinor)}`}>{formatMoneyMinor(e.amountMinor, e.currencyCode, lang)}</span>,
            },
            { header: t.t('wal.colBalanceAfter'), cell: (e) => formatMoneyMinor(e.balanceAfterMinor, e.currencyCode, lang) },
          ]}
        />
      )}

      {nextCursor && (
        <p className="kv-pager">
          <Link href={`/wallet/transactions?${qs({ cursor: nextCursor })}`} className="kv-btn--link">{t.t('common.nextPage')}</Link>
        </p>
      )}

      {/* Said on the screen, because it is the reason there is no edit button to look for. */}
      {LEDGER_HAS_NO_EDIT && <p className="kv-field__hint">{t.t('wal.noEditByDesign')}</p>}
      <p className="kv-field__hint">{t.t('wal.keysetOnly')}</p>
    </section>
  );
}
