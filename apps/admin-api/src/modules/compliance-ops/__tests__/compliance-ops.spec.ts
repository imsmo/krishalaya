// apps/admin-api/src/modules/compliance-ops/__tests__/compliance-ops.spec.ts · unit tests (pure/mocked).
// Covers: the DSR + breach state machines + entities; the DPDP erasure-cooling guard; the export-approval guard;
// owner-RBAC for the compliance roles + the NO-privilege-escalation property (Law 11); DTO validation; and the
// services proving every write audits IN-TX, the state machine is enforced, and a missing entity is a 404.
import { DataSubjectRequest } from '../domain/dsr.entity';
import { canTransition as dsrCan, IllegalDsrTransitionError, DSR_STATUSES } from '../domain/dsr.state';
import { Breach } from '../domain/breach.entity';
import { canTransition as breachCan, IllegalBreachTransitionError, BREACH_STATUSES } from '../domain/breach.state';
import { decideExport } from '../domain/export-approval';
import { ErasureCoolingActiveError, ExportAlreadyDecidedError, DsrNotFoundError, ExportJobNotFoundError, BreachNotFoundError } from '../domain/compliance-ops.errors';
import { DataSubjectRequestsQueueService } from '../services/data-subject-requests-queue.service';
import { TenantExportApprovalsService } from '../services/tenant-export-approvals.service';
import { BreachResponseConsoleService } from '../services/breach-response-console.service';
import { UpdateDsrSchema, DecideExportSchema, OpenBreachSchema, UpsertRetentionSchema, QueryAuditSchema } from '../dto/compliance-ops.dto';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';

const dsr = (status: any, over: any = {}) => DataSubjectRequest.rehydrate({ id: 'd1', userId: 'u1', requestType: 'access', status, coolingEndsAt: null, resolution: null, exportMediaId: null, ...over });
const breach = (status: any) => Breach.rehydrate({ id: 'b1', affectedTenantId: null, status, severity: 'high', title: 't', affectedCount: 5, detectedAt: new Date(), containedAt: null, regulatorNotifiedAt: null, principalsNotifiedAt: null, closedAt: null, resolutionNote: null });
const actor = { userId: 'admin1', roles: ['platform_compliance_ops'], ip: '10.0.0.1', requestId: 'req1' } as any;

describe('DSR state machine + entity', () => {
  it('open→in_progress→completed/rejected; terminal locked', () => {
    expect(dsrCan('open', 'in_progress')).toBe(true);
    expect(dsrCan('in_progress', 'completed')).toBe(true);
    expect(dsrCan('completed', 'open')).toBe(false);
    expect(DSR_STATUSES.length).toBe(4);
  });
  it('erasure cannot complete during the cooling window (DPDP)', () => {
    const future = new Date(Date.now() + 86_400_000);
    const e = dsr('in_progress', { requestType: 'erasure', coolingEndsAt: future });
    expect(() => e.complete('done')).toThrow(ErasureCoolingActiveError);
    const past = new Date(Date.now() - 1000);
    const ok = dsr('in_progress', { requestType: 'erasure', coolingEndsAt: past });
    expect(ok.complete('done')).toEqual({ from: 'in_progress', to: 'completed' });
  });
  // ADMIN-5: `reject` now REQUIRES one of the three lawful grounds — 0107's CHECK ties status and ground together, so an
  // ungrounded rejection cannot be stored. The ground is passed here; the assertion (illegal transition) is unchanged.
  it('illegal transition throws', () => { expect(() => dsr('completed').reject('x', 'legal_hold')).toThrow(IllegalDsrTransitionError); });
});

describe('breach state machine + entity', () => {
  it('open→contained→notified→closed; open/contained→closed', () => {
    expect(breachCan('open', 'contained')).toBe(true);
    expect(breachCan('contained', 'notified')).toBe(true);
    expect(breachCan('open', 'closed')).toBe(true);
    expect(breachCan('closed', 'open')).toBe(false);
    expect(BREACH_STATUSES.length).toBe(4);
  });
  it('markNotified stamps both timestamps; close stamps closedAt', () => {
    const b = breach('contained');
    expect(b.markNotified(new Date(), new Date())).toEqual({ from: 'contained', to: 'notified' });
    expect(b.close('done')).toEqual({ from: 'notified', to: 'closed' });
    expect(() => breach('closed').contain()).toThrow(IllegalBreachTransitionError);
  });
});

describe('export-approval guard', () => {
  it('pending → approved/rejected; already-decided → 409', () => {
    expect(decideExport('pending', 'approve')).toBe('approved');
    expect(decideExport('pending', 'reject')).toBe('rejected');
    expect(() => decideExport('approved', 'approve')).toThrow(ExportAlreadyDecidedError);
  });
});

describe('owner roles for compliance (Law 11)', () => {
  it('compliance_ops manage+read; viewer read-only; tenant roles NOTHING; no plane bleed', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_compliance_ops']), OwnerPermissions.ComplianceManage)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_compliance_viewer']), OwnerPermissions.ComplianceManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_compliance_viewer']), OwnerPermissions.ComplianceRead)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['tenant_admin']), OwnerPermissions.ComplianceManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_compliance_ops']), OwnerPermissions.ReconManage)).toBe(false);
  });
});

describe('dto validation', () => {
  it('open-breach requires categories + bounded fields, rejects unknown keys', () => {
    expect(OpenBreachSchema.safeParse({ title: 'leak', description: 'desc here', affectedData: 'phone,email', detectedAt: '2026-06-21T00:00:00.000Z' }).success).toBe(true);
    expect(OpenBreachSchema.safeParse({ title: 'x', description: 'd', affectedData: 'phone', detectedAt: 'nope' }).success).toBe(false);
    expect(OpenBreachSchema.safeParse({ title: 'leak', description: 'desc here', affectedData: 'phone', detectedAt: '2026-06-21T00:00:00.000Z', evil: 1 }).success).toBe(false);
  });
  it('update-dsr + decide-export enums; retention bounds; audit filters regex-safe', () => {
    expect(UpdateDsrSchema.safeParse({ action: 'complete', resolution: 'fulfilled' }).success).toBe(true);
    expect(DecideExportSchema.safeParse({ decision: 'approve', reason: 'verified' }).success).toBe(true);
    expect(DecideExportSchema.safeParse({ decision: 'maybe', reason: 'x' }).success).toBe(false);
    expect(UpsertRetentionSchema.safeParse({ tableName: 'audit_log', activeMonths: 24, archiveMonths: 120, action: 'archive', reason: 'GST 7yr' }).success).toBe(true);
    expect(UpsertRetentionSchema.safeParse({ tableName: 'bad name', activeMonths: 1, archiveMonths: null, action: 'archive', reason: 'x' }).success).toBe(false);
    expect(QueryAuditSchema.safeParse({ action: 'tenant.approved' }).success).toBe(true);
    expect(QueryAuditSchema.safeParse({ action: 'DROP TABLE;' }).success).toBe(false);   // regex-bounded (ReDoS/injection-safe)
  });
});

function harness() {
  const client = { __c: true };
  const pool = { withTx: async (fn: any) => fn(client) } as any;
  const audit = { write: jest.fn(async () => undefined) } as any;
  return { client, pool, audit };
}

describe('services audit-in-tx + 404 + guards', () => {
  it('DSR update: 404 when missing; start audits', async () => {
    const { pool, audit, client } = harness();
    await expect(new DataSubjectRequestsQueueService(pool, audit, { getDsrForUpdate: jest.fn(async () => null) } as any).update(actor, 'x', { action: 'start', resolution: 'begin' })).rejects.toBeInstanceOf(DsrNotFoundError);
    const repo = { getDsrForUpdate: jest.fn(async () => dsr('open')), updateDsr: jest.fn() } as any;
    await new DataSubjectRequestsQueueService(pool, audit, repo).update(actor, 'd1', { action: 'start', resolution: 'begin' });
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'dpdp.dsr_in_progress' }));
  });
  it('export decide: 404 when missing; approve audits', async () => {
    const { pool, audit, client } = harness();
    await expect(new TenantExportApprovalsService(pool, audit, { getExportForUpdate: jest.fn(async () => null) } as any).decide(actor, 'x', { decision: 'approve', reason: 'ok' })).rejects.toBeInstanceOf(ExportJobNotFoundError);
    const repo = { getExportForUpdate: jest.fn(async () => ({ id: 'e1', approvalStatus: 'pending', jobKind: 'tenant_full_export', tenantId: 't1' })), decideExport: jest.fn() } as any;
    const out: any = await new TenantExportApprovalsService(pool, audit, repo).decide(actor, 'e1', { decision: 'approve', reason: 'verified DPO request' });
    expect(out.approvalStatus).toBe('approved');
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'dpdp.export_approved' }));
  });
  it('breach update: notify without both timestamps is rejected; close audits; 404 on missing', async () => {
    const { pool, audit, client } = harness();
    const repo = { getBreachForUpdate: jest.fn(async () => breach('contained')), updateBreach: jest.fn() } as any;
    await expect(new BreachResponseConsoleService(pool, audit, repo).update(actor, 'b1', { action: 'notify', note: 'notifying' })).rejects.toBeDefined();
    const repo2 = { getBreachForUpdate: jest.fn(async () => breach('contained')), updateBreach: jest.fn() } as any;
    await new BreachResponseConsoleService(pool, audit, repo2).update(actor, 'b1', { action: 'close', note: 'remediated' });
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'dpdp.breach_closed' }));
    await expect(new BreachResponseConsoleService(pool, audit, { getBreach: jest.fn(async () => null) } as any).get('nope')).rejects.toBeInstanceOf(BreachNotFoundError);
  });
});
