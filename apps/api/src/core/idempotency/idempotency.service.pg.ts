// core/idempotency/idempotency.service.pg.ts
// Concrete IdempotencyService (Law 3). Village 2G networks retry constantly; a
// retried mutation must return the ORIGINAL result, never act twice.
//   • first caller: claims the key (INSERT … ON CONFLICT …), runs fn,
//     stores the response, returns it.
//   • retry after success: returns the stored response (no side effects).
//   • retry while the first is still in flight: 409 (client retries shortly).
//   • if fn throws: the claim is released so a genuine retry can succeed.
// Records live in the global idempotency_keys table (shard 0), separate from the
// business tx, so the claim survives a business rollback.
//
// PC-56 HOTFIX-8 · B12 (survey STORE-6 C-7 / F-7): the key's memory is 24 h (`expires_at`, DB 0014:60) and `remember` now HONOURS it.
// Before this, `remember` never read `expires_at`: rows are only deleted by the hourly purge (at most 10,000 per run), so a replay between
// 24 h and the purge either replayed or acted again — non-deterministically. Now:
//   • the claim is ONE statement that treats an expired row as absent — `ON CONFLICT (key) DO UPDATE … WHERE idempotency_keys.expires_at
//     < now()` re-claims it (the stored response cleared, `created_at` / `expires_at` fresh); a LIVE row still conflicts (nothing updated,
//     nothing returned) and replays or 409s exactly as before;
//   • the prior-row read refuses an expired row too (a row that expires between the claim and the read is claimed again, once);
//   • a re-claim counts `idempotency.reclaimed_expired` { endpoint }.
// So a key past its memory acts ONCE more, deterministically, and from then on replays its new answer for another 24 h.
// A first run still IN FLIGHT past its expiry (the claim row with `response_status IS NULL` and `expires_at` past) is re-claimed too —
// two runs. A 24-hour in-flight request does not exist in practice (every request is timeout-bounded), and a failed run already frees its
// row (the DELETE below). The TTL stays 24 h — the column default and the re-claim's interval agree; if it ever becomes a setting it is a
// `setting_definitions` row (`idempotency.ttl_hours`) by migration (Law 6), not in this hotfix.
import { Inject, Injectable, Optional } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { PgPoolProvider } from '../database/pg-pool.provider';
import { ConflictError } from '../../shared/errors/app-error';
import { METRICS, Metrics } from '../observability/metrics';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HOTFIX-8 · B12: claim a key — a fresh row, OR an EXPIRED row re-claimed in the same statement. A live row → no row returned. */
export const CLAIM_SQL =
  `INSERT INTO idempotency_keys (key, user_id, endpoint)
   VALUES ($1, $2, $3)
   ON CONFLICT (key) DO UPDATE
     SET user_id = EXCLUDED.user_id, endpoint = EXCLUDED.endpoint, response_status = NULL, response_body = NULL,
         created_at = now(), expires_at = now() + interval '24 hours'
     WHERE idempotency_keys.expires_at < now()
   RETURNING key, (xmax::text <> '0') AS reclaimed`;
/** HOTFIX-8 · B12: the stored answer of a LIVE row only — an expired row is absent. */
export const PRIOR_SQL = `SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND expires_at >= now()`;

@Injectable()
export class PgIdempotencyService extends IdempotencyService {
  constructor(private readonly pools: PgPoolProvider, @Optional() @Inject(METRICS) private readonly metrics?: Metrics) { super(); }

  async remember<T>(key: string, userId: string | undefined, endpoint: string, fn: () => Promise<T>): Promise<T> {
    const pool = this.pools.writer(0);
    // SECURITY: scope the dedup key by caller + endpoint so one user can NEVER replay
    // another user's idempotency key (which would otherwise return their cached response).
    const scoped = `${userId ?? 'anon'}::${endpoint}::${key}`;
    // The user_id COLUMN is uuid; unauthenticated system callers (payment/payout
    // webhooks) pass the sentinel 'system', which is not a uuid. The dedup key above
    // already carries caller identity for scoping, so the column is informational —
    // store a real uuid or NULL, never a non-uuid string (else Postgres 22P02).
    const userIdCol = userId && UUID_RE.test(userId) ? userId : null;

    let claimed = false;
    for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
      const claim = await pool.query(CLAIM_SQL, [scoped, userIdCol, endpoint]);
      if (claim.rowCount && claim.rowCount > 0) {
        claimed = true;
        if (claim.rows[0]?.reclaimed === true) {
          try { this.metrics?.inc('idempotency.reclaimed_expired', { endpoint }); } catch { /* a metric never breaks a request */ }
        }
        break;
      }
      const prior = await pool.query(PRIOR_SQL, [scoped]);
      if (prior.rowCount && prior.rows[0].response_status != null) {
        return prior.rows[0].response_body as T;            // replay the stored result (a live row only)
      }
      // a live row still in flight → 409; a row that expired (or was freed by a failed run) between the claim and the read → claim again
      if (prior.rowCount) break;
    }
    if (!claimed) {
      throw new ConflictError('Duplicate request still in progress; retry shortly',
        { idempotencyKey: key });
    }

    try {
      const result = await fn();
      await pool.query(
        `UPDATE idempotency_keys SET response_status = 200, response_body = $2::jsonb WHERE key = $1`,
        [scoped, JSON.stringify(result ?? null)],
      );
      return result;
    } catch (err) {
      // release the claim so a real retry can proceed (do not cache failures)
      await pool.query(`DELETE FROM idempotency_keys WHERE key = $1 AND response_status IS NULL`, [scoped])
        .catch(() => undefined);
      throw err;
    }
  }
}
