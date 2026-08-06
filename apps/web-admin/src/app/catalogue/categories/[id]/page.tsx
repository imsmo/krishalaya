// apps/web-admin/src/app/catalogue/categories/[id]/page.tsx · category node detail + children + edit + move +
// active toggle + change history. Server component: requireAdmin gates, fetches GET /v1/catalogue/categories/:id
// (404 → notFound), GET :id/children and GET :id/history (degrade independently). Edit (PATCH :id), move (POST
// :id/move — reparent, cycle/depth-checked server-side) and activate/deactivate (POST :id/active) are Server-
// Action forms with a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { COMMERCE_KINDS, commerceKindKey, type CategoryRow, type CatalogueChangeRow } from '../../../../features/catalogue/catalogue';
import { updateCategoryAction, moveCategoryAction, setCategoryActiveAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cat.categoryDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['updated', 'moved', 'activated', 'deactivated', 'created']);
const ERR = new Set(['defaultName', 'commerceKind', 'minAge', 'sortOrder', 'iconMediaId', 'newParentId', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function CategoryDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let cat: CategoryRow | undefined; let notice: string | undefined;
  try { cat = (await adminGet<CategoryRow>(`catalogue/categories/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let children: CategoryRow[] = []; let history: CatalogueChangeRow[] = [];
  try { children = (await adminGet<CategoryRow[]>(`catalogue/categories/${encodeURIComponent(params.id)}/children`, { limit: 100 })).data ?? []; } catch { /* degrade */ }
  try { history = (await adminGet<CatalogueChangeRow[]>(`catalogue/categories/${encodeURIComponent(params.id)}/history`, { limit: 50 })).data ?? []; } catch { /* degrade */ }

  if (!cat) {
    return <section><p className="kv-backlink"><Link href="/catalogue/categories">{t.t('cat.backCategories')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const kind = commerceKindKey(cat.commerceKind);
  const childCols: Column<CategoryRow>[] = [
    { header: t.t('cat.path'), cell: (c) => <Link href={`/catalogue/categories/${encodeURIComponent(c.id)}`}>{c.code}</Link> },
    { header: t.t('cat.name'), cell: (c) => c.defaultName },
    { header: t.t('cat.active'), cell: (c) => <span className={`kv-status ${c.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>{c.isActive ? t.t('cat.activeYes') : t.t('cat.activeNo')}</span> },
  ];
  const histCols: Column<CatalogueChangeRow>[] = [
    { header: t.t('cat.histAction'), cell: (h) => h.action },
    { header: t.t('cat.histReason'), cell: (h) => h.reason },
    { header: t.t('cat.histWhen'), cell: (h) => h.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue/categories">{t.t('cat.backCategories')}</Link></p>
      {/* PC-56 ADMIN-3 · W020's Attributes tab. A separate route rather than a client-side tab: it is a different read
          with a different write path, and a tab would make one page own two audit trails. */}
      <p className="kv-field__hint">
        <Link href={`/catalogue/categories/${encodeURIComponent(params.id)}/bindings`}>{t.t('bind.title')}</Link>
      </p>
      <h1>{cat.code}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`cat.ok.${okKey === 'updated' ? 'categoryUpdated' : okKey === 'moved' ? 'moved' : okKey === 'activated' ? 'activated' : okKey === 'deactivated' ? 'deactivated' : 'categoryCreated'}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cat.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cat.name')}</dt><dd>{cat.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.commerceKind')}</dt><dd>{t.t(`cat.kind.${kind}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.depth')}</dt><dd>{cat.depth.toLocaleString()}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.requiresLicense')}</dt><dd>{cat.requiresLicense ? t.t('cat.yes') : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.requiresCertificate')}</dt><dd>{cat.requiresCertificate ? t.t('cat.yes') : t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.minAge')}</dt><dd>{cat.minAge ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.active')}</dt><dd><span className={`kv-status ${cat.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>{cat.isActive ? t.t('cat.activeYes') : t.t('cat.activeNo')}</span></dd></div>
      </dl>

      <h2>{t.t('cat.childrenHeading')}</h2>
      <DataTable columns={childCols} rows={children} empty={t.t('cat.childrenEmpty')} />

      <div className="kv-action-cards">
        <form action={updateCategoryAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={cat.id} />
          <p className="kv-field__hint">{t.t('cat.editCategoryHint')}</p>
          <label className="kv-field__label">{t.t('cat.name')}</label>
          <input name="defaultName" className="kv-input" required maxLength={150} defaultValue={cat.defaultName} />
          <label className="kv-field__label">{t.t('cat.commerceKind')}</label>
          <select name="commerceKind" className="kv-input" defaultValue={kind}>{COMMERCE_KINDS.map((k) => <option key={k} value={k}>{t.t(`cat.kind.${k}`)}</option>)}</select>
          <label className="kv-field__label">{t.t('cat.requiresLicense')}</label>
          <select name="requiresLicense" className="kv-input" defaultValue={cat.requiresLicense ? 'true' : 'false'}><option value="false">{t.t('cat.no')}</option><option value="true">{t.t('cat.yes')}</option></select>
          <label className="kv-field__label">{t.t('cat.requiresCertificate')}</label>
          <select name="requiresCertificate" className="kv-input" defaultValue={cat.requiresCertificate ? 'true' : 'false'}><option value="false">{t.t('cat.no')}</option><option value="true">{t.t('cat.yes')}</option></select>
          <label className="kv-field__label">{t.t('cat.minAge')}</label>
          <input name="minAge" className="kv-input" inputMode="numeric" defaultValue={cat.minAge == null ? '' : String(cat.minAge)} placeholder={t.t('cat.minAgeHint')} />
          <label className="kv-field__label">{t.t('cat.sortOrder')}</label>
          <input name="sortOrder" className="kv-input" inputMode="numeric" defaultValue={String(cat.sortOrder)} />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('cat.save')}</button>
        </form>

        <form action={moveCategoryAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={cat.id} />
          <p className="kv-field__hint">{t.t('cat.moveHint')}</p>
          <label className="kv-field__label">{t.t('cat.newParentId')}</label>
          <input name="newParentId" className="kv-input" placeholder={t.t('cat.parentHint')} />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('cat.move')}</button>
        </form>

        <form action={setCategoryActiveAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={cat.id} />
          <input type="hidden" name="isActive" value={cat.isActive ? 'false' : 'true'} />
          <p className="kv-field__hint">{cat.isActive ? t.t('cat.deactivateCatHint') : t.t('cat.activateHint')}</p>
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className={`kv-btn${cat.isActive ? ' kv-btn--danger' : ''}`}>{cat.isActive ? t.t('cat.deactivate') : t.t('cat.activate')}</button>
        </form>
      </div>

      <h2>{t.t('cat.historyHeading')}</h2>
      <DataTable columns={histCols} rows={history} empty={t.t('cat.noHistory')} />
    </section>
  );
}
