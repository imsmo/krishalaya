// apps/web-admin/src/app/schemes-registry/schemes/page.tsx · god-mode scheme catalogue. Server component:
// requireAdmin gates, adminGet hits GET /v1/schemes-registry/schemes (authority/category/active filter, keyset).
// A create form (POST) seeds a new scheme (starts inactive, version 1). processing_fee_minor is entered in MINOR
// units and rendered via formatMoneyMinor (Law 2). Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { SchemeRow } from '../../../features/schemes-registry/scheme';
import { apps30dText } from '../../../features/schemes-registry/version';
import { createSchemeAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('sr.schemesTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['code', 'defaultName', 'authorityId', 'categoryId', 'benefitSummary', 'eligibilityRules', 'requiredDocTypeIds', 'applicableRegionIds', 'window', 'processingFeeMinor', 'sourceUrl', 'reason', 'elevation', 'conflict', 'invalid', 'generic']);

export default async function SchemesPage({ searchParams }: { searchParams: { cursor?: string; authorityId?: string; categoryId?: string; active?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const authorityId = searchParams.authorityId?.trim() || undefined;
  const categoryId = searchParams.categoryId?.trim() || undefined;
  const active = searchParams.active === 'true' ? 'true' : searchParams.active === 'false' ? 'false' : undefined;

  let rows: SchemeRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<SchemeRow[]>('schemes-registry/schemes', { cursor: searchParams.cursor, authorityId, categoryId, isActive: active, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<SchemeRow>[] = [
    { header: t.t('sr.schemeCode'), cell: (r) => <Link href={`/schemes-registry/schemes/${encodeURIComponent(r.id)}`}>{r.code}</Link> },
    { header: t.t('sr.schemeName'), cell: (r) => r.defaultName },
    { header: t.t('sr.fee'), cell: (r) => formatMoneyMinor(r.processingFeeMinor, 'INR') },
    { header: t.t('sr.version'), cell: (r) => <Link href={`/schemes-registry/schemes/${encodeURIComponent(r.id)}/versions`}>v{r.version}</Link> },
    // W069's "Apps 30d". A cross-tenant AGGREGATE (Law 11) and nothing more — a count, never an applicant. 0 is a
    // real and useful answer here (a scheme nobody applies to), which is why it is a number rather than a state.
    { header: t.t('sr.apps30d'), cell: (r) => apps30dText((r as SchemeRow & { applications30d?: number }).applications30d) },
    { header: t.t('sr.active'), cell: (r) => <span className={`kv-status ${r.isActive ? 'kv-status--ok' : 'kv-status--muted'}`}>{r.isActive ? t.t('sr.activeYes') : t.t('sr.activeNo')}</span> },
  ];
  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { authorityId, categoryId, active, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/schemes-registry/schemes${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry">{t.t('sr.back')}</Link></p>
      <h1>{t.t('sr.schemesTitle')}</h1>
      <p className="kv-muted">{t.t('sr.schemesLead')}</p>
      <p className="kv-backlink"><Link href="/schemes-registry/exports">{t.t('sxp.link')}</Link></p>
      {/* The three OVERSIGHT lenses (ADMIN-4b). Separate permissions, so a viewer without them gets the console's
          uniform 403 notice on arrival rather than a hidden link — an absent link on a shared screen makes an operator
          think the feature does not exist, while a 403 tells them what to ask for. */}
      <nav className="kv-filters" aria-label={t.t('sov.lensNav')}>
        <Link href="/schemes-registry/applications" className="kv-chip">{t.t('sov.navApplications')}</Link>
        <Link href="/schemes-registry/dbt" className="kv-chip">{t.t('sov.navDbt')}</Link>
        <Link href="/schemes-registry/performance" className="kv-chip">{t.t('sov.navPerformance')}</Link>
      </nav>
      {okCreated && <p className="kv-success" role="status">{t.t('sr.ok.schemeCreated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`sr.error.${errKey}`)}</p>}

      <nav className="kv-filters" aria-label={t.t('sr.filterActive')}>
        <Link href={qp({ active: undefined, cursor: undefined })} className={`kv-chip${!active ? ' is-active' : ''}`} aria-current={!active ? 'true' : undefined}>{t.t('sr.filterAll')}</Link>
        <Link href={qp({ active: 'true', cursor: undefined })} className={`kv-chip${active === 'true' ? ' is-active' : ''}`} aria-current={active === 'true' ? 'true' : undefined}>{t.t('sr.activeYes')}</Link>
        <Link href={qp({ active: 'false', cursor: undefined })} className={`kv-chip${active === 'false' ? ' is-active' : ''}`} aria-current={active === 'false' ? 'true' : undefined}>{t.t('sr.activeNo')}</Link>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('sr.schemesEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('sr.createScheme')}</summary>
        <p className="kv-field__hint">{t.t('sr.createSchemeHint')}</p>
        <form action={createSchemeAction} className="kv-form">
          <label className="kv-field__label">{t.t('sr.schemeCode')}</label>
          <input name="code" className="kv-input" required placeholder="pm_kisan" />
          <label className="kv-field__label">{t.t('sr.schemeName')}</label>
          <input name="defaultName" className="kv-input" required maxLength={250} />
          <label className="kv-field__label">{t.t('sr.authorityId')}</label>
          <input name="authorityId" className="kv-input" required placeholder={t.t('sr.uuidHint')} />
          <label className="kv-field__label">{t.t('sr.categoryId')}</label>
          <input name="categoryId" className="kv-input" required placeholder={t.t('sr.categoryHint')} />
          <label className="kv-field__label">{t.t('sr.benefitSummary')}</label>
          <input name="benefitSummary" className="kv-input" required placeholder={t.t('sr.jsonHint')} />
          <label className="kv-field__label">{t.t('sr.eligibilityRules')}</label>
          <input name="eligibilityRules" className="kv-input" required placeholder={t.t('sr.jsonHint')} />
          <label className="kv-field__label">{t.t('sr.requiredDocTypeIds')}</label>
          <input name="requiredDocTypeIds" className="kv-input" placeholder={t.t('sr.uuidListHint')} />
          <label className="kv-field__label">{t.t('sr.applicableRegionIds')}</label>
          <input name="applicableRegionIds" className="kv-input" placeholder={t.t('sr.uuidListHint')} />
          <label className="kv-field__label">{t.t('sr.windowOpens')}</label>
          <input name="opens" className="kv-input" placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label">{t.t('sr.windowCloses')}</label>
          <input name="closes" className="kv-input" placeholder={t.t('sr.mmddHint')} />
          <label className="kv-field__label">{t.t('sr.season')}</label>
          <input name="season" className="kv-input" placeholder={t.t('sr.seasonHint')} />
          <label className="kv-field__label">{t.t('sr.feeMinor')}</label>
          <input name="processingFeeMinor" className="kv-input" inputMode="numeric" defaultValue="0" />
          <label className="kv-field__label">{t.t('sr.sourceUrl')}</label>
          <input name="sourceUrl" className="kv-input" placeholder="https://…" />
          <label className="kv-field__label">{t.t('sr.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('sr.createSchemeSubmit')}</button>
        </form>
      </details>
    </section>
  );
}
