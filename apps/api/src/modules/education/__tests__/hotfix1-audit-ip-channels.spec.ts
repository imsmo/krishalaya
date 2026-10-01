// modules/education/__tests__/hotfix1-audit-ip-channels.spec.ts · HOTFIX-1 — the audit row's `ip` on education channel moderation (approve / suspend / reject).
// Before HOTFIX-1 these controllers handed `ctx.requestId` (a UUID) to the service's `ip` parameter, which lands in
// audit_log.ip (inet): over real HTTP every one of these writes failed 22P02 and rolled back (TENANT-8c named it,
// F-7 class). Each route must now pass the CLIENT address or NULL — and never the request id.
import { ChannelsController } from '../controllers/v1/channels.controller';

const REQUEST_ID = '0192f0a8-7c1e-7d55-9a7e-3b1f2c4d5e6f';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ctx = { tenantId: 't-1', userId: 'u-1', sessionId: 's-1', requestId: REQUEST_ID, lang: 'en-IN', roles: [], permissions: new Set(['*']), shardId: 0 } as never;

describe('ChannelsController — audit ip is the client address or NULL, never the request id (HOTFIX-1)', () => {
  const build = () => {
    const svc = { moderate: jest.fn(async () => ({})) };
    const c = new ChannelsController(svc as never);
    return { c, svc };
  };
  const cases: Array<[string, (c: ChannelsController, r: { ip?: string }) => Promise<unknown>, string, number]> = [
    ['POST channels/:id/approve', (c, r) => c.approve(ctx, r as never, 'ch-1', { note: null } as never), 'moderate', 5],
    ['POST channels/:id/suspend', (c, r) => c.suspend(ctx, r as never, 'ch-1', { note: 'x' } as never), 'moderate', 5],
    ['POST channels/:id/reject', (c, r) => c.reject(ctx, r as never, 'ch-1', { note: 'x' } as never), 'moderate', 5],
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
