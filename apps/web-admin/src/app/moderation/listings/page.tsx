// apps/web-admin/src/app/moderation/listings/page.tsx · W090, the held-listing queue (PC-56 ADMIN-5f).
//
// This queue had no state behind it until 0112. `listing_status` had no `held` value, nothing set one, and there was
// no hold reason or SLA column anywhere — W090 has been a list with no list. The canon told us exactly where the state
// belonged ("'held' is a listing-lifecycle state (listings module)") and it was never built.
//
// ORDERED BY DEADLINE, WORST FIRST. W090: "Hold SLA 4h: the farmer's produce is perishable and priced by the hour — a
// slow hold is itself harm. Queue pages the lead at 3h." A hold is not a filing decision; it is money stopping.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { slaClass, slaKey, formatMinor, removeBlockedKey, valueDrift, type HoldSla, type RemoveState } from '../../../features/moderation/queue';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mq.listTitle'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; tenantId: string; title: string; status: string;
  priceMinor: string; quantityAvailable: string; unitCode: string; sellerUserId: string | null;
  heldAt: string | null; holdSlaDueAt: string | null; sla: HoldSla;
  holdReason: string | null; holdSource: string | null; holdActorAdminId: string | null;
  valueAtStakeMinor: string; valueAtHoldMinor: string | null;
  removalNeedsChecker: boolean; removeState: RemoveState; removeOfferable: boolean;
  thresholdMinor: string; slaHours: number;
}

export default async function HeldListingsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();

  let rows: Row[] = []; let next: string | null = null; let notice: string | undefined;
  try {
    const r = await adminGet<Row[]>('moderation/listings', { cursor: searchParams.cursor });
    rows = r.data; next = (r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const breached = rows.filter((r) => r.sla?.kind === 'breached').length;
  const paging = rows.filter((r) => r.sla?.kind === 'page_lead').length;

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('mq.listHeading')}</h1>
      <p className="kv-muted">{t.t('mq.listLead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      {breached > 0 && <p className="kv-error" role="alert">{t.t('mq.breached', { n: String(breached) })}</p>}
      {/* W090 says the queue pages the lead at 3h. Nothing on this platform can page anybody — 0098's ladder delivers
          in-app only — so this is an in-app attention line and it says which it is. */}
      {paging > 0 && <p className="kv-notice" role="note">{t.t('mq.pageLead', { n: String(paging) })}</p>}

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('mq.col.deadline')}</th><th>{t.t('mq.col.listing')}</th><th>{t.t('mq.col.source')}</th>
          <th>{t.t('mq.col.tenant')}</th><th>{t.t('mq.col.value')}</th><th>{t.t('mq.col.sla')}</th><th>{t.t('mq.col.action')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const drift = valueDrift(r.valueAtStakeMinor, r.valueAtHoldMinor);
            const blocked = removeBlockedKey(r.removeState, r.holdActorAdminId, viewer);
            return (
              <tr key={r.id}>
                <td>{r.holdSlaDueAt ?? t.t('common.dash')}</td>
                <td><Link href={`/moderation/listings/${r.id}`}>{r.title}</Link></td>
                <td>{r.holdSource ? t.t(`mq.source.${r.holdSource}`) : t.t('common.dash')}</td>
                <td>{r.tenantId}</td>
                <td>
                  {formatMinor(r.valueAtStakeMinor)}
                  {/* The listing was edited while held: the removal threshold was judged on the older figure. */}
                  {drift.known && drift.drifted && <span className="kv-status kv-status--warn">{t.t('mq.valueDrift')}</span>}
                  {r.removalNeedsChecker && <span className="kv-status kv-status--warn">{t.t('mq.needsChecker')}</span>}
                </td>
                <td><span className={slaClass(r.sla)}>{t.t(`mq.sla.${slaKey(r.sla)}`)}</span></td>
                <td>
                  <Link href={`/moderation/listings/${r.id}`} className="kv-btn kv-btn--link">{t.t('mq.review')}</Link>
                  {blocked === 'yourOwnHold' && <div className="kv-detail__muted">{t.t('mq.removeBlocked.yourOwnHold')}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && <p className="kv-empty">{t.t('mq.listEmpty')}</p>}
      {next && <p className="kv-pager"><Link href={`/moderation/listings?cursor=${encodeURIComponent(next)}`}>{t.t('common.next')}</Link></p>}
      <p className="kv-detail__muted">{t.t('mq.holdDoctrine')}</p>
    </section>
  );
}
