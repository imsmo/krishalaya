// apps/web-admin/src/app/providers/page.tsx · god-mode integration-provider registry. Server component:
// requireAdmin gates, adminGet hits GET /v1/providers (category + active filter, keyset paging). Providers are
// platform-seeded — this is a READ surface; the one consequential write (enable/disable, Law 12) lives on the
// detail page. Health/financial lenses are linked in the section nav. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { PROVIDER_CATEGORIES, isValidCategory, categoryKey, providerHealthKey, type ProviderRow } from '../../features/providers/provider';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('providers.title'), robots: { index: false, follow: false } };
}

const HEALTH_TONE: Record<string, StatusTone> = { active: 'success', degraded: 'danger', disabled: 'neutral' };

export default async function ProvidersPage({ searchParams }: { searchParams: { cursor?: string; category?: string; active?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const category = isValidCategory(searchParams.category) ? searchParams.category : undefined;
  const active = searchParams.active === 'true' ? 'true' : searchParams.active === 'false' ? 'false' : undefined;

  let rows: ProviderRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<ProviderRow[]>('providers', { cursor: searchParams.cursor, category, isActive: active, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<ProviderRow>[] = [
    { header: t.t('providers.code'), cell: (r) => <Link href={`/providers/${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { header: t.t('providers.name'), cell: (r) => r.defaultName },
    { header: t.t('providers.category'), cell: (r) => t.t(`providers.cat.${categoryKey(r.category)}`) },
    { header: t.t('providers.health'), cell: (r) => { const k = providerHealthKey(r); return <StatusPill tone={HEALTH_TONE[k]} label={t.t(`providers.healthState.${k}`)} />; } },
    { header: t.t('providers.configured'), cell: (r) => `${r.health.activeTenants.toLocaleString()} / ${r.health.configuredTenants.toLocaleString()}` },
  ];

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { category, active, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/providers${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <h1>{t.t('providers.title')}</h1>
      <p className="kv-muted">{t.t('providers.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('providers.nav')}>
        <Chip as={Link} href="/providers/health">{t.t('providers.healthNav')}</Chip>
        <Chip as={Link} href="/providers/financial">{t.t('providers.financialNav')}</Chip>
      </nav>

      <nav className="kv-filters" aria-label={t.t('providers.filterCategory')}>
        <Chip as={Link} href={qp({ category: undefined, cursor: undefined })} aria-current={!category ? 'true' : undefined} active={!category}>{t.t('providers.filterAll')}</Chip>
        {PROVIDER_CATEGORIES.map((c) => (
          <Chip as={Link} key={c} href={qp({ category: c, cursor: undefined })} aria-current={category === c ? 'true' : undefined} active={category === c}>{t.t(`providers.cat.${c}`)}</Chip>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('providers.filterActive')}>
        <Chip as={Link} href={qp({ active: undefined, cursor: undefined })} aria-current={!active ? 'true' : undefined} active={!active}>{t.t('providers.filterAll')}</Chip>
        <Chip as={Link} href={qp({ active: 'true', cursor: undefined })} aria-current={active === 'true' ? 'true' : undefined} active={active === 'true'}>{t.t('providers.filterEnabled')}</Chip>
        <Chip as={Link} href={qp({ active: 'false', cursor: undefined })} aria-current={active === 'false' ? 'true' : undefined} active={active === 'false'}>{t.t('providers.filterDisabled')}</Chip>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('providers.empty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
