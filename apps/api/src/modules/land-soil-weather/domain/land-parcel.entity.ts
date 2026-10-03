// modules/land-soil-weather/domain/land-parcel.entity.ts · the land_parcels aggregate (the farm registry).
// A farmer registers their parcel (survey/khasra + bhulekh ref, area, irrigation, boundary). verification_
// status (kyc_status) is set by the KYC/admin flow (deferred here — registers as 'none'). area is numeric
// scaled ×10000 (4 dp) to stay float-free. No version → repo locks FOR UPDATE. No money.
import { DomainEvent, LandEventType } from './land-soil-weather.events';
import { InvalidBoundaryError, InvalidParcelError, LandForbiddenError } from './land-soil-weather.errors';
import { validateBoundary } from './geojson';

/** PC-56 TENANT-12 (F-2): a boundary is a GeoJSON Polygon / MultiPolygon or it is refused by name — never `{}`. */
function assertBoundary(b: unknown): void {
  if (b === null || b === undefined) return;
  const v = validateBoundary(b);
  if (!v.ok) throw new InvalidBoundaryError(v.refusal, v.at);
}

export interface LandParcelProps {
  id: string; tenantId: string; ownerUserId: string; regionId: string | null; surveyNo: string | null; bhulekhRef: string | null;
  areaTenThousandth: bigint; areaUnit: string; irrigationTypeId: string | null; boundaryGeojson: Record<string, unknown> | null;
  verificationStatus: string; isTenantFarmed: boolean; createdAt?: Date;
}
export class LandParcel {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: LandParcelProps) {}
  static register(input: Omit<LandParcelProps, 'verificationStatus'> & { verificationStatus?: string }): LandParcel {
    if (input.areaTenThousandth <= 0n) throw new InvalidParcelError('area must be greater than zero');
    assertBoundary(input.boundaryGeojson);
    const p = new LandParcel({ ...input, verificationStatus: input.verificationStatus ?? 'none' });
    p.events.push({ type: LandEventType.ParcelRegistered, payload: { parcelId: p.props.id, ownerUserId: p.props.ownerUserId } });
    return p;
  }
  static rehydrate(props: LandParcelProps): LandParcel { return new LandParcel(props); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get ownerUserId() { return this.props.ownerUserId; }
  /** The fields an audit row records as before / after (no geometry dump: whether a boundary exists, and its type). */
  auditView() { const v = this.props; return { regionId: v.regionId, surveyNo: v.surveyNo, bhulekhRef: v.bhulekhRef, area: (Number(v.areaTenThousandth) / 10000).toFixed(4), areaUnit: v.areaUnit,
    irrigationTypeId: v.irrigationTypeId, boundary: v.boundaryGeojson ? String((v.boundaryGeojson as { type?: unknown }).type ?? 'invalid') : null, isTenantFarmed: v.isTenantFarmed }; }
  toProps(): Readonly<LandParcelProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  update(patch: Partial<Pick<LandParcelProps, 'regionId' | 'surveyNo' | 'bhulekhRef' | 'irrigationTypeId' | 'boundaryGeojson' | 'isTenantFarmed'>>): void {
    assertBoundary(patch.boundaryGeojson);
    let changed = false;
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; (this.props as any)[k] = v; changed = true; }
    if (changed) this.events.push({ type: LandEventType.ParcelUpdated, payload: { parcelId: this.props.id } });
  }
  assertOwner(userId: string, isAdmin: boolean): void { if (this.props.ownerUserId !== userId && !isAdmin) throw new LandForbiddenError('only the parcel owner may act here'); }
  toJSON() { const v = this.props; return { id: v.id, ownerUserId: v.ownerUserId, regionId: v.regionId, surveyNo: v.surveyNo, bhulekhRef: v.bhulekhRef,
    area: (Number(v.areaTenThousandth) / 10000).toFixed(4), areaUnit: v.areaUnit, irrigationTypeId: v.irrigationTypeId, boundaryGeojson: v.boundaryGeojson,
    verificationStatus: v.verificationStatus, isTenantFarmed: v.isTenantFarmed, createdAt: v.createdAt }; }
}
