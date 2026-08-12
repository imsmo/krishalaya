// apps/web-admin/src/app/schemes-registry/portal-sync/page.tsx · W077, government portal sync (PC-56 ADMIN-SWEEP-c1).
//
// A REGISTRY OVER A SYNC THAT HAS NEVER RUN, and every cell says so rather than around it. The canon draws "15 min
// ago · healthy · 4h ack lag"; the repository's truth is barer than even DELTA-018's design-ahead banner assumed —
// no portal job exists in the worker AT ALL, no client for any portal exists anywhere (PFMS is an explicit Noop),
// and the mapping registry's own rule is that sync_status never says 'synced'. So: Last pull = NEVER in words;
// Health = mapping truth, not a green badge nobody earned; Ack lag = measured only over rows 0136's clock stamped;
// Pending pushes = the one figure that is fully real. "Run all pulls" (W2214–W2216) is NOT drawn — with no worker
// to consume a run request, queueing one would be a status recording an act nobody performs (ADMIN-10-Q1's shape,
// refused for the second time) — and the page names that as the GAP-BACKEND it is.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { ackLagText, truthClass, type AckLag } from '../../../features/schemes/portal-sync';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ps.title'), robots: { index: false, follow: false } };
}

interface Row {
  authorityId: string; authorityName: string; level: string;
  providerCode: string; externalId: string; endpointLabel: string | null; mappedAt: string;
  lastPull: string | null; truth: string;
  pendingPushes: { n: number; basis: string };
  ackLag: AckLag;
}
interface Registry { portals: Row[]; manualAuthorities: number; neverSynced: boolean }

export default async function PortalSyncPage() {
  requireAdmin();
  const t = getTranslator();

  let d: Registry | undefined; let notice: string | undefined;
  try { d = (await adminGet<Row[]>('schemes-registry/portal-sync')).data as unknown as Registry; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  return (
    <section>
      <p className="kv-backlink"><Link href="/schemes-registry">{t.t('ps.backRegistry')}</Link></p>
      <h1>{t.t('ps.heading')}</h1>
      <p className="kv-muted">{t.t('ps.lead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      {d && (
        <>
          {/* The one sentence the whole page hangs on, asserted from the data rather than assumed. */}
          {d.neverSynced
            ? <p className="kv-notice" role="note">{t.t('ps.neverSynced')}</p>
            : <p className="kv-error" role="alert">{t.t('ps.syncClaimAppeared')}</p>}

          <table className="kv-table">
            <thead><tr>
              <th>{t.t('ps.col.portal')}</th><th>{t.t('ps.col.authority')}</th><th>{t.t('ps.col.mode')}</th>
              <th>{t.t('ps.col.lastPull')}</th><th>{t.t('ps.col.pending')}</th><th>{t.t('ps.col.ackLag')}</th><th>{t.t('ps.col.truth')}</th>
            </tr></thead>
            <tbody>
              {d.portals.map((r) => {
                const lag = ackLagText(r.ackLag);
                return (
                  <tr key={r.authorityId}>
                    <td>{r.providerCode} <span className="kv-detail__muted">{r.externalId}</span></td>
                    <td><Link href={`/schemes-registry/authorities/${r.authorityId}`}>{r.authorityName}</Link> · {r.level}</td>
                    {/* mode = the mapping's own label, never an inferred 'API + scrape fallback' nobody built */}
                    <td>{r.endpointLabel ?? t.t('common.dash')}</td>
                    <td>{r.lastPull ?? t.t('ps.never')}</td>
                    <td>{r.pendingPushes.n}</td>
                    <td>{lag.key === 'measured'
                      ? t.t('ps.lagMeasured', { h: lag.hours, n: lag.over })
                      : <span className="kv-detail__muted">{t.t('ps.lagUnmeasured')}</span>}</td>
                    <td><span className={truthClass(r.truth)}>{t.t(`ps.truth.${r.truth}` as never)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d.portals.length === 0 && <p className="kv-empty">{t.t('ps.empty')}</p>}
          <p className="kv-detail__muted">{t.t('ps.manualFooter', { n: String(d.manualAuthorities) })}</p>
          <p className="kv-detail__muted">{t.t('ps.pendingBasis')}</p>

          {/* W077's promise to farmers, kept exactly where it is true (apps/api serves the honest interim copy). */}
          <h2>{t.t('ps.farmerHonestyHeading')}</h2>
          <p className="kv-muted">{t.t('ps.farmerHonesty')}</p>

          {/* The GAP, named — not faked with a button. */}
          <h2>{t.t('ps.gapsHeading')}</h2>
          <p className="kv-error" role="note">{t.t('ps.noPullWorker')}</p>
          <p className="kv-detail__muted">{t.t('ps.noSyncPermission')}</p>
          <p className="kv-detail__muted">{t.t('ps.ackClockNote')}</p>
        </>
      )}
    </section>
  );
}
