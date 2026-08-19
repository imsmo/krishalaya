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

// PC-56 TENANT-5c ADDS AN EIGHTH ENTRY THE CANON'S SUB-NAV DOES NOT HAVE, and the reason is a finding:
//
// **W241 (Freight invoices) HAS NO INBOUND LINK ANYWHERE IN THE CANON.** Its own chain screens (W2612–W2618) carry
// it in their breadcrumb, and that is all: no operational screen links to it. For contrast, W229 (Vehicles) is
// linked from W225, W226, W228, W231, W233 and W234. So the freight desk — the one screen in this module that is
// about money leaving the tenant's wallet — is reachable in the canon only by typing its URL.
//
// A screen with no route in is the same defect class as a table with no writer: it exists and nothing reaches it.
// The desk's breadcrumb ("Operations · Logistics · Freight invoices") says where it belongs, so it is added here as
// a sibling of the other logistics desks rather than left unreachable. This is the ONE place the console's nav
// departs from the canon's seven entries, and it departs by adding a way in, never by hiding one.
export const LOGISTICS_NAV: readonly LogisticsNavItem[] = [
  { key: 'overview',  href: null,                  built: false },
  { key: 'shipments', href: '/logistics',          built: true },
  { key: 'carriers',  href: null,                  built: false },
  { key: 'vehicles',  href: '/logistics/vehicles', built: true },
  { key: 'routes',    href: '/logistics/routes',   built: true },
  { key: 'freight',   href: '/logistics/freight',  built: true },
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
