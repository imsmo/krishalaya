// apps/web-storefront/src/components/DataTable.tsx · the shared, accessible, server-pagination-friendly table the
// spec calls for (orders, etc. render through it). Presentational + framework-pure (no client hooks), so it works
// in Server Components. Columns declare an optional `render` (e.g. money via formatMoneyMinor) so callers never
// inline formatting; keyset pagination is a plain "next" link (an href the caller builds from its cursor — never
// OFFSET). A `caption` is required for screen-reader context; an empty data set renders `emptyText`, not a blank.
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Column<T> {
  /** Stable column id (also the default cell accessor when `render` is omitted). */
  key: string;
  /** Visible, already-translated header label. */
  header: string;
  /** Cell renderer; defaults to String((row as any)[key]). Format money/dates HERE, never in the page. */
  render?: (row: T) => ReactNode;
  /** Logical alignment (PC-56 STORE-CLOSE · RTL spot-check: was 'left' | 'right' — a physical side that does not mirror under dir="rtl"). */
  align?: 'start' | 'end' | 'center';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Screen-reader caption describing the table (required for a11y). */
  caption: string;
  emptyText: string;
  /** Keyset "next page" target (the caller builds it from its cursor). Omit when there's no next page. */
  nextHref?: string;
  nextLabel?: string;
}

export function DataTable<T>({ columns, rows, getRowKey, caption, emptyText, nextHref, nextLabel = 'Next' }: DataTableProps<T>) {
  if (rows.length === 0) return <p className="kv-table__empty">{emptyText}</p>;
  return (
    <div className="kv-table__wrap">
      <table className="kv-table">
        <caption className="kv-table__caption">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.align ? { textAlign: c.align } : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>
                  {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {nextHref && <div className="kv-table__pager"><Link href={nextHref} className="kv-btn kv-btn--ghost" rel="next">{nextLabel}</Link></div>}
    </div>
  );
}
