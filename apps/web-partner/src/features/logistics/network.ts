// apps/web-partner/src/features/logistics/network.ts · PURE helpers for the 3PL delivery NETWORK — serviceability
// zones, Village Run routes, and the cold-chain temperature log. Mirrors apps/api logistics zones / routes /
// cold-chain DTOs + read-models EXACTLY. No I/O, no React, no money. Temperatures are PHYSICAL decimals (°C), parsed
// without the float-coercion helpers the §4 audit forbids (decimal regex + unary `+`); the API recomputes is_breach
// from the allowed band. Pincodes are 6-digit Indian PINs; region/vehicle/user refs are UUIDs.

export class NetworkError extends Error {
  constructor(public readonly fieldKey: string) { super(fieldKey); this.name = 'NetworkError'; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PINCODE_RE = /^[1-9][0-9]{5}$/;
const DIGITS_RE = /^\d+$/;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;
// datetime-local control value: YYYY-MM-DDTHH:MM (optionally :SS)
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const MAX_PINCODES = 5000;
const MAX_REGION_IDS = 2000;

// ---- shared parsers ----------------------------------------------------------------------------------------------
/** Split a textarea/csv blob on commas/whitespace/newlines into trimmed, de-duped, non-empty tokens. */
export function tokenize(raw: string | undefined): string[] {
  const seen = new Set<string>();
  for (const tok of (raw ?? '').split(/[\s,]+/)) {
    const v = tok.trim();
    if (v.length > 0) seen.add(v);
  }
  return [...seen];
}
/** activeOnly list filter — defaults true (the API default); explicit false includes inactive. */
export function parseActiveOnly(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no');
}
/** Optional UUID field: blank → null; present → validated. */
export function parseOptionalUuid(raw: string | undefined, key: string): string | null {
  const v = (raw ?? '').trim();
  if (v.length === 0) return null;
  if (!UUID_RE.test(v)) throw new NetworkError(key);
  return v;
}

// ---- zones (mirror create-delivery-zone.dto) --------------------------------------------------------------------
export function validZoneName(raw: string): string {
  const v = (raw ?? '').trim();
  if (v.length < 1 || v.length > 120) throw new NetworkError('zoneName');
  return v;
}
export function parsePincodes(raw: string | undefined): string[] {
  const toks = tokenize(raw);
  if (toks.length > MAX_PINCODES) throw new NetworkError('pincodes');
  for (const p of toks) if (!PINCODE_RE.test(p)) throw new NetworkError('pincodes');
  return toks;
}
export function parseRegionIds(raw: string | undefined, key = 'regionIds'): string[] {
  const toks = tokenize(raw);
  if (toks.length > MAX_REGION_IDS) throw new NetworkError(key);
  for (const r of toks) if (!UUID_RE.test(r)) throw new NetworkError(key);
  return toks;
}

export interface CreateZoneBody { defaultName: string; pincodes: string[]; regionIds: string[]; chargeDefinitionId: string | null; }
export function buildCreateZone(f: { defaultName: string; pincodes?: string; regionIds?: string; chargeDefinitionId?: string }): CreateZoneBody {
  return {
    defaultName: validZoneName(f.defaultName),
    pincodes: parsePincodes(f.pincodes),
    regionIds: parseRegionIds(f.regionIds),
    chargeDefinitionId: parseOptionalUuid(f.chargeDefinitionId, 'chargeDefinitionId'),
  };
}
export interface UpdateZoneBody { defaultName?: string; pincodes?: string[]; regionIds?: string[]; chargeDefinitionId?: string | null; }
export function buildUpdateZone(f: { defaultName?: string; pincodes?: string; regionIds?: string; chargeDefinitionId?: string }): UpdateZoneBody {
  const body: UpdateZoneBody = {};
  if (f.defaultName !== undefined && f.defaultName.trim() !== '') body.defaultName = validZoneName(f.defaultName);
  if (f.pincodes !== undefined) body.pincodes = parsePincodes(f.pincodes);
  if (f.regionIds !== undefined) body.regionIds = parseRegionIds(f.regionIds);
  if (f.chargeDefinitionId !== undefined) body.chargeDefinitionId = parseOptionalUuid(f.chargeDefinitionId, 'chargeDefinitionId');
  if (Object.keys(body).length === 0) throw new NetworkError('noChange');
  return body;
}

// ---- routes (mirror create-delivery-route.dto) ------------------------------------------------------------------
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export function weekdayKey(d: number | null | undefined): string {
  if (d === null || d === undefined) return 'net.wd.any';
  return d >= 0 && d <= 6 ? `net.wd.${d}` : 'net.wd.unknown';
}
export function validRouteName(raw: string): string {
  const v = (raw ?? '').trim();
  if (v.length < 1 || v.length > 150) throw new NetworkError('routeName');
  return v;
}
/** runWeekday is nullable (a route may have no fixed day). Blank → null; else 0..6. */
export function parseRunWeekday(raw: string | undefined): number | null {
  const v = (raw ?? '').trim();
  if (v.length === 0) return null;
  if (!DIGITS_RE.test(v)) throw new NetworkError('runWeekday');
  const n = +v;
  if (n < 0 || n > 6) throw new NetworkError('runWeekday');
  return n;
}

export interface CreateRouteBody { defaultName: string; runWeekday: number | null; villageRegionIds: string[]; vehicleId: string | null; consolidationUserId: string | null; }
export function buildCreateRoute(f: { defaultName: string; runWeekday?: string; villageRegionIds?: string; vehicleId?: string; consolidationUserId?: string }): CreateRouteBody {
  return {
    defaultName: validRouteName(f.defaultName),
    runWeekday: parseRunWeekday(f.runWeekday),
    villageRegionIds: parseRegionIds(f.villageRegionIds, 'villageRegionIds'),
    vehicleId: parseOptionalUuid(f.vehicleId, 'vehicleId'),
    consolidationUserId: parseOptionalUuid(f.consolidationUserId, 'consolidationUserId'),
  };
}
export interface UpdateRouteBody { defaultName?: string; runWeekday?: number | null; villageRegionIds?: string[]; vehicleId?: string | null; consolidationUserId?: string | null; }
export function buildUpdateRoute(f: { defaultName?: string; runWeekday?: string; villageRegionIds?: string; vehicleId?: string; consolidationUserId?: string }): UpdateRouteBody {
  const body: UpdateRouteBody = {};
  if (f.defaultName !== undefined && f.defaultName.trim() !== '') body.defaultName = validRouteName(f.defaultName);
  if (f.runWeekday !== undefined) body.runWeekday = parseRunWeekday(f.runWeekday);
  if (f.villageRegionIds !== undefined) body.villageRegionIds = parseRegionIds(f.villageRegionIds, 'villageRegionIds');
  if (f.vehicleId !== undefined) body.vehicleId = parseOptionalUuid(f.vehicleId, 'vehicleId');
  if (f.consolidationUserId !== undefined) body.consolidationUserId = parseOptionalUuid(f.consolidationUserId, 'consolidationUserId');
  if (Object.keys(body).length === 0) throw new NetworkError('noChange');
  return body;
}

// ---- shared active toggle ----------------------------------------------------------------------------------------
export interface SetActiveBody { isActive: boolean; }
export function buildSetActive(isActive: boolean): SetActiveBody { return { isActive }; }

// ---- cold-chain (mirror cold-chain.dto + cold-chain-log.entity) -------------------------------------------------
export const COLD_CHAIN_SUBJECTS = ['shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box'] as const;
export type ColdChainSubject = (typeof COLD_CHAIN_SUBJECTS)[number];
export function isColdSubject(v: string | undefined): v is ColdChainSubject {
  return !!v && (COLD_CHAIN_SUBJECTS as readonly string[]).includes(v);
}
export function coldSubjectKey(s: string): string {
  return isColdSubject(s) ? `net.subject.${s}` : 'net.subject.unknown';
}

const TEMP_MIN = -60;   // sane sensor envelope (°C) — mirrors the domain
const TEMP_MAX = 80;
/** Parse a temperature (°C) without float-coercion helpers (decimal regex + unary `+`). Range [-60,80]. */
export function parseTempC(raw: string | undefined, key: string): number {
  const v = (raw ?? '').trim();
  if (!DECIMAL_RE.test(v)) throw new NetworkError(key);
  const n = +v;
  if (n < TEMP_MIN || n > TEMP_MAX) throw new NetworkError(key);
  return n;
}
/** Humidity %; blank → null; else [0,100]. */
export function parseHumidity(raw: string | undefined): number | null {
  const v = (raw ?? '').trim();
  if (v.length === 0) return null;
  if (!DECIMAL_RE.test(v)) throw new NetworkError('humidity');
  const n = +v;
  if (n < 0 || n > 100) throw new NetworkError('humidity');
  return n;
}
export function parseDeviceRef(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v.length === 0) return null;
  if (v.length > 100) throw new NetworkError('deviceRef');
  return v;
}
/** Convert a datetime-local control value to a full ISO-8601 timestamp (the API wants z.string().datetime()). */
export function toIsoTimestamp(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!LOCAL_DT_RE.test(v)) throw new NetworkError('recordedAt');
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new NetworkError('recordedAt');
  return d.toISOString();
}

// PC-56 TENANT-SW-e (F-13): a reading sent from a session is MANUAL — temperature, humidity, an optional device label and nothing
// else. The band is copied by the server from the threshold store and the time is the server's; the API's strict DTO refuses
// allowedMinC / allowedMaxC / recordedAt by name, so this builder no longer sends them. A manual reading never opens a breach.
export interface RecordReadingBody {
  subjectType: ColdChainSubject; subjectId: string; tempC: number; humidityPct: number | null; deviceRef: string | null;
}
export function buildRecordReading(f: {
  subjectType: string; subjectId: string; tempC: string; humidityPct?: string; deviceRef?: string;
}): RecordReadingBody {
  if (!isColdSubject(f.subjectType)) throw new NetworkError('subjectType');
  if (!UUID_RE.test((f.subjectId ?? '').trim())) throw new NetworkError('subjectId');
  return {
    subjectType: f.subjectType,
    subjectId: f.subjectId.trim(),
    tempC: parseTempC(f.tempC, 'tempC'),
    humidityPct: parseHumidity(f.humidityPct),
    deviceRef: parseDeviceRef(f.deviceRef),
  };
}

export interface ColdChainQuery { subjectType: ColdChainSubject; subjectId: string; breachOnly: boolean; }
/** Validate the subject scope for a cold-chain reading list (the GET requires subjectType + subjectId). */
export function buildColdChainQuery(f: { subjectType?: string; subjectId?: string; breachOnly?: string }): ColdChainQuery | null {
  const st = (f.subjectType ?? '').trim();
  const sid = (f.subjectId ?? '').trim();
  if (st === '' && sid === '') return null;          // nothing selected yet → show the picker
  if (!isColdSubject(st)) throw new NetworkError('subjectType');
  if (!UUID_RE.test(sid)) throw new NetworkError('subjectId');
  return { subjectType: st, subjectId: sid, breachOnly: f.breachOnly === 'true' };
}

// ---- read-model types (mirror zone / route / cold-chain-log props) ----------------------------------------------
export interface ZoneRow {
  id: string; defaultName: string; pincodes: string[]; regionIds: string[];
  chargeDefinitionId: string | null; isActive: boolean;
}
export interface RouteRow {
  id: string; defaultName: string; runWeekday: number | null; villageRegionIds: string[];
  vehicleId: string | null; consolidationUserId: string | null; isActive: boolean;
}
export interface ColdChainRow {
  id: string; subjectType: string; subjectId: string; tempC: number; humidityPct: number | null;
  deviceRef: string | null; recordedAt: string; isBreach: boolean;
}
