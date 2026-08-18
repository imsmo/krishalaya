// apps/web-admin/src/app/catalogue/lookup-values/[id]/page.tsx · platform lookup-value detail + edit + active
// toggle + change history. Server component: requireAdmin gates, fetches GET /v1/catalogue/lookup-values/:id
// (404 → notFound) and GET :id/history (degrades independently). Edit (PATCH :id — name/meta/sortOrder; code is
// immutable) and activate/deactivate (POST :id/active) are Server-Action forms with a mandatory audit reason.
// meta is a bounded JSON object. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import type { LookupValueRow, CatalogueChangeRow } from '../../../../features/catalogue/catalogue';
import { updateValueAction, setValueActiveAction } from '../../actions';

import { Button, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cat.valueDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['updated', 'activated', 'deactivated']);
const ERR = new Set(['defaultName', 'meta', 'sortOrder', 'isActive', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function LookupValueDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let value: LookupValueRow | undefined; let notice: string | undefined;
  try { value = (await adminGet<LookupValueRow>(`catalogue/lookup-values/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let history: CatalogueChangeRow[] = [];
  try { history = (await adminGet<CatalogueChangeRow[]>(`catalogue/lookup-values/${encodeURIComponent(params.id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!value) {
    return <section><p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const metaJson = JSON.stringify(value.meta ?? {});
  const histCols: Column<CatalogueChangeRow>[] = [
    { header: t.t('cat.histAction'), cell: (h) => h.action },
    { header: t.t('cat.histReason'), cell: (h) => h.reason },
    { header: t.t('cat.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href={`/catalogue/lookup-types/${encodeURIComponent(value.typeCode)}`}>{t.t('cat.backType')}</Link></p>
      <h1>{value.code}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`cat.ok.${okKey === 'updated' ? 'valueUpdated' : okKey === 'activated' ? 'activated' : 'deactivated'}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cat.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cat.typeCode')}</dt><dd>{value.typeCode}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.name')}</dt><dd>{value.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.sortOrder')}</dt><dd>{value.sortOrder.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.active')}</dt><dd><StatusPill tone={value.isActive ? 'success' : 'neutral'} label={value.isActive ? t.t('cat.activeYes') : t.t('cat.activeNo')} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.meta')}</dt><dd><pre className="kv-pre">{metaJson}</pre></dd></div>
      </dl>

      <div className="kv-action-cards">
        <form action={updateValueAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={value.id} />
          <p className="kv-field__hint">{t.t('cat.editValueHint')}</p>
          <label className="kv-field__label">{t.t('cat.name')}</label>
          <input name="defaultName" className="kv-input" required maxLength={150} defaultValue={value.defaultName} />
          <label className="kv-field__label">{t.t('cat.sortOrder')}</label>
          <input name="sortOrder" className="kv-input" inputMode="numeric" defaultValue={String(value.sortOrder)} />
          <label className="kv-field__label">{t.t('cat.meta')}</label>
          <input name="meta" className="kv-input" defaultValue={metaJson} placeholder={t.t('cat.metaHint')} />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('cat.save')}</Button>
        </form>
        <form action={setValueActiveAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={value.id} />
          <input type="hidden" name="isActive" value={value.isActive ? 'false' : 'true'} />
          <p className="kv-field__hint">{value.isActive ? t.t('cat.deactivateHint') : t.t('cat.activateHint')}</p>
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit" variant={value.isActive ? 'danger' : 'primary'}>{value.isActive ? t.t('cat.deactivate') : t.t('cat.activate')}</Button>
        </form>
      </div>

      <h2>{t.t('cat.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('cat.noHistory')} />
    </section>
  );
}
