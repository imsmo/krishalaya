// modules/land-soil-weather/domain/crop-season.entity.ts · the crop_seasons aggregate (what's growing where).
// Lifecycle via crop-season.state (planned→sown→harvested, +abandoned). Yields are numeric scaled ×1000
// (3 dp, float-free). No money. No version → repo locks FOR UPDATE.
import { CropStatus, assertTransition } from './crop-season.state';
import { CropSeasonName, DomainEvent, LandEventType } from './land-soil-weather.events';
import { InvalidCropSeasonError, YieldUnitError } from './land-soil-weather.errors';

export interface CropSeasonProps {
  id: string; tenantId: string; parcelId: string; productId: string; season: CropSeasonName; year: number;
  sownOn: string | null; expectedHarvest: string | null; expectedYieldMilli: bigint | null; actualYieldMilli: bigint | null; status: CropStatus; createdAt?: Date;
  /** PC-56 TENANT-12 (F-9): the mass unit the yields are in (units). NULL only while no yield is recorded. */
  yieldUnitCode: string | null;
}
export class CropSeason {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: CropSeasonProps) {}
  static plan(input: Omit<CropSeasonProps, 'status' | 'sownOn' | 'actualYieldMilli' | 'yieldUnitCode'> & { sownOn?: string | null; yieldUnitCode?: string | null }): CropSeason {
    if (input.year < 2000 || input.year > 2100) throw new InvalidCropSeasonError('invalid year');
    if (input.expectedYieldMilli != null && !input.yieldUnitCode) throw new YieldUnitError('YIELD_UNIT_REQUIRED');
    const c = new CropSeason({ ...input, status: 'planned', sownOn: input.sownOn ?? null, actualYieldMilli: null, yieldUnitCode: input.yieldUnitCode ?? null });
    c.events.push({ type: LandEventType.CropSeasonPlanned, payload: { cropSeasonId: c.props.id, parcelId: c.props.parcelId, productId: c.props.productId } });
    return c;
  }
  static rehydrate(props: CropSeasonProps): CropSeason { return new CropSeason(props); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get parcelId() { return this.props.parcelId; }
  get status() { return this.props.status; }
  toProps(): Readonly<CropSeasonProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  private transition(to: CropStatus, eventType: string, extra: Record<string, unknown> = {}): void {
    const from = this.props.status; assertTransition(from, to); this.props.status = to;
    this.events.push({ type: eventType, payload: { cropSeasonId: this.props.id, from, to, ...extra } });
  }
  sow(sownOn: string): void { this.props.sownOn = sownOn; this.transition('sown', LandEventType.CropSeasonSown); }
  /** A harvest's yield is recorded WITH its unit (F-9): the unit given now, or the one the season already carries. A season
   *  whose expected yield was in one unit cannot record its actual yield in another (the comparison would be meaningless). */
  harvest(actualYieldMilli: bigint | null, unitCode?: string | null): void {
    if (actualYieldMilli != null && actualYieldMilli < 0n) throw new InvalidCropSeasonError('yield cannot be negative');
    if (actualYieldMilli != null) {
      const unit = unitCode ?? this.props.yieldUnitCode;
      if (!unit) throw new YieldUnitError('YIELD_UNIT_REQUIRED');
      if (this.props.yieldUnitCode && unitCode && unitCode !== this.props.yieldUnitCode && this.props.expectedYieldMilli != null) throw new InvalidCropSeasonError(`the expected yield is in ${this.props.yieldUnitCode}; record the actual yield in the same unit`);
      this.props.yieldUnitCode = unit;
    }
    this.props.actualYieldMilli = actualYieldMilli; this.transition('harvested', LandEventType.CropSeasonHarvested);
  }
  abandon(reason: string): void {
    if (!reason || reason.trim().length < 3) throw new InvalidCropSeasonError('abandoning a season needs a reason');
    this.transition('abandoned', LandEventType.CropSeasonAbandoned, { reason: reason.trim() });
  }
  toJSON() { const v = this.props; return { id: v.id, parcelId: v.parcelId, productId: v.productId, season: v.season, year: v.year, sownOn: v.sownOn,
    expectedHarvest: v.expectedHarvest, expectedYield: v.expectedYieldMilli != null ? (Number(v.expectedYieldMilli) / 1000).toFixed(3) : null,
    actualYield: v.actualYieldMilli != null ? (Number(v.actualYieldMilli) / 1000).toFixed(3) : null, yieldUnitCode: v.yieldUnitCode, status: v.status, createdAt: v.createdAt }; }
}
