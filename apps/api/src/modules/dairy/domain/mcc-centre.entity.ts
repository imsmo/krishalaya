// modules/dairy/domain/mcc-centre.entity.ts · the mcc_centres aggregate (a Milk Collection Centre).
// Tenant-owned infrastructure; UNIQUE(tenant_id, code). No version column → repo locks FOR UPDATE.
//
// [PC-56 TENANT-6d-2 · W171] The centre gains the two things it has never been able to say: WHEN IT IS OPEN and WHO IS
// HOLDING THE MILK. Both are acts on this aggregate rather than fields a caller may set, because both have rules that
// a `SET x = $1` cannot carry — a shift needs both ends or neither, and a handover has to name the person released.
import { DomainEvent, DairyEventType } from './dairy.events';
import { MilkShift, ShiftWindow, ShiftWindows, minutesOfDay, shiftWindows } from './mcc-console';

export interface MccCentreProps {
  id: string; tenantId: string; code: string; defaultName: string; regionId: string | null;
  lat: string | null; lng: string | null; operatorUserId: string | null; capacityLitresShift: string | null;
  analyzerModel: string | null; analyzerSerial: string | null; isActive: boolean; createdAt?: Date;
  // [TENANT-6d-2] Local wall clocks, `HH:MM` or null (0163). Null is UNRECORDED, never "closed".
  morningOpensAt: string | null; morningClosesAt: string | null;
  eveningOpensAt: string | null; eveningClosesAt: string | null;
}

export class MccCentre {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MccCentreProps) {}

  static create(
    input: Omit<MccCentreProps, 'isActive' | 'createdAt' | 'morningOpensAt' | 'morningClosesAt' | 'eveningOpensAt' | 'eveningClosesAt'>
      & { isActive?: boolean } & Partial<ShiftColumnsInput>,
  ): MccCentre {
    const m = new MccCentre({
      ...input, isActive: input.isActive ?? true,
      morningOpensAt: input.morningOpensAt ?? null, morningClosesAt: input.morningClosesAt ?? null,
      eveningOpensAt: input.eveningOpensAt ?? null, eveningClosesAt: input.eveningClosesAt ?? null,
    });
    m.assertShiftWindows();
    m.events.push({ type: DairyEventType.MccCreated, payload: { mccId: m.props.id, code: m.props.code } });
    return m;
  }
  static rehydrate(props: MccCentreProps): MccCentre { return new MccCentre(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get operatorUserId() { return this.props.operatorUserId; }
  setActive(v: boolean) { this.props.isActive = v; }

  /** The two windows, as the console reads them. */
  windows(): ShiftWindows { return shiftWindows(this.props); }

  /**
   * Set (or clear) a shift's hours.
   *
   * BOTH ends or NEITHER, and the close strictly after the open — the same rule `ck_mcc_shift_*` enforces, checked
   * here so the refusal an operator sees is a domain error with a reason rather than a Postgres constraint name. A
   * window that wrapped past midnight is refused for the reason 0163 gives: "is the centre open now?" must have one
   * answer.
   *
   * Clearing is legitimate and is not the same as closing the centre: a cooperative that no longer keeps fixed hours
   * goes back to UNRECORDED, and the counter board goes back to TENANT-6a's refusal, which was honest.
   */
  setShiftWindow(shift: MilkShift, w: ShiftWindow | null) {
    const before = this.windows();
    if (shift === 'morning') {
      this.props.morningOpensAt = w?.opens ?? null;
      this.props.morningClosesAt = w?.closes ?? null;
    } else {
      this.props.eveningOpensAt = w?.opens ?? null;
      this.props.eveningClosesAt = w?.closes ?? null;
    }
    this.assertShiftWindows();
    this.events.push({
      type: DairyEventType.MccShiftWindowsSet,
      payload: { mccId: this.props.id, shift, before: before[shift], after: this.windows()[shift] },
    });
  }

  /**
   * Custody changes hands.
   *
   * The entity moves the COLUMN and names both people in the event; the custody ROW is the repository's business
   * (0163's `mcc_operator_assignments`), written in the same transaction. Reassigning to the same person is refused —
   * it would close and reopen a custody row, turning one continuous responsibility into two and making "how long has
   * she held this centre" answer wrongly.
   */
  assignOperator(userId: string) {
    if (this.props.operatorUserId === userId) {
      throw new Error('this operator already holds the centre — a re-assignment would split one custody into two');
    }
    const released = this.props.operatorUserId;
    this.props.operatorUserId = userId;
    this.events.push({
      type: DairyEventType.MccOperatorAssigned,
      payload: { mccId: this.props.id, code: this.props.code, operatorUserId: userId, releasedUserId: released },
    });
  }

  /** Nobody holds the centre. A real state between two operators, and a decision worth announcing. */
  releaseOperator() {
    const released = this.props.operatorUserId;
    if (released === null) throw new Error('nobody holds this centre — there is no custody to release');
    this.props.operatorUserId = null;
    this.events.push({
      type: DairyEventType.MccOperatorReleased,
      payload: { mccId: this.props.id, code: this.props.code, releasedUserId: released },
    });
  }

  private assertShiftWindows() {
    const check = (label: MilkShift, o: string | null, c: string | null) => {
      if ((o === null) !== (c === null)) {
        throw new Error(`${label} shift needs both an opening and a closing time, or neither — half a window tells a farmer nothing`);
      }
      if (o !== null && c !== null && minutesOfDay(c) <= minutesOfDay(o)) {
        throw new Error(`${label} shift closes at or before it opens (${o} → ${c}) — a shift that wraps past midnight has two answers to "are you open now"`);
      }
    };
    check('morning', this.props.morningOpensAt, this.props.morningClosesAt);
    check('evening', this.props.eveningOpensAt, this.props.eveningClosesAt);
  }

  toProps(): Readonly<MccCentreProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  toJSON() {
    const v = this.props;
    return { id: v.id, code: v.code, defaultName: v.defaultName, regionId: v.regionId, lat: v.lat, lng: v.lng,
      operatorUserId: v.operatorUserId, capacityLitresShift: v.capacityLitresShift, isActive: v.isActive, createdAt: v.createdAt,
      // The hours are added; the ANALYZER's model and serial are deliberately NOT. This getter is reachable by any
      // authenticated tenant user (`GET /dairy/mccs/:id` carries no permission), and a device serial number is the
      // kind of field that turns a browse route into an inventory export. The board that needs it (W171) reads it
      // through the console, behind `dairy.manage`, and masks it — one place, with a permission in front.
      shiftWindows: shiftWindows(v) };
  }
}

interface ShiftColumnsInput {
  morningOpensAt: string | null; morningClosesAt: string | null;
  eveningOpensAt: string | null; eveningClosesAt: string | null;
}
