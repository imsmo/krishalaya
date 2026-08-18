// apps/web-admin/src/app/recon/ledger/page.tsx · W064, the ledger explorer (PC-56 ADMIN-6).
//
// "ledger_transactions + entries — append-only, hash-chained, zero-sum per txn. The single source of money truth."
// This is the first console surface that reads it: the recon repository's own header says it "NEVER touches
// ledger_entries/ledger_transactions", which was the right boundary for recon and is exactly what this crosses, under
// its own permission.
//
// THE MAGNITUDE COLUMN IS NOT A SUM. A healthy transaction's legs sum to ZERO by construction, so a Σ column would
// read ₹0.00 on every row and tell an operator scanning for a large movement nothing at all. Half the absolute total
// is the size of the movement, which is what W064's "Magnitude ₹48,600" means.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { referenceText, txnTypeCell, magnitudeText, windowTooWide, MAX_LIVE_WINDOW_DAYS, type TxnRow } from '../../../features/ledger/ledger';

import { Button, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lg.title'), robots: { index: false, follow: false } };
}

interface Meta {
  nextCursor: string | null;
  window: { from: string; to: string; maxDays: number };
  txnTypes: { code: string; name: string }[];
}

export default async function LedgerExplorerPage({ searchParams }: {
  searchParams: { from?: string; to?: string; txnType?: string; tenantId?: string; accountCode?: string; cursor?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const f = {
    from: searchParams.from?.trim() || undefined,
    to: searchParams.to?.trim() || undefined,
    txnType: searchParams.txnType?.trim() || undefined,
    tenantId: searchParams.tenantId?.trim() || undefined,
    accountCode: searchParams.accountCode?.trim() || undefined,
  };
  const tooWide = windowTooWide(f.from, f.to, new Date());

  let rows: TxnRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  if (!tooWide) {
    try {
      const r = await adminGet<TxnRow[]>('ledger/transactions', { ...f, cursor: searchParams.cursor });
      rows = r.data; meta = r.meta as unknown as Meta;
    } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  }

  const q = (extra: Record<string, string>) => new URLSearchParams({
    ...Object.fromEntries(Object.entries(f).filter(([, v]) => !!v) as [string, string][]), ...extra,
  }).toString();

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon">{t.t('lg.backRecon')}</Link></p>
      <h1>{t.t('lg.heading')}</h1>
      <p className="kv-muted">{t.t('lg.lead')}</p>

      <nav className="kv-filters">
        <Chip as={Link} href="/recon/ledger">{t.t('lg.today')}</Chip>
        <Chip as={Link} href="/recon/accounts">{t.t('lg.navAccounts')}</Chip>
      </nav>

      {/* The query is not SENT when the window is too wide: the point of the rule is to avoid the partition scan, so
          asking the server to refuse would still have cost it. */}
      {tooWide && <p className="kv-error" role="alert">{t.t('lg.windowTooWide', { d: String(MAX_LIVE_WINDOW_DAYS) })}</p>}
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      <form method="get" className="kv-form kv-filters" aria-label={t.t('lg.filters')}>
        <label htmlFor="from" className="kv-field__label">{t.t('lg.from')}</label>
        <input id="from" name="from" className="kv-input kv-input--sm" defaultValue={f.from ?? ''} />
        <label htmlFor="to" className="kv-field__label">{t.t('lg.to')}</label>
        <input id="to" name="to" className="kv-input kv-input--sm" defaultValue={f.to ?? ''} />
        <label htmlFor="txnType" className="kv-field__label">{t.t('lg.txnType')}</label>
        {/* The options are DATA. 0006's own comment: "a new money product is an INSERT, never a code change" — so a
            hardcoded list here would go stale the first time that happens. */}
        <select id="txnType" name="txnType" className="kv-input kv-input--sm" defaultValue={f.txnType ?? ''}>
          <option value="">{t.t('lg.allTypes')}</option>
          {(meta?.txnTypes ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
        </select>
        <label htmlFor="accountCode" className="kv-field__label">{t.t('lg.accountCode')}</label>
        <input id="accountCode" name="accountCode" className="kv-input kv-input--sm" defaultValue={f.accountCode ?? ''} />
        <Button type="submit">{t.t('lg.apply')}</Button>
      </form>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('lg.col.when')}</th><th>{t.t('lg.col.txn')}</th><th>{t.t('lg.col.type')}</th>
          <th>{t.t('lg.col.reference')}</th><th>{t.t('lg.col.legs')}</th><th>{t.t('lg.col.magnitude')}</th>
          <th>{t.t('lg.col.tenant')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const ty = txnTypeCell(r);
            return (
              <tr key={r.id}>
                <td>{r.createdAt}</td>
                <td><Link href={`/recon/ledger/${r.id}`}><code>{r.id.slice(0, 8)}…</code></Link></td>
                {/* An unresolvable type is a data fault, not a transaction without a type. A blank would read as the
                    second. */}
                <td>{ty.known ? ty.text : <StatusPill tone="danger" label={t.t('lg.typeUnresolved')} />}</td>
                <td>{referenceText(r)}</td>
                <td>{r.legCount ?? t.t('common.dash')}</td>
                <td>{magnitudeText(r)}</td>
                <td>{r.tenantId ?? t.t('lg.platform')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && !tooWide && <EmptyState variant="empty" title={t.t('lg.empty')} />}
      {meta?.nextCursor && <p className="kv-pager"><Link href={`/recon/ledger?${q({ cursor: meta.nextCursor })}`}>{t.t('common.next')}</Link></p>}

      <p className="kv-detail__muted">{t.t('lg.typesAreData')}</p>
      <p className="kv-detail__muted">{t.t('lg.signedExportGap')}</p>
    </section>
  );
}
