// apps/web-admin/src/app/cells/shards/[id]/page.tsx · shard detail + meta edit (weight/notes) + status transition +
// change history. Server component: requireAdmin gates, GET /v1/cells/shards/:id (404 → notFound) and :id/history
// (degrades independently). The status <select> offers only legal node transitions. CRITICAL (§4): the connection
// string is a vault secret — only `hasDsn` is shown, never a value, and there is no field to set one here.
// Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { statusTargets, nodeStatusKey, nodeStatusTone, isNodeStatus, type NodeStatus, type ShardRow, type CellChangeRow } from '../../../../features/cells/cell';
import { updateShardAction, setShardStatusAction } from '../../actions';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.shardDetailTitle'), robots: { index: false, follow: false } };
}

// DEV-60 static-literal sweep: nodeStatusTone (features/cells/cell.ts) still returns the OLD tone-suffix
// vocabulary ('ok'|'warn'|'danger'|'muted'), not StatusTone — that helper is a features/** file, out of
// scope for this page-only sweep, so the remap lives here at the call site instead.
const NODE_TONE: Record<string, StatusTone> = { ok: 'success', warn: 'warning', danger: 'danger', muted: 'neutral' };

const OK = new Set(['created', 'updated', 'status']);
const ERR = new Set(['weight', 'notes', 'reason', 'status', 'illegal', 'noChange', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function ShardDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const id = params.id;

  let shard: ShardRow | undefined; let notice: string | undefined;
  try { shard = (await adminGet<ShardRow>(`cells/shards/${encodeURIComponent(id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: CellChangeRow[] = [];
  try { history = (await adminGet<CellChangeRow[]>(`cells/shards/${encodeURIComponent(id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!shard) {
    return <section><p className="kv-backlink"><Link href="/cells/shards">{t.t('cells.backShards')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const fromStatus = (isNodeStatus(shard.status) ? shard.status : 'active') as NodeStatus;
  const targets = statusTargets(fromStatus);
  const histCols: Column<CellChangeRow>[] = [
    { header: t.t('cells.histAction'), cell: (h) => h.action },
    { header: t.t('cells.histReason'), cell: (h) => h.reason ?? t.t('common.dash') },
    { header: t.t('cells.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href={`/cells/shards?cellId=${encodeURIComponent(shard.cellId)}`}>{t.t('cells.backShards')}</Link></p>
      <h1>{t.t('cells.shardHeading')} #{shard.shardIndex}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`cells.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cells.cellId')}</dt><dd><Link href={`/cells/cells/${encodeURIComponent(shard.cellId)}`}>{shard.cellId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.status')}</dt><dd><StatusPill tone={NODE_TONE[nodeStatusTone(shard.status)]} label={t.t(nodeStatusKey(shard.status))} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.weight')}</dt><dd>{shard.weight}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.placed')}</dt><dd>{shard.placedCount}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.dsn')}</dt><dd>{shard.hasDsn ? t.t('cells.dsnSet') : <StatusPill tone="warning" label={t.t('cells.dsnMissing')} />}</dd></div>
        {shard.notes && <div className="kv-facts__row"><dt>{t.t('cells.notes')}</dt><dd>{shard.notes}</dd></div>}
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.editShard')}</summary>
        <form action={updateShardAction} className="kv-form">
          <input type="hidden" name="id" value={shard.id} />
          <label className="kv-field__label">{t.t('cells.weight')}</label>
          <input name="weight" className="kv-input" inputMode="numeric" defaultValue={String(shard.weight)} placeholder={t.t('cells.weightHint')} />
          <label className="kv-field__label">{t.t('cells.notes')}</label>
          <input name="notes" className="kv-input" maxLength={2000} defaultValue={shard.notes ?? ''} />
          <label className="kv-field__label">{t.t('cells.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit">{t.t('cells.save')}</Button>
        </form>
      </details>

      {targets.length > 0 ? (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('cells.changeStatus')}</summary>
          <form action={setShardStatusAction} className="kv-form">
            <input type="hidden" name="id" value={shard.id} />
            <input type="hidden" name="from" value={fromStatus} />
            <label className="kv-field__label">{t.t('cells.newStatus')}</label>
            <select name="status" className="kv-input" defaultValue={targets[0]}>{targets.map((s) => <option key={s} value={s}>{t.t(nodeStatusKey(s))}</option>)}</select>
            <label className="kv-field__label">{t.t('cells.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
            <Button type="submit">{t.t('cells.applyStatus')}</Button>
          </form>
        </details>
      ) : <p className="kv-muted">{t.t('cells.statusTerminal')}</p>}

      <h2>{t.t('cells.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('cells.noHistory')} />
    </section>
  );
}
