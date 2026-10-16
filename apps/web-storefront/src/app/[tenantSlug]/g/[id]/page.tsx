// apps/web-storefront/src/app/[tenantSlug]/g/[id]/page.tsx · PC-56 STORE-3c · C5 — canon W279 "Group lot", under the ORGANISATION's chrome (the
// platform's /g/[id] is a door). Dynamic, server-rendered.
//
// What was true (survey 1A / F-19): no buyer surface existed — the only read was the members' authed `GET /v1/group-lots/:id`; no deadline sweep
// ran; the canon's payout copy was false. Now (`storefront.groupLot` — API B8, behind the `group_lots` flag):
//   • the store's `group_lots` flag FIRST — OFF → "this organisation does not run group lots" (honest; never "for this tenant/plan");
//   • the badge + the status (all six × three languages); H1 "<product> — building a <target> <unit> lot"; "<count> farmers pledging" (a COUNT —
//     founder D3; never a name); "Coordinated by <organisation> (coordination fee <bps as %>, shown, not hidden)"; "<pledged> of <target> <unit>
//     pledged (<bps as %>)" with a bar from the SERVER's basis points; the pledge deadline; "if the lot doesn't fill by then it closes; nothing
//     was paid, nothing is owed" (TRUE: the deadline clock, D3); the TRUE payout sentence;
//   • listed → the listing ("buy it as one purchase" — TRUE: one listing, bought through checkout); cancelled → the reason by its code + "See
//     similar lots" (THIS store's search, facet `saleType=group_lot`); not found; a load error with a Retry that reloads (W3089–W3091 DECOR —
//     "Register interest" is REFUSED by name, founder D3);
//   • no arithmetic beyond formatting: the percentages are the server's basis points printed as text (features/store3c/group-lot.ts bpsPercent).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { StorefrontFlags, StorefrontGroupLot } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { publicClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { reloadHref } from '../../../../features/home/load-result';
import { groupLotStatusKey, groupLotState, bpsPercent, cancelReasonKey, similarLotsHref, lotListingHref, groupLotHref } from '../../../../features/store3c/group-lot';
import { RefusalList } from '../../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('store3c.gl.badge'), robots: { index: false, follow: true } };
}

export default async function TenantGroupLotPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const shell = await loadTenantShell(slug);
  const org = (shell.kind === 'ok' ? shell.tenant.displayName : '') || slug;

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.group_lots !== true) {
    return (
      <section className="kv-group-lot" data-kv-state="group-lots-off">
        <h1>{t.t('store3c.gl.badge')}</h1>
        <div className="kv-state" role="status" data-kv-state="flag-off">
          <p><strong>{t.t('store3c.gl.off.title')}</strong></p>
          <p>{t.t('store3c.gl.off.body', { org })}</p>
        </div>
        <RefusalList surface="group" />
      </section>
    );
  }

  let lot: StorefrontGroupLot | null = null; let notFound = false;
  if (flags !== null) {
    try { lot = await publicClient(slug).storefront.groupLot(params.id); }
    catch (e) { notFound = e instanceof SdkError && e.isNotFound; lot = null; }
  }
  if (!lot) {
    return (
      <section className="kv-group-lot">
        <h1>{t.t('store3c.gl.badge')}</h1>
        {notFound ? <p className="kv-detail__muted" data-kv-state="not-found">{t.t('store3c.gl.notFound')}</p> : (
          <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
            <p>{t.t('store3c.gl.error')}</p>
            <a href={reloadHref(groupLotHref(slug, params.id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
          </div>
        )}
        <RefusalList surface="group" />
      </section>
    );
  }

  const state = groupLotState(lot);
  const qty = (q: string) => formatNumber(Number(q), lang);
  const unit = lot.unitCode;
  const fee = bpsPercent(lot.coordinationFeeBps);
  const progress = bpsPercent(lot.progressBps);
  const product = lot.product.name ?? t.t('store3c.card.untitled');
  return (
    <section className="kv-group-lot" data-kv-group-lot={lot.id} data-kv-state={state}>
      <p>
        <span className="kv-chip" data-kv-badge="group-lot">{t.t('store3c.gl.badge')}</span>{' '}
        <span className="kv-chip" data-kv-chip={lot.status}>{t.t(groupLotStatusKey(lot.status))}</span>
      </p>
      <h1>{t.t('store3c.gl.title', { product, target: qty(lot.targetQuantity), unit })}</h1>
      <p data-kv-pledgers={lot.pledgerCount}>{t.t('store3c.gl.pledgers', { n: formatNumber(lot.pledgerCount, lang) })}</p>
      <p data-kv-seller="organisation">{t.t('store3c.gl.coordinated', { org: lot.organisation?.name ?? org, pct: fee ?? '' })}</p>
      <p data-kv-progress={lot.progressBps}>{t.t('store3c.gl.progress', { pledged: qty(lot.pledgedQuantity), target: qty(lot.targetQuantity), unit, pct: progress ?? '' })}</p>
      <div className="kv-progress" role="progressbar" aria-label={t.t('store3c.gl.progressLabel')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(progress ?? '0')}>
        <span className="kv-progress__bar" style={{ width: `${progress ?? '0'}%` }} />
      </div>
      <p data-kv-deadline="">{t.t('store3c.gl.deadline', { date: formatDate(lot.pledgeDeadline, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
      {state === 'pledging' && <p className="kv-field__hint" data-kv-unfilled="">{t.t('store3c.gl.unfilled')}</p>}
      <p className="kv-field__hint" data-kv-payout="true">{t.t('store3c.gl.payout')}</p>

      {state === 'ready' && <p className="kv-form__notice" role="status" data-kv-state-line="ready">{t.t('store3c.gl.ready')}</p>}
      {state === 'listed' && lot.listingId && (
        <div className="kv-form__notice" role="status" data-kv-state-line="listed">
          <p>{t.t('store3c.gl.listed')}</p>
          <p><Link href={lotListingHref(slug, lot.listingId)} className="kv-btn" data-kv-listing={lot.listingId}>{t.t('store3c.gl.openListing')}</Link></p>
        </div>
      )}
      {state === 'sold' && <p className="kv-detail__muted" data-kv-state-line="sold">{t.t(lot.status === 'settled' ? 'store3c.gl.settled' : 'store3c.gl.sold')}</p>}
      {state === 'cancelled' && (
        <div className="kv-state" role="status" data-kv-state-line="cancelled" data-kv-reason={lot.cancelReasonCode ?? 'unknown'}>
          <p>{t.t('store3c.gl.cancelled', { reason: t.t(cancelReasonKey(lot.cancelReasonCode)) })}</p>
          <p><Link href={similarLotsHref(slug)} className="kv-btn" data-kv-similar="">{t.t('store3c.gl.similar')}</Link></p>
        </div>
      )}
      <RefusalList surface="group" />
      <p><Link href={`/${encodeURIComponent(slug)}`} className="kv-btn--link">{t.t('store2c.browseStore', { org })}</Link></p>
    </section>
  );
}
