// @krishalaya/sdk-js · public farm-to-fork QR scan (GET /v1/traceability/scan/:qrToken). No auth — possession
// of the unguessable token is the capability; the API returns a curated, NON-PII provenance projection.
import { HttpClient } from '../http';
import { TraceProvenance } from '../types';

export class TraceabilityResource {
  constructor(private readonly http: HttpClient) {}
  async scan(qrToken: string, signal?: AbortSignal): Promise<TraceProvenance> {
    return (await this.http.request<TraceProvenance>('GET', `traceability/scan/${encodeURIComponent(qrToken)}`, { anonymous: true, signal })).data;
  }
}
