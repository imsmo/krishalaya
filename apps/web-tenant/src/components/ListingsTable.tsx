'use client';
// apps/web-tenant/src/components/ListingsTable.tsx · DEV-18 REAL consuming-app smoke test (packages/ui
// port batch 4) — client boundary wrapper around `@krishi-verse/ui`'s `DataTable`.
//
// WHY THIS FILE EXISTS (the real RSC-boundary lesson this batch's smoke test was built to surface, see
// `dev18_report.md`): `DataTable` is a Client Component (it uses `useRef`/`useEffect` internally — this
// batch's own QA-FIX to a pre-existing DEV-15/16 gap, see `DataTable.tsx`'s header comment). Next.js's App
// Router does NOT allow a Server Component (like `listings/page.tsx`) to pass its own inline function props
// (a `render: (row) => ...` closure, a `getRowKey` closure) across the server→client boundary — functions
// are not serializable. The fix is the standard Next.js pattern: the Server Component page fetches data and
// passes only PLAIN, SERIALIZABLE values (the `items` array, already-i18n-resolved strings, the `state`
// enum) into this small Client Component, which builds the column/render closures HERE — on the client
// side, where defining a fresh function is completely normal (no boundary crossed, because both the
// closures and the component that consumes them now live on the same side).
import Link from 'next/link';
import { DataTable } from '@krishi-verse/ui';
import type { DataTableColumn, DataTableState } from '@krishi-verse/ui';
import { formatMoneyMinor } from '@krishi-verse/i18n';
import type { ListingCard } from '@krishi-verse/sdk-js';

export interface ListingsTableProps {
  items: ListingCard[];
  state: DataTableState;
  lang: string;
  caption: string;
  emptyTitle: string;
  errorTitle: string;
  colTitle: string;
  colPrice: string;
  colAvailable: string;
  colType: string;
  colOrganic: string;
  organicYes: string;
  dash: string;
}

export function ListingsTable({
  items, state, lang, caption, emptyTitle, errorTitle,
  colTitle, colPrice, colAvailable, colType, colOrganic, organicYes, dash,
}: ListingsTableProps) {
  const columns: DataTableColumn<ListingCard>[] = [
    {
      key: 'title', header: colTitle,
      render: (l) => <Link href={`/listings/${l.id}`} className="kv-link">{l.title}</Link>,
    },
    {
      key: 'price', header: colPrice, isMoney: true,
      render: (l) => `${formatMoneyMinor(l.priceMinor, l.currencyCode, lang)} / ${l.unitCode}`,
    },
    { key: 'available', header: colAvailable, render: (l) => `${l.quantityAvailable} ${l.unitCode}` },
    { key: 'type', header: colType, render: (l) => l.saleType },
    { key: 'organic', header: colOrganic, render: (l) => (l.organicClaim ? organicYes : dash) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      getRowKey={(l) => l.id}
      state={state}
      caption={caption}
      emptyTitle={emptyTitle}
      errorTitle={errorTitle}
    />
  );
}
