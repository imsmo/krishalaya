// core/database/gov-realm-uow.ts · PC-56 GOV-0 — THE GOVERNMENT REALM'S UNIT OF WORK (the PartnerRealmUnitOfWork shape, 0225 → 0239).
//
// A government authority is not a tenant: it reads applications to its schemes ACROSS organisations, so a government act has NO tenant to
// route by. Its control-plane rows (authority_memberships, the gov session, a gov-realm audit row) live on shard 0. This runner opens ONE
// transaction there as the ordinary app role (kv_app) with:
//   • app.tenant_id    = ''              — no tenant: every tenant table stays invisible, nothing is written to a tenant;
//   • app.user_id      = the person      — 0239's functions act as THIS person (the request, the approval, the removal);
//   • app.authority_id = the authority   — from the VERIFIED TOKEN (or the person's own membership at sign-in), never from a header.
// It never assumes `kv_gov`: the application reads run in their own `SET LOCAL ROLE kv_gov` transactions in the gov-console repository.
// Retries on 40001 / 40P01 like PgUnitOfWork.
import { Injectable, Logger } from '@nestjs/common';
import { PoolClient } from 'pg';
import { PgPoolProvider } from './pg-pool.provider';
import { TxContext } from './unit-of-work';

const RETRYABLE = new Set(['40001', '40P01']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class GovRealmUnitOfWork {
  private readonly log = new Logger(GovRealmUnitOfWork.name);
  constructor(private readonly pools: PgPoolProvider) {}

  /** `authorityId` null = no authority in scope yet (the sign-in, before the person's authority is known). */
  async run<T>(authorityId: string | null, fn: (tx: TxContext) => Promise<T>, opts?: { userId?: string; retries?: number }): Promise<T> {
    if (authorityId !== null && !UUID.test(authorityId)) throw new Error('GovRealmUnitOfWork: authorityId must be a uuid');
    const maxRetries = opts?.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const client: PoolClient = await this.pools.writer(0).connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `SELECT set_config('app.tenant_id', '', true), set_config('app.user_id', $1, true), set_config('app.authority_id', $2, true), set_config('app.partner_id', '', true)`,
          [opts?.userId ?? '', authorityId ?? '']);
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
          this.log.warn(`gov tx retry ${attempt + 1}/${maxRetries} (pg ${err.code}) after ${backoff}ms`);
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
