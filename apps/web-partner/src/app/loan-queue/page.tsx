// apps/web-partner/src/app/loan-queue/page.tsx · PC-56 PARTNER-0 · founder D8 — the partner's loan queue over the PARTNER read
// (`/v1/partner/applications`): only this partner's products, only applications whose applicant consented to THIS partner for THIS
// application — the API decides on the kv_partner axis, never this page. Keyset paging (?cursor=); box chips (review = the review queue
// [default] / all = every consented application) + status chips. No applicant id or name exists in the read (D2): the row shows the product,
// the purpose category, the amount, the status. A 404 while `partner_console` is OFF prints the switched-off sentence. Money from bigint-minor
// strings (Law 2). All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { partnerConsoleSwitch } from '../../lib/console-flag';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError, type PartnerApplication, type PartnerApplicationStatus } from '@krishalaya/sdk-js';
import { APP_STATUSES, statusKey, statusTone, buildListQuery, queueHref, boxKey, LENDER_BOXES } from '../../features/lending/application';
import { partnerListFilter } from '../../features/partner/application';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('loan.queueTitle'), robots: { index: false, follow: false } };
}

export default async function LoanQueuePage({ searchParams }: { searchParams: { box?: string; status?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const q = buildListQuery(searchParams);

  let rows: PartnerApplication[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const f = partnerListFilter(q.box, q.status);
    const page = await partnerClient().partner.applications.list({ reviewQueue: f.reviewQueue, status: f.status as PartnerApplicationStatus | undefined, cursor: q.cursor, limit: q.limit });
    rows = page.items;
    nextCursor = page.nextCursor ?? undefined;
  } catch (e) {
    notice = e instanceof SdkError && e.status === 404 && (await partnerConsoleSwitch()) === 'off' ? t.t('partner.off.body') : t.t('dash.unavailable');
  }

  const columns: Column<PartnerApplication>[] = [
    { header: t.t('loan.colApp'), cell: (r) => <Link href={`/loan-queue/${r.id}`}>{r.applicantRef.slice(0, 8)}…</Link> },
    { header: t.t('partner.loan.colProduct'), cell: (r) => r.product.name },
    { header: t.t('loan.colRequested'), cell: (r) => formatMoneyMinor(r.amountRequestedMinor, 'INR', lang) },
    { header: t.t('partner.loan.colCategory'), cell: (r) => r.purposeCategory ?? t.t('common.dash') },
    { header: t.t('loan.colStatus'), cell: (r) => <span className={`kv-status kv-status--${statusTone(r.status)}`}>{t.t(statusKey(r.status))}</span> },
    { header: t.t('loan.colApplied'), cell: (r) => (r.createdAt ? formatDate(r.createdAt, lang) : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('loan.queueTitle')}</h1>
      <p className="kv-muted">{t.t('loan.queueLead')}</p>

      <nav className="kv-filters" aria-label={t.t('loan.filterBox')}>
        {LENDER_BOXES.map((b) => (
          <Link key={b} href={queueHref(b, q.status)} className={`kv-chip${q.box === b ? ' is-active' : ''}`} aria-current={q.box === b ? 'true' : undefined}>{t.t(boxKey(b))}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('loan.filterStatus')}>
        <Link href={queueHref(q.box)} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('loan.filterAll')}</Link>
        {APP_STATUSES.filter((s) => s !== 'draft').map((s) => (
          <Link key={s} href={queueHref(q.box, s)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(statusKey(s))}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('loan.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={queueHref(q.box, q.status, nextCursor)}>{t.t('common.nextPage')}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
