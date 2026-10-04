// modules/logistics/domain/vehicle.entity.ts · a vehicle in a partner's fleet (0007 vehicles). Pure TS. reg_no is
// normalised (uppercase, no spaces) + UNIQUE per partner. capacity_kg is a weight (numeric), NOT money. Tenant-
// scoped (tenant_id); platform-3PL vehicles (tenant_id NULL) are admin-api-written, browsed here (Law 11).
import { InvalidVehicleError, FleetAlreadyInStateError } from './logistics.errors';
import type { DomainEvent } from './logistics.events';

const REG_RE = /^[A-Z0-9-]{4,20}$/;   // normalised Indian RTO plates e.g. MH12AB1234 (anchored, ReDoS-safe)
const MAX_CAPACITY_KG = 100000;        // 100 t sanity cap

export interface VehicleProps {
  id: string; tenantId: string; partnerId: string; regNo: string; vehicleTypeId: string | null;
  capacityKg: number | null; isRefrigerated: boolean; rcDocId: string | null; isActive: boolean; createdAt?: Date | null; createdUs?: string | null;
}
export type VehiclePatch = { vehicleTypeId?: string | null; capacityKg?: number | null; isRefrigerated?: boolean; rcDocId?: string | null };

/** Normalise a registration number to the stored form: upper-case, spaces/dots stripped. */
export function normalizeRegNo(raw: string): string {
  const v = raw.toUpperCase().replace(/[\s.]/g, '');
  if (!REG_RE.test(v)) throw new InvalidVehicleError('reg_no must be 4–20 chars of A–Z, 0–9, hyphen');
  return v;
}
function assertCapacity(v: number | null): number | null {
  if (v === null) return null;
  if (!(typeof v === 'number') || Number.isNaN(v) || v <= 0 || v > MAX_CAPACITY_KG) throw new InvalidVehicleError(`capacity_kg must be > 0 and <= ${MAX_CAPACITY_KG}`);
  return v;
}

export class Vehicle {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: VehicleProps) {}

  static create(input: Omit<VehicleProps, 'isActive' | 'regNo'> & { regNo: string }): Vehicle {
    const regNo = normalizeRegNo(input.regNo);
    const capacityKg = assertCapacity(input.capacityKg);
    const v = new Vehicle({ ...input, regNo, capacityKg, isActive: true });
    v.events.push({ type: 'logistics.vehicle_registered', payload: { vehicleId: v.p.id, tenantId: input.tenantId, partnerId: input.partnerId } });
    return v;
  }
  static rehydrate(p: VehicleProps): Vehicle { return new Vehicle(p); }

  get id() { return this.p.id; }
  get isActive() { return this.p.isActive; }
  toProps(): Readonly<VehicleProps> { return Object.freeze({ ...this.p }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: VehiclePatch): { old: Record<string, unknown>; new: Record<string, unknown> } {
    const old: Record<string, unknown> = {}; const next: Record<string, unknown> = {};
    if (patch.vehicleTypeId !== undefined && patch.vehicleTypeId !== this.p.vehicleTypeId) { old.vehicleTypeId = this.p.vehicleTypeId; next.vehicleTypeId = patch.vehicleTypeId; this.p.vehicleTypeId = patch.vehicleTypeId; }
    if (patch.capacityKg !== undefined) { const v = assertCapacity(patch.capacityKg); if (v !== this.p.capacityKg) { old.capacityKg = this.p.capacityKg; next.capacityKg = v; this.p.capacityKg = v; } }
    if (patch.isRefrigerated !== undefined && patch.isRefrigerated !== this.p.isRefrigerated) { old.isRefrigerated = this.p.isRefrigerated; next.isRefrigerated = patch.isRefrigerated; this.p.isRefrigerated = patch.isRefrigerated; }
    if (patch.rcDocId !== undefined && patch.rcDocId !== this.p.rcDocId) { old.rcDocId = this.p.rcDocId; next.rcDocId = patch.rcDocId; this.p.rcDocId = patch.rcDocId; }
    if (Object.keys(next).length === 0) throw new FleetAlreadyInStateError('vehicle');
    return { old, new: next };
  }

  setActive(to: boolean): { action: 'activated' | 'deactivated'; old: { isActive: boolean }; new: { isActive: boolean } } {
    if (this.p.isActive === to) throw new FleetAlreadyInStateError('vehicle');
    const from = this.p.isActive; this.p.isActive = to;
    return { action: to ? 'activated' : 'deactivated', old: { isActive: from }, new: { isActive: to } };
  }
}
