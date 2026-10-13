// apps/web-storefront/src/test/caller-sign.spec.ts · PC-56 STORE-1a · C2 — the storefront signer AGREES with the API verifier:
// the same known-answer vector as apps/api/src/core/http/__tests__/client-ip.spec.ts, and `clientIpSignature`'s text is identical in
// both files (a change to one side only turns this red). Plus: an address is forwarded only under a trusted proxy, only if it is an IP.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientIpSignature, clientIpFromForwarded, signedClientHeaders } from '../lib/caller-sign';

const API_FILE = join(__dirname, '..', '..', '..', 'api', 'src', 'core', 'http', 'client-ip.ts');
const SF_FILE = join(__dirname, '..', 'lib', 'caller-sign.ts');
const fnText = (src: string) => { const s = src.indexOf('export function clientIpSignature('); return src.slice(s, src.indexOf('\n}\n', s) + 2); };

describe('STORE-1a · caller-sign', () => {
  it('known-answer vector (identical to the API spec)', () => {
    expect(clientIpSignature('203.0.113.9', '1760000000', 'k'.repeat(32))).toBe('38b097e9efd61fdc9f632c6596dceab7aa34c37763578591e2426007c27224c5');
  });
  it('the signing function is the same text in the storefront and the API (drift guard)', () => {
    const api = fnText(readFileSync(API_FILE, 'utf8'));
    expect(api.length).toBeGreaterThan(50);
    expect(fnText(readFileSync(SF_FILE, 'utf8'))).toBe(api);
  });
  it('the buyer address is read only under a trusted proxy, and only when it is an IP literal', () => {
    expect(clientIpFromForwarded('203.0.113.9, 10.0.0.1', true)).toBe('203.0.113.9');
    expect(clientIpFromForwarded('2001:db8::1', true)).toBe('2001:db8::1');
    expect(clientIpFromForwarded('203.0.113.9', false)).toBeNull();
    expect(clientIpFromForwarded('evil.example.com', true)).toBeNull();
    expect(clientIpFromForwarded(null, true)).toBeNull();
  });
  it('signs three headers with a fresh timestamp; nothing without an address or a secret', () => {
    const h = signedClientHeaders('203.0.113.9', 's'.repeat(32), 1760000000);
    expect(h).toEqual({ 'x-kv-client-ip': '203.0.113.9', 'x-kv-client-ts': '1760000000', 'x-kv-client-sig': clientIpSignature('203.0.113.9', '1760000000', 's'.repeat(32)) });
    expect(signedClientHeaders(null, 's'.repeat(32))).toEqual({});
    expect(signedClientHeaders('203.0.113.9', '')).toEqual({});
  });
});
