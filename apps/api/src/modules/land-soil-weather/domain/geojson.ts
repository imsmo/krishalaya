// modules/land-soil-weather/domain/geojson.ts · PC-56 TENANT-12 · F-2 — A PARCEL BOUNDARY IS A POLYGON OR IT IS NOTHING. PURE.
//
// `boundary_geojson` was accepted as `z.record(z.unknown())`: `{}` or `{"a":1}` was stored and would have counted as
// "mapped" on the twin's coverage tile, so W420's "N unmapped … the twin says unknown there, never guesses" would have
// undercounted. A boundary is now a GeoJSON geometry object — `{ type: 'Polygon' | 'MultiPolygon', coordinates }` and nothing
// else — whose every ring is CLOSED (first position = last), has at least four positions, and whose every position is a
// finite [longitude, latitude] inside the earth's ranges (an optional third element, altitude, is tolerated). The coverage
// tile counts exactly the rows this validator would accept (`type` in SQL, the CHECK in 0190 for new writes).
export const BOUNDARY_TYPES = ['Polygon', 'MultiPolygon'] as const;
export type BoundaryType = (typeof BOUNDARY_TYPES)[number];
/** A ceiling on positions so a boundary cannot be used to store a megabyte of numbers. */
export const MAX_POSITIONS = 5000;

export type BoundaryRefusal =
  | 'NOT_AN_OBJECT' | 'TYPE_NOT_POLYGON' | 'EXTRA_MEMBERS' | 'COORDINATES_MISSING' | 'RING_TOO_SHORT' | 'RING_NOT_CLOSED'
  | 'POSITION_INVALID' | 'LONGITUDE_OUT_OF_RANGE' | 'LATITUDE_OUT_OF_RANGE' | 'TOO_MANY_POSITIONS' | 'NO_POLYGONS';

export interface BoundaryGeometry { type: BoundaryType; coordinates: number[][][] | number[][][][] }
export type BoundaryVerdict = { ok: true; value: BoundaryGeometry } | { ok: false; refusal: BoundaryRefusal; at?: string };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkPosition(p: unknown, at: string): BoundaryVerdict | null {
  if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return { ok: false, refusal: 'POSITION_INVALID', at };
  const [lon, lat] = p as number[];
  if (lon < -180 || lon > 180) return { ok: false, refusal: 'LONGITUDE_OUT_OF_RANGE', at };
  if (lat < -90 || lat > 90) return { ok: false, refusal: 'LATITUDE_OUT_OF_RANGE', at };
  return null;
}

function checkPolygon(rings: unknown, at: string, count: { n: number }): BoundaryVerdict | null {
  if (!Array.isArray(rings) || rings.length === 0) return { ok: false, refusal: 'COORDINATES_MISSING', at };
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const here = `${at}[${r}]`;
    if (!Array.isArray(ring) || ring.length < 4) return { ok: false, refusal: 'RING_TOO_SHORT', at: here };
    for (let i = 0; i < ring.length; i++) {
      const bad = checkPosition(ring[i], `${here}[${i}]`);
      if (bad) return bad;
    }
    count.n += ring.length;
    if (count.n > MAX_POSITIONS) return { ok: false, refusal: 'TOO_MANY_POSITIONS' };
    const a = ring[0] as number[]; const b = ring[ring.length - 1] as number[];
    if (a[0] !== b[0] || a[1] !== b[1]) return { ok: false, refusal: 'RING_NOT_CLOSED', at: here };
  }
  return null;
}

/** The one judge of a boundary — the DTO, the service and the console spec all ask it. */
export function validateBoundary(input: unknown): BoundaryVerdict {
  if (!isObj(input)) return { ok: false, refusal: 'NOT_AN_OBJECT' };
  if (input.type !== 'Polygon' && input.type !== 'MultiPolygon') return { ok: false, refusal: 'TYPE_NOT_POLYGON' };
  const extra = Object.keys(input).filter((k) => k !== 'type' && k !== 'coordinates' && k !== 'bbox');
  if (extra.length > 0) return { ok: false, refusal: 'EXTRA_MEMBERS', at: extra[0] };
  const count = { n: 0 };
  if (input.type === 'Polygon') {
    const bad = checkPolygon(input.coordinates, 'coordinates', count);
    if (bad) return bad;
    return { ok: true, value: { type: 'Polygon', coordinates: input.coordinates as number[][][] } };
  }
  const polys = input.coordinates;
  if (!Array.isArray(polys)) return { ok: false, refusal: 'COORDINATES_MISSING' };
  if (polys.length === 0) return { ok: false, refusal: 'NO_POLYGONS' };
  for (let i = 0; i < polys.length; i++) {
    const bad = checkPolygon(polys[i], `coordinates[${i}]`, count);
    if (bad) return bad;
  }
  return { ok: true, value: { type: 'MultiPolygon', coordinates: polys as number[][][][] } };
}

/** The SQL predicate the coverage tile counts — the same shape the validator accepts (and 0190's CHECK enforces on writes). */
export const BOUNDARY_MAPPED_SQL = (col = 'boundary_geojson') => `(${col} IS NOT NULL AND ${col}->>'type' IN ('Polygon','MultiPolygon') AND jsonb_typeof(${col}->'coordinates') = 'array')`;
