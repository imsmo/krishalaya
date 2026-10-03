// modules/market-intel/domain/mandi-price.entity.ts · one price observation (mandi_prices, GLOBAL, PARTITIONED
// by price_date). Append-only. All money is bigint minor units / quintal (Law 2). min<=modal<=max enforced.
import { PriceSource, DomainEvent, MarketEventType } from './market-intel.events';
import { InvalidPriceError } from './market-intel.errors';

export interface MandiPriceProps {
  id?: string; mandiId: string | null; regionId: string | null; productId: string; gradeOptionId: string | null; priceDate: string;
  minMinor: bigint | null; maxMinor: bigint | null; modalMinor: bigint; unitCode: string; arrivalsQty: string | null; source: PriceSource; currencyCode: string;
  /** PC-56 TENANT-12 (F-4): set = a TENANT OBSERVATION (source tenant_manual); null = a platform row. */
  tenantId?: string | null; enteredBy?: string | null;
}
export class MandiPrice {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MandiPriceProps) {}

  static observe(input: MandiPriceProps): MandiPrice {
    if (input.modalMinor <= 0n) throw new InvalidPriceError('modal price must be positive');
    if (input.minMinor != null && input.minMinor < 0n) throw new InvalidPriceError('min cannot be negative');
    if (input.minMinor != null && input.minMinor > input.modalMinor) throw new InvalidPriceError('min cannot exceed modal');
    if (input.maxMinor != null && input.maxMinor < input.modalMinor) throw new InvalidPriceError('max cannot be below modal');
    const m = new MandiPrice(input);
    m.events.push({ type: MarketEventType.PriceIngested, payload: { productId: input.productId, regionId: input.regionId, modalMinor: input.modalMinor.toString(), source: input.source } });
    return m;
  }
  static rehydrate(p: MandiPriceProps): MandiPrice { return new MandiPrice(p); }
  get productId() { return this.props.productId; }
  get regionId() { return this.props.regionId; }
  get modalMinor() { return this.props.modalMinor; }
  toProps(): Readonly<MandiPriceProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  toJSON() {
    const v = this.props;
    return { id: v.id, mandiId: v.mandiId, regionId: v.regionId, productId: v.productId, gradeOptionId: v.gradeOptionId, priceDate: v.priceDate,
      minMinor: v.minMinor?.toString() ?? null, maxMinor: v.maxMinor?.toString() ?? null, modalMinor: v.modalMinor.toString(), unitCode: v.unitCode, arrivalsQty: v.arrivalsQty, source: v.source,
      // PC-56 TENANT-12 (F-4): a page labels this cooperative's own typed entries as such — never as a platform feed.
      tenantObservation: v.tenantId != null };
  }
}
