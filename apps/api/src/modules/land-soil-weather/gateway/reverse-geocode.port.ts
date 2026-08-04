// modules/land-soil-weather/gateway/reverse-geocode.port.ts
// Port to an EXTERNAL reverse-geocoder (coarse coordinate → human place label for the weather header, P1-4).
// Krishalaya owns the POLICY (best-effort, degrade-to-null, cache with the forecast); the provider owns the
// gazetteer. CONTRACT: reverse(lat,lng) returns a place NAME string or null — it NEVER fabricates a name. On any
// provider error the adapter returns null (the header then falls back to a generic "your area"). No PII: lat/lng
// are coarse (grid-rounded upstream) and not user identifiers.
export const REVERSE_GEOCODE = Symbol('REVERSE_GEOCODE');

export interface ReverseGeocodeProvider {
  readonly providerCode: string;
  /** Coarse coordinate → best available place label (city/locality/district), or null when unavailable. */
  reverse(lat: number, lng: number): Promise<string | null>;
}
