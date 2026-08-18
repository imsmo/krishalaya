// apps/web-admin/src/app/cells/cells/[id]/page.tsx · cell detail + meta edit + status transition + default toggle +
// residency-lock toggle + change history. Server component: requireAdmin gates, GET /v1/cells/cells/:id (404 →
// notFound) and :id/history (degrades independently). The status <select> offers only the node state machine's legal
// next states. Toggling residency-lock OFF or moving tenants crosses a DPDP boundary — a warning is shown. Every
// mutation carries a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { statusTargets, nodeStatusKey, nodeStatusTone, residencyWarnKey, isNodeStatus, type NodeStatus, type CellRow, type CellChangeRow } from '../../../../features/cells/cell';
import { updateCellAction, setCellStatusAction, setCellDefaultAction, setResidencyLockAction } from '../../actions';

import { Button, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.cellDetailTitle'), robots: { index: false, follow: false } };
}

// nodeStatusTone (features/cells/cell.ts) predates the StatusPill canon and still returns the old kv-status--*
// token name ('ok' | 'warn' | 'danger' | 'muted'); mapped here rather than editing that shared helper.
const NODE_TONE: Record<'ok' | 'warn' | 'danger' | 'muted', StatusTone> = {
  ok: 'success', warn: 'warning', danger: 'danger', muted: 'neutral',
};

const OK = new Set(['created', 'updated', 'status', 'madeDefault', 'unset', 'locked', 'unlocked']);
const ERR = new Set(['name', 'notes', 'reason', 'capacity', 'status', 'illegal', 'noChange', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function CellDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const id = params.id;

  let cell: CellRow | undefined; let notice: string | undefined;
  try { cell = (await adminGet<CellRow>(`cells/cells/${encodeURIComponent(id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: CellChangeRow[] = [];
  try { history = (await adminGet<CellChangeRow[]>(`cells/cells/${encodeURIComponent(id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!cell) {
    return <section><p className="kv-backlink"><Link href="/cells">{t.t('cells.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const fromStatus = (isNodeStatus(cell.status) ? cell.status : 'active') as NodeStatus;
  const targets = statusTargets(fromStatus);
  const histCols: Column<CellChangeRow>[] = [
    { header: t.t('cells.histAction'), cell: (h) => h.action },
    { header: t.t('cells.histReason'), cell: (h) => h.reason ?? t.t('common.dash') },
    { header: t.t('cells.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/cells">{t.t('cells.back')}</Link></p>
      <h1>{cell.code}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`cells.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cells.name')}</dt><dd>{cell.displayName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.country')}</dt><dd>{cell.countryCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.status')}</dt><dd><StatusPill tone={NODE_TONE[nodeStatusTone(cell.status)]} label={t.t(nodeStatusKey(cell.status))} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.residency')}</dt><dd>{cell.residencyLocked ? t.t('cells.locked') : <StatusPill tone="warning" label={t.t('cells.unlocked')} />}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.default')}</dt><dd>{cell.isDefault ? t.t('common.yes') : t.t('common.no')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.placed')}</dt><dd>{cell.placedCount}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.capacity')}</dt><dd>{cell.capacityTenants === null ? t.t('cells.unbounded') : cell.capacityTenants}</dd></div>
        {cell.notes && <div className="kv-facts__row"><dt>{t.t('cells.notes')}</dt><dd>{cell.notes}</dd></div>}
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.editCell')}</summary>
        <form action={updateCellAction} className="kv-form">
          <input type="hidden" name="id" value={cell.id} />
          <label className="kv-field__label">{t.t('cells.name')}</label>
          <input name="displayName" className="kv-input" maxLength={150} defaultValue={cell.displayName} />
          <label className="kv-field__label">{t.t('cells.capacity')}</label>
          <input name="capacityTenants" className="kv-input" inputMode="numeric" defaultValue={cell.capacityTenants === null ? '' : String(cell.capacityTenants)} placeholder={t.t('cells.capacityHint')} />
          <label className="kv-field__label">{t.t('cells.notes')}</label>
          <input name="notes" className="kv-input" maxLength={2000} defaultValue={cell.notes ?? ''} />
          <p className="kv-field__hint">{t.t('cells.editCellHint')}</p>
          <label className="kv-field__label">{t.t('cells.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit">{t.t('cells.save')}</Button>
        </form>
      </details>

      {targets.length > 0 ? (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('cells.changeStatus')}</summary>
          <form action={setCellStatusAction} className="kv-form">
            <input type="hidden" name="id" value={cell.id} />
            <input type="hidden" name="from" value={fromStatus} />
            <label className="kv-field__label">{t.t('cells.newStatus')}</label>
            <select name="status" className="kv-input" defaultValue={targets[0]}>{targets.map((s) => <option key={s} value={s}>{t.t(nodeStatusKey(s))}</option>)}</select>
            <label className="kv-field__label">{t.t('cells.reason')}</label>
            <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
            <Button type="submit">{t.t('cells.applyStatus')}</Button>
          </form>
        </details>
      ) : <p className="kv-muted">{t.t('cells.statusTerminal')}</p>}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.residencyLockTitle')}</summary>
        {cell.residencyLocked
          ? <p className="kv-field__hint kv-field__hint--warn">{t.t(residencyWarnKey('unlock'))}</p>
          : <p className="kv-field__hint kv-field__hint--warn">{t.t(residencyWarnKey('lock'))}</p>}
        <form action={setResidencyLockAction} className="kv-inline-form">
          <input type="hidden" name="id" value={cell.id} />
          <input type="hidden" name="residencyLocked" value={cell.residencyLocked ? 'false' : 'true'} />
          <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={500} placeholder={t.t('cells.reason')} />
          <Button type="submit" variant="danger">{cell.residencyLocked ? t.t('cells.unlock') : t.t('cells.lock')}</Button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.defaultTitle')}</summary>
        <form action={setCellDefaultAction} className="kv-inline-form">
          <input type="hidden" name="id" value={cell.id} />
          <input type="hidden" name="isDefault" value={cell.isDefault ? 'false' : 'true'} />
          <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={500} placeholder={t.t('cells.reason')} />
          <Button type="submit">{cell.isDefault ? t.t('cells.unsetDefault') : t.t('cells.makeDefault')}</Button>
        </form>
      </details>

      <h2>{t.t('cells.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('cells.noHistory')} />
    </section>
  );
}
