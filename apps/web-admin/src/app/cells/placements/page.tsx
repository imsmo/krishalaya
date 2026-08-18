// apps/web-admin/src/app/cells/placements/page.tsx · tenant → cell/shard placements (where each tenant's data lives).
// Server component: requireAdmin gates, GET /v1/cells/placements (cellId + shardId filter, keyset). A place form
// (POST) assigns a tenant to a cell+shard — admin-api enforces the node accepts placement, capacity, residency, and
// shard↔cell match. Moving a tenant later crosses a DPDP residency boundary, so it's done from the detail page with
// a warning. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { type PlacementRow } from '../../../features/cells/cell';
import { placeTenantAction } from '../actions';

import { Button, Chip } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.placementsTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['tenantId', 'cellId', 'shardId', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function PlacementsPage({ searchParams }: { searchParams: { cursor?: string; cellId?: string; shardId?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const cellId = (searchParams.cellId ?? '').trim() || undefined;
  const shardId = (searchParams.shardId ?? '').trim() || undefined;

  let rows: PlacementRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<PlacementRow[]>('cells/placements', { cursor: searchParams.cursor, cellId, shardId, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okRemoved = searchParams.ok === 'removed';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<PlacementRow>[] = [
    { header: t.t('cells.tenantId'), cell: (r) => <Link href={`/cells/placements/${encodeURIComponent(r.tenantId)}`}>{r.tenantId}</Link> },
    { header: t.t('cells.cellId'), cell: (r) => <Link href={`/cells/cells/${encodeURIComponent(r.cellId)}`}>{r.cellId}</Link> },
    { header: t.t('cells.shardId'), cell: (r) => <Link href={`/cells/shards/${encodeURIComponent(r.shardId)}`}>{r.shardId}</Link> },
    { header: t.t('cells.pinned'), cell: (r) => r.pinned ? t.t('common.yes') : t.t('common.dash') },
    { header: t.t('cells.histWhen'), cell: (r) => r.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <h1>{t.t('cells.placementsTitle')}</h1>
      <p className="kv-muted">{t.t('cells.placementsLead')}</p>
      <nav className="kv-filters" aria-label={t.t('cells.nav')}>
        <Chip as={Link} href="/cells">{t.t('cells.navCells')}</Chip>
        <Chip as={Link} href="/cells/shards">{t.t('cells.navShards')}</Chip>
        <Chip as={Link} href="/cells/placements" aria-current="true" active>{t.t('cells.navPlacements')}</Chip>
        <Chip as={Link} href="/cells/residency">{t.t('cells.navResidency')}</Chip>
      </nav>
      {okRemoved && <p className="kv-success" role="status">{t.t('cells.ok.removed')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <form method="get" className="kv-filters kv-filters--form" role="search">
        <label htmlFor="pCellId" className="kv-field__label">{t.t('cells.cellId')}</label>
        <input id="pCellId" name="cellId" className="kv-input kv-input--sm" defaultValue={cellId ?? ''} placeholder={t.t('cells.uuidHint')} />
        <label htmlFor="pShardId" className="kv-field__label">{t.t('cells.shardId')}</label>
        <input id="pShardId" name="shardId" className="kv-input kv-input--sm" defaultValue={shardId ?? ''} placeholder={t.t('cells.uuidHint')} />
        <Button type="submit" variant="tertiary">{t.t('common.filter')}</Button>
      </form>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cells.placementsEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={`/cells/placements?cursor=${encodeURIComponent(nextCursor)}${cellId ? `&cellId=${cellId}` : ''}${shardId ? `&shardId=${shardId}` : ''}`}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.placeTenant')}</summary>
        <p className="kv-field__hint kv-field__hint--warn">{t.t('cells.placeHint')}</p>
        <form action={placeTenantAction} className="kv-form">
          <label htmlFor="tenantId" className="kv-field__label">{t.t('cells.tenantId')}</label>
          <input id="tenantId" name="tenantId" className="kv-input" required placeholder={t.t('cells.uuidHint')} />
          <label htmlFor="placeCellId" className="kv-field__label">{t.t('cells.cellId')}</label>
          <input id="placeCellId" name="cellId" className="kv-input" required defaultValue={cellId ?? ''} placeholder={t.t('cells.uuidHint')} />
          <label htmlFor="placeShardId" className="kv-field__label">{t.t('cells.shardId')}</label>
          <input id="placeShardId" name="shardId" className="kv-input" required defaultValue={shardId ?? ''} placeholder={t.t('cells.uuidHint')} />
          <label className="kv-field__label"><input type="checkbox" name="pinned" value="true" /> {t.t('cells.pinnedField')}</label>
          <label htmlFor="placeReason" className="kv-field__label">{t.t('cells.reason')}</label>
          <input id="placeReason" name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit">{t.t('cells.placeSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
