// @krishalaya/sdk-js · partner realm resource (PC-55 A10). The typed client a BANK/NBFC/INSURER uses against
// `/v1/partner-api/*` — read-only, own-book-only, scoped by an API key.
//
// HOW THE CREDENTIAL IS SUPPLIED (and why the SDK still holds no secret): every call here is `anonymous: true`, so the
// SDK never attaches a user bearer token — a partner integration has no user session and no tenant. The API key
// travels in the `X-Partner-Key` header, which the HOST provides through `config.getHeaders`, exactly as the SDK's
// contract intends (the host owns secret storage: a vault, an env var, a KMS-decrypted value):
//
//   const kv = new KrishalayaClient({
//     baseUrl: 'https://api.krishalaya.com',
//     getHeaders: () => ({ 'X-Partner-Key': process.env.KRISHALAYA_PARTNER_KEY! }),
//   });
//   const page = await kv.partnerApi.loans({ status: 'overdue' });
//
// Money is always a bigint minor-unit STRING (Law 2) — never a number, so no integrator can lose paise to a float.
// Pagination is cursor-based: loop while `nextCursor` is non-null. There is no total count; an honest cursor beats an
// expensive lie about a book that is changing while you read it.
import { HttpClient } from '../http';

export interface PartnerPage<T> { rows: T[]; nextCursor: string | null; limit: number }

export interface PartnerIdentity {
  partnerId: string; keyId: string; scopes: string[]; rateLimitPerHour: number; capabilities: 'read-only';
}
export interface PartnerLoan {
  id: string; tenantId: string; borrowerUserId: string; principalMinor: string; interestAprBps: number;
  disbursedAt: string | null; maturityDate: string | null; status: string; outstandingMinor: string; nextDueDate: string | null;
}
export interface PartnerLoanRepayment {
  id: string; loanId: string; dueDate: string; amountDueMinor: string; amountPaidMinor: string;
  paidAt: string | null; channel: string | null;
}
export interface PartnerPolicy {
  id: string; tenantId: string; holderUserId: string; productId: string; policyNo: string | null;
  subjectType: string; subjectId: string | null; status: string; sumInsuredMinor: string; premiumMinor: string;
  validFrom: string; validUntil: string;
}

export class PartnerApiResource {
  constructor(private readonly http: HttpClient) {}

  private async page<T>(path: string, query: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<PartnerPage<T>> {
    const r = await this.http.request<T[]>('GET', path, { query, signal, anonymous: true });
    const meta = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number };
    return { rows: r.data, nextCursor: meta.nextCursor ?? null, limit: meta.limit ?? r.data.length };
  }

  /** Verify a key without reading a single farmer's record — the first call an integrator should make. */
  async me(signal?: AbortSignal): Promise<PartnerIdentity> {
    return (await this.http.request<PartnerIdentity>('GET', 'partner-api/me', { signal, anonymous: true })).data;
  }

  /** This partner's lending servicing book, across every tenant they lend into. */
  loans(q: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerPage<PartnerLoan>> {
    return this.page<PartnerLoan>('partner-api/lending/loans', { status: q.status, cursor: q.cursor, limit: q.limit }, signal);
  }

  /** One loan's schedule + collections. A loan outside this partner's book returns an EMPTY page (not a 404) — the
   *  realm deliberately refuses to confirm whether another partner's loan id exists. */
  repayments(loanId: string, q: { limit?: number } = {}, signal?: AbortSignal): Promise<PartnerPage<PartnerLoanRepayment>> {
    return this.page<PartnerLoanRepayment>(`partner-api/lending/loans/${encodeURIComponent(loanId)}/repayments`, { limit: q.limit }, signal);
  }

  /** This insurer's book: policies written on their products, across tenants. */
  policies(q: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerPage<PartnerPolicy>> {
    return this.page<PartnerPolicy>('partner-api/insurance/policies', { status: q.status, cursor: q.cursor, limit: q.limit }, signal);
  }
}
