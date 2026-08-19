// apps/web-tenant/src/features/logistics/nav.ts · the logistics desk's own sub-nav (PC-56 TENANT-5b).
//
// W225's sub-nav, printed identically on every logistics screen in the canon:
//
//     Overview · Shipments · Carriers · Vehicles · Routes · Zones · Cold chain
//
// Seven entries, of which this console has built three. The nav lists all seven and marks the four that are not
// built yet as exactly that, rather than quietly shipping a three-item nav: an FPO who was shown the canon and
// then finds four tabs missing has no way to tell "not built" from "hidden from me by a permission".
//
// (Overview is W225 — TENANT-5d. Carriers is the partner register, Zones the serviceability map, Cold chain the
// reefer telemetry desk; each has API surface and no tenant screen.)

export interface LogisticsNavItem { key: string; href: string | null; built: boolean }

export const LOGISTICS_NAV: readonly LogisticsNavItem[] = [
  { key: 'overview',  href: null,                  built: false },
  { key: 'shipments', href: '/logistics',          built: true },
  { key: 'carriers',  href: null,                  built: false },
  { key: 'vehicles',  href: '/logistics/vehicles', built: true },
  { key: 'routes',    href: '/logistics/routes',   built: true },
  { key: 'zones',     href: null,                  built: false },
  { key: 'coldChain', href: null,                  built: false },
];

export function navLabelKey(item: LogisticsNavItem): string { return `logistics.nav.${item.key}`; }

/** Which entry is current, matched on the longest built href so `/logistics/vehicles` does not light up
 *  `/logistics` as well. */
export function currentNavKey(pathname: string): string | null {
  let best: LogisticsNavItem | null = null;
  for (const i of LOGISTICS_NAV) {
    if (!i.href) continue;
    if (pathname === i.href || pathname.startsWith(`${i.href}/`)) {
      if (!best || i.href.length > (best.href ?? '').length) best = i;
    }
  }
  return best?.key ?? null;
}

/** The count the nav footer states, so "four of these do nothing" is a fact on the screen and not a surprise. */
export function unbuiltCount(): number { return LOGISTICS_NAV.filter((i) => !i.built).length; }
