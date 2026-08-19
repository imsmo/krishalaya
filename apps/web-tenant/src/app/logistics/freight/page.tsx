// apps/web-tenant/src/app/logistics/freight/page.tsx · W241 (Freight invoices) — what carriers bill against what
// our shipments say they should (PC-56 TENANT-5c). Server-first, requireSession-gated, noindex, keyset-paged.
// Also hosts W2616/W2617/W2618's confirm → success → failure chain for [Reconcile] and for booking a cost note.
//
// **THIS DESK DID NOT EXIST IN ANY FORM.** `freight_invoices` and `freight_invoice_lines` were created in migration
// 0070 — with RLS policies, a status vocabulary and a `payout_id` column — and have had **no entity, no repository,
// no service, no controller, no SDK method and no screen** since. The canon's own banner says as much ("Backend
// pending (DELTA-034)"), and 5a found this module's mirror-image defect: `shipment_events` had two writers and no
// reader; here were two tables with a reader-less, writer-less existence for a year.
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • **the expected side is usually empty.** W241's column header is literally "Expected (Σ charge_minor)" and
//     NOTHING on this platform writes `shipments.charge_minor` — `OrderConfirmedHandler`, which creates virtually
//     every shipment, passes no charge. So a real ₹96,440 bill would reconcile against ₹0 and every invoice would
//     read as total leakage. The desk prints the expected figure only when there IS one, and says which of the three
//     states it is in ("priced" / "partly" / "unpriced") beside every variance;
//   • **the payment cannot happen.** W241: "Carrier invoices pay from the tenant wallet through the normal rails
//     (maker-checker above ₹25,000)". `payouts.bank_account_id` is NOT NULL and `bank_accounts` requires a user or a
//     tenant — a carrier is a `logistics_partners` row, which is neither; `payout_purpose` has no freight value.
//     There is no payee. So the READY figure is printed and the missing pieces are named, and no button is drawn
//     that would 500 — or worse, appear to pay;
//   • **the variance percentage is computed.** The canon's own prose and table disagree about it ("+₹2,320" in the
//     row, "+₹2,360 … 2.5%" in the paragraph), which is what a hand-typed percentage does to a number twice;
//   • and it prints "last quarter recon recovered ₹11,840" only as a SUM OF RESOLVED LINES — the recoveries this
//     tenant actually agreed — never as the canon's illustrative figure.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import {
  FREIGHT_TABS, deskHref, deskState, emptyKey, freightErrorKey, freightOkKey, reconBadgeKey, reconHref,
  rowActionKey, showsExpected, statusKey, statusParam, stateKey, tabOf, variancePctText,
} from '../../../features/logistics/freight';
import { LOGISTICS_NAV, navLabelKey, unbuiltCount } from '../../../features/logistics/nav';
import type { FreightDeskPage } from '@krishalaya/sdk-js';
import { closeFreightAction, reconcileFreightAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('freight.title'), robots: { index: false, follow: false } };
}

/** The cycle W241's footer counts over ("3 of 3 invoices (Jun cycle)"). Computed as the current calendar month
 *  unless the URL names one — a stored "current cycle" would be a second mechanism over the same fact, and a
 *  hardcoded month name would be an untranslatable string in a console that ships in three languages. */
function cycleOf(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default async function FreightPage({ searchParams }: {
  searchParams: { tab?: string; cursor?: string; act?: string; id?: string; ok?: string; error?: string; cycleFrom?: string; cycleTo?: string };
}) {
  await requireSession('/logistics/freight');
  const t = getTranslator();
  const lang = getLang();
  const tab = tabOf(searchParams.tab);
  const cycle = cycleOf(searchParams.cycleFrom, searchParams.cycleTo);

  let desk: FreightDeskPage | null = null;
  let state = 'ok' as ReturnType<typeof deskState>;
  try {
    desk = await tenantClient().freight.list({
      reconStatus: statusParam(tab), cursor: searchParams.cursor, limit: 50,
      cycleFrom: cycle.from, cycleTo: cycle.to,
    });
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = deskState(err?.code ?? 'generic', err?.status);
  }

  const act = searchParams.act === 'reconcile' || searchParams.act === 'book' ? searchParams.act : null;
  const target = act && searchParams.id ? desk?.items.find((r) => r.id === searchParams.id) ?? null : null;
  const okKey = searchParams.ok ? freightOkKey(searchParams.ok) : null;
  const errKey = searchParams.error ? freightErrorKey(searchParams.error) : null;

  return (
    <section>
      <h1>{t.t('freight.title')}</h1>
      <p className="kv-field__hint">{t.t('freight.lead')}</p>

      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'freight' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'freight' ? 'page' : undefined}>
            {t.t(navLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>
      <p className="kv-field__hint">{t.t('logistics.nav.unbuilt')} {formatNumber(unbuiltCount(), lang)}</p>

      {okKey && <p className="kv-success" role="status">{t.t(okKey)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(errKey)}</p>}

      {/* ---- the four non-ok states W241 declares, each its own sentence and none of them "something broke" ---- */}
      {state !== 'ok' ? (
        <div className={state === 'flaggedOff' ? 'kv-card kv-card--notice' : 'kv-error'} role={state === 'flaggedOff' ? 'status' : 'alert'}>
          <p>{t.t(stateKey(state))}</p>
          {state === 'error' && <p><Link href={deskHref(tab)} className="kv-btn--link">{t.t('freight.retry')}</Link></p>}
        </div>
      ) : (
        <>
          {/* ---- W2616: the confirm step. Reconciling is not destructive; booking a cost note to ops is a
                   decision that closes a cost centre entry, and both get the explicit step (Completeness Law B4). ---- */}
          {act && target && (
            <form action={act === 'book' ? closeFreightAction : reconcileFreightAction} className="kv-card kv-card--notice">
              <h2>{t.t(act === 'book' ? 'freight.act.book.title' : 'freight.act.reconcile.title')}</h2>
              <p>
                <strong>{target.invoiceNo}</strong>
                {' · '}{target.carrierName ?? t.t('freight.carrier.unknown')}
                {' · '}{formatMoneyMinor(target.billedMinor, target.currencyCode, lang)}
                {' · '}{formatNumber(target.shipmentCount, lang)} {t.t('freight.shipmentsWord')}
              </p>
              <p>{t.t(act === 'book' ? 'freight.act.book.body' : 'freight.act.reconcile.body')}</p>
              <p className="kv-field__hint">{t.t('freight.act.audited')}</p>
              <input type="hidden" name="id" value={target.id} />
              <input type="hidden" name="back" value={deskHref(tab)} />
              {act === 'book' && <input type="hidden" name="booked" value="true" />}
              <button type="submit" className="kv-btn">{t.t('freight.act.proceed')}</button>{' '}
              <Link href={deskHref(tab)} className="kv-btn--link">{t.t('freight.act.cancel')}</Link>
            </form>
          )}

          {!act && (
            <>
              <nav className="kv-filters" aria-label={t.t('freight.tabsLabel')}>
                {FREIGHT_TABS.map((x) => (
                  <Link key={x} href={deskHref(x)} className={x === tab ? 'kv-chip is-active' : 'kv-chip'} aria-current={x === tab ? 'true' : undefined}>
                    {t.t(`freight.tab.${x}`)}
                  </Link>
                ))}
              </nav>
              <p className="kv-toolbar"><Link href="/logistics/freight/new" className="kv-btn">{t.t('freight.upload')}</Link></p>
            </>
          )}

          <DataTable
            rows={desk?.items ?? []}
            empty={t.t(emptyKey(!!searchParams.cycleFrom))}
            columns={[
              { header: t.t('freight.colReceived'), cell: (r) => formatDate(r.receivedAt, lang) },
              {
                header: t.t('freight.colInvoice'),
                cell: (r) => (
                  <>
                    <Link href={reconHref(r.id)} className="kv-link">{r.invoiceNo}</Link>
                    <br />
                    <span className="kv-field__hint">
                      {formatDate(r.periodStart, lang, { month: 'short', year: 'numeric' })}
                      {' · '}{formatNumber(r.shipmentCount, lang)} {t.t('freight.shipmentsWord')}
                      {r.sourceKind === 'own_fleet_cost_note' && <> · {t.t('freight.source.costNote')}</>}
                    </span>
                  </>
                ),
              },
              {
                header: t.t('freight.colCarrier'),
                cell: (r) => (r.sourceKind === 'own_fleet_cost_note'
                  ? t.t('freight.carrier.ownFleet')
                  : r.carrierName ?? <span className="kv-badge kv-badge--muted">{t.t('freight.carrier.unknown')}</span>),
              },
              { header: t.t('freight.colBilled'), cell: (r) => formatMoneyMinor(r.billedMinor, r.currencyCode, lang) },
              {
                header: t.t('freight.colExpected'),
                // A dash, never a zero: "₹0 expected" against a real bill reads as "we expected this to be free",
                // and for a cost note there is no expected side at all.
                cell: (r) => (showsExpected(r)
                  ? formatMoneyMinor(r.expectedMinor, r.currencyCode, lang)
                  : <span className="kv-field__hint">{t.t('common.dash')}</span>),
              },
              {
                header: t.t('freight.colRecon'),
                cell: (r) => (
                  <>
                    <span className={r.disputedLines > 0 ? 'kv-badge kv-badge--warn' : 'kv-badge'}>{t.t(reconBadgeKey(r))}</span>
                    {showsExpected(r) && r.varianceDirection !== 'level' && (
                      <> {formatMoneyMinor(r.varianceMinor, r.currencyCode, lang)}
                        {variancePctText(r.varianceBps) !== null && <> ({variancePctText(r.varianceBps)})</>}
                      </>
                    )}
                    {r.disputedLines > 0 && <> · {formatNumber(r.disputedLines, lang)} {t.t('freight.disputedWord')}</>}
                    {r.paymentHold && <> <span className="kv-badge kv-badge--muted">{t.t('freight.hold')}</span></>}
                    <br /><span className="kv-field__hint">{t.t(statusKey(r.reconStatus))}</span>
                  </>
                ),
              },
              {
                header: t.t('freight.colAction'),
                cell: (r) => {
                  const a = rowActionKey(r);
                  if (a === null) return <span className="kv-field__hint">{t.t('common.dash')}</span>;
                  if (a === 'open') return <Link href={reconHref(r.id)} className="kv-link">{t.t('freight.openRecon')}</Link>;
                  return (
                    <Link href={`${deskHref(tab)}${deskHref(tab).includes('?') ? '&' : '?'}act=${a === 'book' ? 'book' : 'reconcile'}&id=${encodeURIComponent(r.id)}`} className="kv-link">
                      {t.t(a === 'book' ? 'freight.bookToOps' : 'freight.reconcile')}
                    </Link>
                  );
                },
              },
            ]}
          />

          {/* ---- W241's footer: the cycle count, the hold policy, and the money that cannot move ---- */}
          {desk?.cycle && (
            <p className="kv-field__hint">
              {formatNumber(desk.cycle.total, lang)} {t.t('freight.cycleInvoices')}
              {' ('}{formatDate(desk.cycle.from, lang, { month: 'short', year: 'numeric' })}{') · '}
              {t.t('freight.holdPolicy')}
            </p>
          )}
          <p className="kv-field__hint">{t.t('freight.railsMissing')}</p>
          {/* One figure PER CURRENCY, and nothing at all when no dispute has ever been resolved — the canon's
              "₹11,840" is an illustration, and printing a zero as though it were this tenant's own recovery record
              would make a desk nobody has used yet look like a desk that has recovered nothing. */}
          {(desk?.recovered.length ?? 0) > 0 && (
            <p className="kv-field__hint">
              {t.t('freight.recovered')}{' '}
              {desk!.recovered.map((r) => formatMoneyMinor(r.recoveredMinor, r.currencyCode, lang)).join(' · ')}
              {' · '}{t.t('freight.recoveredHow')}
            </p>
          )}

          {desk?.nextCursor && (
            <p className="kv-pager"><a href={deskHref(tab, desk.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>
          )}
        </>
      )}
    </section>
  );
}
