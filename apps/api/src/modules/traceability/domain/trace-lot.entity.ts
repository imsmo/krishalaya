// modules/traceability/domain/trace-lot.entity.ts · a traceable produce lot (trace_lots, tenant-scoped). qr_token
// is the public scan capability (unguessable). declared_inputs/certificate_ids are JSON. blockchain_anchor is the
// Phase-2 tamper anchor (set to the latest event hash by the anchor job). No version → repo locks FOR UPDATE.
import { DomainEvent, TraceEventType } from './traceability.events';
import { InvalidTraceLotError } from './traceability.errors';

export interface TraceLotProps {
  id: string; tenantId: string; listingId: string | null; qrToken: string; farmerUserId: string; parcelId: string | null; cropSeasonId: string | null;
  declaredInputs: unknown[]; certificateIds: unknown[]; blockchainAnchor: string | null; createdAt?: Date;
  /** PC-56 HOTFIX-7 · B24: `created_at` as the database printed it (µs) — the keyset cursor only, never in toJSON. */
  createdAtUs?: string | null;
}
export class TraceLot {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: TraceLotProps) {}

  static create(input: Omit<TraceLotProps, 'blockchainAnchor'>): TraceLot {
    if (!input.qrToken) throw new InvalidTraceLotError('qr_token required');
    const l = new TraceLot({ ...input, blockchainAnchor: null });
    l.events.push({ type: TraceEventType.LotCreated, payload: { lotId: l.props.id, qrToken: l.props.qrToken, listingId: l.props.listingId } });
    return l;
  }
  static rehydrate(p: TraceLotProps): TraceLot { return new TraceLot(p); }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get qrToken() { return this.props.qrToken; }
  get farmerUserId() { return this.props.farmerUserId; }
  get blockchainAnchor() { return this.props.blockchainAnchor; }
  toProps(): Readonly<TraceLotProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  anchor(hash: string): void {
    this.props.blockchainAnchor = hash;
    this.events.push({ type: TraceEventType.LotAnchored, payload: { lotId: this.props.id, anchor: hash } });
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, listingId: v.listingId, qrToken: v.qrToken, farmerUserId: v.farmerUserId, parcelId: v.parcelId, cropSeasonId: v.cropSeasonId,
      declaredInputs: v.declaredInputs, certificateIds: v.certificateIds, blockchainAnchor: v.blockchainAnchor, createdAt: v.createdAt };
  }
}
