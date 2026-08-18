// apps/web-admin/src/app/cells/page.tsx · god-mode CELL MAP — routing cells (the per-country DPDP residency stacks).
// Server component: requireAdmin gates, adminGet hits GET /v1/cells/cells (country + status filter, keyset page). A
// create form (POST) spins up a new cell (residency-lock defaults ON). Shards / placements / residency lenses are in
// the section nav. Editing the map relocates real tenant data, so admin-api re-authorises + audits. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { NODE_STATUSES, isNodeStatus, nodeStatusKey, nodeStatusTone, type CellRow } from '../../features/cells/cell';
import { createCellAction } from './actions';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['code', 'country', 'name', 'notes', 'reason', 'capacity', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);
// DEV-60 static-literal sweep: nodeStatusTone (features/cells/cell.ts) still returns the OLD tone-suffix
// vocabulary ('ok'|'warn'|'danger'|'muted'), not StatusTone — that helper is a features/** file, out of
// scope for this page-only sweep, so the remap lives here at the call site instead.
const NODE_TONE: Record<string, StatusTone> = { ok: 'success', warn: 'warning', danger: 'danger', muted: 'neutral' };

export default async function CellsPage({ searchParams }: { searchParams: { cursor?: string; countryCode?: string; status?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const status = isNodeStatus(searchParams.status ?? '') ? searchParams.status : undefined;
  const countryCode = (searchParams.countryCode ?? '').trim().toUpperCase() || undefined;

  let rows: CellRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<CellRow[]>('cells/cells', { cursor: searchParams.cursor, status, countryCode, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okCreated = searchParams.ok === 'created';
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const cols: Column<CellRow>[] = [
    { header: t.t('cells.code'), cell: (r) => <Link href={`/cells/cells/${encodeURIComponent(r.id)}`}>{r.code}</Link> },
    { header: t.t('cells.name'), cell: (r) => r.displayName },
    { header: t.t('cells.country'), cell: (r) => r.countryCode },
    { header: t.t('cells.status'), cell: (r) => <StatusPill tone={NODE_TONE[nodeStatusTone(r.status)]} label={t.t(nodeStatusKey(r.status))} /> },
    { header: t.t('cells.residency'), cell: (r) => r.residencyLocked ? t.t('cells.locked') : <StatusPill tone="warning" label={t.t('cells.unlocked')} /> },
    { header: t.t('cells.default'), cell: (r) => r.isDefault ? t.t('common.yes') : t.t('common.dash') },
    { header: t.t('cells.placed'), cell: (r) => String(r.placedCount) },
    { header: t.t('cells.capacity'), cell: (r) => r.capacityTenants === null ? t.t('cells.unbounded') : String(r.capacityTenants) },
  ];
  const filterHref = (s?: string) => `/cells?${new URLSearchParams({ ...(countryCode ? { countryCode } : {}), ...(s ? { status: s } : {}) }).toString()}`;

  return (
    <section>
      <h1>{t.t('cells.title')}</h1>
      <p className="kv-muted">{t.t('cells.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('cells.nav')}>
        <Chip as={Link} href="/cells" aria-current="true" active>{t.t('cells.navCells')}</Chip>
        <Chip as={Link} href="/cells/shards">{t.t('cells.navShards')}</Chip>
        <Chip as={Link} href="/cells/placements">{t.t('cells.navPlacements')}</Chip>
        <Chip as={Link} href="/cells/residency">{t.t('cells.navResidency')}</Chip>
        {/* PC-56 ADMIN-8/8b: these planes were built and were reachable only by typing the URL. A console screen nobody
            can navigate to is a screen that does not exist for the person who needs it. */}
        <Chip as={Link} href="/cells/capacity">{t.t('cells.navCapacity')}</Chip>
        <Chip as={Link} href="/cells/changes">{t.t('cells.navChanges')}</Chip>
        <Chip as={Link} href="/cells/residency/log">{t.t('cells.navResidencyLog')}</Chip>
        <Chip as={Link} href="/cells/migrations">{t.t('cells.navMigrations')}</Chip>
        <Chip as={Link} href="/cells/plan">{t.t('cells.navPlan')}</Chip>
        <Chip as={Link} href="/cells/provisioning">{t.t('cells.navProvisioning')}</Chip>
      </nav>
      {okCreated && <p className="kv-success" role="status">{t.t('cells.ok.cellCreated')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`cells.err.${errKey}`)}</p>}

      <form method="get" className="kv-filters kv-filters--form" role="search">
        <label htmlFor="countryCode" className="kv-field__label">{t.t('cells.country')}</label>
        <input id="countryCode" name="countryCode" className="kv-input kv-input--sm" maxLength={2} defaultValue={countryCode ?? ''} placeholder={t.t('cells.countryHint')} />
        {status && <input type="hidden" name="status" value={status} />}
        <Button type="submit" variant="tertiary">{t.t('common.filter')}</Button>
      </form>
      <nav className="kv-filters" aria-label={t.t('cells.filterStatus')}>
        <Chip as={Link} href={filterHref()} aria-current={!status ? 'true' : undefined} active={!status}>{t.t('cells.filterAll')}</Chip>
        {NODE_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={filterHref(s)} aria-current={status === s ? 'true' : undefined} active={status === s}>{t.t(nodeStatusKey(s))}</Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('cells.cellsEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={`/cells?cursor=${encodeURIComponent(nextCursor)}${status ? `&status=${status}` : ''}${countryCode ? `&countryCode=${countryCode}` : ''}`}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('cells.createCell')}</summary>
        <form action={createCellAction} className="kv-form">
          <label htmlFor="code" className="kv-field__label">{t.t('cells.code')}</label>
          <input id="code" name="code" className="kv-input" required maxLength={40} placeholder={t.t('cells.codeHint')} />
          <label htmlFor="displayName" className="kv-field__label">{t.t('cells.name')}</label>
          <input id="displayName" name="displayName" className="kv-input" required maxLength={150} />
          <label htmlFor="countryCodeNew" className="kv-field__label">{t.t('cells.country')}</label>
          <input id="countryCodeNew" name="countryCode" className="kv-input" required maxLength={2} placeholder={t.t('cells.countryHint')} />
          <label htmlFor="capacityTenants" className="kv-field__label">{t.t('cells.capacity')}</label>
          <input id="capacityTenants" name="capacityTenants" className="kv-input" inputMode="numeric" placeholder={t.t('cells.capacityHint')} />
          <label className="kv-field__label"><input type="checkbox" name="residencyLocked" value="true" defaultChecked /> {t.t('cells.residencyLockField')}</label>
          <p className="kv-field__hint">{t.t('cells.residencyLockHint')}</p>
          <label className="kv-field__label"><input type="checkbox" name="isDefault" value="true" /> {t.t('cells.defaultField')}</label>
          <label htmlFor="cellNotes" className="kv-field__label">{t.t('cells.notes')}</label>
          <input id="cellNotes" name="notes" className="kv-input" maxLength={2000} />
          <label htmlFor="cellReason" className="kv-field__label">{t.t('cells.reason')}</label>
          <input id="cellReason" name="reason" className="kv-input" required minLength={3} maxLength={500} />
          <Button type="submit">{t.t('cells.createCellSubmit')}</Button>
        </form>
      </details>
    </section>
  );
}
