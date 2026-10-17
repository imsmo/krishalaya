// @krishalaya/sdk-js · public farm-to-fork QR scan (GET /v1/traceability/scan/:qrToken). No auth — possession
// of the unguessable token is the capability; the API returns a curated, NON-PII provenance projection.
// PC-56 STORE-5b: + `verify` (W304 — the server's recompute of the hash chain, public) and `requestExport` (W3154 — SIGNED IN, keyed: queues
// the lot's record on the export plane for the caller; the job is then read with `exportsPlane.get(jobId)`).
import { HttpClient } from '../http';
import { TraceProvenance, TraceVerification } from '../types';

export class TraceabilityResource {
  constructor(private readonly http: HttpClient) {}
  async scan(qrToken: string, signal?: AbortSignal): Promise<TraceProvenance> {
    return (await this.http.request<TraceProvenance>('GET', `traceability/scan/${encodeURIComponent(qrToken)}`, { anonymous: true, signal })).data;
  }
  /** W304 — per event `recomputed: ok | mismatch | unverifiable_v1`, the chain, the seal's `matchesHead`. Same refusals as `scan`. */
  async verify(qrToken: string, signal?: AbortSignal): Promise<TraceVerification> {
    return (await this.http.request<TraceVerification>('GET', `traceability/scan/${encodeURIComponent(qrToken)}/verify`, { anonymous: true, signal })).data;
  }
  /** W3154 — "Download the record": signed in; the Idempotency-Key minted when the page rendered (a Retry re-sends it) → `{ jobId }`.
   *  Refusals by name: 401 (not signed in), TRACE_NOT_PUBLISHED / TRACE_NO_LONGER_PUBLISHED / TRACE_SCAN_NOT_FOUND (404),
   *  TRACE_EXPORT_UNAVAILABLE (503). The file is a CSV with the plane's receipt — not signed (the receipt's sha256 is the integrity). */
  async requestExport(qrToken: string, idempotencyKey: string): Promise<{ jobId: string }> {
    return (await this.http.request<{ jobId: string }>('POST', `traceability/scan/${encodeURIComponent(qrToken)}/export`, { idempotencyKey, body: {} })).data;
  }
}
