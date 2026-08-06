// packages/storage/src/test/sigv4-presigner.spec.ts · the presigner is now shared by apps/api and admin-api, so its
// behaviour is pinned HERE rather than in one app's suite. Signing is deterministic: the same inputs must always
// produce the same signature, or a URL that was handed out stops matching what S3 recomputes.
import { presignS3Url } from '../sigv4-presigner';

const base = {
  region: 'ap-south-1',
  bucket: 'kv-media',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretExampleKey',
  expiresSec: 900,
  now: new Date('2026-08-06T12:00:00.000Z'),
} as const;

describe('presignS3Url', () => {
  it('is deterministic for identical input', () => {
    const a = presignS3Url({ ...base, method: 'GET', key: 'invoices/INV-1.pdf' });
    const b = presignS3Url({ ...base, method: 'GET', key: 'invoices/INV-1.pdf' });
    expect(a).toBe(b);
  });

  it('signs GET and PUT differently — a read URL must not double as a write URL', () => {
    expect(presignS3Url({ ...base, method: 'GET', key: 'k' })).not.toBe(presignS3Url({ ...base, method: 'PUT', key: 'k' }));
  });

  it('carries the V4 query parameters and the expiry', () => {
    const u = new URL(presignS3Url({ ...base, method: 'GET', key: 'invoices/INV-1.pdf' }));
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKIAEXAMPLE/20260806/ap-south-1/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(u.host).toBe('kv-media.s3.ap-south-1.amazonaws.com');   // virtual-hosted by default
  });

  it('keeps path separators but encodes each segment (a key is not a URL path to be trusted)', () => {
    expect(presignS3Url({ ...base, method: 'GET', key: 'invoices/2026 07/INV#1.pdf' }))
      .toContain('/invoices/2026%2007/INV%231.pdf?');
  });

  it('supports MinIO/LocalStack via endpoint + path style', () => {
    const u = new URL(presignS3Url({ ...base, method: 'PUT', key: 'k', endpoint: 'http://minio:9000', forcePathStyle: true }));
    expect(u.protocol).toBe('http:');
    expect(u.host).toBe('minio:9000');
    expect(u.pathname).toBe('/kv-media/k');
  });

  it('includes the STS session token when temporary credentials are used', () => {
    const u = new URL(presignS3Url({ ...base, method: 'GET', key: 'k', sessionToken: 'FQoGZXIvYXdzEExample' }));
    expect(u.searchParams.get('X-Amz-Security-Token')).toBe('FQoGZXIvYXdzEExample');
  });

  it('a different secret produces a different signature, and the secret never appears in the URL', () => {
    const a = presignS3Url({ ...base, method: 'GET', key: 'k' });
    expect(a).not.toBe(presignS3Url({ ...base, method: 'GET', key: 'k', secretAccessKey: 'other' }));
    expect(a).not.toContain('secretExampleKey');
  });
});
