// modules/warehousing/domain/storage-booking.entity.ts · the storage_bookings aggregate root.
// Lifecycle via storage-booking.state. THE STORAGE FEE (charged at release) is FLOAT-FREE: quantity is a
// scaled integer (×1000), and fee = qtyMilli × ratePerQtlMonth × months / 1000 with round-half-up integer
// division (Law: money correctness). The wallet transfer is posted by the service (Law 2).
import { BookingStatus, assertTransition } from './storage-booking.state';
import { DomainEvent, WarehousingEventType } from './warehousing.events';
import { InvalidBookingError } from './warehousing.errors';
import { formatQuantityMilli } from './quantity';   // PC-56 OPS-2c B23: printed from the scaled integer, never a float

function roundDiv(num: bigint, den: bigint): bigint { return (num + den / 2n) / den; }

export interface StorageBookingProps {
  id: string; tenantId: string; warehouseId: string; depositorUserId: string; productId: string;
  quantityMilli: bigint;            // quantity ×1000 — IN QUINTALS: the request refuses any other unit (PC-56 OPS-2c B5, STORAGE_FEE_UNIT)
  unitCode: string; expectedArrival: string | null; status: BookingStatus; storedAt: Date | null; releasedAt: Date | null; createdAt?: Date;
}
export class StorageBooking {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: StorageBookingProps) {}

  static request(input: Omit<StorageBookingProps, 'status' | 'storedAt' | 'releasedAt'>): StorageBooking {
    if (input.quantityMilli <= 0n) throw new InvalidBookingError('quantity must be greater than zero');
    const b = new StorageBooking({ ...input, status: 'requested', storedAt: null, releasedAt: null });
    b.events.push({ type: WarehousingEventType.BookingRequested, payload: { bookingId: b.props.id, warehouseId: b.props.warehouseId, depositorUserId: b.props.depositorUserId } });
    return b;
  }
  static rehydrate(props: StorageBookingProps): StorageBooking { return new StorageBooking(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get warehouseId() { return this.props.warehouseId; }
  get depositorUserId() { return this.props.depositorUserId; }
  get status() { return this.props.status; }
  get quantityMilli() { return this.props.quantityMilli; }
  get storedAt() { return this.props.storedAt; }
  toProps(): Readonly<StorageBookingProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  private transition(to: BookingStatus, eventType: string, extra: Record<string, unknown> = {}): void {
    const from = this.props.status; assertTransition(from, to); this.props.status = to;
    this.events.push({ type: eventType, payload: { bookingId: this.props.id, from, to, ...extra } });
  }
  confirm(): void { this.transition('confirmed', WarehousingEventType.BookingConfirmed); }
  store(now: Date): void { this.transition('stored', WarehousingEventType.BookingStored); this.props.storedAt = now; }
  release(now: Date, feeMinor: bigint): void { this.transition('released', WarehousingEventType.BookingReleased, { storageFeeMinor: feeMinor.toString() }); this.props.releasedAt = now; }
  cancel(reason?: string): void { this.transition('cancelled', WarehousingEventType.BookingCancelled, reason ? { reason } : {}); }

  /** Whole months stored (≥1), billed inclusively, from stored_at to `now`. */
  monthsStored(now: Date): number {
    if (!this.props.storedAt) return 0;
    const ms = now.getTime() - this.props.storedAt.getTime();
    return Math.max(1, Math.ceil(ms / (30 * 24 * 3600 * 1000)));
  }
  /** EXACT storage fee = quantity(qtl) × rate/qtl/month × months (float-free). */
  storageFeeMinor(ratePerQtlMonthMinor: bigint, months: number): bigint {
    if (ratePerQtlMonthMinor <= 0n || months <= 0) return 0n;
    return roundDiv(this.props.quantityMilli * ratePerQtlMonthMinor * BigInt(months), 1000n);
  }
  toJSON() { const v = this.props; return { id: v.id, warehouseId: v.warehouseId, depositorUserId: v.depositorUserId, productId: v.productId,
    quantity: formatQuantityMilli(v.quantityMilli), unitCode: v.unitCode, status: v.status, storedAt: v.storedAt, releasedAt: v.releasedAt, createdAt: v.createdAt }; }
}
