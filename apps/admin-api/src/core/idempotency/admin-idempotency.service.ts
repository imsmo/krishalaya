// apps/admin-api/src/core/idempotency/admin-idempotency.service.ts · PC-56 LEGAL-1 — the admin realm's Idempotency-Key (Law 3).
//
// Until this wave admin-api had NO header-level idempotency: web-admin's actions say so in their headers ("admin-api exposes no
// Idempotency-Key here, so none is passed; mutations never auto-retry") and money planes keyed their own rows. The platform policy pages are
// the first admin plane that REQUIRES the header, so the mechanism lives here, in core, for the next plane to reuse.
//
// Same contract as apps/api's PgIdempotencyService (core/idempotency/idempotency.service.pg.ts), over the SAME global `idempotency_keys`
// table (0014; kv_admin holds ALL on it since 0014's blanket grant):
//   • first caller claims the key (INSERT … ON CONFLICT — an expired row is re-claimed), runs fn, stores the response, returns it;
//   • a retry after success returns the stored response (no second act, no second audit row);
//   • a retry while the first is in flight → 409 IDEMPOTENCY_IN_FLIGHT (the client retries shortly);
//   • if fn throws, the claim is released so a genuine retry can succeed.
// The claim is OUTSIDE the business transaction so it survives a business rollback.
//
// THE KEY IS SCOPED by operator + endpoint, then hashed: `admin:<sha256(adminId::endpoint::key)>`. Scoping stops one operator replaying
// another's key (and reading their cached answer); hashing keeps it inside the column's varchar(120) and the `admin:` prefix keeps it out of
// the tenant realm's key space (which stores `<userId>::<endpoint>::<key>` in clear).
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AdminPool } from '../database/admin-pool';

/** What a client may send: 8–120 characters of a conservative alphabet (a uuid is the norm). */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,120}$/;

export class IdempotencyKeyRequiredError extends HttpException {
  constructor() {
    super({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'this write needs an Idempotency-Key header (8–120 characters: letters, digits, _ . : -) — a retried request must never act twice',
    }, HttpStatus.BAD_REQUEST);
  }
}
export class IdempotencyInFlightError extends HttpException {
  constructor() {
    super({ code: 'IDEMPOTENCY_IN_FLIGHT', message: 'the same request is still being processed; retry shortly' }, HttpStatus.CONFLICT);
  }
}

export function scopedIdempotencyKey(adminId: string, endpoint: string, key: string): string {
  return `admin:${createHash('sha256').update(`${adminId}::${endpoint}::${key}`).digest('hex')}`;
}

/** Read the header value (Express lower-cases header names); an array or a malformed value is refused. */
export function idempotencyKeyOf(raw: unknown): string {
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_RE.test(raw.trim())) throw new IdempotencyKeyRequiredError();
  return raw.trim();
}

const CLAIM_SQL =
  `INSERT INTO idempotency_keys (key, user_id, endpoint)
   VALUES ($1, NULL, $2)
   ON CONFLICT (key) DO UPDATE
     SET endpoint = EXCLUDED.endpoint, response_status = NULL, response_body = NULL,
         created_at = now(), expires_at = now() + interval '24 hours'
     WHERE idempotency_keys.expires_at < now()
   RETURNING key`;
const PRIOR_SQL = `SELECT response_status, response_body FROM idempotency_keys WHERE key = $1 AND expires_at >= now()`;

@Injectable()
export class AdminIdempotency {
  constructor(private readonly pool: AdminPool) {}

  /** Run `fn` at most once per (operator, endpoint, key) within 24 h. `user_id` stays NULL: the column is the tenant realm's users FK
   *  space by convention, and an admin identity is not a users row (0118). The operator is in the hashed key. */
  async run<T>(adminId: string, endpoint: string, rawKey: unknown, fn: () => Promise<T>): Promise<T> {
    const key = scopedIdempotencyKey(adminId, endpoint, idempotencyKeyOf(rawKey));
    let claimed = false;
    for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
      const claim = await this.pool.query(CLAIM_SQL, [key, endpoint.slice(0, 200)]);
      if (claim.rowCount && claim.rowCount > 0) { claimed = true; break; }
      const prior = await this.pool.query(PRIOR_SQL, [key]);
      if (prior.rowCount && prior.rows[0].response_status != null) return prior.rows[0].response_body as T;
      if (prior.rowCount) break;   // live and in flight
    }
    if (!claimed) throw new IdempotencyInFlightError();
    let out: T;
    try {
      out = await fn();
    } catch (e) {
      await this.pool.query(`DELETE FROM idempotency_keys WHERE key = $1 AND response_status IS NULL`, [key]).catch(() => undefined);
      throw e;
    }
    await this.pool.query(`UPDATE idempotency_keys SET response_status = 200, response_body = $2::jsonb WHERE key = $1`,
      [key, JSON.stringify(out ?? null)]);
    return out;
  }
}
