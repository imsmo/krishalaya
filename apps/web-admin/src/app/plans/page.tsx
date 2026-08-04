// apps/web-admin/src/app/plans/page.tsx · god-mode SaaS plan catalogue. Server component: requireAdmin gates,
// adminGet hits GET /v1/plans (status filter + keyset). A create-plan form (POST /plans) lives in a <details>;
// prices are entered in MINOR units (float-free) and shown via formatMoneyMinor. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { PLAN_STATUSES, planStatusKey, type PlanRow } from '../../features/plans/plan';
import { createPlanAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('plans.title'), robots: { index: false, follow: false } };
}

const STATUS_CLASS: Record<string, string> = { draft: 'kv-status--muted', active: 'kv-status--ok', archived: 'kv-status--muted' };
const ERR = new Set(['code', 'defaultName', 'countryCode', 'currencyCode', 'price', 'reason', 'elevation', 'conflict', 'notFound', 'generic']);

export default async function PlansPage({ searchParams }: { searchParams: { cursor?: string; status?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = (PLAN_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: PlanRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<PlanRow[]>('plans', { cursor: searchParams.cursor, status, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<PlanRow>[] = [
    { header: t.t('plans.code'), cell: (r) => <Link href={`/plans/${r.id}`}>{r.code} v{r.version}</Link> },
    { header: t.t('plans.status'), cell: (r) => { const s = planStatusKey(r.status); return <span className={`kv-status ${STATUS_CLASS[s]}`}>{t.t(`plans.state.${s}`)}</span>; } },
    { header: t.t('plans.monthly'), cell: (r) => formatMoneyMinor(r.monthlyPriceMinor, r.currency) },
    { header: t.t('plans.public'), cell: (r) => (r.isPublic ? t.t('plans.yes') : t.t('common.dash')) },
  ];
  const filterHref = (s?: string) => `/plans${s ? `?status=${encodeURIComponent(s)}` : ''}`;

  return (
    <section>
      <h1>{t.t('plans.title')}</h1>
      <p className="kv-muted">{t.t('plans.lead')}</p>
      {errKey && <p className="kv-error" role="alert">{t.t(`plans.error.${errKey}`)}</p>}

      <nav className="kv-filters" aria-label={t.t('plans.filterLabel')}>
        <Link href={filterHref()} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('plans.filterAll')}</Link>
        {PLAN_STATUSES.map((s) => (
          <Link key={s} href={filterHref(s)} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>{t.t(`plans.state.${s}`)}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('plans.empty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={`/plans?cursor=${encodeURIComponent(nextCursor)}${status ? `&status=${status}` : ''}`}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('plans.create')}</summary>
        <p className="kv-field__hint">{t.t('plans.createHint')}</p>
        <form action={createPlanAction} className="kv-form">
          <label htmlFor="code" className="kv-field__label">{t.t('plans.code')}</label>
          <input id="code" name="code" className="kv-input" required placeholder="pro_in" />
          <label htmlFor="defaultName" className="kv-field__label">{t.t('plans.name')}</label>
          <input id="defaultName" name="defaultName" className="kv-input" required maxLength={100} />
          <label htmlFor="countryCode" className="kv-field__label">{t.t('plans.country')}</label>
          <input id="countryCode" name="countryCode" className="kv-input" required placeholder="IN" />
          <label htmlFor="currencyCode" className="kv-field__label">{t.t('plans.currency')}</label>
          <input id="currencyCode" name="currencyCode" className="kv-input" required placeholder="INR" />
          <label htmlFor="monthlyPriceMinor" className="kv-field__label">{t.t('plans.monthlyMinor')}</label>
          <input id="monthlyPriceMinor" name="monthlyPriceMinor" className="kv-input" required inputMode="numeric" placeholder="99900" />
          <label htmlFor="annualPriceMinor" className="kv-field__label">{t.t('plans.annualMinor')}</label>
          <input id="annualPriceMinor" name="annualPriceMinor" className="kv-input" required inputMode="numeric" placeholder="999000" />
          <label htmlFor="createReason" className="kv-field__label">{t.t('plans.reason')}</label>
          <input id="createReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <button type="submit" className="kv-btn">{t.t('plans.createSubmit')}</button>
        </form>
      </details>
    </section>
  );
}
