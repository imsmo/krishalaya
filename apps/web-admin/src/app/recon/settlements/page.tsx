// apps/web-admin/src/app/recon/settlements/page.tsx · W062, the settlement queue (PC-56 ADMIN-6b).
//
// "settlement_statements — per seller per cycle: gross − commission − tax = net → payout. Daily cycle 18:00 IST."
//
// THE CYCLE DID THE WORK AND LEFT NO RECORD OF HAVING DONE IT. `SettlementStatementsJob` scans every tenant, generates a
// statement per seller, validates each against the zero-sum invariant — and returns its counts TO A LOG LINE. Nothing
// was persisted, so a cycle had no id, no outcome and no way to be asked about tomorrow. Every figure on this screen
// ("1,102 statements generated", "Cycle failed mid-run", "No statements this cycle") needed that record. 0114 adds
// `settlement_runs`.
//
// EACH TILE CARRIES ITS OWN KNOWN/UNKNOWN. "Today's cycle ₹0" and "no cycle has run today" render identically as a
// number and mean opposite things — the first is a quiet day, the second is a broken scheduler on the money path. 0113
// found exactly this collapse on the recon board; this is the same mistake one table over, and the tiles refuse it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { requestCycleAction } from '../payouts/actions';
import {
  balanceClass, balanceKey, basisKey, formatMinor, outcomeClass, outcomeKey, pdfClass, pdfKey,
  tileText, type RunOutcomeKind, type Tile,
} from '../../../features/payouts/payouts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.stl.title'), robots: { index: false, follow: false } };
}

interface StatementItem {
  id: string; tenantId: string; sellerUserId: string; statementNo: string;
  periodStart: string; periodEnd: string;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  balanced: boolean;
  pdf: { kind: 'not_generated' | 'never_hashed' | 'anchored' | 'mismatch'; sha256?: string };
  runId: string | null; createdAt: string;
}
interface Meta {
  nextCursor: string | null;
  cycle: string | null;
  basis: 'run' | 'period' | 'none';
  run: {
    id: string; periodStart: string; periodEnd: string; status: string;
    outcome: { kind: RunOutcomeKind; generated?: number; failed?: number; detail?: string | null; startedAt?: string };
    sellersScanned: number; generatedCount: number; failedCount: number;
    triggeredByAdminId: string | null; failureDetail: string | null; finishedAt: string | null; createdAt: string;
  } | null;
  tiles: { cycleGross: Tile; commission: Tile; tax: Tile; awaitingPayout: Tile };
  statementCount: number | null;
}

export default async function SettlementQueuePage({ searchParams }: {
  searchParams: { cycle?: string; tenantId?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const cycle = searchParams.cycle?.trim() || undefined;
  const tenantId = searchParams.tenantId?.trim() || undefined;

  let rows: StatementItem[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (cycle) q.set('cycle', cycle);
    if (tenantId) q.set('tenantId', tenantId);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<StatementItem[]>(`payouts/settlement?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'po.restricted.stl' : 'po.error.stl';
  }

  const withFilters = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (cycle) q.set('cycle', cycle);
    if (tenantId) q.set('tenantId', tenantId);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/recon/settlements?${s}` : '/recon/settlements';
  };

  const tiles = meta?.tiles;
  const basis = meta ? basisKey(meta.basis) : null;
  const outcome = meta?.run?.outcome;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/recon">{t.t('nav.recon')}</Link> <span aria-hidden="true">/</span> <span>{t.t('po.stl.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('po.stl.title')}</h1>
        <p className="kv-page__sub">{t.t('po.stl.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`po.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`po.err.${searchParams.error}`)}</p> : null}

      {/* ---------------- THE FOUR TILES ---------------- */}
      {tiles ? (
        <section className="kv-panel" aria-labelledby="po-tiles">
          <h2 id="po-tiles" className="kv-panel__title">{t.t('po.tiles.title')}</h2>
          <dl className="kv-stat-row">
            {([
              ['po.tile.cycle', tiles.cycleGross],
              ['po.tile.commission', tiles.commission],
              ['po.tile.tds', tiles.tax],
              ['po.tile.awaiting', tiles.awaitingPayout],
            ] as const).map(([key, tile]) => {
              const v = tileText(tile);
              return (
                <div key={key}>
                  <dt>{t.t(key)}</dt>
                  <dd>{v.value}</dd>
                  {/* THE UNKNOWN IS WORDS, NOT ₹0.00. This is the whole point of the tile type. */}
                  {v.unknownKey ? <dd className="kv-note is-warn">{t.t(v.unknownKey)}</dd> : null}
                </div>
              );
            })}
          </dl>
          {/* Which basis the totals used. A total that silently switches between "this run's aggregates" and "everything
              filed for this period" is worse than one that says which it is — and every statement generated before 0114
              has no run to describe it. */}
          {basis ? <p className="kv-note">{t.t(basis)}</p> : null}
        </section>
      ) : null}

      {/* ---------------- THE CYCLE ---------------- */}
      {meta?.run && outcome ? (
        <section className="kv-panel" aria-labelledby="po-cycle">
          <h2 id="po-cycle" className="kv-panel__title">{t.t('po.cycle.title')}</h2>
          <p>
            <span className={outcomeClass(outcome.kind)}>{t.t(outcomeKey(outcome.kind))}</span>{' '}
            {meta.run.periodStart} → {meta.run.periodEnd} ·{' '}
            {t.t('po.cycle.counts', {
              scanned: String(meta.run.sellersScanned),
              generated: String(meta.run.generatedCount),
              failed: String(meta.run.failedCount),
            })}
          </p>
          {/* W062's "Cycle failed mid-run — completed ones stand, the rest retry". `partial` is its own status in 0114
              rather than "completed with failures", because folding it into `completed` would hide the one outcome that
              needs a second look. */}
          {outcome.kind === 'partial' || outcome.kind === 'failed' ? (
            <p className="kv-note is-danger">{t.t('po.cycle.retry')}</p>
          ) : null}
          {/* ABANDONED is derived from the ABSENCE of an ending, because a crashed process cannot write its own epitaph.
              It is drawn as seriously as a failure: nobody was told, and the statements tomorrow's payouts are built
              from are missing. */}
          {outcome.kind === 'abandoned' ? (
            <p className="kv-note is-danger" role="alert">{t.t('po.cycle.abandoned')}</p>
          ) : null}
          {meta.run.failureDetail ? <p className="kv-pre">{meta.run.failureDetail}</p> : null}
          <p className="kv-note">
            {meta.run.triggeredByAdminId
              ? t.t('po.cycle.byOperator', { who: meta.run.triggeredByAdminId.slice(0, 8) })
              : t.t('po.cycle.byCadence')}
          </p>
        </section>
      ) : null}

      {/* ---------------- RUN A CYCLE ---------------- */}
      <section className="kv-panel" aria-labelledby="po-run">
        <h2 id="po-run" className="kv-panel__title">{t.t('po.run.title2')}</h2>
        {/* The button RECORDS A REQUEST. Statement generation belongs to the settlement worker, which owns the
            tenant-scoped unit of work, the per-aggregate zero-sum validation and the line linking that makes a run
            idempotent — reimplementing any of it here would be a second settlement engine in a different service. */}
        <p className="kv-note">{t.t('po.run.note')}</p>
        <form action={requestCycleAction}>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="po-from">{t.t('po.run.from')}</label>
            <input className="kv-input" id="po-from" name="periodStart" type="date" required />
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="po-to">{t.t('po.run.to')}</label>
            <input className="kv-input" id="po-to" name="periodEnd" type="date" required />
          </div>
          <button className="kv-btn" type="submit">{t.t('po.run.submit')}</button>
        </form>
      </section>

      {/* ---------------- FILTERS ---------------- */}
      <form className="kv-filters" method="get" action="/recon/settlements">
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="po-cycle-in">{t.t('po.filter.cycle')}</label>
          <input className="kv-input" id="po-cycle-in" name="cycle" type="date" defaultValue={cycle ?? ''} />
        </div>
        <div className="kv-field">
          <label className="kv-field__label" htmlFor="po-tenant">{t.t('po.filter.tenant')}</label>
          <input className="kv-input" id="po-tenant" name="tenantId" defaultValue={tenantId ?? ''} />
        </div>
        <button className="kv-btn" type="submit">{t.t('common.apply')}</button>
      </form>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('po.stl.empty.title')}</h2>
          {/* The two empty cases are DIFFERENT SENTENCES. "No statements this cycle" means no delivered orders; "no
              cycle has run" means the scheduler did not fire. Before `settlement_runs` existed the screen could not
              tell them apart, which is why the tile above says which. */}
          <p>{meta?.run ? t.t('po.stl.empty.body') : t.t('po.stl.empty.noRun')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">
            {t.t('po.stl.caption', { n: String(meta?.statementCount ?? rows.length) })}
          </caption>
          <thead>
            <tr>
              <th scope="col">{t.t('po.col.statement')}</th>
              <th scope="col">{t.t('po.col.seller')}</th>
              <th scope="col">{t.t('po.col.gross')}</th>
              <th scope="col">{t.t('po.col.commission')}</th>
              <th scope="col">{t.t('po.col.tax')}</th>
              <th scope="col">{t.t('po.col.net')}</th>
              <th scope="col">{t.t('po.col.sums')}</th>
              <th scope="col">{t.t('po.col.pdf')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>
                  <Link href={`/recon/settlements/${encodeURIComponent(s.id)}`}>{s.statementNo}</Link>
                </td>
                <td>{s.sellerUserId.slice(0, 8)}</td>
                <td>{formatMinor(s.grossMinor)}</td>
                <td>{formatMinor(s.commissionMinor)}</td>
                <td>{formatMinor(s.taxMinor)}</td>
                <td>{formatMinor(s.netMinor)}</td>
                {/* RECOMPUTED PER ROW, EVEN IN THE LIST. A statement whose four numbers do not add up is a corrupted
                    financial document, and it should be visible here rather than only on whichever screen somebody
                    happens to open. */}
                <td><span className={balanceClass(s.balanced)}>{t.t(balanceKey(s.balanced))}</span></td>
                <td><span className={pdfClass(s.pdf.kind)}>{t.t(pdfKey(s.pdf.kind))}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {meta?.nextCursor ? (
        <nav className="kv-pager" aria-label={t.t('common.pagination')}>
          <Link className="kv-btn" href={withFilters({ cursor: meta.nextCursor })}>{t.t('common.next')}</Link>
        </nav>
      ) : null}
    </main>
  );
}
