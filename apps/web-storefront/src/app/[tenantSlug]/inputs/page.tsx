// apps/web-storefront/src/app/[tenantSlug]/inputs/page.tsx · PC-56 STORE-2a · C5 — canon W282 FARM INPUTS of one organisation's store
// (`inputs` reserved in 0204). The tenant feed filtered to the inputs subtree of the PUBLIC category tree — the root(s) whose commerce kind is
// `input_regulated` (master data, never a baked code); if the tree has none, the page says so plainly (never an invented aisle).
//   • cards carry the regulated lock — "Licence required to buy" SHOWN, never hidden (B5; canon: "the lock is shown, not hidden");
//     nothing about licences beyond the lock: licence states and the upload chain (W3092–W3095) are STORE-2b — PC-56 STORE-2b (founder D1):
//     REFUSED by name here ("a buyer licence flow does not exist yet; this product cannot be bought on the storefront"), no upload form;
//   • refused by name: FIFO / expiry on the page / "MRP-capped" / 18+ / the label helpline (no batch allocation or expiry read exists —
//     F-9 / C-2), and "This seller organisation hasn't switched on input sales" (no per-organisation inputs switch; the platform's browse
//     switch is the only one);
//   • ERROR with Retry = a reload (W3096–W3098 PARITY-DECOR); the kill-switch OFF (founder D4) → temporarily unavailable.
import type { Metadata } from 'next';
import type { CategoryNode, ListingSearchPage, StorefrontFlags } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { loadTenantProfile } from '../../../lib/storefront-data';
import { ListingCard } from '../../../components/ListingCard';
import { DirArrow } from '../../../components/DirArrow';
import { RefusalList, BrowseOff } from '../../../components/RefusalList';
import { reloadHref } from '../../../features/home/load-result';
import { browseOff, countOf, inputsRoots, readBrowse, readState, showMoreHref, toSearchQuery } from '../../../features/store2a/browse';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('inputs.title') };
}

export default async function FarmInputs({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const t = getTranslator();
  const lang = getLang();
  const slug = params.tenantSlug;
  const base = `/${slug}/inputs`;
  const api = publicClient(slug);
  const cursor = readBrowse(searchParams).cursor;
  const n = (x: number) => formatNumber(x, lang);
  const profile = await loadTenantProfile(slug);
  const org = profile.ok ? profile.data.displayName : slug;

  const flags = await readState<StorefrontFlags>(() => api.storefront.flags());
  const head = (
    <>
      <h1>{t.t('inputs.title')}</h1>
      <p className="kv-prose__lead">{t.t('inputs.lead', { org })}</p>
    </>
  );
  if (browseOff(flags)) return <section>{head}<BrowseOff /><RefusalList surface="inputs" /></section>;

  const cats = await readState<CategoryNode[]>(() => api.lookups.categories() as Promise<CategoryNode[]>);
  const roots = cats.ok ? inputsRoots(cats.data) : [];
  const root = roots[0];
  const listings = root ? await readState<ListingSearchPage>(() => api.listings.search(toSearchQuery({ category: root.id, cursor }, null))) : null;
  if (listings && browseOff(flags, listings)) return <section>{head}<BrowseOff /><RefusalList surface="inputs" /></section>;
  const failed = !cats.ok || (listings !== null && !listings.ok);
  const count = listings && listings.ok ? countOf(listings.data.total, listings.data.totalCap) : null;

  return (
    <section aria-labelledby="kv-inputs-title">
      <h1 id="kv-inputs-title">{t.t('inputs.title')}</h1>
      <p className="kv-prose__lead">{t.t('inputs.lead', { org })}</p>
      <p className="kv-state" data-kv-lock-rule="shown">{t.t('inputs.lockShown')}</p>
      {/* PC-56 STORE-2b · C5 (founder D1): the canon's licence states + "Upload renewal" chain (W3092–W3095) are REFUSED by name — a locked
          product cannot be bought on the storefront and there is no licence upload form (the cart refuses it LICENCE_REQUIRED) */}
      <p className="kv-state" data-kv-licence-flow="none">{t.t('store2b.licence.noFlow')}</p>

      {failed && (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('inputs.error')}</p>
          <a href={reloadHref(base, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
      )}
      {!failed && !root && <p className="kv-empty" data-kv-state="no-inputs-category">{t.t('inputs.noCategory')}</p>}
      {!failed && listings && listings.ok && (
        <>
          {roots.length > 1 && (
            <ul className="kv-chips">{roots.map((r) => <li key={r.id}><a href={`/${slug}?category=${encodeURIComponent(r.id)}`} className="kv-chip">{r.defaultName}</a></li>)}</ul>
          )}
          {count && <p className="kv-results-count" data-kv-count-line={count.capped ? 'capped' : 'exact'}>{t.t(count.capped ? 'browse.countCapped' : 'browse.count', { count: n(count.n) })}</p>}
          {listings.data.items.length === 0 ? (
            <div className="kv-empty" data-kv-state="empty"><p>{t.t('inputs.empty', { org })}</p><a href={`/${slug}`} className="kv-btn--link">{t.t('sellers.browseAll', { org })}</a></div>
          ) : (
            <>
              <div className="kv-grid">
                {listings.data.items.map((l) => (
                  <ListingCard key={l.id} listing={l} tenantSlug={slug} lang={lang} labels={{
                    organic: t.t('card.organic'), available: t.t('card.available'), certified: t.t('browse.organic.certified'), natural: t.t('browse.organic.natural'),
                    licence: t.t('lot.licenceRequired'),
                    soldBy: l.district ? t.t('browse.card.soldByIn', { org: l.organisation?.name ?? org, district: l.district }) : t.t('card.soldBy', { org: l.organisation?.name ?? org }),
                  }} />
                ))}
              </div>
              {listings.data.nextCursor && (
                <p className="kv-loadmore">
                  <a href={showMoreHref(base, {}, listings.data.nextCursor)} className="kv-btn" rel="next">{t.t('discover.showMore')} <DirArrow /></a>
                </p>
              )}
            </>
          )}
        </>
      )}

      <RefusalList surface="inputs" />
    </section>
  );
}
