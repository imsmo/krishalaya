// core/media/__tests__/media.spec.ts · SigV4 presigner + media domain (pure).
import { presignS3Url } from '@krishalaya/storage';
import { objectKey, parseObjectKey, isMimeAllowed } from '../media.domain';
import { MediaRepository } from '../media.repository';

const base = { region: 'ap-south-1', bucket: 'kv-media', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret/key+example', expiresSec: 900, now: new Date('2026-04-15T10:00:00Z') } as const;

describe('SigV4 presigner', () => {
  it('builds a virtual-hosted PUT URL with the V4 query parameters', () => {
    const url = presignS3Url({ method: 'PUT', key: 't/abc/document/x.pdf', ...base });
    expect(url.startsWith('https://kv-media.s3.ap-south-1.amazonaws.com/t/abc/document/x.pdf?')).toBe(true);
    expect(url).toMatch(/X-Amz-Algorithm=AWS4-HMAC-SHA256/);
    expect(url).toMatch(/X-Amz-Credential=AKIDEXAMPLE%2F20260415%2Fap-south-1%2Fs3%2Faws4_request/);
    expect(url).toMatch(/X-Amz-Expires=900/);
    expect(url).toMatch(/X-Amz-SignedHeaders=host/);
    expect(url).toMatch(/&X-Amz-Signature=[0-9a-f]{64}$/);
  });

  it('is deterministic, and a different key/method/time yields a different signature', () => {
    const sig = (u: string) => u.split('X-Amz-Signature=')[1];
    const a = presignS3Url({ method: 'GET', key: 'k1', ...base });
    const b = presignS3Url({ method: 'GET', key: 'k1', ...base });
    const c = presignS3Url({ method: 'GET', key: 'k2', ...base });
    const d = presignS3Url({ method: 'PUT', key: 'k1', ...base });
    expect(sig(a)).toBe(sig(b));      // deterministic
    expect(sig(a)).not.toBe(sig(c));  // key matters
    expect(sig(a)).not.toBe(sig(d));  // method matters
  });

  it('supports path-style (MinIO) addressing', () => {
    const url = presignS3Url({ method: 'GET', key: 'k', endpoint: 'http://minio:9000', forcePathStyle: true, ...base });
    expect(url.startsWith('http://minio:9000/kv-media/k?')).toBe(true);
  });
});

describe('media object-key layout', () => {
  it('embeds tenant + kind + id and round-trips', () => {
    const key = objectKey('11111111-1111-1111-1111-111111111111', 'document', '22222222-2222-2222-2222-222222222222', 'application/pdf');
    expect(key).toBe('t/11111111-1111-1111-1111-111111111111/document/22222222-2222-2222-2222-222222222222.pdf');
    const p = parseObjectKey(key);
    expect(p).toEqual({ tenantId: '11111111-1111-1111-1111-111111111111', mediaId: '22222222-2222-2222-2222-222222222222' });
  });
  it('handles platform (tenant-null) keys', () => {
    const key = objectKey(null, 'image', '33333333-3333-3333-3333-333333333333', 'image/png');
    expect(key).toBe('p/image/33333333-3333-3333-3333-333333333333.png');
    expect(parseObjectKey(key)).toEqual({ tenantId: null, mediaId: '33333333-3333-3333-3333-333333333333' });
  });
  it('rejects a malformed key', () => { expect(parseObjectKey('../etc/passwd')).toBeNull(); });
});

describe('mime allow-list', () => {
  it('permits known types and rejects executables/html', () => {
    expect(isMimeAllowed('document', 'application/pdf')).toBe(true);
    expect(isMimeAllowed('image', 'image/png')).toBe(true);
    expect(isMimeAllowed('document', 'text/html')).toBe(false);
    expect(isMimeAllowed('image', 'application/x-msdownload')).toBe(false);
  });
});

describe('media tenant isolation (SQL contract)', () => {
  it('getForUpdate binds tenant_id + row-locks', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MediaRepository({ forTenant: () => tx } as any).getForUpdate(tx as any, 'tenantA', 'm1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['m1', 'tenantA']);
  });
  it('getVisible scopes to own-tenant-or-platform and owner-or-moderator (no IDOR)', async () => {
    const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MediaRepository({ forTenant: () => exec } as any).getVisible('tenantA', 'm1', 'viewer', false);
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$2 OR tenant_id IS NULL/);
    expect(sql).toMatch(/\$3=true OR uploader_user_id=\$4 OR tenant_id IS NULL/);
    expect(params).toEqual(['m1', 'tenantA', false, 'viewer']);
  });
});
