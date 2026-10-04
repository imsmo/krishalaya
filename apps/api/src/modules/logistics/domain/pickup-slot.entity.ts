// modules/logistics/domain/pickup-slot.entity.ts · a seller-offered weekly pickup window (0007 pickup_slots).
// Pure TS. weekday 0–6 (Sun–Sat); start_time < end_time (HH:MM[:SS], 24h). Tenant-scoped (tenant_id NOT NULL),
// owned by a seller_user_id. No money.
import { InvalidPickupSlotError, FleetAlreadyInStateError } from './logistics.errors';
import type { DomainEvent } from './logistics.events';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;   // HH:MM or HH:MM:SS, 24h

export interface PickupSlotProps {
  id: string; tenantId: string; sellerUserId: string; weekday: number; startTime: string; endTime: string; isActive: boolean; createdAt?: Date | null; createdUs?: string | null;
}
export type PickupSlotPatch = { weekday?: number; startTime?: string; endTime?: string };

function assertWeekday(d: number): number {
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new InvalidPickupSlotError('weekday must be an integer 0–6');
  return d;
}
function assertWindow(start: string, end: string): void {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw new InvalidPickupSlotError('start_time/end_time must be HH:MM (24h)');
  // lexicographic compare is valid for zero-padded 24h times
  if (start.slice(0, 5) >= end.slice(0, 5)) throw new InvalidPickupSlotError('start_time must be before end_time');
}

export class PickupSlot {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: PickupSlotProps) {}

  static create(input: Omit<PickupSlotProps, 'isActive'>): PickupSlot {
    const weekday = assertWeekday(input.weekday);
    assertWindow(input.startTime, input.endTime);
    const s = new PickupSlot({ ...input, weekday, isActive: true });
    s.events.push({ type: 'logistics.pickup_slot_created', payload: { slotId: s.p.id, tenantId: input.tenantId, sellerUserId: input.sellerUserId } });
    return s;
  }
  static rehydrate(p: PickupSlotProps): PickupSlot { return new PickupSlot(p); }

  get id() { return this.p.id; }
  get isActive() { return this.p.isActive; }
  toProps(): Readonly<PickupSlotProps> { return Object.freeze({ ...this.p }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: PickupSlotPatch): { old: Record<string, unknown>; new: Record<string, unknown> } {
    const old: Record<string, unknown> = {}; const next: Record<string, unknown> = {};
    const nextWeekday = patch.weekday !== undefined ? assertWeekday(patch.weekday) : this.p.weekday;
    const nextStart = patch.startTime !== undefined ? patch.startTime : this.p.startTime;
    const nextEnd = patch.endTime !== undefined ? patch.endTime : this.p.endTime;
    if (patch.startTime !== undefined || patch.endTime !== undefined) assertWindow(nextStart, nextEnd);
    if (nextWeekday !== this.p.weekday) { old.weekday = this.p.weekday; next.weekday = nextWeekday; this.p.weekday = nextWeekday; }
    if (nextStart !== this.p.startTime) { old.startTime = this.p.startTime; next.startTime = nextStart; this.p.startTime = nextStart; }
    if (nextEnd !== this.p.endTime) { old.endTime = this.p.endTime; next.endTime = nextEnd; this.p.endTime = nextEnd; }
    if (Object.keys(next).length === 0) throw new FleetAlreadyInStateError('pickup_slot');
    return { old, new: next };
  }

  setActive(to: boolean): { action: 'activated' | 'deactivated'; old: { isActive: boolean }; new: { isActive: boolean } } {
    if (this.p.isActive === to) throw new FleetAlreadyInStateError('pickup_slot');
    const from = this.p.isActive; this.p.isActive = to;
    return { action: to ? 'activated' : 'deactivated', old: { isActive: from }, new: { isActive: to } };
  }
}
