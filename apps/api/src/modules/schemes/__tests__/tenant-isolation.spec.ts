// modules/schemes/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// scheme_applications + events + dbt_transfers bind tenant_id (Law 1). No version columns → mutations lock
// FOR UPDATE. Lists are keyset (never OFFSET). schemes + scheme_authorities are GLOBAL reference (no
// tenant_id). dbt_transfers is partitioned → list bounds created_at.
import { SchemeApplicationRepository } from '../repositories/scheme-application.repository';
import { DbtTransferRepository } from '../repositories/dbt-transfer.repository';
import { SchemeRepository } from '../repositories/scheme.repository';
import { SchemeAuthorityRepository } from '../repositories/scheme-authority.repository';
import { SchemeApplication } from '../domain/scheme-application.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }

describe('scheme_applications isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new SchemeApplicationRepository(fakeReplica().provider).getForUpdate(tx as any, 'tA', 'a1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['a1', 'tA']);
  });
  it('insert binds tenant_id; appendEvent writes the partitioned audit row tenant-bound', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const a = SchemeApplication.draft({ id: 'a1', tenantId: 'tA', schemeId: 's1', schemeVersion: 1, schemeVersionId: null, applicantUserId: 'u1', assistedBy: null, formData: {}, eligibilityCheck: null });
    await new SchemeApplicationRepository(fakeReplica().provider).insert(tx as any, a);
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO scheme_applications/); expect(tx.query.mock.calls[0][1]).toContain('tA');
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new SchemeApplicationRepository(fakeReplica().provider).appendEvent(tx2 as any, 'tA', 'a1', 'draft', 'submitted', null, 'u1');
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO scheme_application_events/); expect(tx2.query.mock.calls[0][1]).toContain('tA');
  });
  it('queue listFor excludes terminal/draft; keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new SchemeApplicationRepository(provider).listFor('tA', { queue: true, limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/status NOT IN \('closed','rejected','disbursed','draft'\)/); expect(sql).not.toMatch(/OFFSET/i);
  });
});

describe('dbt_transfers isolation (partitioned)', () => {
  it('listForApplication binds tenant + application + bounds created_at (prune)', async () => {
    const { provider, exec } = fakeReplica();
    await new DbtTransferRepository(provider).listForApplication('tA', 'a1');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND application_id=\$2/); expect(sql).toMatch(/created_at >= now\(\) - interval/); expect(params).toEqual(['tA', 'a1']);
  });
});

describe('global reference data (no tenant scoping on the rows)', () => {
  it('schemes + authorities list without a tenant_id predicate', async () => {
    const { provider, exec } = fakeReplica();
    await new SchemeRepository(provider).list('tA', { activeOnly: true });
    expect(exec.query.mock.calls[0][0]).not.toMatch(/tenant_id/);
    const { provider: p2, exec: e2 } = fakeReplica();
    await new SchemeAuthorityRepository(p2).list('tA');
    expect(e2.query.mock.calls[0][0]).not.toMatch(/tenant_id/);
  });
});
