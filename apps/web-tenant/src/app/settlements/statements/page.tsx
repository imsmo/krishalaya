// apps/web-tenant/src/app/settlements/statements/page.tsx · W148 — statements (PC-56 TENANT-4c).
// Server-first, requireSession-gated, noindex, every string via i18n.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • whether a statement's period is a CYCLE or one of the DAILY documents the nightly job produced before
//     this wave — W148 shows fortnightly periods, and relabelling a Tuesday as a fortnight would tell a
//     member their trade sits in a document that does not contain it;
//   • how far the gapless numbering it stakes an audit claim on actually reaches: the series is per period,
//     unique per tenant, and the counter serialises so a rolled-back transaction leaves no hole;
//   • that the organisation's monthly statement is DERIVED from the append-only ledger rather than stored —
//     reproducible from the book of record, and carrying no number, because no series exists for it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DataTable } from '../../../components/DataTable';
import { closedMonths, pdfStateKey, periodKindKey, refusalKey, rowNeedsAttention } from '../../../features/settlements/console';
import { orgStatementAction } from '../actions';
import type { SettlementStatementsPage } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('stl.statementsTitle'), robots: { index: false, follow: false } };
}

export default async function StatementsPage({ searchParams }: {
  searchParams: { cursor?: string; cycleId?: string; ok?: string; error?: string; rows?: string; period?: string };
}) {
  await requireSession('/settlements/statements');
  const t = getTranslator();
  const lang = getLang();
  const canClose = tenantHasPerm('settlement.close');

  if (!canClose) {
    return (
      <section>
        <h1>{t.t('stl.statementsTitle')}</h1>
        {/* W148: "Org statements need finance scope; seller statements are visible to that seller and
            finance staff only." The seller's own copy lives in the member app. */}
        <p className="kv-empty" role="status">{t.t('stl.statementsRestricted')}</p>
      </section>
    );
  }

  let page: SettlementStatementsPage | null = null;
  try {
    page = await tenantClient().settlements.statements({ cursor: searchParams.cursor, cycleId: searchParams.cycleId, limit: 50 });
  } catch {
    page = null;
  }

  const months = closedMonths(new Date());

  return (
    <section>
      <h1>{t.t('stl.statementsTitle')}</h1>
      <p className="kv-muted">{t.t('stl.statementsIntro')}</p>

      {searchParams.error && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.error))}</p>}
      {searchParams.ok === 'orgStatement' && (
        <p className="kv-success" role="status">{t.t('stl.ok.orgStatement', { period: searchParams.period ?? '', rows: searchParams.rows ?? '0' })}</p>
      )}

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('stl.orgStatementTitle')}</h2>
        {/* Derived, not stored — said on the screen instead of implying a numbered artefact. */}
        <p className="kv-field__hint">{t.t('stl.orgStatementDerived')}</p>
        <form action={orgStatementAction}>
          <label htmlFor="period" className="kv-field__label">{t.t('stl.orgStatementMonth')}</label>
          <select id="period" name="period" defaultValue={months[0]}>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('stl.orgStatementOpenMonth')}</p>
          <button type="submit" className="kv-btn">{t.t('stl.orgStatementDownload')}</button>
        </form>
      </div>

      {page && page.counts.legacyDaily > 0 && (
        <p className="kv-note" role="status">
          {t.t('stl.mixedPeriods', { cycle: String(page.counts.cycleBased), daily: String(page.counts.legacyDaily) })}
        </p>
      )}

      <h2 className="kv-section-title">{t.t('stl.sellerStatements')}</h2>
      {!page ? <p className="kv-error" role="alert">{t.t('stl.statementsLoadError')}</p> : (
        <DataTable
          rows={page.items}
          empty={t.t('stl.statementsEmpty')}
          columns={[
            { header: t.t('stl.colStatementNo'), cell: (r) => <span className="kv-mono">{r.statementNo}</span> },
            { header: t.t('stl.colSeller'), cell: (r) => r.sellerName ?? r.sellerUserId.slice(0, 8) },
            {
              header: t.t('stl.colPeriod'),
              cell: (r) => (
                <>
                  {r.periodStart} → {r.periodEnd}
                  {/* A daily statement is NEVER presented as a cycle one. */}
                  <span className="kv-badge">{t.t(periodKindKey(r.periodKind), { days: String(r.dayCount) })}</span>
                </>
              ),
            },
            { header: t.t('stl.colGross'), cell: (r) => formatMoneyMinor(r.grossMinor, 'INR', lang) },
            {
              header: t.t('stl.colNet'),
              cell: (r) => (
                <>
                  {formatMoneyMinor(r.netMinor, 'INR', lang)}
                  {rowNeedsAttention(r) && <span className="kv-badge kv-badge--warn">{t.t('stl.netMismatch')}</span>}
                </>
              ),
            },
            { header: t.t('stl.colPdf'), cell: (r) => t.t(pdfStateKey(r.hasPdf)) },
            { header: t.t('stl.colIssued'), cell: (r) => formatDate(r.createdAt, lang) },
          ]}
        />
      )}

      {page?.nextCursor && (
        <p className="kv-pager">
          <Link href={`/settlements/statements?cursor=${encodeURIComponent(page.nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</Link>
        </p>
      )}

      <p className="kv-field__hint">{t.t('stl.gaplessNote')}</p>
      <p className="kv-pager"><Link href="/settlements" className="kv-btn--link">{t.t('stl.backToCycle')}</Link></p>
    </section>
  );
}
