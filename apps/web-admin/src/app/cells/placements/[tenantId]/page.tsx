// apps/web-admin/src/app/cells/placements/[tenantId]/page.tsx · a single tenant's placement + move + remove.
// Server component: requireAdmin gates, GET /v1/cells/placements/:tenantId (404 → notFound). Move (POST :tenantId/move)
// relocates the tenant's data to another cell+shard — that crosses a DPDP residency boundary, so a warning is shown
// and admin-api re-checks residency/capacity/shard match before committing. Remove (DELETE :tenantId) detaches the
// tenant. Both carry a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { residencyWarnKey, type PlacementRow } from '../../../../features/cells/cell';
import { moveTenantAction, removePlacementAction } from '../../actions';

import { Button } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.placementDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['placed', 'moved']);
const ERR = new Set(['cellId', 'shardId', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function PlacementDetailPage({ params, searchParams }: { params: { tenantId: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const tenantId = params.tenantId;

  let placement: PlacementRow | undefined; let notice: string | undefined;
  try { placement = (await adminGet<PlacementRow>(`cells/placements/${encodeURIComponent(tenantId)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!placement) {
    return <section><p className="kv-backlink"><Link href="/cells/placements">{t.t('cells.backPlacements')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/cells/placements">{t.t('cells.backPlacements')}</Link></p>
      <h1>{t.t('cells.placementHeading')}</h1>
      <p className="kv-muted">{placement.tenantId}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`cells.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cells.cellId')}</dt><dd><Link href={`/cells/cells/${encodeURIComponent(placement.cellId)}`}>{placement.cellId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.shardId')}</dt><dd><Link href={`/cells/shards/${encodeURIComponent(placement.shardId)}`}>{placement.shardId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.pinned')}</dt><dd>{placement.pinned ? t.t('common.yes') : t.t('common.no')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cells.histWhen')}</dt><dd>{placement.createdAt ?? t.t('common.dash')}</dd></div>
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.moveTenant')}</summary>
        <p className="kv-field__hint kv-field__hint--warn">{t.t(residencyWarnKey('move'))}</p>
        <form action={moveTenantAction} className="kv-form">
          <input type="hidden" name="tenantId" value={placement.tenantId} />
          <label className="kv-field__label">{t.t('cells.cellId')}</label>
          <input name="cellId" className="kv-input" required placeholder={t.t('cells.uuidHint')} />
          <label className="kv-field__label">{t.t('cells.shardId')}</label>
          <input name="shardId" className="kv-input" required placeholder={t.t('cells.uuidHint')} />
          <label className="kv-field__label"><input type="checkbox" name="pinned" value="true" defaultChecked={placement.pinned} /> {t.t('cells.pinnedField')}</label>
          <label className="kv-field__label">{t.t('cells.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit" variant="danger">{t.t('cells.moveSubmit')}</Button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.removeTenant')}</summary>
        <p className="kv-field__hint kv-field__hint--warn">{t.t('cells.removeHint')}</p>
        <form action={removePlacementAction} className="kv-inline-form">
          <input type="hidden" name="tenantId" value={placement.tenantId} />
          <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={500} placeholder={t.t('cells.reason')} />
          <Button type="submit" variant="danger">{t.t('cells.removeSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
