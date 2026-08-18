// apps/web-admin/src/app/recon/payouts/page.tsx · W066, payout batches (PC-56 ADMIN-6b).
//
// "payout_batches → payouts (RazorpayX) · wages ride the priority lane · every batch checker-approved before execution."
// THE LAST CLAUSE WAS NOT TRUE OF ANYTHING. `payout-execution.cadence-job.ts` claimed every queued payout on a
// five-minute timer with no reference to a batch at all, and `payout_batches` has never had an approval column. 0114
// adds the columns and the trigger; this is the screen that uses them.
//
// AND THE TABLE IS EMPTY IN PRODUCTION. The only caller of `PayoutBatchService.runBatch` is `WagePriorityLaneJob`, which
// is registered in no module and no job registry — the cadence job's own header says "GA-DEFERRED, not wired here". So
// the empty state below is the state this screen is actually in today, and it says why rather than implying a quiet day.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { Button, Callout, Chip, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  formatMinor, phaseTone, phaseKey, executionSummary, type Phase,
} from '../../../features/payouts/payouts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.batches.title'), robots: { index: false, follow: false } };
}

interface BatchRow {
  id: string; tenantId: string | null; batchType: string; count: number; status: string; phase: Phase;
  settledMinor: string; openedByAdminId: string | null; approvedByAdminId: string | null; approvedAt: string | null;
  returnedAt: string | null; returnReason: string | null; executedAt: string | null; createdAt: string;
}
interface Meta {
  nextCursor: string | null;
  awaitingChecker: { id: string; batchType: string; count: number; requestedMinor: string; openedByAdminId: string | null; createdAt: string }[];
  held: { count: number; totalMinor: string } | null;
}

const STATUSES = ['open', 'approved', 'returned', 'executing', 'executed', 'failed'] as const;

export default async function PayoutBatchesPage({ searchParams }: {
  searchParams: { status?: string; batchType?: string; cursor?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;
  const batchType = searchParams.batchType?.trim() || undefined;

  let rows: BatchRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (batchType) q.set('batchType', batchType);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<BatchRow[]>(`payouts/batches?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'po.restricted.batches' : 'po.error.batches';
  }

  // A filter preserved across paging. W066's pager carried nothing before this screen existed, and the ADMIN-1 finding
  // (page 2 of a search silently becoming page 2 of everything) applies to any list with both a filter and a cursor.
  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (batchType) q.set('batchType', batchType);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/recon/payouts?${s}` : '/recon/payouts';
  };

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/recon">{t.t('nav.recon')}</Link> <span aria-hidden="true">/</span> <span>{t.t('po.batches.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('po.batches.title')}</h1>
        <p className="kv-page__sub">{t.t('po.batches.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}

      {/* THE GATE'S OWN NUMBER. A gate that holds money silently is indistinguishable from a stalled queue — 0113's
          lesson, where the recon staleness alarm could never fire because its gauge was a hardcoded 0. */}
      {meta?.held && meta.held.count > 0 ? (
        <Callout tone="warning" live="polite">
          {t.t('po.held', { count: String(meta.held.count), amount: formatMinor(meta.held.totalMinor) })}
        </Callout>
      ) : null}

      {/* W066's alert strip, read across EVERY open batch rather than this page. */}
      {meta?.awaitingChecker?.length ? (
        <section className="kv-panel is-warn" aria-labelledby="po-awaiting">
          <h2 id="po-awaiting" className="kv-panel__title">{t.t('po.awaiting.title')}</h2>
          <ul className="kv-stat-row">
            {meta.awaitingChecker.map((a) => (
              <li key={a.id}>
                <Link href={`/recon/payouts/${encodeURIComponent(a.id)}`}>{a.id.slice(0, 8)}</Link>{' '}
                {formatMinor(a.requestedMinor)} · {t.t('po.awaiting.count', { n: String(a.count) })}
                {/* The maker is shown by id, not by name. admin-api has no `users` row to join to — the realm-identity
                    finding for the fifth time — and inventing a display name would be inventing an identity. */}
                {a.openedByAdminId ? ` · ${t.t('po.maker')} ${a.openedByAdminId.slice(0, 8)}` : ` · ${t.t('po.maker.unknown')}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form className="kv-filters" method="get" action="/recon/payouts">
        <div className="kv-chips" role="group" aria-label={t.t('po.filter.status')}>
          <Chip as={Link} href={withFilters({ status: undefined })} active={!status}>
            {t.t('common.all')}
          </Chip>
          {STATUSES.map((s) => (
            <Chip as={Link} key={s} href={(() => { const q = new URLSearchParams(); q.set('status', s); if (batchType) q.set('batchType', batchType); return `/recon/payouts?${q.toString()}`; })()} active={status === s}>
              {t.t(phaseKey(s === 'open' ? 'awaiting_checker' : (s as Phase)))}
            </Chip>
          ))}
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="po-type">{t.t('po.filter.type')}</label>
          <input className="kv-input" id="po-type" name="batchType" defaultValue={batchType ?? ''} maxLength={40} />
        </div>
        <Button type="submit">{t.t('common.apply')}</Button>
      </form>

      {rows.length === 0 && !notice ? (
        // THE EMPTY STATE NAMES THE DEFECT rather than describing a quiet day. Until the batch writer is scheduled
        // there will never be a row here, and an operator told "no batches this window" would wait for one.
        <EmptyState variant="empty" title={t.t('po.batches.empty.title')} body={t.t('po.batches.empty.body')} />
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('po.batches.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('po.col.created')}</th>
              <th scope="col">{t.t('po.col.batch')}</th>
              <th scope="col">{t.t('po.col.type')}</th>
              <th scope="col">{t.t('po.col.count')}</th>
              <th scope="col">{t.t('po.col.settled')}</th>
              <th scope="col">{t.t('po.col.status')}</th>
              <th scope="col">{t.t('po.col.executed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const ex = executionSummary({ phase: b.phase, count: b.count, executedAt: b.executedAt });
              return (
                <tr key={b.id}>
                  <td>{b.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td><Link href={`/recon/payouts/${encodeURIComponent(b.id)}`}>{b.id.slice(0, 8)}</Link></td>
                  <td>{b.batchType}</td>
                  <td>{b.count}</td>
                  {/* Labelled SETTLED, not "total". `total_minor` accumulates only as disbursements succeed, so it is 0
                      on every batch awaiting approval — a column headed "Total" would read as "nothing to approve". */}
                  <td>{formatMinor(b.settledMinor)}</td>
                  <td><StatusPill tone={phaseTone(b.phase)} label={t.t(phaseKey(b.phase))} /></td>
                  <td>{ex ? ex.at.slice(11, 16) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Button as={Link} href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Button>
        </nav>
      ) : null}
    </main>
  );
}
