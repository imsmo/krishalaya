// apps/web-admin/src/app/catalogue/page.tsx · god-mode PLATFORM master-taxonomy — the lookup-type registry.
// Server component: requireAdmin gates, adminGet hits GET /v1/catalogue/lookup-types (keyset on code). A create
// form (POST) seeds a new controlled vocabulary. The category-tree lens is linked in the section nav. A master-
// taxonomy change ripples into every tenant's catalogue. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import type { LookupTypeRow } from '../../features/catalogue/catalogue';
import { createTypeAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cat.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['code', 'defaultName', 'reason', 'elevation', 'conflict', 'invalid', 'generic']);

export default async function CatalogueTypesPage({ searchParams }: { searchParams: { cursor?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: LookupTypeRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<LookupTypeRow[]>('catalogue/lookup-types', { cursor: searchParams.cursor, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<LookupTypeRow>[] = [
    { header: t.t('cat.typeCode'), cell: (r) => <Link href={`/catalogue/lookup-types/${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { header: t.t('cat.name'), cell: (r) => r.defaultName },
    { header: t.t('cat.tenantExtendable'), cell: (r) => (r.isTenantExtendable ? t.t('cat.yes') : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('cat.title')}</h1>
      <p className="kv-muted">{t.t('cat.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('cat.nav')}>
        <Link href="/catalogue" className="kv-chip is-active" aria-current="true">{t.t('cat.navTypes')}</Link>
        <Link href="/catalogue/categories" className="kv-chip">{t.t('cat.navCategories')}</Link>
        {/* PC-56 ADMIN-3 · the EAV definition plane */}
        <Link href="/catalogue/attributes" className="kv-chip">{t.t('cat.navAttributes')}</Link>
        <Link href="/catalogue/units" className="kv-chip">{t.t('cat.navUnits')}</Link>
        <Link href="/catalogue/translations" className="kv-chip">{t.t('cat.navTranslations')}</Link>
      </nav>
      {okCreated && <p className="kv-success" role="status">{t.t('cat.ok.typeCreated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cat.error.${errKey}`)}</p>}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cat.typesEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={`/catalogue?cursor=${encodeURIComponent(nextCursor)}`}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cat.createType')}</summary>
        <p className="kv-field__hint">{t.t('cat.createTypeHint')}</p>
        <form action={createTypeAction} className="kv-form">
          <label htmlFor="code" className="kv-field__label">{t.t('cat.typeCode')}</label>
          <input id="code" name="code" className="kv-input" required placeholder="crop_stage" />
          <label htmlFor="defaultName" className="kv-field__label">{t.t('cat.name')}</label>
          <input id="defaultName" name="defaultName" className="kv-input" required maxLength={100} />
          <label htmlFor="isTenantExtendable" className="kv-field__label">{t.t('cat.tenantExtendable')}</label>
          <select id="isTenantExtendable" name="isTenantExtendable" className="kv-input" defaultValue="false"><option value="false">{t.t('cat.no')}</option><option value="true">{t.t('cat.yes')}</option></select>
          <label htmlFor="typeReason" className="kv-field__label">{t.t('cat.reason')}</label>
          <input id="typeReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('cat.createTypeSubmit')}</button>
        </form>
      </details>
    </section>
  );
}
