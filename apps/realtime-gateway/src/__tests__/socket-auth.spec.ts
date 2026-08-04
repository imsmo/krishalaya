// JWT handshake auth: the gateway must accept ONLY a valid, unexpired, correctly-signed access token with
// the right iss/aud, and extract sub/tid/perms. Forged/expired/wrong-realm tokens → null (connection refused).
import * as jwt from 'jsonwebtoken';
import { extractToken, verifyToken, authenticate } from '../auth/socket-auth.guard';

const CFG = { accessSecret: 'a'.repeat(40), issuer: 'krishalaya', audience: 'krishalaya-app' };
const mint = (over: Record<string, unknown> = {}, secret = CFG.accessSecret) =>
  jwt.sign({ tid: 't1', sid: 's1', roles: [], perms: ['dairy.manage'], typ: 'access', ...over },
    secret, { subject: 'u1', issuer: CFG.issuer, audience: CFG.audience, expiresIn: 900, algorithm: 'HS256' });

describe('extractToken', () => {
  it('reads Bearer header or ?token= query', () => {
    expect(extractToken('Bearer abc', undefined)).toBe('abc');
    expect(extractToken(undefined, '/ws?token=xyz')).toBe('xyz');
    expect(extractToken(undefined, '/ws')).toBeNull();
  });
});

describe('verifyToken', () => {
  it('accepts a valid access token and returns claims', () => {
    expect(verifyToken(mint(), CFG)).toEqual({ sub: 'u1', tid: 't1', perms: ['dairy.manage'] });
  });
  it('rejects a wrong signature', () => {
    expect(verifyToken(mint({}, 'b'.repeat(40)), CFG)).toBeNull();
  });
  it('rejects wrong issuer/audience', () => {
    const bad = jwt.sign({ tid: 't1', typ: 'access' }, CFG.accessSecret,
      { subject: 'u1', issuer: 'evil', audience: CFG.audience, expiresIn: 900, algorithm: 'HS256' });
    expect(verifyToken(bad, CFG)).toBeNull();
  });
  it('rejects a refresh/non-access token', () => {
    expect(verifyToken(mint({ typ: 'refresh' }), CFG)).toBeNull();
  });
  it('rejects an expired token', () => {
    const exp = jwt.sign({ tid: 't1', typ: 'access' }, CFG.accessSecret,
      { subject: 'u1', issuer: CFG.issuer, audience: CFG.audience, expiresIn: -10, algorithm: 'HS256' });
    expect(verifyToken(exp, CFG)).toBeNull();
  });
  it('rejects a token missing sub/tid', () => {
    const noTid = jwt.sign({ typ: 'access' }, CFG.accessSecret,
      { subject: 'u1', issuer: CFG.issuer, audience: CFG.audience, expiresIn: 900, algorithm: 'HS256' });
    expect(verifyToken(noTid, CFG)).toBeNull();
  });
});

describe('authenticate (handshake)', () => {
  it('end-to-end via query param', () => {
    expect(authenticate(undefined, `/ws?token=${mint()}`, CFG)).toEqual({ sub: 'u1', tid: 't1', perms: ['dairy.manage'] });
  });
  it('refuses when no token present', () => {
    expect(authenticate(undefined, '/ws', CFG)).toBeNull();
  });
});
