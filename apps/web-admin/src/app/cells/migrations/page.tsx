// apps/web-admin/src/app/cells/migrations/page.tsx · W034 (DELTA-012) (PC-56 ADMIN-8b).
//
// "shadow → canary" is the AI plane's ladder; this one is copy → verify → cutover → cleanup, and the canon deferred its
// schema by name: "a dedicated migration_jobs table/state machine is not yet in schema. Design leads."
//
// **DESIGNED AND NOT RUNNING, AND THIS PAGE SAYS SO ON EVERY LIST.** There is no executor — 0117 gives the pipeline a
// state machine, evidence and locks, and the worker that performs logical replication, runs the verify and takes the
// write freeze is ADMIN-8b-Q1. Five status columns on this platform have already recorded acts nobody performs; a
// seven-state pipeline rendered as though something were about to pick it up would be the sixth and by far the largest.
//
// THE COLUMN THAT MATTERS MOST IS "WHERE THE DATA IS". Only `done` means the tenant moved — the source is authoritative
// through copy and verify, and the placement flips inside the cutover. A console that got that wrong would tell somebody
// their data is in a country it is not in.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  Button, Callout, Chip, EmptyState, StatusPill,
} from '@krishalaya/ui';
import {
  cleanupKey, dataLocationKey, executorNoticeKey, jobTone, jobKey,
} from '../../../features/cells/residency-migration';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rz.jobs.title'), robots: { index: false, follow: false } };
}

interface JobItem {
  id: string; migratingTenantId: string;
  fromCellId: string; toCellId: string; status: string;
  approvedByAdminId: string | null; windowStart: string | null; windowEnd: string | null;
  safetyHoldUntil: string | null; sourceCleanedAt: string | null;
  rollbackReason: string | null; createdAt: string;
  dataHasMoved: boolean; sourceStillHeld: boolean; inWindow: boolean;
  cleanup: { kind: string; daysRemaining?: number; at?: string };
}
interface Meta {
  nextCursor: string | null;
  executor: { exists: boolean; owner: string };
}

const STATUSES = ['queued', 'copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed'] as const;

export default async function MigrationsPage({ searchParams }: {
  searchParams: { status?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: JobItem[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<JobItem[]>(`cells/migrations?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rz.restricted.jobs' : 'rz.error.jobs';
  }

  const executorNotice = meta ? executorNoticeKey(meta.executor.exists) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rz.jobs.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rz.jobs.title')}</h1>
        <p className="kv-page__sub">{t.t('rz.jobs.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`rz.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`rz.err.${searchParams.error}`)}</Callout> : null}

      {/* **THE EXECUTOR NOTICE, ON EVERY LIST.** Without it a reader takes `queued` to mean "about to run". */}
      {executorNotice ? (
        <Callout tone="warning" live="polite">
          {t.t(executorNotice, { owner: meta?.executor.owner ?? '' })}
        </Callout>
      ) : null}

      <form className="kv-filters" method="get" action="/cells/migrations">
        <div className="kv-chips" role="group" aria-label={t.t('rz.filter.status')}>
          <Chip as={Link} href="/cells/migrations" active={!status}>{t.t('common.all')}</Chip>
          {STATUSES.map((s) => (
            <Chip as={Link} key={s} href={`/cells/migrations?status=${s}`} active={status === s}>{t.t(jobKey(s))}</Chip>
          ))}
        </div>
      </form>

      {rows.length === 0 && !notice ? (
        <EmptyState title={t.t('rz.jobs.empty.title')} body={t.t('rz.jobs.empty.body')} />
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('rz.jobs.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('rz.col.job')}</th>
              <th scope="col">{t.t('rz.col.tenant')}</th>
              <th scope="col">{t.t('rz.col.status')}</th>
              <th scope="col">{t.t('rz.col.whereData')}</th>
              <th scope="col">{t.t('rz.col.window')}</th>
              <th scope="col">{t.t('rz.col.approved')}</th>
              <th scope="col">{t.t('rz.col.cleanup')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/cells/migrations/${encodeURIComponent(j.id)}`}>{j.id.slice(0, 8)}</Link></td>
                <td>{j.migratingTenantId.slice(0, 8)}</td>
                <td><StatusPill tone={jobTone(j.status)} label={t.t(jobKey(j.status))} /></td>
                {/* The most consequential cell on the page. */}
                <td>{t.t(dataLocationKey(j.status))}</td>
                <td>
                  {j.windowStart ? `${j.windowStart.slice(11, 16)}–${(j.windowEnd ?? '').slice(11, 16)}` : '—'}
                  {j.inWindow ? <><br /><small>{t.t('rz.window.open')}</small></> : null}
                </td>
                <td>{j.approvedByAdminId ? j.approvedByAdminId.slice(0, 8) : t.t('rz.notApproved')}</td>
                <td>
                  {t.t(cleanupKey(j.cleanup.kind))}
                  {j.cleanup.kind === 'holding' ? ` (${j.cleanup.daysRemaining}d)` : ''}
                  {/* The source is still held after `done` until cleanup runs — which is why `done` is the end of the
                      state machine and not the end of the story. */}
                  {j.sourceStillHeld ? <><br /><small>{t.t('rz.sourceHeld')}</small></> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Button as={Link} href={`/cells/migrations?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(meta.nextCursor)}`}>
            {t.t('common.next')}
          </Button>
        </nav>
      ) : null}

      <Callout>{t.t('rz.jobs.residencyNote')}</Callout>
    </main>
  );
}
