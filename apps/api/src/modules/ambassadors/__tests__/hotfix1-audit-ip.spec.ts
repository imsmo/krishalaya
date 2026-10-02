// modules/ambassadors/__tests__/hotfix1-audit-ip.spec.ts · HOTFIX-1 — the audit row's `ip` on ambassadors enroll / suspend / reinstate.
// Before HOTFIX-1 these controllers handed `ctx.requestId` (a UUID) to the service's `ip` parameter, which lands in
// audit_log.ip (inet): over real HTTP every one of these writes failed 22P02 and rolled back (TENANT-8c named it,
// F-7 class). Each route must now pass the CLIENT address or NULL — and never the request id.
import { AmbassadorsController } from '../controllers/v1/ambassadors.controller';

const REQUEST_ID = '0192f0a8-7c1e-7d55-9a7e-3b1f2c4d5e6f';
const AMB = '01a0c000-0000-7000-8000-0000000000a1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ctx = { tenantId: 't-1', userId: 'u-1', sessionId: 's-1', requestId: REQUEST_ID, lang: 'en-IN', roles: [], permissions: new Set(['*']), shardId: 0 } as never;

describe('AmbassadorsController — audit ip is the client address or NULL, never the request id (HOTFIX-1)', () => {
  const build = () => {
    const svc = { enroll: jest.fn(async () => ({})), setActive: jest.fn(async () => ({})) };
    const c = new AmbassadorsController(svc as never, {} as never, {} as never, {} as never);
    return { c, svc };
  };
  const cases: Array<[string, (c: AmbassadorsController, r: { ip?: string }) => Promise<unknown>, string, number]> = [
    // PC-56 TENANT-10a: enroll takes an Idempotency-Key (the service's 4th argument) and suspend a reason — the ip moved to index 4.
    ['POST enroll', (c, r) => c.enroll(ctx, r as never, 'idem-1', { userId: AMB, clusterRegionIds: [], kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: '0' } as never), 'enroll', 4],
    ['POST suspend', (c, r) => c.suspend(ctx, r as never, AMB, { reason: 'left the village' }), 'setActive', 4],
    ['POST reinstate', (c, r) => c.reinstate(ctx, r as never, AMB, {}), 'setActive', 4],
  ];
  it.each(cases)('%s passes req.ip through to the audit ip', async (_n, call, method, argIndex) => {
    const { c, svc } = build();
    await call(c, { ip: '203.0.113.7' });
    const got = (svc as Record<string, jest.Mock>)[method].mock.calls[0][argIndex];
    expect(got).toBe('203.0.113.7');
    expect(got).not.toBe(REQUEST_ID);
  });
  it.each(cases)('%s passes NULL (not the request id) when the request has no ip', async (_n, call, method, argIndex) => {
    const { c, svc } = build();
    await call(c, {});
    const got = (svc as Record<string, jest.Mock>)[method].mock.calls[0][argIndex];
    expect(got).toBeNull();
    expect(String(got)).not.toMatch(UUID);
  });
});
