// apps/web-admin/src/app/providers/health/page.tsx · god-mode provider-health monitor. Server component:
// requireAdmin gates, adminGet hits GET /v1/providers/health (every provider + credential-ref coverage counts +
// the precomputed `degraded` flag). DEGRADED = the provider is DISABLED but tenants still reference it — those
// integrations fail until it is re-enabled or migrated; admin-api surfaces these first. Counts only, never secret
// material. This plane reports PERSISTED configuration health, not real-time latency. Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { categoryKey, providerHealthKey, type ProviderHealthRow } from '../../../features/providers/provider';
import {
  circuitClass, circuitKey, fallbackClass, fallbackKey, fleetKey, metricKey, type CircuitCard,
} from '../../../features/integrations/api-oversight';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('providers.healthTitle'), robots: { index: false, follow: false } };
}

const HEALTH_CLASS: Record<string, string> = { active: 'kv-status--ok', degraded: 'kv-status--danger', disabled: 'kv-status--muted' };

export default async function ProviderHealthPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: ProviderHealthRow[] = []; let notice: string | undefined;
  try { rows = (await adminGet<ProviderHealthRow[]>('providers/health')).data ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  // PC-56 ADMIN-11c: the RUNTIME half. The section above reports PERSISTED configuration health, which is what this
  // plane could see before — a provider disabled while tenants still point at it. What W007 actually draws is a circuit
  // state, a fallback and two latency figures, and none of those existed here: the breakers live in apps/api, in
  // memory, per process. 0123 publishes their TRANSITIONS so a different process can read them.
  let circuits: CircuitCard[] = []; let runtimeMeta: { latencyOwner: string; probeOwner: string; circuitIsPerInstance: string } | undefined;
  let runtimeNotice: string | undefined;
  try {
    const res = await adminGet<CircuitCard[]>('platform-api/providers/health');
    circuits = res.data ?? [];
    runtimeMeta = res.meta as unknown as { latencyOwner: string; probeOwner: string; circuitIsPerInstance: string };
  } catch (e) {
    runtimeNotice = e instanceof AdminApiError && e.status === 403 ? 'ap11.restricted' : 'ap11.error.health';
  }

  const degradedCount = rows.filter((r) => r.degraded).length;

  const cols: Column<ProviderHealthRow>[] = [
    { header: t.t('providers.code'), cell: (r) => <Link href={`/providers/${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { header: t.t('providers.category'), cell: (r) => t.t(`providers.cat.${categoryKey(r.category)}`) },
    { header: t.t('providers.health'), cell: (r) => { const k = providerHealthKey(r); return <span className={`kv-status ${HEALTH_CLASS[k]}`}>{t.t(`providers.healthState.${k}`)}</span>; } },
    { header: t.t('providers.configuredTenants'), cell: (r) => r.health.configuredTenants.toLocaleString() },
    { header: t.t('providers.activeTenants'), cell: (r) => r.health.activeTenants.toLocaleString() },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/providers">{t.t('providers.back')}</Link></p>
      <h1>{t.t('providers.healthTitle')}</h1>
      <p className="kv-muted">{t.t('providers.healthLead')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {degradedCount > 0
            ? <p className="kv-error" role="alert">{t.t('providers.degradedAlarm').replace('{count}', String(degradedCount))}</p>
            : <p className="kv-success" role="status">{t.t('providers.allHealthy')}</p>}
          <DataTable columns={cols} rows={rows} empty={t.t('providers.empty')} />
        </>
      )}

      {/* ---------------------------------------------------------------------------------------- */}
      {/* THE RUNTIME PLANE (PC-56 ADMIN-11c)                                                      */}
      {/* ---------------------------------------------------------------------------------------- */}
      <section className="kv-panel" aria-labelledby="ap11-runtime">
        <h2 id="ap11-runtime" className="kv-panel__title">{t.t('ap11.providerHealth')}</h2>
        <p className="kv-muted">{t.t('ap11.ph.sub')}</p>

        {runtimeNotice ? <p className="kv-note is-danger" role="alert">{t.t(runtimeNotice)}</p> : null}

        {runtimeMeta ? (
          <>
            {/* The sentence that keeps the Circuit column honest. */}
            <p className="kv-note is-warn">{t.t(runtimeMeta.circuitIsPerInstance)}</p>
            {/* And the two columns the canon draws that have no source anywhere on this platform. */}
            <p className="kv-note">{t.t('ap11.ph.noMetrics', { owner: runtimeMeta.latencyOwner })}</p>
            <p className="kv-note">{t.t('ap11.ph.noProbe', { owner: runtimeMeta.probeOwner })}</p>
          </>
        ) : null}

        {circuits.length === 0 && !runtimeNotice ? (
          <div className="kv-empty">
            <h3>{t.t('ap11.ph.emptyTitle')}</h3>
            <p>{t.t('ap11.ph.emptyBody')}</p>
          </div>
        ) : (
          <table className="kv-table">
            <caption className="kv-table__caption">{t.t('ap11.ph.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t.t('ap11.col.dep')}</th>
                <th scope="col">{t.t('ap11.col.category')}</th>
                <th scope="col">{t.t('ap11.col.circuit')}</th>
                <th scope="col">{t.t('ap11.col.fallback')}</th>
                <th scope="col">{t.t('ap11.col.latency')}</th>
                <th scope="col">{t.t('ap11.col.errors')}</th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((c) => (
                <tr key={c.dep}>
                  <td className="kv-mono">{c.dep}<br /><small>{c.displayName ?? ''}</small></td>
                  <td>{c.category ?? '—'}</td>
                  <td>
                    <span className={circuitClass(c.fleetState)}>{t.t(circuitKey(c.fleetState))}</span>
                    {/* HOW MANY INSTANCES SAID SO — the true shape of a distributed circuit. */}
                    <br /><small>{t.t(fleetKey(c), { open: String(c.instancesOpen), total: String(c.instancesReporting) })}</small>
                  </td>
                  <td>
                    <span className={fallbackClass(c)}>
                      {t.t(fallbackKey(c), { strategy: c.fallbackStrategy ?? '' })}
                    </span>
                  </td>
                  {/* ABSENT, WITH THE REASON — never approximated from the failure count this wave does have. */}
                  <td>{t.t(metricKey(c.p95LatencyMs), { n: String(c.p95LatencyMs ?? 0) })}</td>
                  <td>{t.t(metricKey(c.errorRateBp), { n: String(c.errorRateBp ?? 0) })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </section>
  );
}
