// apps/web-admin/src/app/cells/shards/page.tsx · physical shards within a cell (the tenant→shard hash targets).
// Server component: requireAdmin gates, GET /v1/cells/shards (cellId + status filter, keyset). A create form (POST)
// adds a shard. CRITICAL (§4): a shard's connection string lives only as a vault `dsn_secret_ref` server-side — this
// console NEVER sees or sets it, only the `hasDsn` flag. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { NODE_STATUSES, isNodeStatus, nodeStatusKey, nodeStatusTone, type ShardRow } from '../../../features/cells/cell';
import { createShardAction } from '../actions';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.shardsTitle'), robots: { index: false, follow: false } };
}

// DEV-60 static-literal sweep: nodeStatusTone (features/cells/cell.ts) still returns the OLD tone-suffix
// vocabulary ('ok'|'warn'|'danger'|'muted'), not StatusTone — that helper is a features/** file, out of
// scope for this page-only sweep, so the remap lives here at the call site instead.
const NODE_TONE: Record<string, StatusTone> = { ok: 'success', warn: 'warning', danger: 'danger', muted: 'neutral' };

const ERR = new Set(['cellId', 'shardIndex', 'weight', 'notes', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function ShardsPage({ searchParams }: { searchParams: { cursor?: string; cellId?: string; status?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = isNodeStatus(searchParams.status ?? '') ? searchParams.status : undefined;
  const cellId = (searchParams.cellId ?? '').trim() || undefined;

  let rows: ShardRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<ShardRow[]>('cells/shards', { cursor: searchParams.cursor, status, cellId, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<ShardRow>[] = [
    { header: t.t('cells.shardIndex'), cell: (r) => <Link href={`/cells/shards/${encodeURIComponent(r.id)}`}>{r.shardIndex}</Link> },
    { header: t.t('cells.status'), cell: (r) => <StatusPill tone={NODE_TONE[nodeStatusTone(r.status)]} label={t.t(nodeStatusKey(r.status))} /> },
    { header: t.t('cells.weight'), cell: (r) => String(r.weight) },
    { header: t.t('cells.placed'), cell: (r) => String(r.placedCount) },
    { header: t.t('cells.dsn'), cell: (r) => r.hasDsn ? t.t('cells.dsnSet') : <StatusPill tone="warning" label={t.t('cells.dsnMissing')} /> },
  ];
  const filterHref = (s?: string) => `/cells/shards?${new URLSearchParams({ ...(cellId ? { cellId } : {}), ...(s ? { status: s } : {}) }).toString()}`;

  return (
    <section>
      <h1>{t.t('cells.shardsTitle')}</h1>
      <p className="kv-muted">{t.t('cells.shardsLead')}</p>
      <nav className="kv-filters" aria-label={t.t('cells.nav')}>
        <Chip as={Link} href="/cells">{t.t('cells.navCells')}</Chip>
        <Chip as={Link} href="/cells/shards" aria-current="true" active>{t.t('cells.navShards')}</Chip>
        <Chip as={Link} href="/cells/placements">{t.t('cells.navPlacements')}</Chip>
        <Chip as={Link} href="/cells/residency">{t.t('cells.navResidency')}</Chip>
      </nav>
      {okCreated && <p className="kv-success" role="status">{t.t('cells.ok.shardCreated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <form method="get" className="kv-filters kv-filters--form" role="search">
        <label htmlFor="cellId" className="kv-field__label">{t.t('cells.cellId')}</label>
        <input id="cellId" name="cellId" className="kv-input kv-input--sm" defaultValue={cellId ?? ''} placeholder={t.t('cells.uuidHint')} />
        {status && <input type="hidden" name="status" value={status} />}
        <Button type="submit" variant="tertiary">{t.t('common.filter')}</Button>
      </form>
      <nav className="kv-filters" aria-label={t.t('cells.filterStatus')}>
        <Chip as={Link} href={filterHref()} aria-current={!status ? 'true' : undefined} active={!status}>{t.t('cells.filterAll')}</Chip>
        {NODE_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={filterHref(s)} aria-current={status === s ? 'true' : undefined} active={status === s}>{t.t(nodeStatusKey(s))}</Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cells.shardsEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={`/cells/shards?cursor=${encodeURIComponent(nextCursor)}${status ? `&status=${status}` : ''}${cellId ? `&cellId=${cellId}` : ''}`}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.createShard')}</summary>
        <form action={createShardAction} className="kv-form">
          <label htmlFor="shardCellId" className="kv-field__label">{t.t('cells.cellId')}</label>
          <input id="shardCellId" name="cellId" className="kv-input" required defaultValue={cellId ?? ''} placeholder={t.t('cells.uuidHint')} />
          <label htmlFor="shardIndex" className="kv-field__label">{t.t('cells.shardIndex')}</label>
          <input id="shardIndex" name="shardIndex" className="kv-input" required inputMode="numeric" placeholder="0" />
          <label htmlFor="weight" className="kv-field__label">{t.t('cells.weight')}</label>
          <input id="weight" name="weight" className="kv-input" inputMode="numeric" placeholder={t.t('cells.weightHint')} />
          <label htmlFor="shardNotes" className="kv-field__label">{t.t('cells.notes')}</label>
          <input id="shardNotes" name="notes" className="kv-input" maxLength={2000} />
          <p className="kv-field__hint">{t.t('cells.dsnHint')}</p>
          <label htmlFor="shardReason" className="kv-field__label">{t.t('cells.reason')}</label>
          <input id="shardReason" name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit">{t.t('cells.createShardSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
