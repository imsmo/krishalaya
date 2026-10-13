// core/http/__tests__/client-ip.spec.ts · PC-56 STORE-1a · A1 (founder D3) — the signed storefront client address.
// Pins: a valid signed header set is honoured; a bad signature, a stale / future timestamp, a non-IP address, a malformed signature and
// an unconfigured secret all fall back to req.ip; the middleware fixes the answer once and the rate-limit guard keys on it; and the
// known-answer vector the storefront's signer (apps/web-storefront/src/lib/caller-sign.ts) is tested against.
import { clientIpSignature, verifiedForwardedIp, effectiveClientIp, clientIpOf, ClientIpMiddleware, CLIENT_SIG_MAX_SKEW_SEC } from '../client-ip';
import { RateLimitGuard } from '../rate-limit.guard';
import { InMemoryCacheService } from '../../cache/cache.service.in-memory';
import { TooManyRequestsError } from '../../../shared/errors/app-error';
import { AppConfig } from '../../config/app-config';

const SECRET = 'store1a-caller-secret-0123456789abcdef';
const NOW = 1_760_000_000;
const signed = (ip: string, ts: number, secret = SECRET) => ({
  'x-kv-client-ip': ip, 'x-kv-client-ts': String(ts), 'x-kv-client-sig': clientIpSignature(ip, String(ts), secret),
});
const req = (headers: Record<string, string>, ip = '10.0.0.5') => ({ headers, ip, socket: {} }) as any;

describe('STORE-1a · client-ip', () => {
  it('known-answer vector (the storefront signer must produce the same hex)', () => {
    expect(clientIpSignature('203.0.113.9', '1760000000', 'k'.repeat(32))).toBe('38b097e9efd61fdc9f632c6596dceab7aa34c37763578591e2426007c27224c5');
  });

  it('a valid signed header set → the forwarded address (IPv4 and IPv6)', () => {
    expect(verifiedForwardedIp(signed('203.0.113.9', NOW), SECRET, NOW)).toBe('203.0.113.9');
    expect(verifiedForwardedIp(signed('2001:db8::7', NOW - CLIENT_SIG_MAX_SKEW_SEC), SECRET, NOW)).toBe('2001:db8::7');
    expect(effectiveClientIp(req(signed('203.0.113.9', NOW)), SECRET, NOW)).toBe('203.0.113.9');
  });

  it.each([
    ['no secret configured', signed('203.0.113.9', NOW), ''],
    ['signed with another secret', signed('203.0.113.9', NOW, 'another-secret-another-secret-0123'), SECRET],
    ['stale timestamp', signed('203.0.113.9', NOW - CLIENT_SIG_MAX_SKEW_SEC - 1), SECRET],
    ['future timestamp', signed('203.0.113.9', NOW + CLIENT_SIG_MAX_SKEW_SEC + 1), SECRET],
    ['address swapped after signing', { ...signed('203.0.113.9', NOW), 'x-kv-client-ip': '198.51.100.1' }, SECRET],
    ['not an IP literal', signed('evil.example.com', NOW), SECRET],
    ['malformed signature', { ...signed('203.0.113.9', NOW), 'x-kv-client-sig': 'zz' }, SECRET],
    ['missing signature', { 'x-kv-client-ip': '203.0.113.9', 'x-kv-client-ts': String(NOW) }, SECRET],
  ])('%s → req.ip', (_name, headers, secret) => {
    expect(verifiedForwardedIp(headers as Record<string, string>, secret as string, NOW)).toBeNull();
    expect(effectiveClientIp(req(headers as Record<string, string>), secret as string, NOW)).toBe('10.0.0.5');
  });

  it('the middleware fixes the answer once; clientIpOf falls back to req.ip where it did not run', () => {
    const cfg = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'test-secret-test-secret', STOREFRONT_CALLER_SECRET: SECRET });
    const r = req(signed('203.0.113.9', Math.floor(Date.now() / 1000)));
    expect(clientIpOf(r)).toBe('10.0.0.5');                       // middleware not run yet
    const next = jest.fn();
    new ClientIpMiddleware(cfg).use(r, {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(clientIpOf(r)).toBe('203.0.113.9');
    const forged = req({ 'x-kv-client-ip': '203.0.113.9', 'x-kv-client-ts': String(Math.floor(Date.now() / 1000)), 'x-kv-client-sig': 'a'.repeat(64) });
    new ClientIpMiddleware(cfg).use(forged, {} as any, jest.fn());
    expect(clientIpOf(forged)).toBe('10.0.0.5');
  });

  it('the rate-limit guard keys on the verified client: two buyers behind one server get two buckets; a forged header shares the server bucket', async () => {
    const cfg = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'test-secret-test-secret', STOREFRONT_CALLER_SECRET: SECRET });
    const mw = new ClientIpMiddleware(cfg);
    const reflector: any = { getAllAndOverride: () => ({ limit: 1, windowSec: 60, by: 'ip' }) };
    const guard = new RateLimitGuard(reflector, new InMemoryCacheService());
    const ctxFor = (r: any) => ({
      getType: () => 'http', switchToHttp: () => ({ getRequest: () => r, getResponse: () => ({ setHeader: jest.fn() }) }),
      getClass: () => ({ name: 'AuthController' }), getHandler: () => ({ name: 'requestOtp' }),
    }) as any;
    const now = Math.floor(Date.now() / 1000);
    const a = req(signed('203.0.113.1', now)); mw.use(a, {} as any, jest.fn());
    const b = req(signed('203.0.113.2', now)); mw.use(b, {} as any, jest.fn());
    expect(await guard.canActivate(ctxFor(a))).toBe(true);
    expect(await guard.canActivate(ctxFor(b))).toBe(true);        // a separate bucket — not the server's shared one
    await expect(guard.canActivate(ctxFor(a))).rejects.toBeInstanceOf(TooManyRequestsError);
    const forged1 = req({ 'x-kv-client-ip': '203.0.113.3', 'x-kv-client-ts': String(now), 'x-kv-client-sig': 'b'.repeat(64) });
    const forged2 = req({ 'x-kv-client-ip': '203.0.113.4', 'x-kv-client-ts': String(now), 'x-kv-client-sig': 'c'.repeat(64) });
    mw.use(forged1, {} as any, jest.fn()); mw.use(forged2, {} as any, jest.fn());
    expect(await guard.canActivate(ctxFor(forged1))).toBe(true);
    await expect(guard.canActivate(ctxFor(forged2))).rejects.toBeInstanceOf(TooManyRequestsError);   // both are 10.0.0.5
  });
});
