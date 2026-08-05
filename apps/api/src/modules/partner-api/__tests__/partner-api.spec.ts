// modules/partner-api/__tests__/partner-api.spec.ts · PC-55 A10.
// These specs are written to FAIL if the realm ever becomes more permissive than its documentation. Each block below
// pins one promise made in the module's README / the migration header, and several were mutation-tested (break the
// guard, prove the spec goes red, restore) before being committed.
import { createHash, randomBytes } from 'node:crypto';
import {
  PARTNER_SCOPES, clampLimit, formatKey, hasScope, hashSecret, isUsable, keyFromHeaders, parseKey,
  rateWindowKey, secretMatches, touchWindowKey, unknownScopes,
} from '../domain/partner-key.rules';
import { PARTNER_WEBHOOK_EVENT_TYPES, deliverable, isPartnerWebhookEvent, ownershipKindFor } from '../domain/partner-webhook.rules';
import { PartnerKeyGuard, PARTNER_SCOPE_KEY } from '../guards/partner-key.guard';
import { PartnerBookService } from '../services/partner-book.service';
import { PartnerWebhookFanoutHandler } from '../events/handlers/partner-webhook-fanout.handler';
import { PartnerKeyRejectedError, PartnerRateLimitError, PartnerScopeMissingError } from '../domain/partner-api.errors';
import { FintechEventType } from '../../fintech/domain/fintech.events';
import { InsuranceEventType, ClaimEventType } from '../../insurance/domain/insurance.events';

// ---------------------------------------------------------------- key material

describe('partner-key.rules · key material', () => {
  it('parses exactly the shape db/scripts/mint-partner-key.js produces (the contract between them)', () => {
    // Built the way the script builds one — 16 lower-hex handle chars, base64url 32-byte secret.
    const handle = randomBytes(8).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const key = formatKey('live', handle, secret);
    expect(key).toBe(`kv_pk_live_${handle}.${secret}`);
    expect(parseKey(key)).toEqual({ prefix: `kv_pk_live_${handle}`, secret });
  });

  it.each([
    ['empty', ''],
    ['no dot', 'kv_pk_live_abcdef0123456789'],
    ['no secret', 'kv_pk_live_abcdef0123456789.'],
    ['wrong label', 'kv_sk_live_abcdef0123456789.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['unknown env', 'kv_pk_prod_abcdef0123456789.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['short handle', 'kv_pk_live_abc.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['short secret', 'kv_pk_live_abcdef0123456789.tooshort'],
    ['sql-ish payload', "kv_pk_live_abcdef0123456789.' OR 1=1 --"],
  ])('rejects malformed input before any DB access: %s', (_label, raw) => {
    expect(parseKey(raw)).toBeNull();
  });

  it('reads the key from X-Partner-Key or an Authorization bearer, preferring the explicit header', () => {
    expect(keyFromHeaders(undefined, ' k1 ')).toBe('k1');
    expect(keyFromHeaders('Bearer k2')).toBe('k2');
    expect(keyFromHeaders('bearer k2')).toBe('k2');          // scheme is case-insensitive
    expect(keyFromHeaders('Basic k2')).toBeNull();           // wrong scheme is not a key
    expect(keyFromHeaders(undefined, undefined)).toBeNull();
  });

  it('stores only a SHA-256 hash and matches it constant-time; a near-miss secret never passes', () => {
    const secret = randomBytes(32).toString('base64url');
    const stored = createHash('sha256').update(secret, 'utf8').digest('hex');
    expect(hashSecret(secret)).toBe(stored);
    expect(secretMatches(secret, stored)).toBe(true);
    expect(secretMatches(`${secret}x`, stored)).toBe(false);
    expect(secretMatches(secret.slice(0, -1), stored)).toBe(false);
  });

  it('treats a junk/legacy/empty stored hash as a MISS, never a pass', () => {
    const secret = 'a'.repeat(40);
    expect(secretMatches(secret, null)).toBe(false);
    expect(secretMatches(secret, '')).toBe(false);
    expect(secretMatches(secret, 'not-a-hash')).toBe(false);
    expect(secretMatches(secret, hashSecret(secret).toUpperCase())).toBe(false); // strict lower-hex only
  });

  it('revocation is permanent — is_active alone cannot resurrect a revoked key', () => {
    expect(isUsable({ isActive: true, revokedAt: null })).toBe(true);
    expect(isUsable({ isActive: false, revokedAt: null })).toBe(false);
    expect(isUsable({ isActive: true, revokedAt: '2026-08-01T00:00:00.000Z' })).toBe(false);
  });

  it('has NO wildcard scope: a partner key can never become god-mode', () => {
    expect(hasScope(['lending:book:read'], 'lending:book:read')).toBe(true);
    expect(hasScope(['*'], 'lending:book:read')).toBe(false);
    expect(hasScope(['insurance:*'], 'insurance:book:read')).toBe(false);
    expect(hasScope(['lending:book'], 'lending:book:read')).toBe(false);   // no prefix matching either
    expect(hasScope([], 'lending:book:read')).toBe(false);
    expect(hasScope(null, 'lending:book:read')).toBe(false);
    expect(hasScope(['lending:book:read'], '')).toBe(false);
  });

  it('an insurer key has no lending reach and a lender key has no insurance reach', () => {
    expect(hasScope(['insurance:book:read'], 'lending:book:read')).toBe(false);
    expect(hasScope(['lending:book:read'], 'insurance:book:read')).toBe(false);
  });

  it('refuses to mint unknown scopes (typos become a rejection, not a silent no-capability key)', () => {
    expect(unknownScopes([...PARTNER_SCOPES])).toEqual([]);
    expect(unknownScopes(['lending:book:write'])).toEqual(['lending:book:write']);
    expect(unknownScopes(['*'])).toEqual(['*']);
  });

  it('clamps page size — the caller cannot ask for an unbounded cross-tenant scan', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit('0')).toBe(50);
    expect(clampLimit('-5')).toBe(50);
    expect(clampLimit('abc')).toBe(50);
    expect(clampLimit('10')).toBe(10);
    expect(clampLimit(10_000)).toBe(200);
    expect(clampLimit(10_000, 200, 500)).toBe(500);
  });

  it('quota windows are per KEY and per hour; the touch window is per minute', () => {
    const t0 = Date.parse('2026-08-06T10:00:00.000Z');
    expect(rateWindowKey('k1', t0)).toBe(rateWindowKey('k1', t0 + 59 * 60_000));      // same hour
    expect(rateWindowKey('k1', t0)).not.toBe(rateWindowKey('k1', t0 + 60 * 60_000));  // next hour
    expect(rateWindowKey('k1', t0)).not.toBe(rateWindowKey('k2', t0));                // never shared between keys
    expect(touchWindowKey('k1', t0)).not.toBe(touchWindowKey('k1', t0 + 60_000));
  });
});

// ---------------------------------------------------------------- the guard

const HASH = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const SECRET = 'z'.repeat(43);
const KEY = `kv_pk_test_abcdef0123456789.${SECRET}`;

function makeGuard(opts: {
  row?: Record<string, unknown> | null; scope?: string | undefined; count?: number; cacheThrows?: boolean;
} = {}) {
  const row = opts.row === undefined ? {
    id: 'key-1', partnerId: 'p-1', name: 'n', keyHash: HASH(SECRET),
    scopes: ['partner:identity:read', 'lending:book:read'], rateLimitPerHour: 100, isActive: true, revokedAt: null, lastUsedAt: null,
  } : opts.row;
  const repo = { findKeyByPrefix: jest.fn(async () => row), touchLastUsed: jest.fn(async () => undefined) };
  const cache = { incr: jest.fn(async () => { if (opts.cacheThrows) throw new Error('redis down'); return opts.count ?? 1; }) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn(() => ('scope' in opts ? opts.scope : 'lending:book:read')) };
  const guard = new PartnerKeyGuard(reflector as any, repo as any, cache as any, metrics as any);
  const req: any = { headers: {} };
  const ctx: any = {
    getType: () => 'http',
    getHandler: () => ({ name: 'loans' }),
    getClass: () => ({ name: 'PartnerApiController' }),
    switchToHttp: () => ({ getRequest: () => req }),
  };
  return { guard, ctx, req, repo, cache, metrics };
}

describe('PartnerKeyGuard', () => {
  it('authenticates a good key and attaches the partner to the request (never a fake tenant context)', async () => {
    const { guard, ctx, req } = makeGuard();
    req.headers['x-partner-key'] = KEY;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.partner).toEqual({ keyId: 'key-1', partnerId: 'p-1', scopes: ['partner:identity:read', 'lending:book:read'], rateLimitPerHour: 100 });
  });

  it('never queries the database for a malformed key', async () => {
    const { guard, ctx, req, repo } = makeGuard();
    req.headers.authorization = 'Bearer garbage';
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(PartnerKeyRejectedError);
    expect(repo.findKeyByPrefix).not.toHaveBeenCalled();
  });

  it('gives the SAME opaque 401 for unknown prefix, wrong secret, inactive and revoked — no existence oracle', async () => {
    const cases: Array<Record<string, unknown> | null> = [
      null,
      { id: 'k', partnerId: 'p', keyHash: HASH('another-secret'), scopes: ['lending:book:read'], rateLimitPerHour: 10, isActive: true, revokedAt: null },
      { id: 'k', partnerId: 'p', keyHash: HASH(SECRET), scopes: ['lending:book:read'], rateLimitPerHour: 10, isActive: false, revokedAt: null },
      { id: 'k', partnerId: 'p', keyHash: HASH(SECRET), scopes: ['lending:book:read'], rateLimitPerHour: 10, isActive: true, revokedAt: '2026-01-01T00:00:00Z' },
    ];
    for (const row of cases) {
      const { guard, ctx, req } = makeGuard({ row });
      req.headers['x-partner-key'] = KEY;
      const err = await guard.canActivate(ctx).catch((e) => e);
      expect(err).toBeInstanceOf(PartnerKeyRejectedError);
      expect(err.httpStatus).toBe(401);
      expect(err.message).toBe('Invalid partner API key');   // identical text in all four cases
      expect(err.details ?? {}).toEqual({});                 // and no leaked reason
    }
  });

  it('refuses a route that declares no @PartnerScope (a forgotten decorator must not mean "open")', async () => {
    const { guard, ctx, req } = makeGuard({ scope: undefined });
    req.headers['x-partner-key'] = KEY;
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(PartnerKeyRejectedError);
  });

  it('rejects a valid key that lacks the route scope — and says WHICH scope (the caller is authenticated)', async () => {
    const { guard, ctx, req } = makeGuard({
      row: { id: 'k', partnerId: 'p', keyHash: HASH(SECRET), scopes: ['insurance:book:read'], rateLimitPerHour: 10, isActive: true, revokedAt: null },
    });
    req.headers['x-partner-key'] = KEY;
    const err = await guard.canActivate(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(PartnerScopeMissingError);
    expect(err.httpStatus).toBe(403);
    expect(err.details).toEqual({ requiredScope: 'lending:book:read' });
  });

  it('enforces the per-key hourly quota: at the limit passes, one over is 429 with the limit disclosed', async () => {
    const ok = makeGuard({ count: 100 });
    ok.req.headers['x-partner-key'] = KEY;
    await expect(ok.guard.canActivate(ok.ctx)).resolves.toBe(true);

    const over = makeGuard({ count: 101 });
    over.req.headers['x-partner-key'] = KEY;
    const err = await over.guard.canActivate(over.ctx).catch((e) => e);
    expect(err).toBeInstanceOf(PartnerRateLimitError);
    expect(err.httpStatus).toBe(429);
    expect(err.details).toEqual({ limitPerHour: 100, windowSec: 3600 });
  });

  it('falls OPEN (documented) when the cache is down, and records that the call went unmetered', async () => {
    const { guard, ctx, req, metrics } = makeGuard({ cacheThrows: true });
    req.headers['x-partner-key'] = KEY;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(metrics.inc).toHaveBeenCalledWith('partner_api.quota_unmetered');
  });

  it('stamps last_used_at at most once per minute per key (a read API must not become a write API)', async () => {
    const first = makeGuard({ count: 1 });       // cache.incr → 1 ⇒ first call in this minute
    first.req.headers['x-partner-key'] = KEY;
    await first.guard.canActivate(first.ctx);
    await new Promise(setImmediate);             // the touch is fire-and-forget
    expect(first.repo.touchLastUsed).toHaveBeenCalledTimes(1);

    const again = makeGuard({ count: 2 });       // already stamped inside this window
    again.req.headers['x-partner-key'] = KEY;
    await again.guard.canActivate(again.ctx);
    await new Promise(setImmediate);
    expect(again.repo.touchLastUsed).not.toHaveBeenCalled();
  });

  it('is not authorised for non-HTTP contexts', async () => {
    const { guard, ctx } = makeGuard();
    await expect(guard.canActivate({ ...ctx, getType: () => 'ws' } as any)).resolves.toBe(false);
  });

  it('exports the metadata key the controller decorator writes', () => {
    expect(PARTNER_SCOPE_KEY).toBe('partner_scope');
  });
});

// ---------------------------------------------------------------- paging contract

describe('PartnerBookService · page contract', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

  it('clamps the limit, and returns a cursor only when the page was full', async () => {
    const repo = { loans: jest.fn(async (_p: string, q: any) => rows(q.limit)), policies: jest.fn(), loanRepayments: jest.fn() };
    const svc = new PartnerBookService(repo as any);
    const full = await svc.loans('p-1', { limit: '2' });
    expect(full.limit).toBe(2);
    expect(full.nextCursor).toBe('id-1');       // last row's uuid v7 id → the next page starts after it

    repo.loans = jest.fn(async (_p: string, _q: any) => rows(1));
    const partial = await svc.loans('p-1', { limit: '2' });
    expect(partial.nextCursor).toBeNull();      // short page ⇒ end of book, no cursor to chase
  });

  it('passes the partner id through and never accepts a tenant id from the caller', async () => {
    const repo = { policies: jest.fn(async () => []), loans: jest.fn(), loanRepayments: jest.fn() };
    const svc = new PartnerBookService(repo as any);
    await svc.policies('p-9', { status: 'active', cursor: 'c1', limit: 5 });
    expect(repo.policies).toHaveBeenCalledWith('p-9', { status: 'active', cursorId: 'c1', limit: 5 });
    const arg = (repo.policies as jest.Mock).mock.calls[0][1];
    expect(Object.keys(arg)).toEqual(['status', 'cursorId', 'limit']);   // no tenantId in the read contract at all
  });
});

// ---------------------------------------------------------------- webhook sharing

describe('partner-webhook.rules', () => {
  it('allow-lists only REAL event strings from the emitting modules (a rename fails here, not in production)', () => {
    for (const e of [FintechEventType.LoanDisbursed, FintechEventType.LoanRepaid, FintechEventType.LoanClosed]) {
      expect(isPartnerWebhookEvent(e)).toBe(true);
      expect(ownershipKindFor(e)).toBe('loan');
    }
    for (const e of [InsuranceEventType.PolicyActivated, InsuranceEventType.PolicyCancelled, InsuranceEventType.PolicyClaimed]) {
      expect(ownershipKindFor(e)).toBe('insurance_policy');
    }
    for (const e of [ClaimEventType.Filed, ClaimEventType.Surveyed, ClaimEventType.Decided, ClaimEventType.Settled, ClaimEventType.Closed]) {
      expect(ownershipKindFor(e)).toBe('insurance_claim');
    }
    expect(PARTNER_WEBHOOK_EVENT_TYPES).toHaveLength(11);
  });

  it('does not share tenant-commercial events with partners', () => {
    for (const e of ['order.created', 'payment.succeeded', 'payout.completed', 'offer.accepted', 'fintech.loan_application_approved']) {
      expect(isPartnerWebhookEvent(e)).toBe(false);
      expect(ownershipKindFor(e)).toBeNull();
    }
  });

  const endpoint = { id: 'e1', partnerId: 'p-1', eventTypes: [FintechEventType.LoanRepaid], isActive: true };

  it('delivers only when subscribed AND the DB-resolved owner is this partner', () => {
    expect(deliverable(endpoint, FintechEventType.LoanRepaid, 'p-1')).toBe(true);
    expect(deliverable(endpoint, FintechEventType.LoanRepaid, 'p-2')).toBe(false);  // another partner's loan
    expect(deliverable(endpoint, FintechEventType.LoanRepaid, null)).toBe(false);   // ownership unknown ⇒ silence
    expect(deliverable(endpoint, FintechEventType.LoanClosed, 'p-1')).toBe(false);  // not subscribed
    expect(deliverable(endpoint, 'order.created', 'p-1')).toBe(false);              // not allow-listed
    expect(deliverable({ ...endpoint, isActive: false }, FintechEventType.LoanRepaid, 'p-1')).toBe(false);
  });
});

describe('PartnerWebhookFanoutHandler', () => {
  const tx = {} as any;
  const event = (over: Record<string, unknown> = {}) => ({
    id: '1', tenantId: 't-1', aggregateType: 'loan', aggregateId: 'loan-1',
    eventType: FintechEventType.LoanRepaid, payload: { v: 1, amountMinor: '5000' }, ...over,
  } as any);

  function make(ownerPartnerId: string | null, endpoints: any[] = [{ id: 'e1', partnerId: 'p-1', eventTypes: [FintechEventType.LoanRepaid], isActive: true }]) {
    const partners = {
      resolveOwnerPartner: jest.fn(async () => ownerPartnerId),
      activeEndpointsForPartner: jest.fn(async () => endpoints),
    };
    const webhooks = { enqueue: jest.fn(async () => undefined) };
    return { handler: new PartnerWebhookFanoutHandler(FintechEventType.LoanRepaid, partners as any, webhooks as any), partners, webhooks };
  }

  it('resolves ownership from the aggregate row — NOT from the payload — before anything is enqueued', async () => {
    const { handler, partners, webhooks } = make('p-1');
    // A payload that LIES about the partner must not change the outcome.
    await handler.handle(event({ payload: { v: 1, partnerId: 'p-999' } }), tx);
    expect(partners.resolveOwnerPartner).toHaveBeenCalledWith(tx, 'loan', 'loan-1');
    expect(partners.activeEndpointsForPartner).toHaveBeenCalledWith(tx, 'p-1');
    expect(webhooks.enqueue).toHaveBeenCalledTimes(1);
    const [, tenantId, endpointId, eventType, body] = (webhooks.enqueue as jest.Mock).mock.calls[0];
    expect(tenantId).toBe('t-1');                    // originating tenant is preserved (transparency)
    expect(endpointId).toBe('e1');
    expect(eventType).toBe(FintechEventType.LoanRepaid);
    expect(body.partnerId).toBe('p-1');              // the RESOLVED owner, not the payload's claim
  });

  it('sends NOTHING when ownership cannot be resolved', async () => {
    const { handler, partners, webhooks } = make(null);
    await handler.handle(event(), tx);
    expect(partners.activeEndpointsForPartner).not.toHaveBeenCalled();
    expect(webhooks.enqueue).not.toHaveBeenCalled();
  });

  it('never queries endpoints of any partner other than the resolved owner', async () => {
    const { handler, partners, webhooks } = make('p-1', [{ id: 'e2', partnerId: 'p-2', eventTypes: [FintechEventType.LoanRepaid], isActive: true }]);
    await handler.handle(event(), tx);
    expect(partners.activeEndpointsForPartner).toHaveBeenCalledWith(tx, 'p-1');
    expect(webhooks.enqueue).not.toHaveBeenCalled();  // a mismatched row still cannot slip through deliverable()
  });

  it('drops events with no aggregate id and platform-global events with no tenant', async () => {
    const a = make('p-1'); await a.handler.handle(event({ aggregateId: '' }), tx);
    expect(a.webhooks.enqueue).not.toHaveBeenCalled();
    const b = make('p-1'); await b.handler.handle(event({ tenantId: null }), tx);
    expect(b.webhooks.enqueue).not.toHaveBeenCalled();
  });
});
