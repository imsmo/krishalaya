// apps/web-admin/src/app/tenants/page.tsx · god-mode tenant directory. Server component: requireAdmin gates,
// adminGet hits admin-api GET /v1/tenants (owner perm enforced server-side; reads across ALL tenants by design —
// Law 11). Keyset pagination (?cursor=) + a status filter. Degrade-never-die: failures map (features/nav
// adminNoticeKey) to a localized notice (403 → re-auth). Slug/id link to the per-tenant scorecard.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
import {
  TENANT_STATUSES, statusKey, parseQuery, parseRiskMin, directoryHref, hasActiveFilters, HIGH_RISK_MIN,
  type TenantListItem,
} from '../../features/tenants/tenant';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tenants.title'), robots: { index: false, follow: false } };
}

const STATUS_TONE: Record<string, StatusTone> = {
  pending: 'warning', trial: 'success', active: 'success', grace: 'warning',
  suspended: 'danger', archived: 'neutral', terminated: 'neutral',
};

export default async function TenantsPage({ searchParams }: {
  searchParams: { cursor?: string; status?: string; q?: string; riskMin?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (TENANT_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  // PC-56 ADMIN-1: `q` was already being forwarded to the API by this page and there was no input to type it into;
  // `riskMin` was accepted by the API and never used at all. Both are now real, and — see directoryHref — both
  // survive a page turn.
  const q = parseQuery(searchParams.q);
  const riskMin = parseRiskMin(searchParams.riskMin);
  const filters = { status, q, riskMin };

  let rows: TenantListItem[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await adminGet<TenantListItem[]>('tenants', { cursor: searchParams.cursor, status, q, riskMin, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) {
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const columns: Column<TenantListItem>[] = [
    { header: t.t('tenants.colSlug'), cell: (r) => <Link href={`/tenants/${r.id}`}>{r.slug}</Link> },
    { header: t.t('tenants.colStatus'), cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? 'neutral'} label={t.t(`tenants.status.${statusKey(r.status)}`)} /> },
    // risk is shown as the integer the platform holds; ≥ the triage line is marked, never re-scored here
    { header: t.t('tenants.colRisk'), cell: (r) => (
      r.riskScore >= HIGH_RISK_MIN ? <StatusPill tone="danger" label={String(r.riskScore)} /> : String(r.riskScore)
    ) },
    { header: t.t('tenants.colCreated'), cell: (r) => r.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <h1>{t.t('tenants.title')}</h1>
      <p className="kv-muted">{t.t('tenants.lead')}</p>

      {/* Search as a GET form: the query lands in the URL, so the view is linkable, shareable and back-button-safe —
          and the pager below can carry it. A POST search would make page 2 unreachable by link. */}
      <form method="get" action="/tenants" className="kv-form kv-form--inline" role="search">
        <label htmlFor="tenant-q" className="kv-field__label">{t.t('tenants.searchLabel')}</label>
        <input id="tenant-q" name="q" className="kv-input" defaultValue={q ?? ''} maxLength={120}
          placeholder={t.t('tenants.searchPlaceholder')} />
        <label htmlFor="tenant-risk" className="kv-field__label">{t.t('tenants.riskLabel')}</label>
        <input id="tenant-risk" name="riskMin" className="kv-input" inputMode="numeric" maxLength={3}
          defaultValue={riskMin === undefined ? '' : String(riskMin)} placeholder="0-100" />
        {/* the active status chip must survive a search, or searching would silently widen the list */}
        {status && <input type="hidden" name="status" value={status} />}
        <Button type="submit">{t.t('tenants.searchSubmit')}</Button>
        {hasActiveFilters(filters) && <Button as={Link} href="/tenants" variant="secondary">{t.t('tenants.clearFilters')}</Button>}
      </form>

      <nav className="kv-filters" aria-label={t.t('tenants.filterLabel')}>
        <Chip as={Link} href={directoryHref({ q, riskMin })} aria-current={!status ? 'true' : undefined} active={!status}>{t.t('tenants.filterAll')}</Chip>
        {TENANT_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={directoryHref({ status: s, q, riskMin })} aria-current={status === s ? 'true' : undefined} active={status === s}>{t.t(`tenants.status.${s}`)}</Chip>
        ))}
      </nav>

      {/* The canon's saved view. It is a LINK, not stored state: a bookmarkable URL is the honest version of a
          "saved view" until the platform actually stores per-operator views. */}
      <p className="kv-detail__muted">
        <Button as={Link} href={directoryHref({ status: 'trial', riskMin: HIGH_RISK_MIN })} variant="tertiary">
          {t.t('tenants.savedHighRiskTrials', { min: String(HIGH_RISK_MIN) })}
        </Button>
      </p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('tenants.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              {/* every active filter travels with the cursor (this used to carry only `status`) */}
              <Button as={Link} href={directoryHref({ status, q, riskMin, cursor: nextCursor })}>{t.t('common.nextPage')}</Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
