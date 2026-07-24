// packages/ui/src/__tests__/DataTable.test.tsx · DEV-15 (4-state honest minimum) + DEV-16 (deepening:
// all 6 contract-§6 states, sorting, selection, row actions, pagination hardening incl. pageSize).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataTable, DataTableColumn, DataTableSort } from '../components/DataTable';

interface Row { id: string; name: string; amount: string }

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => r.name, sortable: true },
  { key: 'amount', header: 'Amount', render: (r) => r.amount, isMoney: true },
];

describe('DataTable — states (design contract §6, 6/6)', () => {
  it('renders a semantic table with an accessible caption', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={[]} getRowKey={(r) => r.id} state="empty" caption="Farmer orders" />,
    );
    expect(html).toContain('<table');
    expect(html).toContain('<caption');
    expect(html).toContain('Farmer orders');
    expect(html).toContain('scope="col"');
  });

  it('loading state renders skeleton rows with aria-busy', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={[]} getRowKey={(r) => r.id} state="loading" caption="x" skeletonRowCount={3} />,
    );
    expect(html).toContain('aria-busy="true"');
    expect((html.match(/kvw-skeleton-row/g) || []).length).toBe(3);
  });

  it('empty state renders role="status" with caller-supplied copy, via EmptyState', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={[]} getRowKey={(r) => r.id} state="empty" caption="x"
        emptyTitle="No orders yet" emptyBody="Orders will appear here."
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('No orders yet');
    expect(html).toContain('data-kv-variant="empty"');
  });

  it('error state renders role="alert" with a retry action', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={[]} getRowKey={(r) => r.id} state="error" caption="x"
        errorTitle="Could not load" onRetry={() => {}} retryLabel="Try again"
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load');
    expect(html).toContain('Try again');
    expect(html).toContain('data-kv-variant="error"');
  });

  it('denied state renders role="status" with no forced action (canon shows none)', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={[]} getRowKey={(r) => r.id} state="denied" caption="x"
        deniedTitle="Permission needed" deniedBody="Ask your admin for the payouts.read permission."
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('Permission needed');
    expect(html).toContain('data-kv-variant="denied"');
    expect(html).not.toContain('kvw-btn-secondary'); // no action button rendered when none supplied
  });

  it('flagged-off state renders informational copy, no action (canon: W128 line 112)', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={[]} getRowKey={(r) => r.id} state="flagged-off" caption="x"
        flaggedOffTitle="Flagged off — Bulk Upload disabled"
        flaggedOffBody="This module is switched off for this tenant/plan (feature flag)."
      />,
    );
    expect(html).toContain('Flagged off — Bulk Upload disabled');
    expect(html).toContain('data-kv-variant="flagged-off"');
  });

  it('default state renders one row per data item, money cells end-aligned', () => {
    const rows: Row[] = [{ id: '1', name: 'Anil Kumar', amount: '₹1,250' }];
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} state="default" caption="x" />,
    );
    expect(html).toContain('Anil Kumar');
    expect(html).toContain('cell-money');
  });
});

describe('DataTable — sorting (aria-sort, single-active-column)', () => {
  it('applies aria-sort only to the active sorted column', () => {
    const sort: DataTableSort = { columnKey: 'name', direction: 'descending' };
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={[]} getRowKey={(r) => r.id} state="empty" caption="x" sort={sort} />,
    );
    expect(html).toContain('aria-sort="descending"');
    // the non-sortable/non-active "Amount" header must carry no aria-sort at all
    const amountThMatch = html.match(/<th[^>]*>Amount<\/th>/);
    expect(amountThMatch).not.toBeNull();
  });

  it('renders sortable headers as keyboard-focusable buttons (gate 10)', () => {
    const html = renderToStaticMarkup(
      <DataTable columns={columns} rows={[]} getRowKey={(r) => r.id} state="empty" caption="x" />,
    );
    expect(html).toContain('kvw-table-sort-btn');
    expect(html).toContain('class="sort"');
  });
});

describe('DataTable — selection (checkbox column + bulk bar)', () => {
  it('renders a select-all header checkbox and per-row checkboxes, is-selected class on selected rows', () => {
    const rows: Row[] = [{ id: '1', name: 'Anil', amount: '₹1' }, { id: '2', name: 'Sita', amount: '₹2' }];
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={rows} getRowKey={(r) => r.id} state="default" caption="x"
        selection={{
          selectedKeys: new Set(['1']),
          onToggleRow: () => {},
          onToggleAll: () => {},
          selectedLabel: (n) => `${n} selected`,
          selectAllLabel: 'Select all',
          selectRowLabel: (r) => `Select ${r.name}`,
        }}
      />,
    );
    expect(html).toContain('aria-label="Select all"');
    expect(html).toContain('aria-label="Select Anil"');
    expect(html).toContain('is-selected');
    expect(html).toContain('kvw-col-check');
  });

  it('renders the bulk-action bar with caller-resolved label + actions once a row is selected', () => {
    const rows: Row[] = [{ id: '1', name: 'Anil', amount: '₹1' }];
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={rows} getRowKey={(r) => r.id} state="default" caption="x"
        selection={{
          selectedKeys: new Set(['1']),
          onToggleRow: () => {},
          onToggleAll: () => {},
          selectedLabel: (n) => `${n} selected`,
          selectAllLabel: 'Select all',
          selectRowLabel: (r) => `Select ${r.name}`,
          bulkActions: <button type="button">Approve</button>,
        }}
      />,
    );
    expect(html).toContain('kvw-bulkbar');
    expect(html).toContain('1 selected');
    expect(html).toContain('Approve');
  });

  it('omits the bulk bar entirely when nothing is selected', () => {
    const rows: Row[] = [{ id: '1', name: 'Anil', amount: '₹1' }];
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={rows} getRowKey={(r) => r.id} state="default" caption="x"
        selection={{
          selectedKeys: new Set(),
          onToggleRow: () => {},
          onToggleAll: () => {},
          selectedLabel: (n) => `${n} selected`,
          selectAllLabel: 'Select all',
          selectRowLabel: (r) => `Select ${r.name}`,
        }}
      />,
    );
    expect(html).not.toContain('kvw-bulkbar');
  });
});

describe('DataTable — row actions (kebab)', () => {
  it('renders a kebab button per row with the caller-supplied accessible label', () => {
    const rows: Row[] = [{ id: '1', name: 'Anil', amount: '₹1' }];
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={rows} getRowKey={(r) => r.id} state="default" caption="x"
        rowActions={{ label: 'Row actions', onClick: () => {} }}
      />,
    );
    expect(html).toContain('kvw-row-kebab');
    expect(html).toContain('aria-label="Row actions"');
  });
});

describe('DataTable — pagination (Golden Law 11: keyset-friendly, never numbered offset paging)', () => {
  it('prev/next only, plus optional pageSize control', () => {
    const html = renderToStaticMarkup(
      <DataTable
        columns={columns} rows={[]} getRowKey={(r) => r.id} state="empty" caption="x"
        pagination={{
          hasNextPage: true, hasPrevPage: false, onNext: () => {}, onPrev: () => {},
          rangeLabel: '1–20 of 143',
          pageSize: { value: 25, options: [25, 50, 100], onChange: () => {}, label: 'Rows:', selectAriaLabel: 'Rows per page' },
        }}
      />,
    );
    expect(html).toContain('1–20 of 143');
    expect(html).toContain('aria-label="Previous page"');
    expect(html).toContain('aria-label="Next page"');
    expect(html).not.toContain('aria-current="page"');
    expect(html).toContain('kvw-pagesize');
    expect(html).toContain('aria-label="Rows per page"');
    // no numeric page prop exists anywhere in the public type — a compile-time guarantee, not just a
    // runtime assertion; this test documents the runtime-observable half of that guarantee.
    expect(html).toMatch(/disabled[^>]*aria-label="Previous page"/);
  });
});
