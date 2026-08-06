// apps/admin-api/src/modules/compliance-ops/domain/dsr.entity.ts · the data-subject-request entity. Pure domain,
// no I/O. Status moves go ONLY through dsr.state.ts (Law 5); each transition returns {from,to} for the audit.
// DPDP guard: an ERASURE may not be COMPLETED while its 90-day cooling window is still open (cooling_ends_at in
// the future) — the data principal can still withdraw. Mirrors data_subject_requests (0003).
import { DsrStatus, assertTransition, isTerminal } from './dsr.state';
import { ErasureCoolingActiveError, DsrAlreadyAcknowledgedError } from './compliance-ops.errors';

export interface DsrProps {
  id: string;
  userId: string;
  requestType: 'access' | 'erasure' | 'correction' | 'portability';
  status: DsrStatus;
  coolingEndsAt: Date | null;
  resolution: string | null;
  exportMediaId: string | null;
  /** DPDP 72h acknowledge clock (0107). NULL means NOT YET ACKNOWLEDGED — never "acknowledged at creation", which
   *  would make every SLA measurement pass trivially. */
  acknowledgedAt: Date | null;
  /** One of the three lawful grounds; NULL unless rejected (CHECK-enforced both ways in 0107). */
  rejectionGround: string | null;
  /** The DPO countersign. maker ≠ checker is enforced by `ck_dsr_countersign_ne_actor` AND by assertSecondPerson. */
  countersignedBy: string | null;
  countersignedAt: Date | null;
  scopeComputedAt: Date | null;
  /** Who last moved this request — the initiator side of the two-person rule. */
  updatedBy: string | null;
  createdAt?: Date | null;
}

export class DataSubjectRequest {
  private constructor(private props: DsrProps) {}
  static rehydrate(p: DsrProps): DataSubjectRequest { return new DataSubjectRequest(p); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get requestType() { return this.props.requestType; }

  private move(to: DsrStatus): { from: DsrStatus; to: DsrStatus } {
    const from = this.props.status;
    assertTransition(from, to);
    this.props.status = to;
    return { from, to };
  }

  startProgress(): { from: DsrStatus; to: DsrStatus } { return this.move('in_progress'); }

  /** Complete the request. For an erasure, the 90-day cooling window must have elapsed (DPDP).
   *
   *  THE EVIDENCE CHECK IS NOT HERE — it lives in the service, because it needs the retention policies and the
   *  recorded actions, both of which are I/O. The entity keeps the check it CAN make (the cooling window) and the
   *  service refuses on the one it cannot. Splitting them this way is deliberate: an entity that silently completes
   *  because nobody passed it the evidence would be the same defect in a new place. */
  complete(resolution: string, now: Date = new Date()): { from: DsrStatus; to: DsrStatus } {
    if (this.props.requestType === 'erasure' && this.props.coolingEndsAt && this.props.coolingEndsAt > now) {
      throw new ErasureCoolingActiveError(this.props.coolingEndsAt.toISOString());
    }
    const c = this.move('completed');
    this.props.resolution = resolution;
    return c;
  }

  /** Reject on one of the three lawful grounds (W042). The ground is REQUIRED — 0107's CHECK ties status and ground
   *  together, so a rejection without one cannot be stored, and the data principal receives it verbatim. */
  reject(resolution: string, ground: string): { from: DsrStatus; to: DsrStatus } {
    const c = this.move('rejected');
    this.props.resolution = resolution;
    this.props.rejectionGround = ground;
    return c;
  }

  /** Stamp the DPDP acknowledgement. Idempotency is the caller's problem to REPORT, not this method's to swallow: a
   *  second acknowledgement must not quietly move the timestamp later and turn a breach into a met SLA. */
  acknowledge(at: Date): void {
    if (this.props.acknowledgedAt) throw new DsrAlreadyAcknowledgedError(this.props.acknowledgedAt.toISOString());
    this.props.acknowledgedAt = at;
  }

  /** The DPO countersign. The maker≠checker assertion is the service's (it needs the actor context); this records it. */
  countersign(by: string, at: Date): void {
    this.props.countersignedBy = by;
    this.props.countersignedAt = at;
  }

  get acknowledgedAt() { return this.props.acknowledgedAt; }
  get coolingEndsAt() { return this.props.coolingEndsAt; }
  get countersignedBy() { return this.props.countersignedBy; }
  get updatedBy() { return this.props.updatedBy; }
  get userId() { return this.props.userId; }

  /** Link the fulfilment export (access/portability bundle) produced by the worker. */
  attachExportMedia(mediaId: string): void { this.props.exportMediaId = mediaId; }

  get resolution() { return this.props.resolution; }
  get isTerminal() { return isTerminal(this.props.status); }

  toJSON() {
    const v = this.props;
    return { id: v.id, userId: v.userId, requestType: v.requestType, status: v.status,
      coolingEndsAt: v.coolingEndsAt, resolution: v.resolution, exportMediaId: v.exportMediaId,
      acknowledgedAt: v.acknowledgedAt, rejectionGround: v.rejectionGround,
      countersignedBy: v.countersignedBy, countersignedAt: v.countersignedAt,
      scopeComputedAt: v.scopeComputedAt, createdAt: v.createdAt ?? null };
  }
}
