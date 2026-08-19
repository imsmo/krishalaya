// modules/logistics/domain/delivery-route.entity.ts · the Saturday Village Run (0007 delivery_routes, PRD §16.5):
// a tenant's recurring consolidation route to a cluster of village regions, optionally on a fixed weekday, served
// by a vehicle and dropped at a consolidation point (often an ambassador). Pure TS. Tenant-scoped. No money.
import { InvalidDeliveryRouteError, FleetAlreadyInStateError, RouteNotApprovableError } from './logistics.errors';
import type { DomainEvent } from './logistics.events';
import { ApprovalVerdict, RouteStatus, approvalVerdict, canTransitionRoute } from './route-plan';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const MAX_REGIONS = 2000;

export interface DeliveryRouteProps {
  id: string; tenantId: string; defaultName: string; runWeekday: number | null; villageRegionIds: string[];
  vehicleId: string | null; consolidationUserId: string | null;
  /**
   * PC-56 TENANT-5b · the ONE lifecycle (0152). Replaces the `isActive` boolean this entity carried, which
   * `create` set to TRUE — so W231's `(proposed)` row could not exist and every route was live the instant it
   * was typed, with the Village-Run job ready to notify a named ambassador about a run nobody had approved.
   * `is_active` is now a GENERATED column in the database, derived from this, so the two cannot disagree.
   */
  status: RouteStatus;
  /** The evidence of the commitment. Both or neither — 0152's `ck_delivery_routes_approval_pair`. */
  approvedBy: string | null; approvedAt: Date | null;
  createdAt?: Date | null;
}
export type DeliveryRoutePatch = { defaultName?: string; runWeekday?: number | null; villageRegionIds?: string[]; vehicleId?: string | null; consolidationUserId?: string | null };

function assertName(v: string): string {
  const s = v.trim();
  if (!s) throw new InvalidDeliveryRouteError('default_name is required');
  if (s.length > 150) throw new InvalidDeliveryRouteError('default_name exceeds 150 chars');
  if (/[<>]/.test(s) || CONTROL_RE.test(s)) throw new InvalidDeliveryRouteError('default_name must be plain text');
  return s;
}
function assertWeekday(d: number | null): number | null {
  if (d === null) return null;
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new InvalidDeliveryRouteError('run_weekday must be an integer 0–6 or null');
  return d;
}
function assertRegionIds(raw: string[]): string[] {
  if (!Array.isArray(raw)) throw new InvalidDeliveryRouteError('village_region_ids must be an array');
  if (raw.length > MAX_REGIONS) throw new InvalidDeliveryRouteError(`village_region_ids exceeds ${MAX_REGIONS}`);
  const out: string[] = [];
  for (const r of raw) { const s = String(r).trim(); if (!UUID_RE.test(s)) throw new InvalidDeliveryRouteError(`invalid region_id: ${s}`); out.push(s); }
  return Array.from(new Set(out));
}

export class DeliveryRoute {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: DeliveryRouteProps) {}

  /**
   * A new route is a PROPOSAL, not a run. W231 draws exactly this row — "(proposed)", `unassigned` vehicle,
   * "— est. 12" parcels — and puts an [Approve route] button beside it, because approving "commits a vehicle +
   * ambassador weekly". Creating it live (the pre-wave behaviour) skipped the one decision the screen exists
   * to make.
   */
  static create(input: Omit<DeliveryRouteProps, 'status' | 'approvedBy' | 'approvedAt' | 'villageRegionIds'> & { villageRegionIds: string[] }): DeliveryRoute {
    const r = new DeliveryRoute({
      ...input, defaultName: assertName(input.defaultName), runWeekday: assertWeekday(input.runWeekday),
      villageRegionIds: assertRegionIds(input.villageRegionIds), status: 'proposed', approvedBy: null, approvedAt: null,
    });
    r.events.push({ type: 'logistics.delivery_route_created', payload: { routeId: r.p.id, tenantId: input.tenantId, runWeekday: r.p.runWeekday } });
    return r;
  }
  static rehydrate(p: DeliveryRouteProps): DeliveryRoute { return new DeliveryRoute(p); }

  get id() { return this.p.id; }
  /** DERIVED, never stored on the entity either: one fact, one place. */
  get isActive() { return this.p.status === 'active'; }
  get status() { return this.p.status; }
  get runWeekday() { return this.p.runWeekday; }
  toProps(): Readonly<DeliveryRouteProps> { return Object.freeze({ ...this.p, villageRegionIds: [...this.p.villageRegionIds] }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  update(patch: DeliveryRoutePatch): { old: Record<string, unknown>; new: Record<string, unknown> } {
    const old: Record<string, unknown> = {}; const next: Record<string, unknown> = {};
    if (patch.defaultName !== undefined) { const v = assertName(patch.defaultName); if (v !== this.p.defaultName) { old.defaultName = this.p.defaultName; next.defaultName = v; this.p.defaultName = v; } }
    if (patch.runWeekday !== undefined) { const v = assertWeekday(patch.runWeekday); if (v !== this.p.runWeekday) { old.runWeekday = this.p.runWeekday; next.runWeekday = v; this.p.runWeekday = v; } }
    if (patch.villageRegionIds !== undefined) { const v = assertRegionIds(patch.villageRegionIds); old.villageRegionIds = this.p.villageRegionIds.length; next.villageRegionIds = v.length; this.p.villageRegionIds = v; }
    if (patch.vehicleId !== undefined && patch.vehicleId !== this.p.vehicleId) { old.vehicleId = this.p.vehicleId; next.vehicleId = patch.vehicleId; this.p.vehicleId = patch.vehicleId; }
    if (patch.consolidationUserId !== undefined && patch.consolidationUserId !== this.p.consolidationUserId) { old.consolidationUserId = this.p.consolidationUserId; next.consolidationUserId = patch.consolidationUserId; this.p.consolidationUserId = patch.consolidationUserId; }
    if (Object.keys(next).length === 0) throw new FleetAlreadyInStateError('delivery_route');
    return { old, new: next };
  }

  /**
   * Approve the proposal: commit the vehicle and the consolidation point, weekly, and RECORD WHO DID IT.
   *
   * The verdict is returned rather than guessed at by the caller, and every refusal names the ONE missing
   * commitment — a console that says "incomplete" makes an operator open five fields to find out which.
   */
  approve(actorUserId: string, now: Date = new Date()): { verdict: ApprovalVerdict } {
    const v = approvalVerdict({ status: this.p.status, vehicleId: this.p.vehicleId, consolidationUserId: this.p.consolidationUserId, villageRegionIds: this.p.villageRegionIds });
    if (v.kind !== 'ready') throw new RouteNotApprovableError(v.kind);
    this.p.status = 'active';
    this.p.approvedBy = actorUserId;
    this.p.approvedAt = now;
    this.events.push({ type: 'logistics.delivery_route_approved', payload: {
      routeId: this.p.id, tenantId: this.p.tenantId, runWeekday: this.p.runWeekday,
      // The EVIDENCE travels with the verdict: a consumer that is told a run was approved and not what was
      // committed cannot tell an ambassador which Thursday is theirs.
      vehicleId: this.p.vehicleId, consolidationUserId: this.p.consolidationUserId,
      villages: this.p.villageRegionIds.length, approvedBy: actorUserId,
    } });
    return { verdict: v };
  }

  /**
   * The compatibility surface the existing `POST :id/active` route drives, expressed against the state machine.
   *
   * `true` on a route that was NEVER APPROVED is refused rather than quietly activated: otherwise a dropped
   * proposal could be switched live through the back door and the approval — the decision that commits a
   * vehicle and a person — would have been skipped while `approved_by` stayed null.
   */
  setActive(to: boolean): { action: 'activated' | 'deactivated'; old: { status: RouteStatus }; new: { status: RouteStatus } } {
    const from = this.p.status;
    const next: RouteStatus = to ? 'active' : 'inactive';
    if (from === next) throw new FleetAlreadyInStateError('delivery_route');
    // ONE guard, not two. A proposal has no `approved_at` and nothing ever transitions a route back INTO
    // `proposed`, so "never approved" already covers "still a proposal" — mutation testing proved the extra
    // `from === 'proposed'` check unreachable, and a second mechanism over one fact is on this programme's own
    // defect list even when both mechanisms agree.
    if (to && this.p.approvedAt === null) throw new RouteNotApprovableError('needs_approval');
    if (!canTransitionRoute(from, next)) throw new RouteNotApprovableError('not_proposed');
    this.p.status = next;
    return { action: to ? 'activated' : 'deactivated', old: { status: from }, new: { status: next } };
  }
}
