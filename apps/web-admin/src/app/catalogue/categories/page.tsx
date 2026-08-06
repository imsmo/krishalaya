// apps/web-admin/src/app/catalogue/categories/page.tsx · god-mode category-tree browse. Server component:
// requireAdmin gates, adminGet hits GET /v1/catalogue/categories (parent / active / commerce-kind filter, keyset).
// `code` is the materialised dotted path; drill into a node from its detail page (children). A create form (POST)
// adds a node (root, or under a parent UUID). Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { COMMERCE_KINDS, isCommerceKind, commerceKindKey, type CategoryRow } from '../../../features/catalogue/catalogue';
import { createCategoryAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cat.categoriesTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['parentId', 'slug', 'defaultName', 'commerceKind', 'minAge', 'sortOrder', 'iconMediaId', 'reason', 'elevation', 'conflict', 'invalid', 'generic']);

export default async function CategoriesPage({ searchParams }: { searchParams: { cursor?: string; commerceKind?: string; active?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const commerceKind = isCommerceKind(searchParams.commerceKind) ? searchParams.commerceKind : undefined;
  const active = searchParams.active === 'true' ? 'true' : searchParams.active === 'false' ? 'false' : undefined;

  let rows: CategoryRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<CategoryRow[]>('catalogue/categories', { cursor: searchParams.cursor, commerceKind, isActive: active, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<CategoryRow>[] = [
    { header: t.t('cat.path'), cell: (r) => <Link href={`/catalogue/categories/${encodeURIComponent(r.id)}`}>{r.code}</Link> },
    { header: t.t('cat.name'), cell: (r) => r.defaultName },
    { header: t.t('cat.commerceKind'), cell: (r) => t.t(`cat.kind.${commerceKindKey(r.commerceKind)}`) },
    { header: t.t('cat.depth'), cell: (r) => r.depth.toLocaleString() },
    { header: t.t('cat.active'), cell: (r) => <span className={`kv-status ${r.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>{r.isActive ? t.t('cat.activeYes') : t.t('cat.activeNo')}</span> },
  ];
  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { commerceKind, active, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/catalogue/categories${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{t.t('cat.categoriesTitle')}</h1>
      <p className="kv-muted">{t.t('cat.categoriesLead')}</p>
      {okCreated && <p className="kv-success" role="status">{t.t('cat.ok.categoryCreated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cat.error.${errKey}`)}</p>}

      {/* The catalogue section nav. It existed only on the lookup-types page, so the categories screen was a dead end —
          PC-56 ADMIN-3 adds it here alongside the two new lenses. */}
      <nav className="kv-filters" aria-label={t.t('cat.nav')}>
        <Link href="/catalogue" className="kv-chip">{t.t('cat.navTypes')}</Link>
        <Link href="/catalogue/categories" className="kv-chip is-active" aria-current="true">{t.t('cat.navCategories')}</Link>
        <Link href="/catalogue/attributes" className="kv-chip">{t.t('cat.navAttributes')}</Link>
        <Link href="/catalogue/units" className="kv-chip">{t.t('cat.navUnits')}</Link>
      </nav>

      <nav className="kv-filters" aria-label={t.t('cat.filterKind')}>
        <Link href={qp({ commerceKind: undefined, cursor: undefined })} className={`kv-chip${!commerceKind ? ' is-active' : ''}`} aria-current={!commerceKind ? 'true' : undefined}>{t.t('cat.filterAll')}</Link>
        {COMMERCE_KINDS.map((k) => (
          <Link key={k} href={qp({ commerceKind: k, cursor: undefined })} className={`kv-chip${commerceKind === k ? ' is-active' : ''}`} aria-current={commerceKind === k ? 'true' : undefined}>{t.t(`cat.kind.${k}`)}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('cat.filterActive')}>
        <Link href={qp({ active: undefined, cursor: undefined })} className={`kv-chip${!active ? ' is-active' : ''}`} aria-current={!active ? 'true' : undefined}>{t.t('cat.filterAll')}</Link>
        <Link href={qp({ active: 'true', cursor: undefined })} className={`kv-chip${active === 'true' ? ' is-active' : ''}`} aria-current={active === 'true' ? 'true' : undefined}>{t.t('cat.activeYes')}</Link>
        <Link href={qp({ active: 'false', cursor: undefined })} className={`kv-chip${active === 'false' ? ' is-active' : ''}`} aria-current={active === 'false' ? 'true' : undefined}>{t.t('cat.activeNo')}</Link>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cat.categoriesEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cat.createCategory')}</summary>
        <p className="kv-field__hint">{t.t('cat.createCategoryHint')}</p>
        <form action={createCategoryAction} className="kv-form">
          <label className="kv-field__label">{t.t('cat.parentId')}</label>
          <input name="parentId" className="kv-input" placeholder={t.t('cat.parentHint')} />
          <label className="kv-field__label">{t.t('cat.slug')}</label>
          <input name="slug" className="kv-input" required maxLength={40} placeholder="wheat" />
          <label className="kv-field__label">{t.t('cat.name')}</label>
          <input name="defaultName" className="kv-input" required maxLength={150} />
          <label className="kv-field__label">{t.t('cat.commerceKind')}</label>
          <select name="commerceKind" className="kv-input" defaultValue="goods">{COMMERCE_KINDS.map((k) => <option key={k} value={k}>{t.t(`cat.kind.${k}`)}</option>)}</select>
          <label className="kv-field__label">{t.t('cat.requiresLicense')}</label>
          <select name="requiresLicense" className="kv-input" defaultValue="false"><option value="false">{t.t('cat.no')}</option><option value="true">{t.t('cat.yes')}</option></select>
          <label className="kv-field__label">{t.t('cat.requiresCertificate')}</label>
          <select name="requiresCertificate" className="kv-input" defaultValue="false"><option value="false">{t.t('cat.no')}</option><option value="true">{t.t('cat.yes')}</option></select>
          <label className="kv-field__label">{t.t('cat.minAge')}</label>
          <input name="minAge" className="kv-input" inputMode="numeric" placeholder={t.t('cat.minAgeHint')} />
          <label className="kv-field__label">{t.t('cat.sortOrder')}</label>
          <input name="sortOrder" className="kv-input" inputMode="numeric" defaultValue="100" />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('cat.createCategorySubmit')}</button>
        </form>
      </details>
    </section>
  );
}
