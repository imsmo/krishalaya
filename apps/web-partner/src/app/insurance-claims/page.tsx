// apps/web-partner/src/app/insurance-claims/page.tsx · the INSURER claims queue (KV-BL-056, DEV-24; canon
// W255-264, screens 291's status-tracker list). Server-gated; keyset pagination (?cursor=). Status chips drive the
// API's status filter. SCOPING NOTE (see features/insurance/insurance.ts's header): `insurance.manage` is
// TENANT-WIDE in the API (no partnerId filter exists on GET /v1/insurance/claims) — this queue is the full tenant
// claims queue, not scoped to a single insurance partner; that is an honest reflection of the API's current shape,
// not an invented restriction. Money rendered from bigint-minor strings (Law 2) where present. A failed call
// degrades to a notice, never a 500. All copy via i18n; status chip tone + filters via the pure insurance helper;
// no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishi-verse/i18n';
import {
  CLAIM_STATUSES, claimStatusKey, claimStatusTone, buildClaimListQuery, claimsHref, type ClaimRow,
} from '../../features/insurance/insurance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('claim.queueTitle'), robots: { index: false, follow: false } };
}

export default async function InsuranceClaimsPage({ searchParams }: { searchParams: { status?: string; policyId?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const q = buildClaimListQuery(searchParams);

  let rows: ClaimRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<ClaimRow[]>('GET', 'insurance/claims', { query: { status: q.status, policyId: q.policyId, cursor: q.cursor, limit: q.limit } });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<ClaimRow>[] = [
    { header: t.t('claim.colClaim'), cell: (r) => <Link href={`/insurance-claims/${r.id}`}>{r.id.slice(0, 8)}…</Link> },
    { header: t.t('claim.colEventDate'), cell: (r) => formatDate(r.eventDate, 'en') },
    { header: t.t('claim.colApproved'), cell: (r) => (r.approvedMinor ? formatMoneyMinor(r.approvedMinor, 'INR', 'en') : t.t('common.dash')) },
    { header: t.t('claim.colStatus'), cell: (r) => <span className={`kv-status kv-status--${claimStatusTone(r.status)}`}>{t.t(claimStatusKey(r.status))}</span> },
    { header: t.t('claim.colCreated'), cell: (r) => (r.createdAt ? formatDate(r.createdAt, 'en') : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('claim.queueTitle')}</h1>
      <p className="kv-muted">{t.t('claim.queueLead')}</p>

      {q.policyId && <p className="kv-muted">{t.t('claim.filteredByPolicy', { policy: q.policyId.slice(0, 8) })} <Link href="/insurance-claims">{t.t('claim.clearPolicyFilter')}</Link></p>}

      <nav className="kv-filters" aria-label={t.t('claim.filterStatus')}>
        <Link href={claimsHref(undefined, undefined, q.policyId)} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('claim.filterAll')}</Link>
        {CLAIM_STATUSES.map((s) => (
          <Link key={s} href={claimsHref(s, undefined, q.policyId)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(claimStatusKey(s))}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('claim.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={claimsHref(q.status, nextCursor, q.policyId)}>{t.t('common.nextPage')}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
