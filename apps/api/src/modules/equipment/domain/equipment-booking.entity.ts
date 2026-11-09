// modules/equipment/domain/equipment-booking.entity.ts · the equipment_bookings aggregate root (CHC rental).
// Lifecycle via equipment-booking.state. Money is bigint minor units; quantities (hours/acres) are SCALED
// INTEGERS (×100) so total = rate × qty is FLOAT-FREE (Law: money correctness). The start is OTP-gated —
// the entity stores ONLY the OTP HMAC hash (the service hashes with the server pepper) and compares it in
// constant time. The escrow hold/release legs are posted by the service via the wallet boundary (Law 2).
import { timingSafeEqual } from 'node:crypto';
import { RentalStatus, assertTransition } from './equipment-booking.state';
import { RateBasis, DomainEvent, EquipmentEventType } from './equipment.events';
import { formatScaled } from './scaled';
import { InvalidBookingError, OverEstimateError, BookingStartOtpInvalidError, BookingStartOtpNotIssuedError, UsageNotConfirmableError, UsageAlreadyConfirmedError, UsageConfirmNotRenterError } from './equipment.errors';

/** Round-half-up integer division for positive bigints. */
function roundDiv(num: bigint, den: bigint): bigint { return (num + den / 2n) / den; }

export interface EquipmentBookingProps {
  id: string; tenantId: string; bookingNo: string; renterUserId: string; assetId: string; ownerUserId: string;
  operatorUserId: string | null; taskDesc: string | null; rateBasis: RateBasis; rateMinor: bigint;
  estQuantityCenti: bigint; actualQuantityCenti: bigint | null; scheduledAt: Date; status: RentalStatus;
  advanceMinor: bigint; totalMinor: bigint | null; startOtpHash: string | null; startedAt: Date | null; completedAt: Date | null; createdAt?: Date;
  /** [PC-56 HOTFIX-13 · founder Q1-A, 0236] the renter's own confirmation of the hours the owner recorded. Optional on input
   *  so a fresh request / older fixture is "not confirmed"; always present on a row read back. */
  usageConfirmedBy?: string | null; usageConfirmedAt?: Date | null;
}

export class EquipmentBooking {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: EquipmentBookingProps) {}

  static request(input: Omit<EquipmentBookingProps, 'status' | 'actualQuantityCenti' | 'advanceMinor' | 'totalMinor' | 'startOtpHash' | 'startedAt' | 'completedAt' | 'usageConfirmedBy' | 'usageConfirmedAt'>): EquipmentBooking {
    if (input.estQuantityCenti <= 0n) throw new InvalidBookingError('estimated quantity must be greater than zero');
    if (input.rateMinor <= 0n) throw new InvalidBookingError('rate must be greater than zero');
    const b = new EquipmentBooking({ ...input, status: 'requested', actualQuantityCenti: null, advanceMinor: 0n, totalMinor: null, startOtpHash: null, startedAt: null, completedAt: null, usageConfirmedBy: null, usageConfirmedAt: null });
    b.events.push({ type: EquipmentEventType.BookingRequested, payload: { bookingId: b.props.id, renterUserId: b.props.renterUserId, assetId: b.props.assetId, ownerUserId: b.props.ownerUserId } });
    return b;
  }
  static rehydrate(props: EquipmentBookingProps): EquipmentBooking { return new EquipmentBooking(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get renterUserId() { return this.props.renterUserId; }
  get ownerUserId() { return this.props.ownerUserId; }
  get status() { return this.props.status; }
  get advanceMinor() { return this.props.advanceMinor; }
  get totalMinor() { return this.props.totalMinor; }
  get usageConfirmedBy(): string | null { return this.props.usageConfirmedBy ?? null; }
  get usageConfirmedAt(): Date | null { return this.props.usageConfirmedAt ?? null; }
  get isUsageConfirmed(): boolean { return this.usageConfirmedBy != null; }
  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] Does settling this hire take money BEYOND the deposit from the renter's wallet? True when the
   * bill is above the deposit (the `order_payment` shortfall leg). PURE. A hire with no bill yet answers false (it cannot settle).
   */
  get takesBeyondDeposit(): boolean { return this.props.totalMinor != null && this.props.totalMinor > this.props.advanceMinor; }
  /** Estimated total = rate × estimated quantity (float-free), used to bound the advance + final bill. */
  get estTotalMinor(): bigint { return roundDiv(this.props.rateMinor * this.props.estQuantityCenti, 100n); }
  toProps(): Readonly<EquipmentBookingProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  private transition(to: RentalStatus, eventType: string, extra: Record<string, unknown> = {}): void {
    const from = this.props.status;
    assertTransition(from, to);
    this.props.status = to;
    this.events.push({ type: eventType, payload: { bookingId: this.props.id, from, to, ...extra } });
  }

  /** Owner quotes the deposit/advance (≤ estimated total). requested → quoted. */
  quote(advanceMinor: bigint): void {
    if (advanceMinor < 0n) throw new InvalidBookingError('advance cannot be negative');
    if (advanceMinor > this.estTotalMinor) throw new InvalidBookingError('advance cannot exceed the estimated total');
    this.props.advanceMinor = advanceMinor;
    this.transition('quoted', EquipmentEventType.BookingQuoted, { advanceMinor: advanceMinor.toString(), estTotalMinor: this.estTotalMinor.toString() });
  }
  /** Renter confirms; the advance is escrowed by the service. quoted → confirmed. Stores the start-OTP hash. */
  confirm(startOtpHash: string): void {
    this.props.startOtpHash = startOtpHash;
    this.transition('confirmed', EquipmentEventType.BookingConfirmed, { advanceMinor: this.props.advanceMinor.toString() });
  }
  /** Operator/owner starts the meter after the renter hands over the OTP (constant-time compare). */
  start(submittedOtpHash: string, now: Date): void {
    if (!this.props.startOtpHash) throw new BookingStartOtpNotIssuedError();
    const a = Buffer.from(this.props.startOtpHash); const b = Buffer.from(submittedOtpHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BookingStartOtpInvalidError();
    this.props.startedAt = now;
    this.transition('in_progress', EquipmentEventType.BookingStarted);
  }
  /** Complete the job with measured usage (≤ estimate — over-runs need a re-quote). Computes total. */
  complete(actualQuantityCenti: bigint, now: Date): void {
    if (actualQuantityCenti <= 0n) throw new InvalidBookingError('actual quantity must be greater than zero');
    if (actualQuantityCenti > this.props.estQuantityCenti) throw new OverEstimateError();
    this.props.actualQuantityCenti = actualQuantityCenti;
    this.props.totalMinor = roundDiv(this.props.rateMinor * actualQuantityCenti, 100n);
    this.props.completedAt = now;
    this.transition('completed', EquipmentEventType.BookingCompleted, { totalMinor: this.props.totalMinor.toString() });
  }
  /** Settlement done (escrow released + remainder/refund posted by the service). completed → settled. */
  markSettled(): void {
    if (this.props.totalMinor == null) throw new InvalidBookingError('cannot settle before completion');
    this.transition('settled', EquipmentEventType.BookingSettled, { totalMinor: this.props.totalMinor.toString() });
  }
  /**
   * [PC-56 HOTFIX-13 · founder Q1-A] THE RENTER CONFIRMS THE HOURS the owner recorded, in her own session. Allowed only on a
   * completed hire, only by its renter, once. Not a status transition (the hire stays `completed`); the database holds the same
   * rule whatever writes the row (0236: ck_eqbook_usage_confirmed_by_renter, equipment_bookings_hf13_guard).
   */
  confirmUsage(by: string, at: Date): void {
    if (by !== this.props.renterUserId) throw new UsageConfirmNotRenterError();
    if (this.props.status !== 'completed' || this.props.totalMinor == null) throw new UsageNotConfirmableError(this.props.status);
    if (this.isUsageConfirmed) throw new UsageAlreadyConfirmedError();
    this.props.usageConfirmedBy = by;
    this.props.usageConfirmedAt = at;
  }
  cancel(reason?: string): void { this.transition('cancelled', EquipmentEventType.BookingCancelled, reason ? { reason } : {}); }

  toJSON() { const v = this.props; return { id: v.id, bookingNo: v.bookingNo, renterUserId: v.renterUserId, assetId: v.assetId, ownerUserId: v.ownerUserId,
    operatorUserId: v.operatorUserId, taskDesc: v.taskDesc, rateBasis: v.rateBasis, rateMinor: v.rateMinor.toString(),
    // [PC-56 OPS-4a · E15] scaled strings by string placement of the point — never Number() on a quantity.
    estQuantity: formatScaled(v.estQuantityCenti, 2), actualQuantity: v.actualQuantityCenti != null ? formatScaled(v.actualQuantityCenti, 2) : null,
    scheduledAt: v.scheduledAt, status: v.status, advanceMinor: v.advanceMinor.toString(), totalMinor: v.totalMinor?.toString() ?? null,
    startedAt: v.startedAt, completedAt: v.completedAt, createdAt: v.createdAt,
    // [PC-56 HOTFIX-13] whether — and when — the renter confirmed the hours (never the start code, never its hash).
    usageConfirmedAt: v.usageConfirmedAt ?? null }; }
}
