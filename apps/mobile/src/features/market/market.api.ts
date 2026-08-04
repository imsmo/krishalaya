// apps/mobile/src/features/market/market.api.ts · data layer for mandi prices + weather (P-19). Keeps screens thin
// (guide §3). Reads degrade-never-die (null/empty). createAlert is idempotent (Law 3) and throws so the screen
// shows the precise outcome. Money is bigint minor strings (Law 2). Alert delivery is a server-side PUSH (P-04) —
// the app only subscribes; the server fires when a price crosses the threshold.
import type { Mandi, MandiPrice, MandiPulse, PriceAlert, AlertActivity, WeatherAlert, ForecastResult, WeatherPrefs } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface PricesPage { items: MandiPrice[]; nextCursor: string | null }
export interface AlertsPage { items: PriceAlert[]; nextCursor: string | null }
export interface MandisPage { items: Mandi[]; nextCursor: string | null }

export async function listPrices(filter: { productId?: string; regionId?: string; mandiId?: string; fromDate?: string } = {}, cursor?: string): Promise<PricesPage> {
  try { return await apiClient().market.prices({ ...filter, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function listMandis(regionId?: string, cursor?: string): Promise<MandisPage> {
  try { return await apiClient().market.mandis({ regionId, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getMandi(id: string): Promise<Mandi | null> {
  try { return await apiClient().market.getMandi(id); } catch { return null; }
}
export async function getPulse(productId: string, regionId?: string): Promise<MandiPulse | null> {
  try { return await apiClient().market.pulse(productId, regionId); } catch { return null; }
}

// --- price alerts (the caller's own) ---
export async function listAlerts(activeOnly?: boolean, cursor?: string): Promise<AlertsPage> {
  try { return await apiClient().market.listAlerts(activeOnly, cursor); } catch { return { items: [], nextCursor: null }; }
}
export function createAlert(input: { productId: string; regionId?: string | null; direction: 'above' | 'below'; thresholdMinor: string }): Promise<PriceAlert> {
  return apiClient().market.createAlert(input, newId());
}
export function setAlertActive(id: string, active: boolean): Promise<PriceAlert> {
  return active ? apiClient().market.activateAlert(id) : apiClient().market.deactivateAlert(id);
}
/** The caller's own alert-trigger counts (today / this week). Degrades to null so the stats render "—", never faked. */
export async function alertActivity(): Promise<AlertActivity | null> {
  try { return await apiClient().market.alertActivity(); } catch { return null; }
}

// --- weather (regional advisories; regionId required by the server) ---
export async function weatherAlerts(regionId: string, activeOnly = true): Promise<WeatherAlert[]> {
  try { return await apiClient().weather.alerts(regionId, { activeOnly }); } catch { return []; }
}

/** Geocoded forecast for the farmer's location (P0-12). regionId is passed so the server can degrade to that
 * region's advisories if the provider is down. Returns null on a hard failure (screen falls back to advisories). */
export async function weatherForecast(lat: number, lng: number, regionId?: string | null): Promise<ForecastResult | null> {
  try { return await apiClient().weather.forecast({ lat, lng, regionId: regionId ?? undefined }); } catch { return null; }
}

/** The caller's weather advisory content prefs (P1-4). Degrades to null so the screen can fall back to defaults. */
export async function getWeatherPrefs(): Promise<WeatherPrefs | null> {
  try { return await apiClient().weather.prefs(); } catch { return null; }
}
/** Persist the caller's weather advisory prefs (P1-4). Throws so the screen shows the precise outcome. */
export function saveWeatherPrefs(p: WeatherPrefs): Promise<WeatherPrefs> {
  return apiClient().weather.savePrefs(p);
}

/** The farmer's region from their default (or first) saved address — "weather by location" without a geocoder.
 * Null if no address has a region (the weather screen then prompts to set one). */
export async function defaultRegionId(): Promise<string | null> {
  try {
    const addrs = await apiClient().addresses.list();
    const withRegion = addrs.filter((a) => !!a.regionId);
    return (withRegion.find((a) => a.isDefault)?.regionId ?? withRegion[0]?.regionId ?? null) as string | null;
  } catch { return null; }
}

/** The farmer's lat/lng from their default (or first) saved address that has coordinates — the forecast anchor.
 * Null when no address carries coordinates (the screen then shows advisories only). */
export async function defaultLatLng(): Promise<{ lat: number; lng: number } | null> {
  try {
    const addrs = await apiClient().addresses.list();
    const withGeo = addrs.filter((a) => typeof a.lat === 'number' && typeof a.lng === 'number');
    const pick = withGeo.find((a) => a.isDefault) ?? withGeo[0];
    return pick ? { lat: pick.lat as number, lng: pick.lng as number } : null;
  } catch { return null; }
}
