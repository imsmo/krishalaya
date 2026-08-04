// apps/mobile/src/features/addresses/addresses.ts · PURE address-book logic (no React/native, no SDK client) →
// unit-tested. Presentation ordering + a Maps affordance guard for screen 134.
import type { Address } from '@krishalaya/sdk-js';

/** Primary address first, then the rest in their existing (server) order (screen 134). Stable. Pure — no I/O. */
export function sortAddresses<T extends { isDefault: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
}

/** Whether an address has real geocoordinates to open a map (screen 134 "📍 Map"). §13: no lat/lng → the Map
 * affordance hides rather than opening a guessed pin. Pure. */
export function hasMapPin(a: Pick<Address, 'lat' | 'lng'>): boolean {
  return typeof a.lat === 'number' && typeof a.lng === 'number';
}
