// apps/web-tenant/src/app/listings/[id]/page.tsx · W124, owner listing detail (PC-56 TENANT-2b over the PC-21b page).
//
// THE PAGE IS STATUS-AWARE THE WAY THE MACHINE IS: a draft shows Submit for QC and IS the review-before-submit
// (W2358 as a real state); pending_approval shows the waiting clock and the WITHDRAW path (the bare publish verb
// is refused server-side once a listing is in the queue); rejected shows its TEACHING REASON verbatim with the
// one-tap fix-and-relist; published gets Pause, the price form, Boost and the archive danger zone. The PRICE
// HISTORY card reads the trail 0005 recorded on every change and nothing had read back until this wave. The
// ACTIVITY card shows only measured figures (offers, saves, views with their pipeline caveat) and NAMES the
// canon's "matched requirements" as the absence it is — no matcher exists; the requirements page is the real
// place demand lives. Archiving asks its reason where the act is terminal: the seller reads it.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatRelative } from '@krishalaya/i18n';
import { minorToMajor } from '../../../features/listings/form';
import { canPublish, canChangePrice, canSubmitQc, canRedraft, canPause, canArchive } from '../../../features/listings/manage';
import { canBoost } from '../../../features/listings/boost';
import { publishListingAction, changePriceAction, boostListingAction, submitQcAction, pauseListingAction, redraftListingAction, archiveListingAction } from './actions';
import type { ListingCard, BoostTier, PriceHistoryEntry, ListingAnalytics } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('listingManage.title'), robots: { index: false, follow: false } };
}

const ERROR_KEYS = new Set(['publish', 'price', 'conflict', 'failed', 'boost', 'boostfunds', 'boostfrozen', 'boosttier', 'inqc', 'archivereason', 'raced']);
const OK_KEYS = new Set(['published', 'price', 'boosted', 'created', 'submitted', 'paused', 'redrafted', 'archived']);

export default async function ListingDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  await requireSession(`/listings/${params.id}`);
  const t = getTranslator();
  const lang = getLang();

  let listing: ListingCard;
  try { listing = await tenantClient().listings.getOwn(params.id); }
  catch { notFound(); }

  const status = listing.status ?? 'draft';

  // Secondary reads degrade to absence — the page never fails because a card could not load (Law 12).
  let history: PriceHistoryEntry[] = []; let historyFailed = false;
  try { history = await tenantClient().listings.priceHistory(params.id); } catch { historyFailed = true; }
  let activity: ListingAnalytics | null = null;
  try { activity = await tenantClient().listings.analytics(params.id); } catch { activity = null; }

  let tiers: BoostTier[] = [];
  if (canBoost(status, listing.boosted)) {
    try { tiers = await tenantClient().listings.boostTiers(); } catch { tiers = []; }
  }
  const errorKey = searchParams.error && ERROR_KEYS.has(searchParams.error) ? searchParams.error : null;
  const okKey = searchParams.ok && OK_KEYS.has(searchParams.ok) ? searchParams.ok : null;

  const facts: Array<[string, string]> = [
    [t.t('listingManage.status'), t.t(`listingManage.status.${status}` as never)],
    [t.t('listingManage.price'), `${formatMoneyMinor(listing.priceMinor, listing.currencyCode, lang)} / ${listing.unitCode}`],
    [t.t('listingManage.available'), `${listing.quantityAvailable} ${listing.unitCode}`],
    [t.t('listingManage.saleType'), listing.saleType],
    [t.t('listingManage.organic'), listing.organicClaim ? t.t('listings.organicYes') : t.t('common.dash')],
    [t.t('listingManage.harvest'), listing.harvestDate ?? t.t('common.dash')],
    [t.t('listingManage.publishedAt'), listing.publishedAt ? formatRelative(listing.publishedAt, lang) : t.t('common.dash')],
    [t.t('listingManage.expires'), listing.expiresAt ? formatRelative(listing.expiresAt, lang) : t.t('common.dash')],
    [t.t('listingManage.boosted'), listing.boosted ? t.t('listingManage.boostedYes') : t.t('common.dash')],
  ];

  return (
    <section>
      <div className="kv-page-head">
        <h1>{listing.title}</h1>
        <Link href="/listings" className="kv-btn--link">← {t.t('listings.title')}</Link>
      </div>

      {okKey && <p className="kv-success" role="status">{t.t(`listingManage.ok.${okKey}` as never)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`listingManage.error.${errorKey}` as never)}</p>}

      {/* ---- the QC state, told as it is ---- */}
      {status === 'draft' && <p className="kv-fine" role="note">{t.t('listingManage.draftIsReview')}</p>}
      {status === 'pending_approval' && (
        <p className="kv-fine" role="note">
          {t.t('listingManage.waitingQc', { since: listing.qcSubmittedAt ? formatRelative(listing.qcSubmittedAt, lang) : t.t('listingManage.beforeClock') })}
        </p>
      )}
      {status === 'rejected' && (
        <p className="kv-error" role="note">
          {t.t('listingManage.rejectedWhy', { reason: listing.rejectReason ? t.t(`listingManage.rejectReason.${listing.rejectReason}` as never) : t.t('common.dash') })}
        </p>
      )}

      <dl className="kv-facts">
        {facts.map(([k, v]) => (<div key={k} className="kv-facts__row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>

      {/* ---- verbs, one form each, only where the machine allows ---- */}
      {canSubmitQc(status) && (
        <form action={submitQcAction} className="kv-inline-form">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="kv-btn">{t.t('listingManage.submitQc')}</button>
          <p className="kv-fine">{t.t('listingManage.submitQcNote')}</p>
        </form>
      )}
      {canPublish(status) && (
        <form action={publishListingAction} className="kv-inline-form">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="kv-btn">{t.t('listingManage.publish')}</button>
        </form>
      )}
      {canPause(status) && (
        <form action={pauseListingAction} className="kv-inline-form">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('listingManage.pause')}</button>
        </form>
      )}
      {canRedraft(status) && (
        <form action={redraftListingAction} className="kv-inline-form">
          <input type="hidden" name="id" value={listing.id} />
          <button type="submit" className="kv-btn kv-btn--muted">
            {status === 'rejected' ? t.t('listingManage.fixRelist') : t.t('listingManage.withdraw')}
          </button>
        </form>
      )}

      {canChangePrice(status) && (
        <form action={changePriceAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('listingManage.changePrice')}</h2>
          <input type="hidden" name="id" value={listing.id} />
          <input type="hidden" name="expectedVersion" value={String(listing.version ?? 0)} />
          <label htmlFor="priceMajor" className="kv-field__label">{t.t('listingManage.newPrice')}</label>
          <input id="priceMajor" name="priceMajor" type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?"
            className="kv-input" required defaultValue={minorToMajor(listing.priceMinor)} />
          <p className="kv-field__hint">{t.t('listingManage.priceHint')}</p>
          <button type="submit" className="kv-btn">{t.t('listingManage.savePrice')}</button>
        </form>
      )}

      {/* ---- price history: 0005's trail, read at last ---- */}
      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('listingManage.historyHeading')}</h2>
        {historyFailed ? (
          <p className="kv-fine">{t.t('listingManage.historyFailed')}</p>
        ) : history.length === 0 ? (
          <p className="kv-fine">{t.t('listingManage.historyEmpty')}</p>
        ) : (
          <ul>
            {history.map((h, i) => (
              <li key={i}>
                {h.oldPriceMinor
                  ? t.t('listingManage.historyRow', {
                      from: formatMoneyMinor(h.oldPriceMinor, listing.currencyCode, lang),
                      to: formatMoneyMinor(h.newPriceMinor, listing.currencyCode, lang),
                      who: h.changedByName ?? t.t('common.dash'), when: formatRelative(h.at, lang),
                    })
                  : t.t('listingManage.historyFirst', {
                      to: formatMoneyMinor(h.newPriceMinor, listing.currencyCode, lang),
                      who: h.changedByName ?? t.t('common.dash'), when: formatRelative(h.at, lang),
                    })}
              </li>
            ))}
          </ul>
        )}
        <p className="kv-fine">{t.t('listingManage.historyBasis')}</p>
      </div>

      {/* ---- activity: measured figures only; the absent one NAMED ---- */}
      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('listingManage.activityHeading')}</h2>
        {activity ? (
          <>
            <dl className="kv-facts">
              <div className="kv-facts__row"><dt>{t.t('listingManage.actViews')}</dt><dd>{activity.views}{activity.lastViewedAt ? ` · ${formatRelative(activity.lastViewedAt, lang)}` : ''}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('listingManage.actSaves')}</dt><dd>{activity.savedCount}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('listingManage.actOffers')}</dt><dd>{activity.offers}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('listingManage.actBoosts')}</dt><dd>{activity.boostsPurchased}</dd></div>
            </dl>
            <p className="kv-fine">{t.t('listingManage.actMatchAbsent')}</p>
          </>
        ) : (
          <p className="kv-fine">{t.t('listingManage.activityFailed')}</p>
        )}
      </div>

      {tiers.length > 0 && (
        <form action={boostListingAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('listingManage.boostHeading')}</h2>
          <p className="kv-field__hint">{t.t('listingManage.boostHint')}</p>
          <fieldset className="kv-fieldset">
            <legend className="kv-field__label">{t.t('listingManage.boostTier')}</legend>
            {tiers.map((tier, i) => (
              <label key={tier.id} className="kv-radio">
                <input type="radio" name="boostTierId" value={tier.id} defaultChecked={i === 0} required />
                <span>{t.t('listingManage.boostTierLabel', {
                  name: tier.name,
                  price: formatMoneyMinor(tier.priceMinor, listing.currencyCode, lang),
                  days: String(tier.days),
                })}</span>
              </label>
            ))}
          </fieldset>
          <input type="hidden" name="id" value={listing.id} />
          <p className="kv-field__hint">{t.t('listingManage.boostWalletNote')}</p>
          <button type="submit" className="kv-btn">{t.t('listingManage.boostBtn')}</button>
        </form>
      )}

      {/* ---- W124's danger zone: terminal, so the reason travels ---- */}
      {canArchive(status) && (
        <form action={archiveListingAction} className="kv-form kv-card">
          <h2 className="kv-card__title">{t.t('listingManage.archiveHeading')}</h2>
          <p className="kv-fine">{t.t('listingManage.archiveNote')}</p>
          <input type="hidden" name="id" value={listing.id} />
          <label htmlFor="arc-reason" className="kv-field__label">{t.t('listingManage.archiveReason')}</label>
          <input id="arc-reason" name="reason" className="kv-input" maxLength={500} placeholder={t.t('listingManage.archiveReasonHint')} />
          <button type="submit" className="kv-btn">{t.t('listingManage.archiveBtn')}</button>
          <p className="kv-fine">{t.t('listingManage.archiveRecorded')}</p>
        </form>
      )}
    </section>
  );
}
