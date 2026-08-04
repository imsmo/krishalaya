// @krishalaya/sdk-js · market-intel (mandi prices) + weather resources (P-19). Mandi pulse/prices/predictions
// are read-only reference data (server-ingested); price ALERTS are the caller's own threshold subscriptions
// (create → server fires a push when crossed). Weather is regional advisories (read-only, by regionId). Money is
// bigint minor strings (Law 2). Gated server-side by `market_intel` / `land_soil_weather` flags.
import { HttpClient } from '../http';
import { Mandi, MandiPrice, PricePrediction, PriceAlert, MandiPulse, AlertActivity, WeatherAlert, ForecastResult, WeatherPrefs, Page } from '../types';

export class MarketResource {
  constructor(private readonly http: HttpClient) {}

  /** Mandis (market yards), optionally by region. Keyset. */
  async mandis(params: { regionId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Mandi>> {
    const r = await this.http.request<Mandi[]>('GET', 'market/mandis', { query: { regionId: params.regionId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getMandi(id: string, signal?: AbortSignal): Promise<Mandi> {
    return (await this.http.request<Mandi>('GET', `market/mandis/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Recent price rows (the prices feed + history), filterable. Keyset; never offset. */
  async prices(params: { productId?: string; regionId?: string; mandiId?: string; fromDate?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<MandiPrice>> {
    const r = await this.http.request<MandiPrice[]>('GET', 'market/prices', { query: { productId: params.productId, regionId: params.regionId, mandiId: params.mandiId, fromDate: params.fromDate, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Live pulse for a (product, region): latest + prediction band + recent history. */
  async pulse(productId: string, regionId?: string, signal?: AbortSignal): Promise<MandiPulse> {
    return (await this.http.request<MandiPulse>('GET', 'market/pulse', { query: { productId, regionId }, signal })).data;
  }
  /** Price predictions (the AI band). */
  async predictions(params: { productId?: string; regionId?: string } = {}, signal?: AbortSignal): Promise<PricePrediction[]> {
    return (await this.http.request<PricePrediction[]>('GET', 'market/predictions', { query: params, signal })).data;
  }

  // --- price alerts (the caller's own) ---
  async listAlerts(activeOnly?: boolean, cursor?: string, signal?: AbortSignal): Promise<Page<PriceAlert>> {
    const r = await this.http.request<PriceAlert[]>('GET', 'market/alerts', { query: { activeOnly, cursor }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Subscribe to a price threshold. `thresholdMinor` is bigint minor (Law 2). Idempotent (Law 3). */
  async createAlert(input: { productId: string; regionId?: string | null; direction: 'above' | 'below'; thresholdMinor: string }, idempotencyKey: string): Promise<PriceAlert> {
    return (await this.http.request<PriceAlert>('POST', 'market/alerts', { idempotencyKey, body: input })).data;
  }
  /** The caller's own alert-trigger activity (how many of their alerts fired today / in the last 7 days). */
  async alertActivity(signal?: AbortSignal): Promise<AlertActivity> {
    return (await this.http.request<AlertActivity>('GET', 'market/alerts/activity', { signal })).data;
  }
  async activateAlert(id: string): Promise<PriceAlert> { return (await this.http.request<PriceAlert>('POST', `market/alerts/${encodeURIComponent(id)}/activate`, {})).data; }
  async deactivateAlert(id: string): Promise<PriceAlert> { return (await this.http.request<PriceAlert>('POST', `market/alerts/${encodeURIComponent(id)}/deactivate`, {})).data; }
}

export class WeatherResource {
  constructor(private readonly http: HttpClient) {}
  /** Regional weather advisories (read-only). `regionId` is required by the server. */
  async alerts(regionId: string, params: { activeOnly?: boolean; limit?: number } = {}, signal?: AbortSignal): Promise<WeatherAlert[]> {
    return (await this.http.request<WeatherAlert[]>('GET', 'land/weather-alerts', { query: { regionId, activeOnly: params.activeOnly, limit: params.limit ?? 50 }, signal })).data;
  }

  /** Geocoded forecast for a coordinate (P0-12). Returns a real provider forecast, or — if the provider is down
   *  and `regionId` is given — degrades to that region's advisories (`degraded:true`). Never a fabricated forecast. */
  async forecast(input: { lat: number; lng: number; days?: number; regionId?: string }, signal?: AbortSignal): Promise<ForecastResult> {
    return (await this.http.request<ForecastResult>('GET', 'land/weather-forecast', { query: { lat: input.lat, lng: input.lng, days: input.days, regionId: input.regionId }, signal })).data;
  }

  /** The caller's own weather advisory content prefs (P1-4). GET returns saved-or-defaults. */
  async prefs(signal?: AbortSignal): Promise<WeatherPrefs> {
    return (await this.http.request<WeatherPrefs>('GET', 'land/weather-prefs', { signal })).data;
  }
  /** Upsert the caller's weather advisory prefs (server persists; returns the saved value). */
  async savePrefs(input: WeatherPrefs): Promise<WeatherPrefs> {
    return (await this.http.request<WeatherPrefs>('PUT', 'land/weather-prefs', { body: input })).data;
  }
}
