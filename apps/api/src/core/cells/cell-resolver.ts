// core/cells/cell-resolver.ts · PC-53 per-country cells. A cell = a fully independent country/region stack
// (README): India never depends on Bangladesh; residency law (DPDP + foreign equivalents) is satisfied by
// never serving another cell's tenants. The EDGE decides routing; this is the in-app fallback + the last-line
// residency guard. Pure parsing (boot must never die on config) + precedence: tenant pin > country > default.
export interface CellMap {
  defaultCell: string;                       // the cell everything belongs to until Phase-4 (e.g. 'in-1')
  countries: Readonly<Record<string, string>>; // ISO country → cellId  (e.g. {"BD":"bd-1","IN":"in-1"})
  tenants: Readonly<Record<string, string>>;   // explicit tenant pins (migration/edge cases) — beat country
}
export const SINGLE_CELL: CellMap = { defaultCell: 'in-1', countries: {}, tenants: {} };

/** CELL_MAP='{"default":"in-1","countries":{"BD":"bd-1"},"tenants":{"<id>":"bd-1"}}' — malformed ⇒ single-cell. */
export function parseCellMap(raw: string | undefined): CellMap {
  if (!raw) return SINGLE_CELL;
  try {
    const p = JSON.parse(raw) as { default?: unknown; countries?: unknown; tenants?: unknown };
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const rec = (v: unknown): Record<string, string> => {
      const out: Record<string, string> = {};
      if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as object)) { const s = str(val); if (s) out[k] = s; }
      return out;
    };
    return { defaultCell: str(p.default) ?? SINGLE_CELL.defaultCell, countries: rec(p.countries), tenants: rec(p.tenants) };
  } catch { return SINGLE_CELL; }
}

/** tenant pin > country mapping > default cell. */
export function cellFor(map: CellMap, opts: { tenantId?: string; countryCode?: string }): string {
  if (opts.tenantId && map.tenants[opts.tenantId]) return map.tenants[opts.tenantId];
  if (opts.countryCode && map.countries[opts.countryCode.toUpperCase()]) return map.countries[opts.countryCode.toUpperCase()];
  return map.defaultCell;
}

/** True while this deployment is the only cell (or unconfigured) — the guard is a strict no-op then. */
export function isSingleCell(map: CellMap, thisCell: string | undefined): boolean {
  if (!thisCell) return true;
  const cells = new Set([map.defaultCell, ...Object.values(map.countries), ...Object.values(map.tenants)]);
  return cells.size <= 1;
}
