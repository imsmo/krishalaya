// apps/web-ops/src/features/insights/summarise.ts · PURE snapshot aggregation (PC-36 OW-6). Counts a page of
// rows by status. HONESTY CONTRACT: the console feeds this the LATEST PAGE ONLY (bounded reads, limit 50) and
// the UI labels the numbers as exactly that — a snapshot of the most recent 50, never a pretend total.
// (True totals need server read-models — PC-54 note; we do not fan out N+1 pages to fake them.)
export function countByStatus(rows: ReadonlyArray<{ status: string }>): Array<{ status: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r || typeof r.status !== 'string' || !r.status) continue;
    map.set(r.status, (map.get(r.status) ?? 0) + 1);
  }
  return [...map.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}
