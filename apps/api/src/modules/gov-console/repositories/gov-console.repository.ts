// modules/gov-console/repositories/gov-console.repository.ts · PC-56 GOV-0 — all SQL of the government console realm.
//
// TWO CONNECTION POSTURES (the partner-console shape):
//
//  1. THE AXIS READS (applications to the authority's schemes) run inside `withAxis()`: a transaction that wears the least-privilege role
//     `kv_gov` (SET LOCAL ROLE — gone at COMMIT/ROLLBACK) with `app.authority_id` from the VERIFIED TOKEN and `app.tenant_id` empty. 0239's
//     policy then admits only applications to schemes this authority runs (`gov_runs_scheme`), its column grant never exposes the
//     applicant, the form or the free-text reason, and the form is read only through `gov_application_form()` — masked, location dropped.
//     An OPENING writes its recorded-read row (`audit_read_log`, purpose `gov_application_open`) in the SAME transaction after `RESET ROLE`,
//     as a TENANT row of the application's organisation: the read and its record commit together or not at all.
//  2. THE CONTROL PLANE (memberships, the session check, a gov-realm audit row) runs in the caller's GovRealmUnitOfWork transaction (kv_app,
//     shard 0, app.authority_id from the token): the `*Tx` methods — every one of them a 0239 DEFINER function; kv_app holds NOTHING on
//     `authority_memberships` itself.
//
// CROSS-SHARD (Rule Zero): applications live on their TENANT's shard — the list scatters over every shard and merges on (created_at, id).
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { AppConfig } from '../../../core/config/app-config';
import { TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';

export interface GovApplicationRow {
  id: string; organisationId: string;
  scheme: { id: string; code: string; name: string }; schemeVersion: number; status: string;
  submittedAt: string | null; decidedAt: string | null; createdAt: string;
  /** µs instant of created_at (the keyset), not part of the read model. */
  cursorTs: string;
}
export interface GovApplicationDetail extends GovApplicationRow {
  /** The stored form, masked by 0239 (phone/Aadhaar/bank/account/IFSC/UPI/PAN → ••••••xyz; location keys dropped). */
  form: Record<string, unknown> | null;
}
export interface MembershipFactsRow { id: string; userId: string; roleCode: string; status: 'requested' | 'active' | 'removed'; requestedBy: string | null; expiresAt: string | null }
export interface RecordedRead { actorUserId: string; actorRole: string; authorityId: string; requestId: string | null }

const APP_SELECT = `
  SELECT a.id, a.tenant_id, a.scheme_id, s.code AS scheme_code, s.name AS scheme_name, a.scheme_version, a.status::text AS status,
         a.submitted_at, a.decided_at, ${US_SQL('a.created_at')} AS created_us
    FROM scheme_applications a JOIN gov_authority_schemes() s ON s.id = a.scheme_id`;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const toApp = (x: any): GovApplicationRow => ({
  id: x.id, organisationId: x.tenant_id, scheme: { id: x.scheme_id, code: x.scheme_code, name: x.scheme_name }, schemeVersion: Number(x.scheme_version),
  status: x.status, submittedAt: iso(x.submitted_at), decidedAt: iso(x.decided_at), createdAt: x.created_us, cursorTs: x.created_us,
});

@Injectable()
export class GovConsoleRepository {
  constructor(private readonly pools: PgPoolProvider, private readonly config: AppConfig) {}

  private get shardCount(): number { return Math.max(1, this.config.shardCount); }

  // ═════════════════════════════════════ the kv_gov axis
  private async withAxis<T>(shardId: number, authorityId: string, fn: (c: PoolClient) => Promise<T>, then?: (c: PoolClient, out: T) => Promise<void>): Promise<T> {
    const client = await this.pools.writer(shardId).connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', '', true), set_config('app.partner_id', '', true)`);
      await client.query('SET LOCAL ROLE kv_gov');
      await client.query(`SELECT set_config('app.authority_id', $1, true)`, [authorityId]);
      const out = await fn(client);
      await client.query('RESET ROLE');
      if (then) await then(client, out);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      await client.query('RESET ROLE').catch(() => undefined);   // belt-and-braces before the pool reuses it
      client.release();
    }
  }

  /** One recorded read: a TENANT row of the application's organisation in `audit_read_log` (0181), written as kv_app on that shard. */
  private async recordRead(c: PoolClient, tenantId: string, who: RecordedRead, purpose: 'gov_application_open' | 'gov_application_list', ids: string[]): Promise<void> {
    await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(
      `INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, filter, row_count, span_first, span_last, request_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [tenantId, who.actorUserId, who.actorRole.slice(0, 200), purpose, purpose === 'gov_application_open' ? 'gov.application' : 'gov.applications',
        JSON.stringify({ authorityId: who.authorityId, ...(purpose === 'gov_application_open' ? { applicationId: ids[0] } : {}) }),
        ids.length, ids[0] ?? null, ids[ids.length - 1] ?? null, who.requestId ? who.requestId.slice(0, 60) : null]);
  }

  /** Applications to this authority's schemes, newest first, µs keyset; scattered over the shards, merged, cut to `limit`. Then ONE recorded
   *  row per organisation on the page (on that organisation's shard), written BEFORE the page is returned: if a record cannot be written,
   *  the caller gets the error and no page. */
  async listApplications(authorityId: string, q: { status?: string; cursor?: KeysetCursor; limit: number }, who: RecordedRead): Promise<GovApplicationRow[]> {
    const shards = Array.from({ length: this.shardCount }, (_, i) => i);
    const perShard = await Promise.all(shards.map((s) => this.withAxis(s, authorityId, async (c) => {
      const r = await c.query(`${APP_SELECT}
         WHERE a.deleted_at IS NULL
           AND ($1::text IS NULL OR a.status::text = $1::text)
           AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $3::uuid))
         ORDER BY a.created_at DESC, a.id DESC LIMIT $4`,
        [q.status ?? null, q.cursor?.ts ?? null, q.cursor?.id ?? null, q.limit]);
      return r.rows.map(toApp);
    })));
    const page = perShard.flat()
      .sort((a, b) => (a.cursorTs < b.cursorTs ? 1 : a.cursorTs > b.cursorTs ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, q.limit);
    // the records: one per organisation on the page, written on the shard each organisation's rows came from
    const onPage = new Set(page.map((r) => r.id));
    await Promise.all(shards.map(async (s, i) => {
      const mine = perShard[i].filter((r) => onPage.has(r.id));
      if (mine.length === 0) return;
      const byTenant = new Map<string, string[]>();
      for (const r of mine) byTenant.set(r.organisationId, [...(byTenant.get(r.organisationId) ?? []), r.id]);
      const client = await this.pools.writer(s).connect();
      try {
        await client.query('BEGIN');
        for (const [tenantId, ids] of byTenant) await this.recordRead(client, tenantId, who, 'gov_application_list', ids);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
    }));
    return page;
  }

  /** ONE application, if the oracle admits it, with its masked form — and its recorded-read row in the same transaction. Not admitted → null. */
  async openApplication(authorityId: string, id: string, who: RecordedRead): Promise<GovApplicationDetail | null> {
    for (let s = 0; s < this.shardCount; s++) {
      const row = await this.withAxis<GovApplicationDetail | null>(s, authorityId, async (c) => {
        const r = await c.query(`${APP_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
        if (!r.rows[0]) return null;
        const f = await c.query<{ f: Record<string, unknown> | null }>(`SELECT gov_application_form($1) AS f`, [id]);
        return { ...toApp(r.rows[0]), form: f.rows[0]?.f ?? null };
      }, async (c, out) => {
        if (!out) return;
        await this.recordRead(c, out.organisationId, who, 'gov_application_open', [out.id]);
      });
      if (row) return row;
    }
    return null;
  }

  // ═════════════════════════════════════ the control plane (GovRealmUnitOfWork, kv_app, 0239's DEFINER functions)
  async setSessionUserTx(tx: TxContext, userId: string): Promise<void> {
    await tx.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
  }
  /** The session person's live authorities (app.user_id). */
  async myAuthoritiesTx(tx: TxContext): Promise<Array<{ authorityId: string; name: string }>> {
    const r = await tx.query<{ authority_id: string; name: string }>(`SELECT authority_id, name FROM gov_my_authorities()`);
    return r.rows.map((x) => ({ authorityId: x.authority_id, name: x.name }));
  }
  /** Roles + permissions of a LIVE membership — through 0239's one resolver (an expired row resolves nothing). */
  async accessTx(tx: TxContext, userId: string, authorityId: string): Promise<{ roles: string[]; permissions: string[]; expiresAt: string | null }> {
    const r = await tx.query<{ role_code: string; permission_code: string | null; expires_at: string }>(`SELECT role_code, permission_code, expires_at FROM gov_access($1, $2)`, [userId, authorityId]);
    const ends = r.rows.map((x) => new Date(x.expires_at).getTime()).filter((n) => Number.isFinite(n));
    return {
      roles: [...new Set(r.rows.map((x) => x.role_code))].sort(),
      permissions: [...new Set(r.rows.map((x) => x.permission_code).filter((p): p is string => !!p))].sort(),
      expiresAt: ends.length ? new Date(Math.min(...ends)).toISOString() : null,
    };
  }
  /** Is this access token's session still a live GOV session of this person for this authority (not revoked, not pending, not expired)? */
  async sessionLiveTx(tx: TxContext, sessionId: string, userId: string, authorityId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 AND realm = 'gov' AND authority_id = $3
        AND revoked_at IS NULL AND NOT two_factor_pending AND expires_at > now()`, [sessionId, userId, authorityId]);
    return r.rowCount > 0;
  }
  async authorityTx(tx: TxContext, authorityId: string): Promise<{ id: string; name: string; level: string } | null> {
    const r = await tx.query<{ id: string; default_name: string; level: string }>(`SELECT id, default_name, level FROM scheme_authorities WHERE id = $1 AND deleted_at IS NULL`, [authorityId]);
    const x = r.rows[0];
    return x ? { id: x.id, name: x.default_name, level: x.level } : null;
  }
  async userPhoneTx(tx: TxContext, userId: string): Promise<string | null> {
    return (await tx.query<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [userId])).rows[0]?.phone ?? null;
  }
  /** A loginable platform account by phone (the request names its grantee by phone) — its id only. */
  async userIdByPhoneTx(tx: TxContext, phone: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`, [phone]);
    return r.rows[0]?.id ?? null;
  }
  async membershipsTx(tx: TxContext): Promise<any[]> {
    const r = await tx.query<any>(`SELECT * FROM gov_authority_memberships()`);
    return r.rows.map((x) => ({
      membershipId: x.membership_id, userId: x.user_id, name: x.full_name ?? null, phoneMasked: x.phone_masked, roleCode: x.role_code,
      status: x.status, live: x.live === true, termMonths: Number(x.term_months),
      requestedBy: x.requested_by ?? null, requestedByPlatform: x.requested_by_platform === true, requestReason: x.request_reason,
      requestedAt: iso(x.requested_at), approvedBy: x.approved_by ?? null, approvedAt: iso(x.approved_at), expiresAt: iso(x.expires_at),
      removedBy: x.removed_by ?? null, removedAt: iso(x.removed_at), removedReason: x.removed_reason ?? null,
    }));
  }
  async membershipTx(tx: TxContext, id: string): Promise<MembershipFactsRow | null> {
    const r = await tx.query<any>(`SELECT * FROM gov_membership_get($1)`, [id]);
    const x = r.rows[0];
    return x ? { id: x.membership_id, userId: x.user_id, roleCode: x.role_code, status: x.status, requestedBy: x.requested_by ?? null, expiresAt: iso(x.expires_at) } : null;
  }
  async requestTx(tx: TxContext, userId: string, roleCode: string, termMonths: number, reason: string): Promise<string> {
    const r = await tx.query<{ id: string }>(`SELECT gov_membership_request($1, $2, $3::smallint, $4) AS id`, [userId, roleCode, termMonths, reason]);
    return r.rows[0].id;
  }
  async approveTx(tx: TxContext, id: string): Promise<boolean> {
    return (await tx.query<{ ok: boolean }>(`SELECT gov_membership_approve($1) AS ok`, [id])).rows[0]?.ok === true;
  }
  async removeTx(tx: TxContext, id: string, reason: string): Promise<boolean> {
    return (await tx.query<{ ok: boolean }>(`SELECT gov_membership_remove($1, $2) AS ok`, [id, reason])).rows[0]?.ok === true;
  }
  async isLiveMemberTx(tx: TxContext, authorityId: string, userId: string): Promise<boolean> {
    return (await tx.query<{ ok: boolean }>(`SELECT kv_is_authority_member($1, $2) AS ok`, [authorityId, userId])).rows[0]?.ok === true;
  }
  /** The approved row's end, as the database wrote it (the guard sets it — the caller never does). */
  async expiresAtTx(tx: TxContext, id: string): Promise<string | null> {
    return (await this.membershipTx(tx, id))?.expiresAt ?? null;
  }
}
