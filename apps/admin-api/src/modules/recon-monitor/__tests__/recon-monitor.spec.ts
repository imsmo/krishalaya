// apps/admin-api/src/modules/recon-monitor/__tests__/recon-monitor.spec.ts · unit tests (pure/mocked).
// Covers: the investigation state machine + entity; the freeze/unfreeze guards (NO ledger posting); owner-RBAC
// for the recon roles + the NO-privilege-escalation property (Law 11); DTO validation; and the services proving
// every write audits IN-TX, the state machine is enforced, and a missing run/account/investigation is a 404.
// PC-56 SEC-4 (zod 4): fixture ids carry valid RFC version/variant digits (`.uuid()` now checks them).
import { Investigation } from '../domain/investigation.entity';
import { canTransition, assertTransition, IllegalInvestigationTransitionError, INVESTIGATION_STATUSES } from '../domain/investigation.state';
import { applyFreeze } from '../domain/account-freeze';
import { InvalidFreezeStateError, ReconRunNotFoundError, WalletAccountNotFoundError } from '../domain/recon-monitor.errors';
import { MismatchInvestigationsService } from '../services/mismatch-investigations.service';
import { LedgerFreezeControlsService } from '../services/ledger-freeze-controls.service';
import { OpenInvestigationSchema, FreezeAccountSchema, QueryRunsSchema } from '../dto/recon-monitor.dto';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';

const inv = (status: any) => Investigation.rehydrate({ id: 'i1', runId: 'r1', status, severity: 'high', summary: 's', assignedTo: null, resolutionNote: null, openedBy: 'admin1', resolvedAt: null });
const actor = { userId: 'admin1', roles: ['platform_recon_ops'], ip: '10.0.0.1', requestId: 'req1' } as any;

describe('investigation state machine', () => {
  it('open→investigating→resolved/false_positive; terminal locked', () => {
    expect(canTransition('open', 'investigating')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(true);
    expect(canTransition('investigating', 'false_positive')).toBe(true);
    expect(canTransition('resolved', 'open')).toBe(false);
    expect(() => assertTransition('resolved', 'investigating')).toThrow(IllegalInvestigationTransitionError);
  });
  it('covers all statuses', () => { expect(INVESTIGATION_STATUSES.length).toBe(4); });
});

describe('Investigation entity', () => {
  it('resolve stamps resolvedAt + note; illegal throws', () => {
    const i = inv('investigating');
    const c = i.resolve('root caused: rounding job');
    expect(c).toEqual({ from: 'investigating', to: 'resolved' });
    expect(i.resolvedAt).toBeInstanceOf(Date);
    expect(i.resolutionNote).toContain('rounding');
    expect(() => inv('resolved').startInvestigating(null)).toThrow(IllegalInvestigationTransitionError);
  });
});

describe('applyFreeze guards', () => {
  it('freeze a not-frozen account → true; unfreeze a frozen one → false', () => {
    expect(applyFreeze(false, 'freeze')).toBe(true);
    expect(applyFreeze(true, 'unfreeze')).toBe(false);
  });
  it('rejects no-ops as 409', () => {
    expect(() => applyFreeze(true, 'freeze')).toThrow(InvalidFreezeStateError);
    expect(() => applyFreeze(false, 'unfreeze')).toThrow(InvalidFreezeStateError);
  });
});

describe('owner roles for recon', () => {
  it('platform_recon_ops manage+read; viewer read-only; tenant roles NOTHING', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_recon_ops']), OwnerPermissions.ReconManage)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_recon_viewer']), OwnerPermissions.ReconManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_recon_viewer']), OwnerPermissions.ReconRead)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['tenant_admin']), OwnerPermissions.ReconManage)).toBe(false);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_recon_ops']), OwnerPermissions.TenantManage)).toBe(false);
  });
});

describe('dto validation', () => {
  it('open-investigation requires a uuid run + summary, rejects unknown keys', () => {
    expect(OpenInvestigationSchema.safeParse({ runId: '11111111-1111-4111-8111-111111111111', summary: 'mismatch in hourly run' }).success).toBe(true);
    expect(OpenInvestigationSchema.safeParse({ runId: 'not-a-uuid', summary: 'x' }).success).toBe(false);
    expect(OpenInvestigationSchema.safeParse({ runId: '11111111-1111-4111-8111-111111111111', summary: 'ok ok', evil: 1 }).success).toBe(false);
  });
  it('freeze requires action + reason', () => {
    expect(FreezeAccountSchema.safeParse({ action: 'freeze', reason: 'suspected leak' }).success).toBe(true);
    expect(FreezeAccountSchema.safeParse({ action: 'nuke', reason: 'x' }).success).toBe(false);
  });
  it('query clamps limit', () => { expect(QueryRunsSchema.safeParse({ limit: 999 }).success).toBe(false); });
});

function harness() {
  const client = { __c: true };
  const pool = { withTx: async (fn: any) => fn(client) } as any;
  const audit = { write: jest.fn(async () => undefined) } as any;
  return { client, pool, audit };
}

describe('MismatchInvestigationsService', () => {
  it('open: 404 when the run is missing', async () => {
    const { pool, audit } = harness();
    const repo = { runExists: jest.fn(async () => false) } as any;
    await expect(new MismatchInvestigationsService(pool, audit, repo).open(actor, { runId: '11111111-1111-4111-8111-111111111111', severity: 'high', summary: 'mismatch found' })).rejects.toBeInstanceOf(ReconRunNotFoundError);
  });
  it('open: inserts + audits in-tx', async () => {
    const { pool, audit, client } = harness();
    const repo = { runExists: jest.fn(async () => true), insertInvestigation: jest.fn(async () => undefined) } as any;
    const out: any = await new MismatchInvestigationsService(pool, audit, repo).open(actor, { runId: '11111111-1111-4111-8111-111111111111', severity: 'high', summary: 'mismatch found' });
    expect(out.status).toBe('open');
    expect(repo.insertInvestigation).toHaveBeenCalledWith(client, expect.anything(), 'admin1');
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'recon.investigation_opened' }));
  });
  it('update: illegal transition throws + audits nothing', async () => {
    const { pool, audit } = harness();
    const repo = { getInvestigationForUpdate: jest.fn(async () => inv('resolved')), updateInvestigation: jest.fn() } as any;
    await expect(new MismatchInvestigationsService(pool, audit, repo).update(actor, 'i1', { action: 'start', note: 'reopen pls' })).rejects.toBeInstanceOf(IllegalInvestigationTransitionError);
    expect(audit.write).not.toHaveBeenCalled();
  });
  it('update: resolve audits old→new', async () => {
    const { pool, audit, client } = harness();
    const repo = { getInvestigationForUpdate: jest.fn(async () => inv('investigating')), updateInvestigation: jest.fn() } as any;
    await new MismatchInvestigationsService(pool, audit, repo).update(actor, 'i1', { action: 'resolve', note: 'fixed the rounding job' });
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'recon.investigation_resolved', oldValue: { status: 'investigating' } }));
  });
});

describe('LedgerFreezeControlsService', () => {
  it('404 when account missing', async () => {
    const { pool, audit } = harness();
    const repo = { getAccountForUpdate: jest.fn(async () => null) } as any;
    await expect(new LedgerFreezeControlsService(pool, audit, repo).setFreeze(actor, 'a1', { action: 'freeze', reason: 'leak' })).rejects.toBeInstanceOf(WalletAccountNotFoundError);
  });
  it('freeze: flips is_frozen via setFrozen + audits — never posts a ledger entry', async () => {
    const { pool, audit, client } = harness();
    const repo = { getAccountForUpdate: jest.fn(async () => ({ id: 'a1', ownerKind: 'user', accountCode: 'main', isFrozen: false })), setFrozen: jest.fn(async () => undefined) } as any;
    const out: any = await new LedgerFreezeControlsService(pool, audit, repo).setFreeze(actor, 'a1', { action: 'freeze', reason: 'suspected leak' });
    expect(out.isFrozen).toBe(true);
    expect(repo.setFrozen).toHaveBeenCalledWith(client, 'a1', true, 'suspected leak', 'admin1');
    expect(audit.write).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'wallet.account_frozen', newValue: { isFrozen: true } }));
    expect((repo as any).postLedgerEntry).toBeUndefined();   // no ledger-write path exists (Law 2/9)
  });
  it('double-freeze rejected as 409', async () => {
    const { pool, audit } = harness();
    const repo = { getAccountForUpdate: jest.fn(async () => ({ id: 'a1', ownerKind: 'user', accountCode: 'main', isFrozen: true })), setFrozen: jest.fn() } as any;
    await expect(new LedgerFreezeControlsService(pool, audit, repo).setFreeze(actor, 'a1', { action: 'freeze', reason: 'again' })).rejects.toBeInstanceOf(InvalidFreezeStateError);
    expect(repo.setFrozen).not.toHaveBeenCalled();
  });
});
