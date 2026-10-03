// modules/land-soil-weather/domain/land-soil-weather.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class ParcelNotFoundError extends NotFoundError { constructor(id: string) { super('Land parcel not found'); (this as any).code = 'PARCEL_NOT_FOUND'; (this as any).details = { id }; } }
export class CropSeasonNotFoundError extends NotFoundError { constructor(id: string) { super('Crop season not found'); (this as any).code = 'CROP_SEASON_NOT_FOUND'; (this as any).details = { id }; } }
export class SoilTestNotFoundError extends NotFoundError { constructor(id: string) { super('Soil test not found'); (this as any).code = 'SOIL_TEST_NOT_FOUND'; (this as any).details = { id }; } }

export class InvalidParcelError extends DomainError { constructor(message: string) { super('PARCEL_INVALID', message, 422); } }
/** PC-56 TENANT-12 (F-2): the boundary is not a closed GeoJSON Polygon / MultiPolygon inside the earth's ranges — by name. */
export class InvalidBoundaryError extends DomainError { constructor(refusal: string, at?: string) { super('PARCEL_BOUNDARY_INVALID', `boundary refused: ${refusal}${at ? ` at ${at}` : ''}`, 422, { refusal, at: at ?? null }); } }
/** PC-56 TENANT-12 (F-11): the land desk edits another member's parcel only with a recorded reason. */
export class ParcelReasonRequiredError extends DomainError { constructor() { super('PARCEL_REASON_REQUIRED', 'editing another member\'s parcel needs a reason (it is written to the audit trail)', 422); } }
/** PC-56 TENANT-12 (F-9): a yield is never stored without a mass unit from `units`. */
export class YieldUnitError extends DomainError { constructor(code: 'YIELD_UNIT_REQUIRED' | 'YIELD_UNIT_UNKNOWN' | 'YIELD_UNIT_NOT_MASS', unit?: string) { super(code, code === 'YIELD_UNIT_REQUIRED' ? 'a yield needs its unit (yieldUnitCode)' : `'${unit}' is not a mass unit this platform knows`, 422, { unit: unit ?? null }); } }
export class InvalidCropSeasonError extends DomainError { constructor(message: string) { super('CROP_SEASON_INVALID', message, 422); } }
export class InvalidSoilTestError extends DomainError { constructor(message: string) { super('SOIL_TEST_INVALID', message, 422); } }
export class LandForbiddenError extends AppError { constructor(message = 'Not allowed on this land resource') { super('LAND_FORBIDDEN', message, 403); } }

// --- weather forecast (P0-12) ---
/** lat/lng outside valid earth bounds (or NaN) — rejected before any provider call. */
export class InvalidCoordinatesError extends DomainError { constructor() { super('WEATHER_INVALID_COORDS', 'lat must be -90..90 and lng -180..180', 422); } }
/** The external forecast provider was unreachable/errored after resilience exhausted — the service degrades to a
 *  regional advisory; the adapter NEVER fabricates numbers. Surfaced as 503 only if no advisory fallback exists. */
export class WeatherProviderUnavailableError extends DomainError { constructor() { super('WEATHER_PROVIDER_UNAVAILABLE', 'Weather forecast provider is unavailable', 503); } }
