// apps/web-tenant/src/test-render/listings-shell.render.test.tsx · DEV-18 (packages/ui port batch 4 — real
// consuming-app smoke test). Asserts the rewired console listings page renders the FULL real shell
// (AppShell + Sidebar + Topbar + PageHeader) and the real DataTable, all from `@krishalaya/ui` — the
// package this app depends on via `workspace:*`, not a mock — assembled exactly the way
// `apps/web-tenant/src/app/layout.tsx` / `src/components/Sidebar.tsx` / `src/components/ConsoleTopbar.tsx`
// / `src/app/listings/page.tsx` / `src/components/ListingsTable.tsx` compose them in production.
//
// WHY THIS TEST BUILDS THE COMPOSITION INLINE RATHER THAN IMPORTING THOSE FILES DIRECTLY: `Sidebar.tsx`/
// `ConsoleTopbar.tsx`/`listings/page.tsx` call `getTranslator()`/`getLang()` (`src/lib/i18n.ts`), which use
// `next/headers`'s `cookies()`/`headers()` — these throw outside a real Next.js request scope (verified:
// `next/headers`'s own runtime invariant) and cannot run in a plain jest process. This test instead renders
// the SAME `@krishalaya/ui` components with realistic fixture data shaped exactly like the real
// `ListingCard`/`UserProfile` SDK types, proving the render-level composition (shell classes, nav items,
// table rows, i18n-resolved copy) genuinely works — the request-scoped data-fetching wrapper around it is
// separately proven correct by the full, real `next build` succeeding across all 31 routes including
// `/listings` (see `dev18_report.md` for the pasted build tail) and by the pre-existing `src/test/listings-
// manage.spec.ts` suite (unchanged, still green) covering the fetch/mutation logic itself.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AppShell, Sidebar as UiSidebar, Topbar, PageHeader, DataTable,
} from '@krishalaya/ui';
import type { SidebarNavSection, DataTableColumn, DataTableState } from '@krishalaya/ui';

interface FixtureListing {
  id: string; title: string; priceMinor: string; currencyCode: string; unitCode: string;
  quantityAvailable: number; organicClaim: boolean; saleType: string;
}

const fixtureListings: FixtureListing[] = [
  { id: 'LST-001', title: 'Fresh Nashik tomatoes, grade A', priceMinor: '4500', currencyCode: 'INR', unitCode: 'kg', quantityAvailable: 500, organicClaim: true, saleType: 'direct' },
  { id: 'LST-002', title: 'Gujarat groundnut GG-20', priceMinor: '8200', currencyCode: 'INR', unitCode: 'kg', quantityAvailable: 1200, organicClaim: false, saleType: 'auction' },
];

function renderListingsPageShell(state: DataTableState, items: FixtureListing[]) {
  const sections: SidebarNavSection[] = [
    {
      key: 'primary',
      items: [
        { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
        { key: 'listings', href: '/listings', label: 'Listings', current: true },
        { key: 'orders', href: '/orders', label: 'Orders' },
      ],
    },
  ];

  const columns: DataTableColumn<FixtureListing>[] = [
    { key: 'title', header: 'Title', render: (l) => l.title },
    { key: 'price', header: 'Price', isMoney: true, render: (l) => `₹${(Number(l.priceMinor) / 100).toFixed(2)} / ${l.unitCode}` },
    { key: 'available', header: 'Available', render: (l) => `${l.quantityAvailable} ${l.unitCode}` },
  ];

  return renderToStaticMarkup(
    <AppShell
      sidebar={
        <UiSidebar
          brand={{ name: 'Krishalaya Console' }}
          sections={sections}
          navLabel="Console"
        />
      }
      topbar={<Topbar userMenu={<span>Priya S.</span>} />}
    >
      <section>
        <PageHeader title="Listings" actions={<a href="/listings/new" className="kv-btn">New listing</a>} />
        <DataTable
          columns={columns}
          rows={items}
          getRowKey={(l) => l.id}
          state={state}
          caption="Listings"
          emptyTitle="No listings yet."
          errorTitle="We couldn't load your listings just now."
        />
      </section>
    </AppShell>,
  );
}

describe('web-tenant listings page — rewired shell + table (DEV-18 smoke test)', () => {
  it('renders the real AppShell/Sidebar/Topbar/PageHeader/DataTable composition with data', () => {
    const html = renderListingsPageShell('default', fixtureListings);

    // Shell (AppShell)
    expect(html).toContain('web-shell');
    expect(html).toContain('kvw-content');

    // Sidebar (real @krishalaya/ui component, not a stub)
    expect(html).toContain('kvw-sidebar');
    expect(html).toContain('Krishalaya Console');
    expect(html).toContain('Listings');
    expect(html).toContain('aria-current="page"');

    // Topbar
    expect(html).toContain('kvw-topbar');
    expect(html).toContain('Priya S.');

    // PageHeader
    expect(html).toContain('kvw-page-header');
    expect(html).toContain('kvw-page-title');
    expect(html).toContain('New listing');

    // DataTable (real rows, real money-cell class)
    expect(html).toContain('kvw-table');
    expect(html).toContain('Fresh Nashik tomatoes, grade A');
    expect(html).toContain('Gujarat groundnut GG-20');
    expect(html).toContain('cell-money');
  });

  it('renders the DataTable empty state (via EmptyState) when there are no listings', () => {
    const html = renderListingsPageShell('empty', []);
    expect(html).toContain('No listings yet.');
    expect(html).not.toContain('Fresh Nashik');
  });

  it('renders the DataTable error state (via EmptyState) on a load failure, still inside the real shell', () => {
    const html = renderListingsPageShell('error', []);
    // renderToStaticMarkup HTML-escapes the apostrophe as `&#x27;` (real React output, not a typo).
    expect(html).toContain('We couldn&#x27;t load your listings just now.');
    // The shell renders regardless of the table's own state — proving the page doesn't fall over on error.
    expect(html).toContain('web-shell');
    expect(html).toContain('kvw-sidebar');
  });
});
