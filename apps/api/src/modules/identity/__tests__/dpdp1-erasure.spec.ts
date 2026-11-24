// PC-56 DPDP-1 · the erasure rules (pure) and the relay handler's decision path (fake transaction). The database half — the matrix
// actually executed, the coverage gate, blockers, idempotence — is `dpdp1-erasure.integration.spec.ts`.
import {
  ERASURE_BLOCKERS, ERASURE_MATRIX, ERASURE_REFERENCE_ONLY, ERASED_TOMBSTONE, decideErasure, erasedPhoneOf, erasureBlockers, parseErasureSummary,
} from '../domain/erasure.rules';
import { ErasureReadyHandler, ERASURE_READY } from '../events/handlers/erasure-ready.handler';
import { DataSubjectRequest } from '../domain/data-subject-request.entity';
import type { OutboxEvent } from '../../../core/outbox/event-envelope';

const clear = Object.fromEntries(ERASURE_BLOCKERS.map((k) => [k, 0]));
const DSR = '0192f0aa-0000-7000-8000-000000000001';
const USER = '0192f0aa-0000-7000-8000-0000000000aa';
const T = '0192f0aa-0000-7000-8000-0000000000ff';

describe('erasureBlockers — every figure is a blocker when non-zero; unknowns fail closed', () => {
  it('all zero → no reason (clear to erase)', () => expect(erasureBlockers(clear)).toEqual([]));
  it('each known figure maps to its own reason code, in the declared order', () => {
    for (const k of ERASURE_BLOCKERS) expect(erasureBlockers({ ...clear, [k]: 2 })).toEqual([k]);
    expect(erasureBlockers({ ...clear, pending_payouts: 1, open_orders: '3', wallet_balance: 1 })).toEqual(['open_orders', 'wallet_balance', 'pending_payouts']);
  });
  it('bigint-as-string counts are read exactly (no float)', () => {
    expect(erasureBlockers({ ...clear, wallet_balance: '9007199254740993' })).toEqual(['wallet_balance']);
    expect(erasureBlockers({ ...clear, wallet_balance: '0' })).toEqual([]);
  });
  it('a NEGATIVE count still blocks (non-zero is the rule — money owed either way)', () =>
    expect(erasureBlockers({ ...clear, wallet_balance: -1 })).toEqual(['wallet_balance']));
  it('an unreadable figure blocks', () => expect(erasureBlockers({ ...clear, open_orders: 'many' })).toEqual(['open_orders']));
  it('a missing known figure blocks as unknown:<key> (the database did not answer that check)', () => {
    const rest: Record<string, number> = { ...clear };
    delete rest.open_disputes;
    expect(erasureBlockers(rest)).toEqual(['unknown:open_disputes']);
  });
  it('an unknown NON-ZERO figure blocks as unknown:<key>; an unknown zero does not', () => {
    expect(erasureBlockers({ ...clear, open_tenders: 1 })).toEqual(['unknown:open_tenders']);
    expect(erasureBlockers({ ...clear, open_tenders: 0 })).toEqual([]);
  });
  it('no figures at all blocks', () => {
    expect(erasureBlockers(null)).toEqual(['unknown:figures']);
    expect(erasureBlockers([1])).toEqual(['unknown:figures']);
  });
});

describe('decideErasure — the handler\'s decision table', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const past = new Date('2026-11-01T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');
  it('completed / rejected / open / unknown → skip (idempotent no-op)', () => {
    for (const s of ['completed', 'rejected', 'open', null]) expect(decideErasure({ status: s, coolingEndsAt: past, figures: clear, now }).decision).toBe('skip');
  });
  it('cooling not over (or never set) → not_due, whatever the figures', () => {
    expect(decideErasure({ status: 'in_progress', coolingEndsAt: future, figures: clear, now }).decision).toBe('not_due');
    expect(decideErasure({ status: 'in_progress', coolingEndsAt: null, figures: clear, now }).decision).toBe('not_due');
  });
  it('in_progress or blocked + a blocker → block with reasons', () => {
    for (const s of ['in_progress', 'blocked']) {
      expect(decideErasure({ status: s, coolingEndsAt: past, figures: { ...clear, active_loans: 1 }, now })).toEqual({ decision: 'block', reasons: ['active_loans'] });
    }
  });
  it('in_progress or blocked + clear → erase (a blocked request completes once its blocker clears)', () => {
    for (const s of ['in_progress', 'blocked']) expect(decideErasure({ status: s, coolingEndsAt: past, figures: clear, now })).toEqual({ decision: 'erase', reasons: [] });
  });
  it('cooling ending exactly now is due', () => expect(decideErasure({ status: 'in_progress', coolingEndsAt: now, figures: clear, now }).decision).toBe('erase'));
});

describe('the matrix and the reference list', () => {
  it('every class has a 0107 action and a description', () => {
    for (const [k, v] of Object.entries(ERASURE_MATRIX)) {
      expect(['deleted', 'anonymised', 'archived', 'blocked_by_law']).toContain(v.action);
      expect(v.what.length).toBeGreaterThan(3);
      expect(k).toMatch(/^[a-z0-9_]+$/);
    }
  });
  it('the decided lists are disjoint and free of duplicates', () => {
    const ref = new Set(ERASURE_REFERENCE_ONLY);
    expect(ref.size).toBe(ERASURE_REFERENCE_ONLY.length);
    for (const k of Object.keys(ERASURE_MATRIX)) expect(ref.has(k)).toBe(false);
  });
  it('money is never deleted or edited: ledger / wallet are kept by law', () => {
    for (const k of ['ledger_entries', 'ledger_transactions', 'wallet_accounts', 'audit_log', 'consents']) expect(ERASURE_MATRIX[k].action).toBe('blocked_by_law');
    for (const k of ['orders', 'trade_invoices', 'payouts', 'settlement_statements']) expect(ERASURE_MATRIX[k].action).toBe('archived');
  });
  it('the person-only classes are deleted; the users row is a tombstone (anonymised, never deleted)', () => {
    for (const k of ['sessions', 'devices', 'push_devices', 'carts', 'saved_searches', 'notification_preferences', 'notifications']) expect(ERASURE_MATRIX[k].action).toBe('deleted');
    expect(ERASURE_MATRIX.users.action).toBe('anonymised');
  });
  it('the tombstone helpers are fixed and non-reversible', () => {
    expect(ERASED_TOMBSTONE).toBe('[erased]');
    expect(erasedPhoneOf(USER)).toBe(`erased:${USER}`);
    expect(erasedPhoneOf(USER).length).toBeLessThanOrEqual(64);
  });
});

describe('parseErasureSummary', () => {
  it('reads a summary', () => {
    expect(parseErasureSummary({ classes: { users: { action: 'anonymised', rows: 1 } }, mediaPendingStoragePurge: 3, unmappedRetentionClasses: ['x'] }))
      .toEqual({ classes: { users: { action: 'anonymised', rows: 1 } }, mediaPendingStoragePurge: 3, unmappedRetentionClasses: ['x'] });
  });
  it('refuses a malformed one', () => {
    expect(parseErasureSummary(null)).toBeNull();
    expect(parseErasureSummary({})).toBeNull();
    expect(parseErasureSummary({ classes: { users: { action: 1, rows: 1 } } })).toBeNull();
  });
});

describe('DSR entity — blocked is reachable only from in_progress and leaves to completed / in_progress / rejected', () => {
  const at = (status: any) => DataSubjectRequest.rehydrate({ id: DSR, userId: USER, requestType: 'erasure', status, coolingEndsAt: null, resolution: null, exportMediaId: null });
  it('moves', () => {
    expect(() => at('in_progress').transition('blocked')).not.toThrow();
    expect(() => at('blocked').transition('completed')).not.toThrow();
    expect(() => at('blocked').transition('rejected')).not.toThrow();
    expect(() => at('open').transition('blocked')).toThrow();
    expect(() => at('completed').transition('blocked')).toThrow();
  });
});

describe('ErasureReadyHandler — calls only the 0245 wall, in order', () => {
  const ev = (payload: Record<string, unknown>): OutboxEvent => ({ id: '1', tenantId: T, aggregateType: 'user', aggregateId: USER, eventType: ERASURE_READY, payload });
  function fakeTx(claim: Record<string, unknown> | null, summary: unknown = { classes: { users: { action: 'anonymised', rows: 1 } }, mediaPendingStoragePurge: 0, unmappedRetentionClasses: [] }) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    return {
      calls,
      tx: {
        tenantId: T, userId: 'system',
        query: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
          if (/kv_dsr_erasure_claim/.test(sql)) return { rows: claim ? [{ ...claim, db_now: new Date('2026-11-24T10:00:00Z') }] : [] };
          if (/kv_dsr_erasure_block/.test(sql)) return { rows: [{ notified: true }] };
          if (/kv_dsr_erasure_execute/.test(sql)) return { rows: [{ summary }] };
          throw new Error(`unexpected SQL ${sql}`);
        },
      } as any,
    };
  }
  const due = { status: 'in_progress', user_id: USER, cooling_ends_at: new Date('2026-11-01T00:00:00Z') };
  it('is registered for identity.erasure_ready', () => expect(new ErasureReadyHandler().eventType).toBe('identity.erasure_ready'));
  it('a malformed event touches nothing', async () => {
    const f = fakeTx(due);
    expect(await new ErasureReadyHandler().run(ev({ v: 1 }), f.tx)).toBe('malformed');
    expect(await new ErasureReadyHandler().run(ev({ v: 1, dsrId: 'x; DROP TABLE users' }), f.tx)).toBe('malformed');
    expect(f.calls).toHaveLength(0);
  });
  it('an event naming another person is refused after the claim (no write)', async () => {
    const f = fakeTx({ ...due, figures: clear });
    expect(await new ErasureReadyHandler().run(ev({ v: 1, dsrId: DSR, userId: T }), f.tx)).toBe('malformed');
    expect(f.calls.map((c) => c.sql).join()).not.toMatch(/execute|block/);
  });
  it('clear → claim then execute, with the event tenant', async () => {
    const f = fakeTx({ ...due, figures: clear });
    expect(await new ErasureReadyHandler().run(ev({ v: 1, dsrId: DSR, userId: USER }), f.tx)).toBe('erased');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].sql).toMatch(/kv_dsr_erasure_execute\(\$1, \$2\)/);
    expect(f.calls[1].params).toEqual([DSR, T]);
  });
  it('blocked → claim then block with the reason codes; never execute', async () => {
    const f = fakeTx({ ...due, figures: { ...clear, open_orders: 1, wallet_balance: 1 } });
    expect(await new ErasureReadyHandler().run(ev({ v: 1, dsrId: DSR, userId: USER }), f.tx)).toBe('blocked');
    expect(f.calls[1].params).toEqual([DSR, ['open_orders', 'wallet_balance'], T]);
    expect(f.calls.some((c) => /execute/.test(c.sql))).toBe(false);
  });
  it('completed / not found / cooling not over → no write', async () => {
    for (const claim of [{ ...due, status: 'completed', figures: null }, null, { ...due, cooling_ends_at: new Date('2027-01-01T00:00:00Z'), figures: clear }]) {
      const f = fakeTx(claim);
      await new ErasureReadyHandler().run(ev({ v: 1, dsrId: DSR, userId: USER }), f.tx);
      expect(f.calls).toHaveLength(1);
    }
  });
  it('an executor that answers no summary throws (the relay rolls the whole erasure back)', async () => {
    const f = fakeTx({ ...due, figures: clear }, null);
    await expect(new ErasureReadyHandler().run(ev({ v: 1, dsrId: DSR, userId: USER }), f.tx)).rejects.toThrow(/no summary/);
  });
});
