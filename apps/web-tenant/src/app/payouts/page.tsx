// apps/web-tenant/src/app/payouts/page.tsx · W145 — THE ORGANISATION's outbound payout queue
// (PC-56 TENANT-4b). Server-first, requireSession-gated, noindex, every string via i18n.
//
// WHAT CHANGED, AND WHY IT IS NOT A REGRESSION. This route used to be the signed-in user's OWN withdrawal
// form (request money from your wallet to your bank). W145's subject is the FPO paying its members and
// workers — 42 farmers in tonight's batch, wages on a priority lane, the milk-bill cycle. Same wrong-subject
// defect TENANT-4a found on the wallet; the personal surface moved to /payouts/my and still works, and this
// page links to it so nobody has to hunt for it.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • which lane a row is ACTUALLY in — a wage payout still at default priority reads "not promoted", never
//     "priority lane", because a worker pays for that difference in days;
//   • the exact retry time for a failure, or that no machine will retry it (a bank that rejected the account
//     will reject it forever, and "retrying" over that is the cruellest copy on this screen);
//   • how many payouts sit in a status the five tabs do not cover — nothing is invisible here;
//   • whether tonight's batch has been signed, and by which rule.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DataTable } from '../../components/DataTable';
import {
  QUEUE_TABS, earliestExecuteLocal, kpiCount, laneKey, refusalKey, retryBlockedBy, retryKey, retryView, tabFilter,
} from '../../features/payouts/org-console';
import { prepareBatchAction, retryPayoutAction } from './actions';
import type { PayoutQueuePage, PayoutBatchRow } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.title'), robots: { index: false, follow: false } };
}

export default async function PayoutsPage({ searchParams }: {
  searchParams: { tab?: string; cursor?: string; ok?: string; error?: string };
}) {
  await requireSession('/payouts');
  const t = getTranslator();
  const lang = getLang();
  const canApprove = tenantHasPerm('payout.approve');
  const canPrepare = tenantHasPerm('payout.prepare');

  if (!canApprove && !canPrepare) {
    return (
      <section>
        <h1>{t.t('po.title')}</h1>
        {/* Reflect-never-grant: the gate is the API's. A member's own withdrawals are a different page. */}
        <p className="kv-empty" role="status">{t.t('po.restricted')}</p>
        <p className="kv-pager"><Link href="/payouts/my" className="kv-btn--link">{t.t('po.myPayouts')}</Link></p>
      </section>
    );
  }

  const tab = tabFilter(searchParams.tab);
  let page: PayoutQueuePage | null = null;
  let batches: PayoutBatchRow[] = [];
  const [qRes, bRes] = await Promise.allSettled([
    tenantClient().payoutConsole.queue({ tab: tab ?? undefined, cursor: searchParams.cursor, limit: 50 }),
    tenantClient().payoutConsole.batches({ limit: 5 }),
  ]);
  if (qRes.status === 'fulfilled') page = qRes.value;
  if (bRes.status === 'fulfilled') batches = bRes.value;

  const counts = page?.counts ?? {};
  const pending = batches.find((b) => b.status === 'pending_approval');
  const approved = batches.find((b) => b.status === 'approved');

  return (
    <section>
      <h1>{t.t('po.title')}</h1>
      <p className="kv-muted">{t.t('po.intro')}</p>
      <p className="kv-field__hint">{t.t('po.makerCheckerNote')}</p>

      {searchParams.error && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.error))}</p>}
      {searchParams.ok && <p className="kv-success" role="status">{t.t(`po.ok.${searchParams.ok}`)}</p>}

      <div className="kv-cards">
        {QUEUE_TABS.map((k) => (
          <div key={k} className="kv-card kv-card--money">
            <h2 className="kv-card__title">{t.t(`po.tab.${k}`)}</h2>
            <p className="kv-card__figure">{kpiCount(counts, k)}</p>
            <p className="kv-field__hint">{t.t(`po.tabHint.${k}`)}</p>
          </div>
        ))}
      </div>

      {/* Nothing is invisible on the screen that claims to show every payout. */}
      {(page?.unmappedCount ?? 0) > 0 && (
        <p className="kv-note" role="status">{t.t('po.unmapped', { count: String(page!.unmappedCount) })}</p>
      )}

      <h2 className="kv-section-title">{t.t('po.batchTitle')}</h2>
      {pending ? (
        <div className="kv-card">
          <p>{t.t('po.batchPending', { type: pending.batchType })}</p>
          <p className="kv-pager">
            <Link href={`/payouts/batches/${pending.id}`} className="kv-btn">{t.t('po.openBatch')}</Link>
          </p>
        </div>
      ) : approved ? (
        <div className="kv-card">
          <p>{t.t('po.batchApproved', { type: approved.batchType })}</p>
          <p className="kv-pager"><Link href={`/payouts/batches/${approved.id}`} className="kv-btn--link">{t.t('po.openBatch')}</Link></p>
        </div>
      ) : canPrepare ? (
        <form action={prepareBatchAction} className="kv-card">
          <h3 className="kv-card__title">{t.t('po.prepareTitle')}</h3>
          {/* The maker submits an INSTANT from their own locale; the server derives the cut-off from the
              tenant's setting. No wall-clock 18:00 in the backend — that is a hidden timezone assumption. */}
          <label htmlFor="batchType" className="kv-field__label">{t.t('po.batchType')}</label>
          <select id="batchType" name="batchType" defaultValue="daily_settlement">
            <option value="daily_settlement">{t.t('po.batchType.daily')}</option>
            <option value="wage_lane">{t.t('po.batchType.wage')}</option>
          </select>
          <label htmlFor="executeAt" className="kv-field__label">{t.t('po.executeAt')}</label>
          <input id="executeAt" name="executeAt" type="datetime-local" required min={earliestExecuteLocal(new Date())} />
          <p className="kv-field__hint">{t.t('po.executeAtHint')}</p>
          <button type="submit" className="kv-btn">{t.t('po.prepare')}</button>
        </form>
      ) : (
        <p className="kv-field__hint">{t.t('po.prepareNoPermission')}</p>
      )}

      <h2 className="kv-section-title">{t.t('po.queueTitle')}</h2>
      <nav className="kv-tabs">
        <Link href="/payouts" className={!tab ? 'kv-tab kv-tab--active' : 'kv-tab'}>{t.t('po.tab.all')}</Link>
        {QUEUE_TABS.map((k) => (
          <Link key={k} href={`/payouts?tab=${k}`} className={tab === k ? 'kv-tab kv-tab--active' : 'kv-tab'}>
            {t.t(`po.tab.${k}`)} ({kpiCount(counts, k)})
          </Link>
        ))}
      </nav>

      {!page ? <p className="kv-error" role="alert">{t.t('po.loadError')}</p> : (
        <DataTable
          rows={page.items}
          empty={t.t(tab ? 'po.queueEmptyFiltered' : 'po.queueEmpty')}
          columns={[
            { header: t.t('po.colPayee'), cell: (r) => <>{r.payeeName ?? t.t('common.dash')} <span className="kv-muted">{r.payeePhone ?? ''}</span></> },
            { header: t.t('po.colPurpose'), cell: (r) => <span className="kv-badge">{r.purposeCode || t.t('common.dash')}</span> },
            { header: t.t('po.colReference'), cell: (r) => r.referenceId ?? t.t('common.dash') },
            { header: t.t('po.colAmount'), cell: (r) => formatMoneyMinor(r.amountMinor, r.currencyCode, lang) },
            {
              header: t.t('po.colBank'),
              cell: (r) => (
                <>
                  {r.bankLast4 ? `••${r.bankLast4}` : t.t('common.dash')}
                  {/* W146's pre-flight counts this; the row says it too, where somebody can act on it. */}
                  {!r.bankVerified && <span className="kv-badge kv-badge--warn">{t.t('po.bankUnverified')}</span>}
                </>
              ),
            },
            { header: t.t('po.colLane'), cell: (r) => <span className={`kv-badge kv-badge--${laneKey(r.lane)}`}>{t.t(`po.lane.${laneKey(r.lane)}`)}</span> },
            {
              header: t.t('po.colStatus'),
              cell: (r) => {
                const v = retryView(r.retry);
                const blocked = retryBlockedBy(r, { canApprove });
                return (
                  <>
                    <span className={`kv-badge kv-badge--${r.status}`}>{t.t(`po.status.${r.status}`)}</span>
                    {r.status === 'failed' && r.failureBucket && (
                      <span className="kv-muted"> {t.t(`po.fail.${r.failureBucket}`)}</span>
                    )}
                    {/* The exact time, or the honest alternative — never a bare "retrying". */}
                    {v.kind !== 'none' && (
                      <span className="kv-muted"> {t.t(retryKey(v), { at: v.kind === 'at' ? formatDate(v.at, lang) : '', attempts: v.kind === 'exhausted' ? String(v.attempts) : '' })}</span>
                    )}
                    {r.status === 'failed' && (blocked ? (
                      <span className="kv-field__hint">{t.t(`po.retryBlocked.${blocked}`)}</span>
                    ) : (
                      <form action={retryPayoutAction}>
                        <input type="hidden" name="payoutId" value={r.id} />
                        {tab && <input type="hidden" name="tab" value={tab} />}
                        <button type="submit" className="kv-btn--link">{t.t('po.retry')}</button>
                      </form>
                    ))}
                  </>
                );
              },
            },
          ]}
        />
      )}

      {page?.nextCursor && (
        <p className="kv-pager">
          <Link href={`/payouts?${tab ? `tab=${tab}&` : ''}cursor=${encodeURIComponent(page.nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</Link>
        </p>
      )}

      <p className="kv-field__hint">{t.t('po.idempotencyNote')}</p>
      <p className="kv-pager"><Link href="/payouts/my" className="kv-btn--link">{t.t('po.myPayouts')}</Link></p>
    </section>
  );
}
