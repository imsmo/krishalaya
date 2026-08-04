// @krishalaya/sdk-js · audit resource (read-only audit trail, P1-12). A tenant auditor browses the
// append-only audit_log — filtered by action / entity / actor / time window, keyset-paginated. There is NO
// write method: the trail is immutable (written server-side by the platform inside business transactions).
// Every read is gated server-side by `audit.read` + the `audit_trail` flag, and RLS-isolated to the tenant.
import { HttpClient } from '../http';
import { AuditEntry, Page } from '../types';

export interface AuditQuery {
  action?: string; entityType?: string; entityId?: string; actorUserId?: string;
  from?: string; to?: string; cursor?: string; limit?: number;
}

export class AuditResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse the audit trail (newest first). All filters optional. */
  async list(params: AuditQuery = {}, signal?: AbortSignal): Promise<Page<AuditEntry>> {
    const r = await this.http.request<AuditEntry[]>('GET', 'audit/entries', {
      query: {
        action: params.action, entityType: params.entityType, entityId: params.entityId,
        actorUserId: params.actorUserId, from: params.from, to: params.to,
        cursor: params.cursor, limit: params.limit ?? 50,
      },
      signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  /** A single audit entry by id (bigint as string). */
  async get(id: string, signal?: AbortSignal): Promise<AuditEntry> {
    return (await this.http.request<AuditEntry>('GET', `audit/entries/${encodeURIComponent(id)}`, { signal })).data;
  }
}
