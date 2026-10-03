// modules/tenant-webhooks/__tests__/tenant-webhooks.spec.ts · unit tests for the security-critical primitives an attacker probes first:
// the SSRF guard (only public https), the HMAC signature (deterministic + tamper-evident), the secret envelope round-trip (+ tamper and
// wrong-row rejection), and that the endpoint serialize() never leaks secret material. PC-56 TENANT-13a extended each to the 13a
// contract; the full 13a matrix is tenant13a-webhooks.spec.ts.
import { checkWebhookUrl } from '../domain/webhook-ssrf';
import { computeSignature, signatureHeader } from '../domain/webhook-signature';
import { WebhookEndpoint } from '../domain/webhook-endpoint.entity';
import { parseKek, sealEnvelope, openEnvelope } from '../../../core/secrets/secret-envelope';

describe('checkWebhookUrl (SSRF guard, syntactic half)', () => {
  it('accepts a public https URL', () => {
    expect(checkWebhookUrl('https://hooks.acme.in/kv').ok).toBe(true);
    expect(checkWebhookUrl('https://example.com:443/x').ok).toBe(true);
  });
  it('rejects non-https, credentials, odd ports', () => {
    expect(checkWebhookUrl('http://acme.in/x').ok).toBe(false);
    expect(checkWebhookUrl('https://u:p@acme.in/x').ok).toBe(false);
    expect(checkWebhookUrl('https://acme.in:8080/x').ok).toBe(false);
  });
  it('blocks localhost, metadata, .internal/.local', () => {
    for (const u of ['https://localhost/x', 'https://metadata.google.internal/x', 'https://svc.internal/x', 'https://box.local/x']) {
      expect(checkWebhookUrl(u).ok).toBe(false);
    }
  });
  it('blocks private + loopback + link-local IP literals (v4 + v6, incl. mapped, NAT64, site-local)', () => {
    for (const h of ['https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x', 'https://169.254.169.254/x', 'https://100.64.0.1/x']) {
      expect(checkWebhookUrl(h).ok).toBe(false);
    }
    for (const h of ['https://[::1]/x', 'https://[fd00::1]/x', 'https://[::ffff:169.254.169.254]/x', 'https://[64:ff9b::a9fe:a9fe]/x', 'https://[fec0::1]/x']) {
      expect(checkWebhookUrl(h).ok).toBe(false);
    }
  });
});

describe('webhook signature', () => {
  it('is deterministic and changes with body/secret/timestamp', () => {
    const a = computeSignature('whsec_x', '{"a":1}', 1000);
    expect(a).toBe(computeSignature('whsec_x', '{"a":1}', 1000));
    expect(a).not.toBe(computeSignature('whsec_y', '{"a":1}', 1000));
    expect(a).not.toBe(computeSignature('whsec_x', '{"a":2}', 1000));
    expect(a).not.toBe(computeSignature('whsec_x', '{"a":1}', 1001));
    expect(signatureHeader('whsec_x', '{"a":1}', 1000)).toBe(`t=1000,v1=${a}`);
  });
});

describe('secret envelope (AES-256-GCM data key under the KEK, bound to the row)', () => {
  const kek = parseKek('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
  it('round-trips and never contains the plaintext', () => {
    const token = sealEnvelope(kek, 'whsec_supersecret', 'webhook_endpoint:e1');
    expect(token).not.toContain('whsec_supersecret');
    expect(openEnvelope(kek, token, 'webhook_endpoint:e1')).toBe('whsec_supersecret');
  });
  it('rejects a tampered token and a token copied onto another row', () => {
    const token = sealEnvelope(kek, 'whsec_supersecret', 'webhook_endpoint:e1');
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect(() => openEnvelope(kek, tampered, 'webhook_endpoint:e1')).toThrow();
    expect(() => openEnvelope(kek, token, 'webhook_endpoint:e2')).toThrow();
  });
  it('parseKek rejects a non-32-byte key', () => {
    expect(() => parseKek('deadbeef')).toThrow();
  });
});

describe('WebhookEndpoint.serialize', () => {
  it('exposes url + events + status + hint but NEVER secret material', () => {
    const e = new WebhookEndpoint({
      id: 'w1', tenantId: 't1', url: 'https://hooks.acme.in/kv', eventTypes: ['order.created'], status: 'active', pausedReason: null, pausedAt: null,
      secretHint: '8f2', secretRotatedAt: null, prevExpiresAt: null, developerEmail: 'dev@acme.in', createdAt: '2026-06-01T00:00:00.000Z', createdUs: '2026-06-01T00:00:00.000000Z', createdBy: null,
      ...({ secretEnc: 'ENCRYPTED_BLOB' } as object),
    } as any);
    const out = e.serialize() as Record<string, unknown>;
    expect(out.url).toBe('https://hooks.acme.in/kv');
    expect(out.eventTypes).toEqual(['order.created']);
    expect(out.secretHint).toBe('8f2');
    expect('secretEnc' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('ENCRYPTED_BLOB');
  });
});
