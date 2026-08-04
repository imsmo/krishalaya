// apps/web-tenant/src/app/listings/page.tsx · the tenant's listings (authed, tenant-scoped by the API token).
// Keyset "next page" (never OFFSET). Money via formatMoneyMinor from the bigint-string. All copy via i18n;
// degrades to an empty/error state (Law 12); noindex.
//
// DEV-18 REAL consuming-app smoke test (packages/ui port batch 4) — this is the ONE real screen rebuilt on
// the ported library end-to-end (per the founder's own brief: "mirroring canon W123/W128's layout, with …
// data via the app's existing data conventions"). `PageHeader` replaces the old ad-hoc `.kv-page-head` div;
// the table itself moved to `<ListingsTable>` (a Client Component wrapper around `@krishalaya/ui`'s
// `DataTable` — see that file's own header comment for why a wrapper is required, not optional: `DataTable`
// is a Client Component and cannot receive this Server Component's inline `render`/`getRowKey` closures
// directly). ALL real behavior is preserved unchanged: `requireSession` gate, `tenantClient().listings.
// browse()` real fetch, keyset cursor pagination (still a plain server-rendered `<a href>` link — DataTable's
// OWN built-in `pagination` prop needs caller `onClick` callbacks, which would force this page into being a
// Client Component too for no real benefit over the existing, simpler, JS-free cursor link; this is a
// disclosed, deliberate choice, not an oversight), Law-12 degrade-to-error-state on fetch failure, and every
// i18n string.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import type { ListingCard } from '@krishalaya/sdk-js';
import { PageHeader } from '@krishalaya/ui';
import type { DataTableState } from '@krishalaya/ui';
import { ListingsTable } from '../../components/ListingsTable';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('listings.title'), robots: { index: false, follow: false } };
}

export default async function ListingsPage({ searchParams }: { searchParams: { cursor?: string; created?: string } }) {
  await requireSession('/listings');
  const t = getTranslator();
  const lang = getLang();
  let items: ListingCard[] = []; let nextCursor: string | null = null; let failed = false;
  try { const p = await tenantClient().listings.browse({ cursor: searchParams.cursor, limit: 50 }); items = p.items; nextCursor = p.nextCursor; }
  catch (e) { failed = true; console.error('[listings] load failed:', e); }

  const state: DataTableState = failed ? 'error' : items.length === 0 ? 'empty' : 'default';

  return (
    <section>
      <PageHeader
        title={t.t('listings.title')}
        actions={<Link href="/listings/new" className="kv-btn">{t.t('listings.newCta')}</Link>}
      />
      {searchParams.created && <p className="kv-success" role="status">{t.t('listingNew.created')}</p>}
      <ListingsTable
        items={items}
        state={state}
        lang={lang}
        caption={t.t('listings.title')}
        emptyTitle={t.t('listings.empty')}
        errorTitle={t.t('listings.loadError')}
        colTitle={t.t('listings.colTitle')}
        colPrice={t.t('listings.colPrice')}
        colAvailable={t.t('listings.colAvailable')}
        colType={t.t('listings.colType')}
        colOrganic={t.t('listings.colOrganic')}
        organicYes={t.t('listings.organicYes')}
        dash={t.t('common.dash')}
      />
      {nextCursor && <p className="kv-pager"><a href={`/listings?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
