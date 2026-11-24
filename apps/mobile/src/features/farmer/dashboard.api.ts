// apps/mobile/src/features/farmer/dashboard.api.ts · data layer for the farmer HOME dashboard (screen 09).
// Keeps the screen thin (guide §3): the screen calls loadFarmerHome() and renders; all SDK access + degrade
// logic lives here. Mandi pulse is best-effort — on failure it returns null so the screen HIDES the section
// rather than inventing prices (degrade-never-die, never fake data). Money stays as bigint-minor strings.
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.store';
import { currentScope } from '../../core/offline/scope';
import { POLICY } from '../../core/offline/cache-policies';
import { myListings } from '../listings/listings.api';
import { countByStatus } from '../listings/my-listings';
import { walletBalance } from '../wallet/wallet.api';
import { listTips } from '../content/content.api';
import { walletTileMinor } from './dashboard-presenters';

// changePct is OPTIONAL: the current market read-models expose latest price + resolved commodity name, but NOT a
// day-over-day delta (see guide §13 known gap). We surface the delta ONLY when the API provides it and NEVER
// fabricate it — the screen hides the ▲/▼ row when it's null. Build the real pulse read-model to populate it.
export interface MandiRow { id: string; commodity: string; modalPriceMinor: string; changePct: number | null }
export interface HomeTip { id: string; title: string; body: string; kind: string }
/** Compact weather for the home header chip. Real forecast (P0-12) anchored on the farmer's default address. */
export interface HomeWeather { tempC: number; code: string; place: string | null }

export interface FarmerHome {
  /** Count of ACTIVE listings only (published/live + running-auction) — same rule as screen 12's "Active" stat
   *  card (countByStatus().active), never a raw owner-box row count (that would include drafts — KV-MF-07). */
  listingCount: number | null;
  mandi: MandiRow[] | null;
  /** Reconciled wallet balance (server-truth, bigint-minor) or null when the read failed — the screen shows a
   *  tap-to-retry affordance (R2-01), never a bare "—" dead-end and never a fabricated ₹0. */
  walletBalanceMinor: string | null;
  /** Today's curated tip (first approved learning resource) or null — the screen hides the section. */
  tip: HomeTip | null;
  /** Today's weather for the header chip, or null (no geo address / provider down) — the chip hides. */
  weather: HomeWeather | null;
}

// KV-MF-10: each tile below (listings/mandi/wallet/tip/weather) already owns its OWN try/catch and resolves
// to null on failure rather than throwing — so this Promise.all can never reject because of one bad sibling
// (e.g. the mandi/market-intel 404 when that module's flag is off). A rejected sibling would otherwise fail
// the WHOLE batch and null every tile, including a perfectly healthy wallet read; per-tile isolation is what
// keeps that from happening. Do not replace an inner try/catch with a bare call — that would reopen the hole.
export async function loadFarmerHome(): Promise<FarmerHome> {
  const [listingCount, mandi, walletBalanceMinor, tip, weather] = await Promise.all([
    loadListingCount(), loadMandiPulse(), loadWalletBalance(), loadTodaysTip(), loadWeather(),
  ]);
  return { listingCount, mandi, walletBalanceMinor, tip, weather };
}

// Today's weather — real geocoded forecast for the farmer's default address (no geo address → null → chip hides).
// tempC = today's max (rounded); `code` is the normalised condition (clear/clouds/rain/…); place = address village.
async function loadWeather(): Promise<HomeWeather | null> {
  try {
    const addrs = await apiClient().addresses.list();
    const geo = addrs.filter((a) => typeof a.lat === 'number' && typeof a.lng === 'number');
    const pick = geo.find((a) => a.isDefault) ?? geo[0];
    if (!pick) return null;
    const res = await apiClient().weather.forecast({ lat: pick.lat as number, lng: pick.lng as number, regionId: pick.regionId ?? undefined });
    const day = res?.forecast?.days?.[0];
    if (!day) return null;
    return { tempC: Math.round(day.tempMaxC), code: day.code, place: pick.village ?? null };
  } catch { return null; }
}

// Wallet balance — server-truth; degrade to null (screen shows a retry affordance, R2-01) rather than a fake ₹0. (Law 2/12)
// KV-MF-10: the field mapping itself lives in dashboard-presenters.ts (pure, unit-tested) — this just wires
// the live network read to it.
async function loadWalletBalance(): Promise<string | null> {
  try { const b = await walletBalance(); return walletTileMinor(b); }
  catch { return null; }
}

// Today's tip — first curated learning resource; best-effort, hides the card on failure (never fakes). (Law 12)
async function loadTodaysTip(): Promise<HomeTip | null> {
  try {
    const { items } = await listTips();
    const r = items[0] as { id: string; title: string; body?: string; kind?: string } | undefined;
    return r ? { id: r.id, title: r.title, body: r.body ?? '', kind: r.kind ?? 'tip' } : null;
  } catch { return null; }
}

// KV-MF-07: home used to show items.length (EVERY owner-box row, drafts included), while screen 12 (My
// Listings) shows countByStatus(items).active (published/live + running-auction only — draft/sold/expired
// excluded). That mismatch is what showed "7 Active" on Home against "6 Active" on the tab (the 7th was a
// draft). Home now reuses the SAME pure helper as the list screen — one definition of "active", never
// duplicated — so the two counters can never drift again.
async function loadListingCount(): Promise<number | null> {
  try { const page = await myListings(undefined, 50); return countByStatus(page.items).active; }
  catch { return null; }
}

// Real contract: GET /v1/market/prices?limit= (market-intel module, names-resolved per API-W11) → latest modal
// prices with the commodity name attached. Read-through SWR cache (prices are public + reference-ish, usable
// offline). changePct is left null — the list endpoint does not expose a day-over-day delta yet (guide §13 gap);
// the screen hides the ▲/▼ row rather than fabricating one. Returns null on a hard failure with no cache, so the
// home screen hides the whole pulse section instead of showing zeros/fakes (Law 12, never fake).

// S6-prep: modules that are feature-flag OFF at pilot 404 on every call. Without memoization the
// home screen re-hit them on EVERY focus/refresh — hammering the API and flooding the dev log with
// identical warnings. Remember "OFF" per app session (an app restart re-checks, so flipping the
// flag ON reaches devices on next launch — same freshness as the boot-time flag hydrate).
const moduleOffThisSession = new Set<string>();
function isModuleOff(key: string): boolean { return moduleOffThisSession.has(key); }
function markModuleOff(key: string, e: unknown): void {
  // Only a 404 (FeatureFlagGuard: flag off ⇒ invisible route) marks OFF; transient/network errors must retry.
  if ((e as { status?: number })?.status === 404) moduleOffThisSession.add(key);
}

async function loadMandiPulse(): Promise<MandiRow[] | null> {
  if (isModuleOff('market_intel')) return null;
  try {
    const { value } = await cache.read<MandiRow[]>({
      scope: currentScope(), ns: 'mandi.pulse', parts: [6], policy: POLICY.shortList,
      fetcher: async () => {
        const page = await apiClient().market.prices({ limit: 6 });
        return (page.items ?? [])
          .filter((p) => !!p.modalMinor)
          .map((p) => ({
            id: p.id,
            commodity: p.productName ?? '—',   // resolved catalogue name; degrade to em-dash, never blank the row
            modalPriceMinor: p.modalMinor,
            changePct: null,                    // no delta in the list contract yet — never faked
          }));
      },
    });
    return value;
  } catch (e) { markModuleOff('market_intel', e); return null; }
}
