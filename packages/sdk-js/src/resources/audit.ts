// @krishalaya/sdk-js · audit resource (read-only audit trail, P1-12). A tenant auditor browses the
// append-only audit_log — filtered by action / entity / actor / time window, keyset-paginated. There is NO
// write method: the trail is immutable (written server-side by the platform inside business transactions).
// Every read is gated server-side by `audit.read` + the `audit_trail` flag, and RLS-isolated to the tenant.
//
// [PC-56 TENANT-9c] Every read is MASKED (PII paths printed `••••`, named in `maskedFields`) and itself RECORDED server-side
// (`audit_read_log`). `from` / `to` are CIVIL DAYS (`YYYY-MM-DD`) in the cooperative's own zone, both inclusive, ≤ 92 days.
// `reveal` is the one write here — a recorded reveal of one row on `member.pii.reveal` with a reason of ≥ 20 characters.
import { HttpClient } from '../http';
import { AuditEntry, AuditWindow, Page } from '../types';

export interface AuditQuery {
  action?: string; entityType?: string; entityId?: string; actorUserId?: string;
  /** First day, inclusive (`YYYY-MM-DD`, the cooperative's zone). */
  from?: string;
  /** Last day, inclusive. */
  to?: string; cursor?: string; limit?: number;
}

export class AuditResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse the audit trail (newest first). All filters optional. */
  async list(params: AuditQuery = {}, signal?: AbortSignal): Promise<Page<AuditEntry> & { window: AuditWindow | null }> {
    const r = await this.http.request<AuditEntry[]>('GET', 'audit/entries', {
      query: {
        action: params.action, entityType: params.entityType, entityId: params.entityId,
        actorUserId: params.actorUserId, from: params.from, to: params.to,
        cursor: params.cursor, limit: params.limit ?? 50,
      },
      signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, window: (r.meta?.window as AuditWindow | undefined) ?? null };
  }

  /** A single audit entry by id (bigint as string). */
  async get(id: string, signal?: AbortSignal, opts: { revealGrant?: string } = {}): Promise<AuditEntry> {
    return (await this.http.request<AuditEntry>('GET', `audit/entries/${encodeURIComponent(id)}`, { query: { revealGrant: opts.revealGrant }, signal })).data;
  }

  /** The RECORDED reveal of one entry's masked fields (`member.pii.reveal`, reason ≥ 20). Recorded before it is returned.
   *  `revealGrant` (the reveal's own read-log id) lets the SAME caller re-open the row unmasked with `get` for 15 minutes. */
  async reveal(id: string, reason: string): Promise<AuditEntry & { revealGrant: string; grantMinutes: number }> {
    return (await this.http.request<AuditEntry & { revealGrant: string; grantMinutes: number }>('POST', `audit/entries/${encodeURIComponent(id)}/reveal`, { body: { reason } })).data;
  }
}
