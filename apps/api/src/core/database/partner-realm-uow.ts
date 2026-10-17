// core/database/partner-realm-uow.ts · PC-56 PARTNER-0 — THE PARTNER REALM'S UNIT OF WORK.
//
// A partner organisation is not a tenant: it spans the tenants it lends into, so a partner act has NO tenant to route by. Its control-plane
// rows (partner_memberships, partner_invites, the partner session, a partner-realm audit row) live on shard 0 — the posture 0090 gave
// `partner_api_keys` and FlagsService gives `feature_flags`. This runner opens ONE transaction there as the ordinary app role (kv_app) with:
//   • app.tenant_id = ''         — no tenant: every tenant table stays invisible (tenant RLS is false), nothing is written to a tenant;
//   • app.user_id   = the person — the 0225 policies let a person read their OWN memberships; the invite trigger checks "in their own session";
//   • app.partner_id = the partner from the VERIFIED TOKEN (or the invite row / the oracle) — never from a request header. It is what the 0225
//     kv_app policies on the two partner tables, and the partner-realm audit policy, key on.
// It never assumes the `kv_partner` role: the axis READS (applications, the team) run in their own `SET LOCAL ROLE kv_partner` transactions
// in the partner-console repository, exactly like 0090's book reads. Retries on 40001 / 40P01 like PgUnitOfWork.
import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PgPoolProvider } from './pg-pool.provider';
import { TxContext } from './unit-of-work';

const RETRYABLE = new Set(['40001', '40P01']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PartnerRealmUnitOfWork {
  private readonly log = new Logger(PartnerRealmUnitOfWork.name);
  constructor(private readonly pools: PgPoolProvider) {}

  /** `partnerId` null = no partner in scope yet (the sign-in, before the person's partner is known). */
  async run<T>(partnerId: string | null, fn: (tx: TxContext) => Promise<T>, opts?: { userId?: string; retries?: number }): Promise<T> {
    if (partnerId !== null && !UUID.test(partnerId)) throw new Error('PartnerRealmUnitOfWork: partnerId must be a uuid');
    const maxRetries = opts?.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const client: PoolClient = await this.pools.writer(0).connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', $1, true), set_config('app.partner_id', $2, true)`,
          [opts?.userId ?? '', partnerId ?? '']);
        const tx: TxContext = {
          tenantId: '', userId: opts?.userId,
          query: async <R = any>(sql: string, params?: readonly unknown[]) => {
            const r = await client.query(sql, params as unknown[]);
            return { rows: r.rows as R[], rowCount: r.rowCount ?? 0 };
          },
        };
        const out = await fn(tx);
        await client.query('COMMIT');
        return out;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (RETRYABLE.has(err?.code) && attempt < maxRetries) {
          const backoff = Math.min(50 * 2 ** attempt, 500) + Math.floor(Math.random() * 25);
          this.log.warn(`partner tx retry ${attempt + 1}/${maxRetries} (pg ${err.code}) after ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }
  }
}
