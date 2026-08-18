// apps/web-admin/src/app/catalogue/lookup-types/[code]/page.tsx · lookup-type detail + its platform values.
// Server component: requireAdmin gates, fetches GET /v1/catalogue/lookup-types/:code (404 → notFound) and GET
// /lookup-values?typeCode=… (active filter, keyset). Rename (PATCH :code) + a create-value form (POST
// lookup-values) are Server-Action forms with a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import type { LookupTypeRow, LookupValueRow } from '../../../../features/catalogue/catalogue';
import { updateTypeAction, createValueAction } from '../../actions';

import { Button, Chip, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cat.typeDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated']);
const ERR = new Set(['code', 'defaultName', 'meta', 'sortOrder', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function LookupTypeDetailPage({ params, searchParams }: { params: { code: string }; searchParams: { active?: string; cursor?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const active = searchParams.active === 'true' ? 'true' : searchParams.active === 'false' ? 'false' : undefined;

  let type: LookupTypeRow | undefined; let notice: string | undefined;
  try { type = (await adminGet<LookupTypeRow>(`catalogue/lookup-types/${encodeURIComponent(params.code)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let values: LookupValueRow[] = []; let nextCursor: string | undefined;
  try {
    const res = await adminGet<LookupValueRow[]>('catalogue/lookup-values', { typeCode: params.code, isActive: active, cursor: searchParams.cursor, limit: 50 });
    values = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { /* degrade */ }

  if (!type) {
    return <section><p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<LookupValueRow>[] = [
    { header: t.t('cat.valueCode'), cell: (r) => <Link href={`/catalogue/lookup-values/${encodeURIComponent(r.id)}`}>{r.code}</Link> },
    { header: t.t('cat.name'), cell: (r) => r.defaultName },
    { header: t.t('cat.sortOrder'), cell: (r) => r.sortOrder.toLocaleString() },
    { header: t.t('cat.active'), cell: (r) => <StatusPill tone={r.isActive ? 'success' : 'neutral'} label={r.isActive ? t.t('cat.activeYes') : t.t('cat.activeNo')} /> },
  ];
  const filterHref = (a?: string) => `/catalogue/lookup-types/${encodeURIComponent(params.code)}${a ? `?active=${a}` : ''}`;

  return (
    <section>
      <p className="kv-backlink"><Link href="/catalogue">{t.t('cat.back')}</Link></p>
      <h1>{type.code}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`cat.ok.${okKey === 'created' ? 'valueCreated' : 'typeUpdated'}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cat.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('cat.name')}</dt><dd>{type.defaultName}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('cat.tenantExtendable')}</dt><dd>{type.isTenantExtendable ? t.t('cat.yes') : t.t('common.dash')}</dd></div>
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cat.renameType')}</summary>
        <form action={updateTypeAction} className="kv-form">
          <input type="hidden" name="code" value={type.code} />
          <label className="kv-field__label">{t.t('cat.name')}</label>
          <input name="defaultName" className="kv-input" required maxLength={100} defaultValue={type.defaultName} />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('cat.save')}</Button>
        </form>
      </details>

      <h2>{t.t('cat.valuesHeading')}</h2>
      <nav className="kv-filters" aria-label={t.t('cat.filterActive')}>
        <Chip as={Link} href={filterHref()} aria-current={!active ? 'true' : undefined} active={!active}>{t.t('cat.filterAll')}</Chip>
        <Chip as={Link} href={filterHref('true')} aria-current={active === 'true' ? 'true' : undefined} active={active === 'true'}>{t.t('cat.activeYes')}</Chip>
        <Chip as={Link} href={filterHref('false')} aria-current={active === 'false' ? 'true' : undefined} active={active === 'false'}>{t.t('cat.activeNo')}</Chip>
      </nav>
      <DataTable columns={cols} rows={values} empty={t.t('cat.valuesEmpty')} />
      {nextCursor && <p className="kv-pager"><Button as={Link} href={`/catalogue/lookup-types/${encodeURIComponent(params.code)}?cursor=${encodeURIComponent(nextCursor)}${active ? `&active=${active}` : ''}`}>{t.t('common.nextPage')}</Button></p>}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cat.createValue')}</summary>
        <p className="kv-field__hint">{t.t('cat.createValueHint')}</p>
        <form action={createValueAction} className="kv-form">
          <input type="hidden" name="typeCode" value={type.code} />
          <label className="kv-field__label">{t.t('cat.valueCode')}</label>
          <input name="code" className="kv-input" required maxLength={80} placeholder="sowing" />
          <label className="kv-field__label">{t.t('cat.name')}</label>
          <input name="defaultName" className="kv-input" required maxLength={150} />
          <label className="kv-field__label">{t.t('cat.sortOrder')}</label>
          <input name="sortOrder" className="kv-input" inputMode="numeric" defaultValue="100" />
          <label className="kv-field__label">{t.t('cat.meta')}</label>
          <input name="meta" className="kv-input" placeholder={t.t('cat.metaHint')} />
          <label className="kv-field__label">{t.t('cat.reason')}</label>
          <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit">{t.t('cat.createValueSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
