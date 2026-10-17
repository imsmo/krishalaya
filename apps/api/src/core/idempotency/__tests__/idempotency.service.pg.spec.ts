// apps/api/src/core/idempotency/__tests__/idempotency.service.pg.spec.ts · PC-56 HOTFIX-8 · B12 — `remember` honours `expires_at` (unit, a
// hand-built pool that plays the database's answers; the live proof is src/__tests__/store6-hotfix8-idempotency.integration.spec.ts).
//   • the claim is ONE statement that re-claims an EXPIRED row (`ON CONFLICT … DO UPDATE … WHERE idempotency_keys.expires_at < now()`);
//   • the prior read refuses an expired row (`expires_at >= now()`);
//   • fresh claim → fn runs once, the answer stored; a live stored row → replayed, fn never runs; a live in-flight row → 409;
//   • an expired row re-claimed → fn runs, `idempotency.reclaimed_expired` counted with the endpoint;
//   • a row that vanished between the claim and the read (expired, or freed by a failed run) → claimed again, once;
//   • fn throws → the claim released (DELETE … response_status IS NULL), the error rethrown;
//   • the scope: `<user>::<endpoint>::<key>` (another user's key is another row).
import { PgIdempotencyService, CLAIM_SQL, PRIOR_SQL } from '../idempotency.service.pg';
import { ConflictError } from '../../../shared/errors/app-error';
import type { PgPoolProvider } from '../../database/pg-pool.provider';
import type { Metrics } from '../../observability/metrics';

type Answer = { rowCount: number; rows: Array<Record<string, unknown>> };
function pool(answers: Answer[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const p = { query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return answers.shift() ?? { rowCount: 1, rows: [] }; }) };
  const pools = { writer: () => p } as unknown as PgPoolProvider;
  return { pools, calls };
}
function metrics() {
  const inc = jest.fn();
  return { m: { inc, observe: jest.fn() } as unknown as Metrics, inc };
}
const U = '0190a8b2-0000-7000-8000-000000000001';

describe('HOTFIX-8 · B12 · PgIdempotencyService.remember honours expires_at', () => {
  it('the claim re-claims an EXPIRED row in the same statement; the prior read refuses an expired row', () => {
    expect(CLAIM_SQL).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(CLAIM_SQL).toMatch(/WHERE idempotency_keys\.expires_at < now\(\)/);
    expect(CLAIM_SQL).toMatch(/response_status = NULL, response_body = NULL/);
    expect(CLAIM_SQL).toMatch(/expires_at = now\(\) \+ interval '24 hours'/);
    expect(CLAIM_SQL).not.toMatch(/DO NOTHING/);
    expect(PRIOR_SQL).toMatch(/expires_at >= now\(\)/);
  });

  it('a fresh claim → fn runs once, the answer stored under <user>::<endpoint>::<key>; no re-claim counted', async () => {
    const { pools, calls } = pool([{ rowCount: 1, rows: [{ key: 'k', reclaimed: false }] }, { rowCount: 1, rows: [] }]);
    const { m, inc } = metrics();
    const fn = jest.fn(async () => ({ id: 'first' }));
    await expect(new PgIdempotencyService(pools, m).remember('K1', U, 'identity.address.create', fn)).resolves.toEqual({ id: 'first' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls[0].params).toEqual([`${U}::identity.address.create::K1`, U, 'identity.address.create']);
    expect(calls[1].sql).toMatch(/UPDATE idempotency_keys SET response_status = 200/);
    expect(inc).not.toHaveBeenCalled();
  });

  it('a LIVE stored row → the stored body replayed, fn never runs', async () => {
    const { pools, calls } = pool([{ rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ response_status: 200, response_body: { id: 'first' } }] }]);
    const fn = jest.fn(async () => ({ id: 'second' }));
    await expect(new PgIdempotencyService(pools).remember('K1', U, 'e', fn)).resolves.toEqual({ id: 'first' });
    expect(fn).not.toHaveBeenCalled();
    expect(calls[1].sql).toBe(PRIOR_SQL);
  });

  it('a LIVE in-flight row → 409, fn never runs', async () => {
    const { pools } = pool([{ rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ response_status: null, response_body: null }] }]);
    const fn = jest.fn(async () => 1);
    await expect(new PgIdempotencyService(pools).remember('K1', U, 'e', fn)).rejects.toBeInstanceOf(ConflictError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('an EXPIRED row re-claimed → fn runs, the metric counted with the endpoint', async () => {
    const { pools } = pool([{ rowCount: 1, rows: [{ key: 'k', reclaimed: true }] }, { rowCount: 1, rows: [] }]);
    const { m, inc } = metrics();
    const fn = jest.fn(async () => ({ id: 'again' }));
    await expect(new PgIdempotencyService(pools, m).remember('K1', U, 'identity.address.create', fn)).resolves.toEqual({ id: 'again' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inc).toHaveBeenCalledWith('idempotency.reclaimed_expired', { endpoint: 'identity.address.create' });
  });

  it('a row that vanished between the claim and the read (expired / freed) → claimed again, once; fn runs once', async () => {
    const { pools, calls } = pool([{ rowCount: 0, rows: [] }, { rowCount: 0, rows: [] }, { rowCount: 1, rows: [{ key: 'k', reclaimed: true }] }, { rowCount: 1, rows: [] }]);
    const fn = jest.fn(async () => 'ok');
    await expect(new PgIdempotencyService(pools).remember('K1', U, 'e', fn)).resolves.toBe('ok');
    expect(calls.map((c) => (c.sql === CLAIM_SQL ? 'claim' : c.sql === PRIOR_SQL ? 'prior' : 'store'))).toEqual(['claim', 'prior', 'claim', 'store']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fn throws → the claim released and the error rethrown (a retry can act)', async () => {
    const { pools, calls } = pool([{ rowCount: 1, rows: [{ key: 'k', reclaimed: false }] }, { rowCount: 1, rows: [] }]);
    await expect(new PgIdempotencyService(pools).remember('K1', U, 'e', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls[1].sql).toMatch(/DELETE FROM idempotency_keys WHERE key = \$1 AND response_status IS NULL/);
  });

  it('a throwing metric never breaks the request; no metrics wired (the hand-built specs) still works', async () => {
    const { pools } = pool([{ rowCount: 1, rows: [{ key: 'k', reclaimed: true }] }, { rowCount: 1, rows: [] }]);
    const bad = { inc: () => { throw new Error('metric'); }, observe: () => undefined } as unknown as Metrics;
    await expect(new PgIdempotencyService(pools, bad).remember('K1', 'system', 'e', async () => 7)).resolves.toBe(7);
    const { pools: p2 } = pool([{ rowCount: 1, rows: [{ key: 'k', reclaimed: true }] }, { rowCount: 1, rows: [] }]);
    await expect(new PgIdempotencyService(p2).remember('K1', 'system', 'e', async () => 8)).resolves.toBe(8);
  });

  it("the scope: another user's same key is another row; a non-uuid caller stores user_id NULL", async () => {
    const a = pool([{ rowCount: 1, rows: [{ reclaimed: false }] }, { rowCount: 1, rows: [] }]);
    const b = pool([{ rowCount: 1, rows: [{ reclaimed: false }] }, { rowCount: 1, rows: [] }]);
    await new PgIdempotencyService(a.pools).remember('K1', U, 'e', async () => 1);
    await new PgIdempotencyService(b.pools).remember('K1', 'system', 'e', async () => 1);
    expect(a.calls[0].params[0]).not.toEqual(b.calls[0].params[0]);
    expect(b.calls[0].params).toEqual(['system::e::K1', null, 'e']);
  });
});
