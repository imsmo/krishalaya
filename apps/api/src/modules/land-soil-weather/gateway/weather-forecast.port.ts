// modules/land-soil-weather/gateway/weather-forecast.port.ts
// Port to the EXTERNAL geocoded weather-forecast provider (IMD / Open-Meteo / Skymet-style). Krishalaya owns
// the POLICY (which fields, caching, degrade-to-advisory); the provider owns the meteorology.
// CONTRACT (Law 12 — degrade, never die / never fabricate):
//   • fetch(lat,lng) returns a NORMALISED forecast (provider-agnostic shape) for the next N days.
//   • the adapter is resilience-wrapped (timeout+retry+breaker+bulkhead). On exhaustion it throws a typed
//     WeatherProviderUnavailableError — it NEVER returns invented numbers. The SERVICE decides the fallback
//     (regional advisory), so a forecast is either real or explicitly absent — never faked.
export const WEATHER_FORECAST = Symbol('WEATHER_FORECAST');

export interface ForecastQuery { lat: number; lng: number; days?: number }

/** One day of the normalised forecast. Temps °C, precip mm, prob 0-100, wind km/h — provider units normalised here.
 *  P1-4 extended metrics are OPTIONAL (present only when the provider returned them) — never fabricated. */
export interface ForecastDay {
  date: string;            // ISO yyyy-mm-dd (provider local day)
  tempMinC: number;
  tempMaxC: number;
  precipMm: number;
  precipProbPct: number;   // 0..100
  windKph: number;
  code: string;            // normalised condition: clear|clouds|rain|thunder|snow|fog|unknown
  // --- P1-4 extended daily metrics (optional; only when the provider supplies them) ---
  feelsLikeMinC?: number | null;   // apparent temperature
  feelsLikeMaxC?: number | null;
  uvIndexMax?: number | null;
  windDirDeg?: number | null;      // dominant wind bearing 0..360
  sunrise?: string | null;         // ISO local time
  sunset?: string | null;
}

/** One hour of the normalised forecast (P1-4). All fields real provider numbers; optional where the provider omits. */
export interface ForecastHour {
  time: string;            // ISO local hour
  tempC: number;
  feelsLikeC?: number | null;
  humidityPct?: number | null;     // 0..100
  precipProbPct: number;   // 0..100
  windKph: number;
  pressureHpa?: number | null;
  uvIndex?: number | null;
  code: string;
}

export interface NormalisedForecast {
  lat: number;
  lng: number;
  providerCode: string;    // 'open-meteo' | 'imd' | …  (never a fabricated value)
  fetchedAt: string;       // ISO timestamp the provider data was retrieved
  days: ForecastDay[];
  hours?: ForecastHour[];  // P1-4 hourly strip (bounded, next ~24h). Absent when the provider omits hourly.
  placeName?: string | null; // P1-4 reverse-geocoded header label (best-effort; null when unavailable — never faked).
}

export interface WeatherForecastProvider {
  readonly providerCode: string;
  fetch(q: ForecastQuery): Promise<NormalisedForecast>;
}
