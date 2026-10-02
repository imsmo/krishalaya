// modules/labour/domain/labour-booking.entity.ts · the labour_bookings aggregate root (pure domain).
// Holds the booking lifecycle (state.ts) + THE DIGNITY FLOOR invariant: an offered wage may never fall
// below the snapshotted statutory minimum (chk_dignity_floor enforces it in the DB; we enforce it here
// first with a typed error). Optimistic concurrency via `version` (the table has a version column —
// unlike most std-column tables — so writers compare-and-swap on it). Money is bigint minor units (Law 2).
import { BookingStatus, assertTransition } from './labour-booking.state';
import { LabourEventType, DomainEvent, WageKind } from './labour.events';
import { WageBelowMinimumError, BookingNotPayableError } from './labour.errors';

export interface LabourBookingProps {
  id: string;
  tenantId: string;
  bookingNo: string;
  employerUserId: string;
  demandTypeId: string;
  taskSkillId: string;
  workersNeeded: number;
  startDate: string;             // ISO date (date column)
  endDate: string;
  dailyHours: number;
  wageKind: WageKind;
  wageOfferedMinor: bigint;
  minWageMinor: bigint;          // snapshot of the statutory floor at posting
  currencyCode: string;
  overtimeRateMultiplier: number;
  womenOnly: boolean;
  farmLat: number;
  farmLng: number;
  status: BookingStatus;
  respondBy: Date | null;
  version: number;
  createdAt?: Date;
  // P0-2 booking details
  startTime?: string | null;     // HH:MM time-of-day (null = unspecified)
  notes?: string | null;         // special instructions to the worker
  // P0-2 read-only enrichment (joined from users; NEVER persisted from the entity)
  employerName?: string | null;
  // PC-56 TENANT-11b — the dignity declarations (A7), the cancel record, the roster stamp, on-behalf posting
  transportProvided?: boolean; mealsProvided?: boolean; toiletConfirmed?: boolean; drinkingWater?: boolean;
  womanSupervisor?: boolean; transportPickupPoint?: string | null; transportPickupTime?: string | null; villageLabel?: string | null;
  cancelReasonId?: string | null; cancelReasonCode?: string | null; cancelReasonText?: string | null; cancelledAt?: Date | null; cancelledBy?: string | null;
  rosterConfirmedAt?: Date | null; rosterConfirmedBy?: string | null; startedAt?: Date | null; completedAt?: Date | null;
  onBehalf?: boolean; createdBy?: string | null; createdAtRaw?: string | null;
}

export class LabourBooking {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: LabourBookingProps) {}

  /** Factory enforces creation invariants INCLUDING the dignity floor (offered ≥ statutory minimum). */
  static post(input: Omit<LabourBookingProps, 'status' | 'version' | 'createdAt'>): LabourBooking {
    if (input.wageOfferedMinor <= 0n) throw new WageBelowMinimumError(input.wageOfferedMinor, input.minWageMinor);
    if (input.wageOfferedMinor < input.minWageMinor) throw new WageBelowMinimumError(input.wageOfferedMinor, input.minWageMinor);
    if (input.workersNeeded < 1) throw new BookingNotPayableError('invalid worker count');
    if (input.endDate < input.startDate) throw new BookingNotPayableError('end date before start date');
    const b = new LabourBooking({ ...input, startTime: input.startTime ?? null, notes: input.notes ?? null, status: 'open', version: 1 });
    if (input.transportPickupTime && !input.transportPickupPoint) throw new BookingNotPayableError('a pickup time needs a pickup point');
    b.events.push({ type: LabourEventType.BookingPosted, payload: { bookingId: b.props.id, employerUserId: b.props.employerUserId,
      taskSkillId: b.props.taskSkillId, workersNeeded: b.props.workersNeeded, wageOfferedMinor: b.props.wageOfferedMinor.toString() } });
    return b;
  }
  static rehydrate(props: LabourBookingProps): LabourBooking { return new LabourBooking(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get employerUserId() { return this.props.employerUserId; }
  get status() { return this.props.status; }
  get version() { return this.props.version; }
  get workersNeeded() { return this.props.workersNeeded; }
  get wageOfferedMinor() { return this.props.wageOfferedMinor; }
  get currencyCode() { return this.props.currencyCode; }
  get bookingNo() { return this.props.bookingNo; }
  setBookingNo(no: string, createdAt: Date, raw: string | null): void { this.props.bookingNo = no; this.props.createdAt = createdAt; this.props.createdAtRaw = raw; }
  toProps(): Readonly<LabourBookingProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  private transition(to: BookingStatus, eventType: string, extra: Record<string, unknown> = {}): void {
    const from = this.props.status;
    assertTransition(from, to);
    this.props.status = to;
    this.events.push({ type: eventType, payload: { bookingId: this.props.id, from, to, ...extra } });
  }

  /** PC-56 TENANT-11b · A3 — the employer (or the desk with consent) confirms the roster; wages are escrowed in the same tx. */
  confirmRoster(now: Date, by: string, extra: Record<string, unknown>): void {
    this.transition('accepted', LabourEventType.RosterConfirmed, extra);
    this.props.rosterConfirmedAt = now; this.props.rosterConfirmedBy = by;
  }

  /** Employer begins the engagement (accepted → in_progress): only once the roster is confirmed and the money held. */
  start(now: Date = new Date()): void { this.transition('in_progress', LabourEventType.BookingStarted); this.props.startedAt = now; }

  /** Employer confirms the work is done (in_progress → completed). Wages are settled by the pay run. */
  complete(now: Date = new Date()): void { this.transition('completed', LabourEventType.BookingCompleted); this.props.completedAt = now; }

  /** Wage settlement done (completed → paid). `totalPaidMinor` travels in the event for downstream. */
  markPaid(totalPaidMinor: bigint, workersPaid: number): void {
    if (this.props.status !== 'completed') throw new BookingNotPayableError(this.props.status);
    this.transition('paid', LabourEventType.WagesPaid, { totalPaidMinor: totalPaidMinor.toString(), workersPaid });
  }

  /** Employer / desk cancels (open, accepted or in_progress → cancelled) with a reason from the lookup (A7). */
  cancel(input: { reasonId: string; reasonCode: string; reasonText: string | null; reasonWords: string; by: string; now: Date; extra?: Record<string, unknown> }): void {
    this.transition('cancelled', LabourEventType.BookingCancelled, { reason: input.reasonWords, reasonCode: input.reasonCode, ...(input.extra ?? {}) });
    this.props.cancelReasonId = input.reasonId; this.props.cancelReasonCode = input.reasonCode; this.props.cancelReasonText = input.reasonText;
    this.props.cancelledAt = input.now; this.props.cancelledBy = input.by;
  }

  /** Worker job: no acceptances by respond_by (open → expired). */
  expire(): void { this.transition('expired', LabourEventType.BookingExpired); }
}
