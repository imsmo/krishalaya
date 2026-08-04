// apps/web-ops/src/components/DataTable.tsx · a tiny accessible table for console list views (server
// component — no client JS). Columns map a row to display cells; an empty list shows a friendly message.
export interface Column<T> { header: string; cell: (row: T) => React.ReactNode; }
export function DataTable<T>({ columns, rows, empty = 'Nothing here yet.' }: { columns: Column<T>[]; rows: T[]; empty?: string }) {
  if (rows.length === 0) return <p className="kv-empty-state">{empty}</p>;
  return (
    <table className="kv-table">
      <thead><tr>{columns.map((c, i) => <th key={i}>{c.header}</th>)}</tr></thead>
      <tbody>{rows.map((r, ri) => <tr key={ri}>{columns.map((c, ci) => <td key={ci}>{c.cell(r)}</td>)}</tr>)}</tbody>
    </table>
  );
}
