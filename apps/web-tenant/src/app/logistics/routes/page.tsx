// apps/web-tenant/src/app/logistics/routes/page.tsx · W231 (Delivery routes) — the recurring runs (PC-56 TENANT-5b).
// Server-first, requireSession-gated, noindex. Keyset-paged; the tab rides in the URL. Also hosts W2406/W2407/
// W2408's confirm → success → failure chain for [Approve route], suspending and restarting.
//
// **EVERY ROUTE WAS LIVE THE INSTANT IT WAS TYPED.** `delivery_routes` carried `is_active NOT NULL DEFAULT true`
// and the entity set it TRUE on create, so W231's `(proposed)` row could not exist, [Approve route] had nothing to
// approve, and the Village-Run consolidation job — which selects `is_active AND run_weekday = today` — would have
// begun notifying a named ambassador about a run nobody had committed to. 0152 gives the route one state machine
// (proposed → active → inactive) with `is_active` GENERATED from it, and the approval records who committed the
// vehicle and the person.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • "Parcels/run avg" MEASURED versus ESTIMATED. `shipments.route_id` has existed since 0007 and is written by
//     nothing, so the number cannot come from a route↔shipment link; it is counted from delivered shipments whose
//     drop village is on the route, on the route's own weekday. For a proposal that is an estimate, and the word
//     "est." — which W231 itself prints on that row — is kept;
//   • the economics with ONE side. The ad-hoc cost per parcel is real (`shipments.charge_minor`); a planned run's
//     cost is recorded nowhere on this platform, so the "₹28/parcel" half of W231's comparison is named as
//     unrecorded instead of being divided out of an imagined lorry hire. So is the "only above 9 parcels/run"
//     break-even, which is the same missing number seen from the other side;
//   • and that "Suggest routes" is a corridor LIST a person reads, not a tool that creates routes — because a
//     button that silently proposed routes would be committing vehicles on the strength of a GROUP BY.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import {
  ROUTE_TABS, actionHref, approvalKey, approveConfirmKey, boardHref, breakEvenKey, canApprove, consolidationKey,
  dayLabelKey, economicsKey, isProposal, isRouteAction, parcelsKey, parcelsValue, routeCostKey, routeErrorKey,
  routeOkKey, statusKey, statusParam, suggestKey, tabOf, tierKey, villagesOverflowKey,
} from '../../../features/logistics/routes';
import { LOGISTICS_NAV, navLabelKey } from '../../../features/logistics/nav';
import type { AmbassadorProfile, FleetRegisterPage, RouteBoardPage, RouteCorridor } from '@krishalaya/sdk-js';
import { approveRouteAction, setRouteActiveAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('route.title'), robots: { index: false, follow: false } };
}

export default async function RoutesPage({ searchParams }: {
  searchParams: { tab?: string; cursor?: string; act?: string; id?: string; ok?: string; error?: string };
}) {
  await requireSession('/logistics/routes');
  const t = getTranslator();
  const lang = getLang();
  const tab = tabOf(searchParams.tab);

  let board: RouteBoardPage | null = null;
  let failed = false;
  try {
    board = await tenantClient().routes.board({ status: statusParam(tab), cursor: searchParams.cursor, limit: 50 });
  } catch { failed = true; }

  const act = isRouteAction(searchParams.act) ? searchParams.act : null;
  const target = act && searchParams.id ? board?.items.find((r) => r.id === searchParams.id) ?? null : null;

  // The approval confirm step OFFERS the two commitments, because W231's proposal row shows `unassigned` and the
  // restricted state says approval "commits a vehicle + ambassador weekly" — the choice belongs to that moment.
  let vehicles: FleetRegisterPage['items'] = [];
  let ambassadors: AmbassadorProfile[] = [];
  if (act === 'approve' && target) {
    const [v, a] = await Promise.allSettled([
      tenantClient().fleet.register({ activeOnly: true, limit: 100 }),
      tenantClient().ambassadors.list({ activeOnly: true, limit: 100 }),
    ]);
    vehicles = v.status === 'fulfilled' ? v.value.items : [];
    ambassadors = a.status === 'fulfilled' ? a.value.items : [];
  }

  // The corridor list stands in for a "Suggest routes" tool that does not exist. Only fetched when there is
  // nothing to show, which is exactly W231's second empty state.
  let corridors: RouteCorridor[] = [];
  if (board && board.items.length === 0) {
    const c = await Promise.allSettled([tenantClient().routes.corridors()]);
    corridors = c[0].status === 'fulfilled' ? c[0].value.items : [];
  }

  const okKey = searchParams.ok ? routeOkKey(searchParams.ok) : null;
  const errKey = searchParams.error ? routeErrorKey(searchParams.error) : null;

  return (
    <section>
      <h1>{t.t('route.title')}</h1>
      <p className="kv-field__hint">{t.t('route.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'routes' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'routes' ? 'page' : undefined}>
            {t.t(navLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>

      {okKey && <p className="kv-success" role="status">{t.t(okKey)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(errKey)}</p>}

      {/* ---- W2406: confirm. Approving commits a named person's day, every week — said out loud. ---- */}
      {act === 'approve' && target && (
        <form action={approveRouteAction} className="kv-card kv-card--notice">
          <h2>{t.t('route.approve.title')}</h2>
          <p><strong>{target.name}</strong> · {t.t(dayLabelKey(target.dayKey, target.onDemand))} · {target.villages.total} {t.t('route.villagesWord')}</p>
          <p>{t.t(approveConfirmKey())}</p>
          {/* The measured side of the math, in front of the person committing the truck. */}
          <p className="kv-field__hint">
            {t.t(parcelsKey(target.parcels))}{parcelsValue(target.parcels) !== null ? ` ${parcelsValue(target.parcels)}` : ''}
            {' · '}
            {/* The key comes from the shared rule, so the confirm screen and any other reader of the economics
                cannot disagree about which sentence a verdict deserves. Money via formatMoneyMinor, never client
                arithmetic (Law 2) — and only when there IS a baseline. */}
            {t.t(economicsKey(target.economics))}
            {target.economics.kind === 'ad_hoc_only' && ` ${formatMoneyMinor(target.economics.adHocPerParcelMinor, target.economics.currencyCode, lang)}`}
          </p>
          <p className="kv-field__hint">{t.t(routeCostKey())} · {t.t(breakEvenKey())}</p>

          <label className="kv-field__label" htmlFor="a-vehicle">{t.t('route.form.vehicle')}</label>
          <select id="a-vehicle" name="vehicleId" className="kv-input" defaultValue={target.vehicle?.id ?? ''}>
            <option value="">{t.t('common.dash')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.regNoMasked}</option>)}
          </select>
          <label className="kv-field__label" htmlFor="a-point">{t.t('route.form.consolidation')}</label>
          <select id="a-point" name="consolidationUserId" className="kv-input" defaultValue={target.consolidation?.userId ?? ''}>
            <option value="">{t.t('common.dash')}</option>
            {ambassadors.map((a) => <option key={a.id} value={a.userId}>{a.userId.slice(0, 8)}…</option>)}
          </select>
          <input type="hidden" name="id" value={target.id} />
          <p className="kv-field__hint">{t.t('route.approve.audited')}</p>
          <button type="submit" className="kv-btn">{t.t('route.approve.proceed')}</button>{' '}
          <Link href={boardHref(tab)} className="kv-btn--link">{t.t('route.approve.cancel')}</Link>
        </form>
      )}
      {(act === 'suspend' || act === 'restart') && target && (
        <form action={setRouteActiveAction} className="kv-card kv-card--notice">
          <h2>{t.t(act === 'suspend' ? 'route.suspend.title' : 'route.restart.title')}</h2>
          <p><strong>{target.name}</strong> · {t.t(dayLabelKey(target.dayKey, target.onDemand))}</p>
          <p>{t.t(act === 'suspend' ? 'route.suspend.body' : 'route.restart.body')}</p>
          <input type="hidden" name="id" value={target.id} />
          <input type="hidden" name="isActive" value={act === 'restart' ? 'true' : 'false'} />
          <button type="submit" className="kv-btn">{t.t('route.approve.proceed')}</button>{' '}
          <Link href={boardHref(tab)} className="kv-btn--link">{t.t('route.approve.cancel')}</Link>
        </form>
      )}

      {!act && (
        <>
          <nav className="kv-filters" aria-label={t.t('route.tabsLabel')}>
            {ROUTE_TABS.map((x) => (
              <Link key={x} href={boardHref(x)} className={x === tab ? 'kv-chip is-active' : 'kv-chip'} aria-current={x === tab ? 'true' : undefined}>
                {t.t(`route.tab.${x}`)}
              </Link>
            ))}
          </nav>
          <p className="kv-toolbar"><Link href="/logistics/routes/new" className="kv-btn">{t.t('route.new')}</Link></p>
        </>
      )}

      {failed || !board ? (
        // W231's error state: "Scheduled runs are unaffected. Retry." A board that will not load does not cancel
        // a Saturday (Law 12).
        <p className="kv-error" role="alert">{t.t('route.loadError')}</p>
      ) : (
        <>
          <DataTable
            rows={board.items}
            empty={t.t('route.empty')}
            columns={[
              {
                header: t.t('route.colRoute'),
                cell: (r) => (
                  <>
                    <strong>{r.name}</strong>
                    {isProposal(r.status) && <> <span className="kv-badge kv-badge--warn">{t.t(statusKey(r.status))}</span></>}
                    {r.status === 'inactive' && <> <span className="kv-badge kv-badge--muted">{t.t(statusKey(r.status))}</span></>}
                  </>
                ),
              },
              { header: t.t('route.colDay'), cell: (r) => t.t(dayLabelKey(r.dayKey, r.onDemand)) },
              {
                header: t.t('route.colVillages'),
                cell: (r) => (
                  <>
                    {r.villages.names.join(', ') || t.t('common.dash')}
                    {villagesOverflowKey(r.villages.more) && <> +{r.villages.more}</>}
                  </>
                ),
              },
              {
                header: t.t('route.colConsolidation'),
                cell: (r) => (r.consolidation
                  ? <>{r.consolidation.name ?? r.consolidation.userId.slice(0, 8)}{tierKey(r.consolidation.tierCode) ? ` (${t.t(tierKey(r.consolidation.tierCode)!)})` : ''}</>
                  : <span className="kv-badge kv-badge--warn">{t.t(consolidationKey(r.consolidation)!)}</span>),
              },
              {
                header: t.t('route.colVehicle'),
                cell: (r) => (r.vehicle ? r.vehicle.regNoMasked : <span className="kv-badge kv-badge--warn">{t.t('route.vehicle.unassigned')}</span>),
              },
              {
                header: t.t('route.colParcels'),
                cell: (r) => {
                  const v = parcelsValue(r.parcels);
                  return <>{v === null ? t.t('route.parcels.none') : `${t.t(parcelsKey(r.parcels))} ${v}`}</>;
                },
              },
              {
                header: t.t('route.colAction'),
                cell: (r) => (
                  <>
                    {canApprove(r.approval)
                      ? <Link href={actionHref('approve', r.id)} className="kv-link">{t.t('route.approveRoute')}</Link>
                      : (approvalKey(r.approval) && r.status === 'proposed'
                          ? <span className="kv-badge kv-badge--warn">{t.t(approvalKey(r.approval)!)}</span>
                          : null)}
                    {r.status === 'proposed' && !canApprove(r.approval) && <> <Link href={actionHref('approve', r.id)} className="kv-link">{t.t('route.commit')}</Link></>}
                    {r.status === 'active' && <Link href={actionHref('suspend', r.id)} className="kv-link">{t.t('route.suspendRoute')}</Link>}
                    {r.status === 'inactive' && r.approvedAt && <Link href={actionHref('restart', r.id)} className="kv-link">{t.t('route.restartRoute')}</Link>}
                  </>
                ),
              },
            ]}
          />

          {board.items.length > 0 && (
            <p className="kv-field__hint">
              {t.t('route.counts')} {board.counts.active} · {board.counts.proposed} · {board.counts.inactive}
              {' · '}{t.t('route.window')} {board.windowDays}
            </p>
          )}

          {/* W231's economics paragraph, with the half that exists and the half that does not, per route. */}
          {board.items.length > 0 && <p className="kv-field__hint">{t.t(routeCostKey())} · {t.t(breakEvenKey())}</p>}

          {/* ---- W231's second empty state: the corridors, and what they are not ---- */}
          {board.items.length === 0 && (
            <div className="kv-card">
              <h2>{t.t('route.suggest.title')}</h2>
              <p className="kv-field__hint">{t.t(suggestKey())}</p>
              {corridors.length === 0 ? (
                <p className="kv-field__hint">{t.t('route.suggest.none')}</p>
              ) : (
                <ul>
                  {corridors.map((c) => (
                    <li key={`${c.regionId}-${c.dayKey ?? 'x'}`}>
                      {c.villageName ?? c.regionId.slice(0, 8)} · {t.t(dayLabelKey(c.dayKey, false))} · {c.parcels}
                      {' · '}{formatMoneyMinor(c.spentMinor, 'INR', lang)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {board.nextCursor && (
            <p className="kv-pager"><a href={boardHref(tab, board.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>
          )}
        </>
      )}
    </section>
  );
}
