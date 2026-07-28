// apps/web-partner/src/app/insurance-policies/page.tsx · the INSURER's policies list (KV-BL-056, DEV-24; canon
// W255-264, screen 287's status tabs mirrored for the insurer view). READ-ONLY: enrol/cancel are the HOLDER's own
// actions (insurance.enrol), not exposed to this console — this page only lists policies for claims-handling
// context (e.g. confirming a claimed policy is on-cover). Server-gated; keyset pagination. SCOPING NOTE (see
// features/insurance/insurance.ts's header): `insurance.manage` is TENANT-WIDE in the API — this is the full
// tenant policy book, not scoped to a single insurance partner (the API exposes no partnerId filter on this list).
// Money via formatMoneyMinor (Law 2). Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishi-verse/i18n';
import {
  POLICY_STATUSES, policyStatusKey, policyStatusTone, buildPolicyListQuery, policiesHref, type PolicyRow,
} from '../../features/insurance/insurance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('policy.listTitle'), robots: { index: false, follow: false } };
}

export default async function InsurancePoliciesPage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const q = buildPolicyListQuery(searchParams);

  let rows: PolicyRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<PolicyRow[]>('GET', 'insurance/policies', { query: { status: q.status, cursor: q.cursor, limit: q.limit } });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<PolicyRow>[] = [
    { header: t.t('policy.colPolicy'), cell: (r) => <Link href={`/insurance-policies/${r.id}`}>{r.policyNo ?? r.id.slice(0, 8) + '…'}</Link> },
    { header: t.t('policy.colSubject'), cell: (r) => t.t(`policy.subject.${r.subjectType}`) },
    { header: t.t('policy.colSumInsured'), cell: (r) => formatMoneyMinor(r.sumInsuredMinor, 'INR', 'en') },
    { header: t.t('policy.colPremium'), cell: (r) => formatMoneyMinor(r.premiumMinor, 'INR', 'en') },
    { header: t.t('policy.colValidUntil'), cell: (r) => formatDate(r.validUntil, 'en') },
    { header: t.t('policy.colStatus'), cell: (r) => <span className={`kv-status kv-status--${policyStatusTone(r.status)}`}>{t.t(policyStatusKey(r.status))}</span> },
  ];

  return (
    <section>
      <h1>{t.t('policy.listTitle')}</h1>
      <p className="kv-muted">{t.t('policy.listLead')}</p>

      <nav className="kv-filters" aria-label={t.t('common.filter')}>
        <Link href={policiesHref()} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('claim.filterAll')}</Link>
        {POLICY_STATUSES.map((s) => (
          <Link key={s} href={policiesHref(s)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(policyStatusKey(s))}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('policy.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={policiesHref(q.status, nextCursor)}>{t.t('common.nextPage')}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
