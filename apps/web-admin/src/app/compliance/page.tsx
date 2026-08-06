// apps/web-admin/src/app/compliance/page.tsx · god-mode DPDP/compliance — the DSR (data-subject-request) queue.
// Server component: requireAdmin gates, adminGet hits GET /v1/compliance/dsr (status + request-type filter,
// keyset). PII-minimal: only the request type, status, user UUID and resolution are shown — never raw subject
// data. The export/breach/retention/audit lenses are linked in the section nav. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
// Only the rollup helpers are used here. A PER-ROW deadline column is deliberately NOT computed in the browser: the
// clocks live in one place (admin-api's erasure-scope domain) so the queue, the detail page and the rollup can never
// disagree about whether a request is late. A second implementation here would be a third opinion.
import { cleanRecordClaimable, type SlaSummary } from '../../features/compliance/erasure';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { DSR_STATUSES, DSR_REQUEST_TYPES, dsrStatusKey, type DsrRow } from '../../features/compliance/compliance';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.dsrTitle'), robots: { index: false, follow: false } };
}

const DSR_CLASS: Record<string, string> = { open: 'kv-status--warn', in_progress: 'kv-status--warn', completed: 'kv-status--ok', rejected: 'kv-status--muted' };

export default async function ComplianceDsrPage({ searchParams }: { searchParams: { cursor?: string; status?: string; requestType?: string } }) {
  requireAdmin();
  const t = getTranslator();

  // W041's tiles. Fetched SEPARATELY from the queue and allowed to fail on its own (Law 12) — the queue is the work,
  // the tiles are context, and a failed rollup must not blank the list a DPO came here to clear.
  interface DsrSla { acknowledge: SlaSummary; resolve: SlaSummary; requests: number; openCount: number; inCoolingCount: number }
  let sla: DsrSla | null = null;
  try { sla = (await adminGet<DsrSla>('compliance/dsr/sla')).data ?? null; } catch { /* tiles stay blank */ }
  const status = (DSR_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const requestType = (DSR_REQUEST_TYPES as readonly string[]).includes(searchParams.requestType ?? '') ? searchParams.requestType : undefined;

  let rows: DsrRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<DsrRow[]>('compliance/dsr', { cursor: searchParams.cursor, status, requestType, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<DsrRow>[] = [
    { header: t.t('compliance.dsrId'), cell: (r) => <Link href={`/compliance/dsr/${encodeURIComponent(r.id)}`}>{r.id}</Link> },
    { header: t.t('compliance.requestType'), cell: (r) => t.t(`compliance.reqType.${r.requestType}`) },
    { header: t.t('compliance.subject'), cell: (r) => r.userId },
    { header: t.t('compliance.status'), cell: (r) => { const s = dsrStatusKey(r.status); return <span className={`kv-status ${DSR_CLASS[s]}`}>{t.t(`compliance.dsrState.${s}`)}</span>; } },
  ];

  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { status, requestType, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/compliance${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <h1>{t.t('compliance.title')}</h1>
      {/* ADMIN-5b: the consent lens. Behind its own permission (`compliance.consent.read`), so an operator without it
          gets the console's uniform 403 notice on arrival rather than a hidden link — a hidden link makes somebody think
          the feature does not exist, while a 403 tells them what to ask for. */}
      <nav className="kv-filters" aria-label={t.t('cns.navLabel')}>
        <Link href="/compliance/consent" className="kv-chip">{t.t('cns.navConsent')}</Link>
        <Link href="/compliance/consent/purposes" className="kv-chip">{t.t('cns.navPurposes')}</Link>
      </nav>
      {/* THE 72-HOUR CLOCK IS READABLE FOR THE FIRST TIME. `acknowledged_at` did not exist before migration 0107, so
          W041's "SLA breaches YTD · 0 · clean record" was an UNMEASURED claim rather than a clean one — and an
          unmeasured zero is what a regulator finds first. `unmeasured` is reported beside `breached`, and the clean
          record is only claimed when both are zero. */}
      {sla && (
        <>
          <div className="kv-stat-row">
            <div className="kv-card kv-stat">
              <div className="kv-stat__label">{t.t('era.tileOpen')}</div>
              <div className="kv-stat__value">{String(sla.openCount)}</div>
            </div>
            <div className="kv-card kv-stat">
              <div className="kv-stat__label">{t.t('era.tileCooling')}</div>
              <div className="kv-stat__value">{String(sla.inCoolingCount)}</div>
              <div className="kv-detail__muted">{t.t('era.tileCoolingHint')}</div>
            </div>
            <div className="kv-card kv-stat">
              <div className="kv-stat__label">{t.t('era.tileAckBreaches')}</div>
              <div className="kv-stat__value">{String(sla.acknowledge.breached)}</div>
              <div className="kv-detail__muted">
                {sla.acknowledge.unmeasured > 0
                  ? t.t('era.tileUnmeasured', { n: String(sla.acknowledge.unmeasured) })
                  : t.t('era.tileAllMeasured')}
              </div>
            </div>
          </div>
          {cleanRecordClaimable(sla.acknowledge)
            ? <p className="kv-detail__muted">{t.t('era.cleanRecord')}</p>
            : <p className="kv-notice">{t.t('era.notCleanRecord')}</p>}
        </>
      )}
      {!sla && <p className="kv-detail__muted">{t.t('era.tilesUnavailable')}</p>}
      <p className="kv-muted">{t.t('compliance.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('compliance.nav')}>
        <Link href="/compliance" className="kv-chip is-active" aria-current="true">{t.t('compliance.navDsr')}</Link>
        <Link href="/compliance/exports" className="kv-chip">{t.t('compliance.navExports')}</Link>
        <Link href="/compliance/breaches" className="kv-chip">{t.t('compliance.navBreaches')}</Link>
        <Link href="/compliance/retention" className="kv-chip">{t.t('compliance.navRetention')}</Link>
        <Link href="/compliance/audit" className="kv-chip">{t.t('compliance.navAudit')}</Link>
      </nav>

      <nav className="kv-filters" aria-label={t.t('compliance.filterStatus')}>
        <Link href={qp({ status: undefined, cursor: undefined })} className={`kv-chip${!status ? ' is-active' : ''}`} aria-current={!status ? 'true' : undefined}>{t.t('compliance.filterAll')}</Link>
        {DSR_STATUSES.map((s) => (
          <Link key={s} href={qp({ status: s, cursor: undefined })} className={`kv-chip${status === s ? ' is-active' : ''}`} aria-current={status === s ? 'true' : undefined}>{t.t(`compliance.dsrState.${s}`)}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('compliance.filterType')}>
        <Link href={qp({ requestType: undefined, cursor: undefined })} className={`kv-chip${!requestType ? ' is-active' : ''}`} aria-current={!requestType ? 'true' : undefined}>{t.t('compliance.filterAll')}</Link>
        {DSR_REQUEST_TYPES.map((rt) => (
          <Link key={rt} href={qp({ requestType: rt, cursor: undefined })} className={`kv-chip${requestType === rt ? ' is-active' : ''}`} aria-current={requestType === rt ? 'true' : undefined}>{t.t(`compliance.reqType.${rt}`)}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('compliance.dsrEmpty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
