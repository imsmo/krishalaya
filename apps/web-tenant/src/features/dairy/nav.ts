// apps/web-tenant/src/features/dairy/nav.ts · the dairy vertical's own sub-nav (PC-56 TENANT-6a).
//
// Every dairy screen in the canon carries the same breadcrumb trail under Operations → Dairy, and between them the
// six screens name six sections:
//
//     Collections · Quality · Payout cycles · BMC · Centres · Insights
//
// W167 links two of them by button ("Payout cycles", "BMC"), W168 links "Rate cards" and "Review flags", W169 and
// W172 link back to collections. Nothing in the canon draws the set as a nav — each screen links the two or three it
// happens to need — so an operator who lands on the quality desk cannot get to the cycles without going back through
// a screen that happens to link it. The console draws all six, once, and marks the five with no screen yet as exactly
// that: TENANT-6a built the first, and "not built" must not be mistakable for "hidden from me by a permission" (the
// same ruling TENANT-5b made for the logistics sub-nav, for the same reason).

export interface DairyNavItem { key: string; href: string | null; built: boolean }

export const DAIRY_NAV: readonly DairyNavItem[] = [
  { key: 'collections', href: '/dairy',  built: true },
  // PC-56 TENANT-6b-2 · W168. **The canon links this screen from NOWHERE** — `grep -rl W168-tenant-dairy-quality`
  // across all 1,955 screens returns zero hits, while W167 is in every dairy breadcrumb. Third instance of that
  // defect (W241 was 5c's, W244 was 5d's), and the sub-nav is the fix: an operator who lands on the counter board can
  // reach the quality desk without knowing the URL.
  { key: 'quality',     href: '/dairy/quality', built: true },
  // PC-56 TENANT-6c-6 · W169. The five waves before this one built the cycle record and every act on it, and the SDK
  // had no method for any of them — so the fortnight 312 families are paid from was reachable only by curl. This is
  // the caller, and the entry the sub-nav has carried as `not built` since TENANT-6a.
  { key: 'cycles',      href: '/dairy/cycles', built: true },
  { key: 'bmc',         href: null,      built: false },
  { key: 'centres',     href: null,      built: false },
  { key: 'insights',    href: null,      built: false },
  // The pre-canon operator console (P1-12), moved to /dairy/console by this wave rather than deleted: it is the only
  // surface that can currently create an MCC, enrol a member, write a rate card or approve a bill, and the canon
  // screens that will own those acts are TENANT-6b–6e. Marked `legacy` so nobody mistakes it for a canon screen.
  { key: 'console',     href: '/dairy/console', built: true },
];

export function dairyNavLabelKey(item: DairyNavItem): string { return `dairy.nav.${item.key}`; }

/** Which entry is current, matched on the longest built href so a future `/dairy/quality` cannot light up `/dairy`
 *  as well — and with the path BOUNDARY checked, so a future `/dairy-archive` lights up nothing. */
export function currentDairyNavKey(pathname: string): string | null {
  let best: DairyNavItem | null = null;
  for (const i of DAIRY_NAV) {
    if (!i.href) continue;
    if (pathname === i.href || pathname.startsWith(`${i.href}/`)) {
      if (!best || i.href.length > (best.href ?? '').length) best = i;
    }
  }
  return best?.key ?? null;
}

/** The count the nav footer states, so "five of these do nothing yet" is a fact on the screen rather than a surprise
 *  an operator discovers by clicking. */
export function dairyUnbuiltCount(): number { return DAIRY_NAV.filter((i) => !i.built).length; }
