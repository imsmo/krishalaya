// modules/traceability/domain/trace-event.entity.ts · one journey event (trace_events, PARTITIONED by created_at,
// append-only). Tamper-evident HASH CHAIN: each event's hash covers the previous event's hash (the first chains off the lot id). meta is
// curated non-PII (trace-meta.ts allow-list) — it is exposed by the public scan.
//
// PC-56 STORE-5b · B11 (founder D3): a new event is written with HASH VERSION 2 — sha256(prev|lot|code|canonical(meta)|createdAt), the
// instant in the v2 text (trace-chain.ts `hashInstant`) — and the INSERT carries that instant as `created_at` (the repository), so the hashed
// instant IS the stored instant and the stored row recomputes. Rows written before 0219 keep version 1 (`chainHashV1`, below as `chainHash`).
import { TraceStep } from './traceability.events';
import { InvalidTraceEventError } from './traceability.errors';
import { chainHashV1, chainHashV2, hashInstant, HASH_V2 } from './trace-chain';

export interface TraceEventProps {
  id?: string; traceLotId: string; tenantId: string; eventCode: TraceStep; meta: Record<string, unknown>; eventHash: string; createdAt?: Date;
  /** PC-56 HOTFIX-7 · B24: `created_at` as the database printed it (µs) — the keyset cursor only, never in toJSON. */
  createdAtUs?: string | null;
  /** PC-56 STORE-5b: 1 (before 0219) or 2 (canonical meta + the instant). */
  hashVersion?: number;
}
/** The v1 chain hash (kept: rows written before 0219 were hashed with it). */
export function chainHash(prevHash: string, lotId: string, eventCode: string, meta: Record<string, unknown>): string {
  return chainHashV1(prevHash, lotId, eventCode, meta);
}
export class TraceEvent {
  private constructor(private readonly props: TraceEventProps) {}
  /** A new event, hash VERSION 2: `createdAt` is the instant hashed AND the instant stored (the repository inserts it). */
  static append(input: { traceLotId: string; tenantId: string; eventCode: TraceStep; meta: Record<string, unknown>; prevHash: string; createdAt: Date }): TraceEvent {
    if (!input.eventCode) throw new InvalidTraceEventError('eventCode required');
    if (!(input.createdAt instanceof Date) || Number.isNaN(input.createdAt.getTime())) throw new InvalidTraceEventError('createdAt required');
    const eventHash = chainHashV2(input.prevHash, input.traceLotId, input.eventCode, input.meta ?? {}, hashInstant(input.createdAt));
    return new TraceEvent({ traceLotId: input.traceLotId, tenantId: input.tenantId, eventCode: input.eventCode, meta: input.meta, eventHash, createdAt: input.createdAt, hashVersion: HASH_V2 });
  }
  static rehydrate(p: TraceEventProps): TraceEvent { return new TraceEvent(p); }
  get eventHash() { return this.props.eventHash; }
  get eventCode() { return this.props.eventCode; }
  toProps(): Readonly<TraceEventProps> { return Object.freeze({ ...this.props }); }
  /** PC-56 HOTFIX-7 · F-13 / B24: + `id` — the bigserial the timeline's keyset compares (the cursor used to carry `eventHash`, which the
   *  repository compared against `id`: page 2 errored `bigint > '<hex>'`). The owner / manager read only — the public scan carries no id. */
  toJSON() { const v = this.props; return { id: v.id ?? null, eventCode: v.eventCode, meta: v.meta, eventHash: v.eventHash, hashVersion: v.hashVersion ?? 1, at: v.createdAt }; }
}
