// @krishalaya/sdk-js · PC-56 STORE-5b · D1 — the PUBLIC certificate (W305). No auth.
//   • `public(id)`        — GET /v1/certificates/public/:id (the trace page links here; the id is the capability)
//   • `publicByNo({no})`  — GET /v1/certificates/public?no= — within the CLIENT's organisation (its tenant slug / host); no organisation →
//                            400 TENANT_REQUIRED
// Refusals by name: CERTIFICATE_NOT_PUBLISHED (the organisation's `certificates_public` is OFF) ≠ CERTIFICATE_NOT_FOUND (unknown, removed, or
// the organisation is not live). "checked by <organisation> (<role>)" — never "platform-verified".
import { HttpClient } from '../http';
import { PublicCertificate } from '../types';

export class CertificatesResource {
  constructor(private readonly http: HttpClient) {}
  async public(id: string, signal?: AbortSignal): Promise<PublicCertificate> {
    return (await this.http.request<PublicCertificate>('GET', `certificates/public/${encodeURIComponent(id)}`, { anonymous: true, signal })).data;
  }
  async publicByNo(q: { no: string }, signal?: AbortSignal): Promise<PublicCertificate> {
    return (await this.http.request<PublicCertificate>('GET', 'certificates/public', { anonymous: true, query: { no: q.no }, signal })).data;
  }
}
