// modules/tenant-integrations/__tests__/tenant-integrations.spec.ts · unit tests for the security-critical bits:
// (1) the entity serialize() NEVER leaks the vault secretRef; (2) the LocalSecretWriter discards the plaintext and
// returns a scoped, non-secret ref. These are the invariants an attacker probes first.
import { TenantIntegration } from '../domain/tenant-integration.entity';
import { LocalSecretWriter } from '../../../core/secrets/local-secret-writer';

describe('TenantIntegration.serialize', () => {
  const e = new TenantIntegration({
    id: 'i1', tenantId: 't1', providerCode: 'razorpay', secretRef: 'arn:aws:secretsmanager:...:SUPER_SECRET',
    config: { sandbox: true }, isActive: true, providerName: 'Razorpay', category: 'payment', createdAt: '2026-06-01T00:00:00Z',
  });
  it('exposes connected + config but NEVER the secretRef', () => {
    const out = e.serialize() as Record<string, unknown>;
    expect(out.connected).toBe(true);
    expect(out.providerCode).toBe('razorpay');
    expect(out.config).toEqual({ sandbox: true });
    expect('secretRef' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('SUPER_SECRET');
  });
  it('connected is false when inactive', () => {
    const off = new TenantIntegration({ id: 'i2', tenantId: 't1', providerCode: 'msg91', secretRef: 'arn:x', config: {}, isActive: false });
    expect((off.serialize() as any).connected).toBe(false);
  });
});

describe('LocalSecretWriter (PC-56 TENANT-13c: an in-process dev store — never on disk, never in the database)', () => {
  it('returns a tenant+provider(+version) scoped ref that never carries the plaintext; reads it back in-process; delete forgets it', async () => {
    const w = new LocalSecretWriter();
    const { secretRef } = await w.putTenantSecret('t1', 'razorpay', 'rzp_live_supersecret', 'v-1');
    expect(secretRef).toBe('local://krishi/t1/razorpay/v-1');
    expect(secretRef).not.toContain('supersecret');
    await expect(w.readTenantSecret(secretRef)).resolves.toBe('rzp_live_supersecret');
    await expect(w.deleteTenantSecret(secretRef)).resolves.toBeUndefined();
    await expect(w.readTenantSecret(secretRef)).resolves.toBeNull();
  });
  it('a second version is a second secret: retiring the old ref never deletes the new one (zero-downtime rotation)', async () => {
    const w = new LocalSecretWriter();
    const a = await w.putTenantSecret('t1', 'gupshup', 'old', 'p1');
    const b = await w.putTenantSecret('t1', 'gupshup', 'new', 'p2');
    expect(a.secretRef).not.toBe(b.secretRef);
    await w.deleteTenantSecret(a.secretRef);
    await expect(w.readTenantSecret(b.secretRef)).resolves.toBe('new');
  });
});
