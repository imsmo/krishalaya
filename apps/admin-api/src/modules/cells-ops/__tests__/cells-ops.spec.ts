// apps/admin-api/src/modules/cells-ops/__tests__/cells-ops.spec.ts · UNIT suite (pure / mocked). Proves the
// routing-directory invariants: node status state machine (Law 5), capacity + residency + accepts-placement
// guards (all fail CLOSED), code/name/index/weight/dsn validation, the dsn_secret_ref NEVER leaving the entity,
// owner-RBAC least-privilege (no escalation, no '*'), zod .strict DTOs, and the services' fail-closed routing +
// audit-in-tx behaviour (pool/repo/audit mocked).
import { NODE_STATUSES, canTransition, acceptsPlacement } from '../domain/node.state';
import { assertCellCode, assertName, assertCountry, assertShardIndex, assertWeight, hasRoom, sameResidency } from '../domain/routing';
import { Cell } from '../domain/cell.entity';
import { Shard } from '../domain/shard.entity';
import {
  InvalidCellsInputError, IllegalNodeTransitionError, CellsAlreadyInStateError, ResidencyViolationError,
  CapacityExceededError, NodeNotAcceptingError, NodeNotEmptyError, ShardCellMismatchError, AlreadyPlacedError,
  CellNotFoundError, ShardNotFoundError, PlacementNotFoundError,
} from '../domain/cells-ops.errors';
import { resolveOwnerPermissions, hasOwnerPermission, OwnerPermissions } from '../../../core/rbac/owner-roles';
import { CreateCellSchema, CreateShardSchema, PlaceTenantSchema, MoveTenantSchema, SetStatusSchema } from '../dto/cells-ops.dto';
import { CellRegistryService } from '../services/cell-registry.service';
import { TenantCellAssignmentService } from '../services/tenant-cell-assignment.service';

const cellProps = (o: Partial<any> = {}) => ({ id: 'c1', code: 'in-west-1', displayName: 'IN West', countryCode: 'IN', status: 'active', isDefault: false, residencyLocked: true, capacityTenants: null, placedCount: 0, notes: null, ...o });
const shardProps = (o: Partial<any> = {}) => ({ id: 's1', cellId: 'c1', shardIndex: 0, status: 'active', weight: 100, placedCount: 0, dsnSecretRef: null, notes: null, ...o });
const U = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`;

describe('node.state — status state machine (Law 5)', () => {
  it('valid transitions', () => {
    expect(canTransition('active', 'draining')).toBe(true);
    expect(canTransition('active', 'readonly')).toBe(true);
    expect(canTransition('readonly', 'active')).toBe(true);
    expect(canTransition('draining', 'retired')).toBe(true);
    expect(canTransition('draining', 'active')).toBe(true);
  });
  it('illegal transitions are rejected', () => {
    expect(canTransition('active', 'retired')).toBe(false);     // must drain first
    expect(canTransition('retired', 'active')).toBe(false);     // terminal
    expect(canTransition('readonly', 'retired')).toBe(false);
  });
  it('only active accepts placement (fail-closed routing)', () => {
    expect(acceptsPlacement('active')).toBe(true);
    for (const s of NODE_STATUSES.filter((x) => x !== 'active')) expect(acceptsPlacement(s)).toBe(false);
  });
});

describe('routing — validation + capacity + residency guards', () => {
  it('cell code / name / country', () => {
    expect(assertCellCode('in-west-1')).toBe('in-west-1');
    expect(() => assertCellCode('IN_WEST')).toThrow(InvalidCellsInputError);
    expect(assertCountry('in')).toBe('IN');
    expect(() => assertCountry('IND')).toThrow();
    expect(() => assertName('<b>x</b>')).toThrow();
  });
  it('shard index + weight bounds', () => {
    expect(assertShardIndex(0)).toBe(0);
    expect(() => assertShardIndex(-1)).toThrow();
    expect(assertWeight(100)).toBe(100);
    expect(() => assertWeight(99999)).toThrow();
  });
  it('capacity: NULL = unbounded, else placed < cap', () => {
    expect(hasRoom(5, null)).toBe(true);
    expect(hasRoom(4, 5)).toBe(true);
    expect(hasRoom(5, 5)).toBe(false);
  });
  it('residency: same country only', () => {
    expect(sameResidency('IN', 'IN')).toBe(true);
    expect(sameResidency('IN', 'BD')).toBe(false);
  });
});

describe('entities — status + meta + no-op + secret-safety', () => {
  it('Cell.changeStatus enforces the state machine + no-op', () => {
    const c = Cell.rehydrate(cellProps());
    expect(c.changeStatus('draining').new.status).toBe('draining');
    expect(() => c.changeStatus('draining')).toThrow(CellsAlreadyInStateError);
    expect(() => c.changeStatus('active')).not.toThrow();        // draining→active allowed
    const c2 = Cell.rehydrate(cellProps({ status: 'active' }));
    expect(() => c2.changeStatus('retired')).toThrow(IllegalNodeTransitionError);   // must drain first
  });
  it('Shard.toJSON NEVER leaks dsn_secret_ref (only hasDsn)', () => {
    const withDsn = Shard.rehydrate(shardProps({ dsnSecretRef: 'arn:aws:secretsmanager:...:shard-0' }));
    const json = withDsn.toJSON() as any;
    expect(json.hasDsn).toBe(true);
    expect(JSON.stringify(json)).not.toContain('arn:aws');
    expect((json as any).dsnSecretRef).toBeUndefined();
  });
  it('Shard.updateMeta rejects a raw connection string as dsn ref + masks it in the change', () => {
    const s = Shard.rehydrate(shardProps());
    expect(() => s.updateMeta({ dsnSecretRef: 'postgres://user:pass@host:5432/db' })).toThrow(InvalidCellsInputError);
    const ch = s.updateMeta({ dsnSecretRef: 'vault/shards/0' });
    expect(ch.new.dsnSecretRef).toBe('***');     // masked, never the value
  });
});

describe('owner RBAC — least privilege (Law 11, no escalation)', () => {
  it('cells roles grant exactly cells perms, never *', () => {
    const ops = resolveOwnerPermissions(['platform_cells_ops']);
    expect(ops.has(OwnerPermissions.CellsManage)).toBe(true);
    expect(ops.has(OwnerPermissions.CellsRead)).toBe(true);
    expect(ops.has('*')).toBe(false);
    const viewer = resolveOwnerPermissions(['platform_cells_viewer']);
    expect(viewer.has(OwnerPermissions.CellsRead)).toBe(true);
    expect(viewer.has(OwnerPermissions.CellsManage)).toBe(false);
  });
  it('unknown / tenant roles grant nothing here', () => { expect(resolveOwnerPermissions(['tenant_admin', 'owner']).size).toBe(0); });
  it('super_admin * passes; plain perms scoped', () => {
    expect(hasOwnerPermission(resolveOwnerPermissions(['super_admin']), OwnerPermissions.CellsManage)).toBe(true);
    expect(hasOwnerPermission(resolveOwnerPermissions(['platform_cells_viewer']), OwnerPermissions.CellsManage)).toBe(false);
  });
});

describe('DTO — zod .strict() validation', () => {
  it('rejects unknown keys', () => {
    expect(CreateCellSchema.safeParse({ code: 'in-west-1', displayName: 'X', countryCode: 'IN', reason: 'r', evil: 1 }).success).toBe(false);
  });
  it('cell/shard/placement happy paths + bad shapes', () => {
    expect(CreateCellSchema.safeParse({ code: 'in-west-1', displayName: 'IN West', countryCode: 'IN', reason: 'add' }).success).toBe(true);
    expect(CreateShardSchema.safeParse({ cellId: U(1), shardIndex: 0, reason: 'add' }).success).toBe(true);
    expect(PlaceTenantSchema.safeParse({ tenantId: U(2), cellId: U(1), shardId: U(3), reason: 'place' }).success).toBe(true);
    expect(MoveTenantSchema.safeParse({ cellId: U(1), shardId: U(3), reason: 'move' }).success).toBe(true);
    expect(SetStatusSchema.safeParse({ status: 'nope', reason: 'r' }).success).toBe(false);
    expect(CreateShardSchema.safeParse({ cellId: U(1), shardIndex: 0, dsnSecretRef: 'postgres://u:p@h/db', reason: 'r' }).success).toBe(false);   // raw DSN blocked by charset
  });
});

/* ---------------- services (pool/repo/audit mocked) ---------------- */
const actor = { userId: 'u1', roles: ['platform_cells_ops'], ip: '10.0.0.1', requestId: 'rq1' } as any;
function fakeTxPool() { const client = {}; return { withTx: jest.fn(async (fn: any) => fn(client)) } as any; }

describe('CellRegistryService — retire-empty guard + audit-in-tx', () => {
  it('createCell clears the prior default for the country + audits in tx', async () => {
    const pool = fakeTxPool(); const audit = { write: jest.fn() } as any;
    const repo = { cellCodeExists: jest.fn().mockResolvedValue(false), insertCell: jest.fn().mockResolvedValue({ id: 'c9', createdAt: new Date() }), clearDefaultForCountry: jest.fn(), insertChange: jest.fn() } as any;
    const svc = new CellRegistryService(pool, audit, repo);
    await svc.createCell(actor, { code: 'in-west-1', displayName: 'IN West', countryCode: 'IN', isDefault: true, residencyLocked: true, capacityTenants: null, notes: null, reason: 'add' } as any);
    expect(repo.clearDefaultForCountry).toHaveBeenCalledTimes(1);
    expect(repo.insertChange).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
  it('setCellStatus refuses to retire a non-empty cell', async () => {
    const pool = fakeTxPool();
    const repo = { getCellForUpdate: jest.fn().mockResolvedValue(Cell.rehydrate(cellProps({ status: 'draining', placedCount: 3 }))) } as any;
    const svc = new CellRegistryService(pool, { write: jest.fn() } as any, repo);
    await expect(svc.setCellStatus(actor, 'c1', { status: 'retired', reason: 'r' })).rejects.toBeInstanceOf(NodeNotEmptyError);
  });
  it('createShard 404s on unknown cell', async () => {
    const pool = fakeTxPool();
    const repo = { getCellForUpdate: jest.fn().mockResolvedValue(null) } as any;
    const svc = new CellRegistryService(pool, { write: jest.fn() } as any, repo);
    await expect(svc.createShard(actor, { cellId: U(1), shardIndex: 0, weight: 100, dsnSecretRef: null, notes: null, reason: 'r' } as any)).rejects.toBeInstanceOf(CellNotFoundError);
  });
});

describe('TenantCellAssignmentService — fail-closed routing', () => {
  const cell = Cell.rehydrate(cellProps());
  const shard = Shard.rehydrate(shardProps());

  // PC-56 ADMIN-8b: the service now takes a residency log. **THE REFUSAL IS RECORDED OUTSIDE THE TRANSACTION** that the
  // refusal itself aborts — recording it inside would roll the evidence back with the move, leaving W033's log
  // permanently empty no matter how often the boundary was tested.
  function residencyLogStub(over: any = {}) {
    return {
      // The refusal is rebuilt from FRESH reads, because the transaction that refused has rolled back. A stub carrying
      // only `recordViolation` records nothing — which is how this stub was first written, and the test said so.
      placementOf: jest.fn().mockResolvedValue({ cellId: 'c1', countryCode: 'IN' }),
      cellCountry: jest.fn().mockResolvedValue({ countryCode: 'BD', residencyLocked: true }),
      recordViolation: jest.fn().mockResolvedValue('v1'),
      ...over,
    } as any;
  }

  function repoWith(over: any = {}) {
    return {
      getPlacementForUpdate: jest.fn().mockResolvedValue(null),
      getCellForUpdate: jest.fn().mockResolvedValue(cell),
      getShardForUpdate: jest.fn().mockResolvedValue(shard),
      insertPlacement: jest.fn(), bumpCellPlaced: jest.fn(), bumpShardPlaced: jest.fn(), insertChange: jest.fn(),
      updatePlacement: jest.fn(), softDeletePlacement: jest.fn(),
      ...over,
    } as any;
  }

  it('place: happy path writes directory + bumps both counters + audit in tx', async () => {
    const pool = fakeTxPool(); const audit = { write: jest.fn() } as any;
    const repo = repoWith();
    const svc = new TenantCellAssignmentService(pool, audit, repo, residencyLogStub());
    await svc.place(actor, { tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false, reason: 'onboard' } as any);
    expect(repo.insertPlacement).toHaveBeenCalledTimes(1);
    expect(repo.bumpCellPlaced).toHaveBeenCalledWith(expect.anything(), 'c1', +1, 'u1');
    expect(repo.bumpShardPlaced).toHaveBeenCalledWith(expect.anything(), 's1', +1, 'u1');
    expect(audit.write).toHaveBeenCalledTimes(1);
  });
  it('place: already placed → 409', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getPlacementForUpdate: jest.fn().mockResolvedValue({ tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false }) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.place(actor, { tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false, reason: 'r' } as any)).rejects.toBeInstanceOf(AlreadyPlacedError);
  });
  it('place: shard not in target cell → 422', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getShardForUpdate: jest.fn().mockResolvedValue(Shard.rehydrate(shardProps({ cellId: 'OTHER' }))) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.place(actor, { tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false, reason: 'r' } as any)).rejects.toBeInstanceOf(ShardCellMismatchError);
  });
  it('place: non-active cell refuses (fail-closed)', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getCellForUpdate: jest.fn().mockResolvedValue(Cell.rehydrate(cellProps({ status: 'draining' }))) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.place(actor, { tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false, reason: 'r' } as any)).rejects.toBeInstanceOf(NodeNotAcceptingError);
  });
  it('place: cell at capacity → 409', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getCellForUpdate: jest.fn().mockResolvedValue(Cell.rehydrate(cellProps({ capacityTenants: 2, placedCount: 2 }))) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.place(actor, { tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false, reason: 'r' } as any)).rejects.toBeInstanceOf(CapacityExceededError);
  });
  it('move: cross-residency blocked when a cell is residency-locked (DPDP)', async () => {
    const pool = fakeTxPool();
    const fromCell = Cell.rehydrate(cellProps({ id: 'c1', countryCode: 'IN', residencyLocked: true }));
    const toCell = Cell.rehydrate(cellProps({ id: 'c2', code: 'bd-east-1', countryCode: 'BD', residencyLocked: true }));
    const toShard = Shard.rehydrate(shardProps({ id: 's2', cellId: 'c2' }));
    const repo = repoWith({
      getPlacementForUpdate: jest.fn().mockResolvedValue({ tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false }),
      getCellForUpdate: jest.fn().mockImplementation((_c: any, id: string) => Promise.resolve(id === 'c1' ? fromCell : toCell)),
      getShardForUpdate: jest.fn().mockResolvedValue(toShard),
    });
    const residencyLog = residencyLogStub();
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLog);
    await expect(svc.move(actor, U(2), { cellId: 'c2', shardId: 's2', reason: 'r' } as any)).rejects.toBeInstanceOf(ResidencyViolationError);
    // **A FAIL-CLOSED BOUNDARY THAT LEAVES NO TRACE WHEN TESTED IS A BOUNDARY NOBODY CAN PROVE HELD** (PC-56 ADMIN-8b).
    // Until 0117 this refusal vanished, and W033's "this log fills automatically if the boundary is ever tested" would
    // have read identically after a hundred blocked attempts.
    expect(residencyLog.recordViolation).toHaveBeenCalledTimes(1);
    const v = residencyLog.recordViolation.mock.calls[0][0];
    expect(v).toMatchObject({ refusedBy: 'residency_lock', outcome: 'blocked', fromCountry: 'IN', toCountry: 'BD' });
  });
  it('move: a broken residency log never masks the refusal', async () => {
    // The evidence write is best-effort BY DESIGN. A logging failure that turned a blocked cross-border move into a 500
    // would be worse than a missing row, and one that swallowed the refusal would be catastrophic — so the refusal must
    // still surface unchanged.
    const pool = fakeTxPool();
    const fromCell = Cell.rehydrate(cellProps({ id: 'c1', countryCode: 'IN', residencyLocked: true }));
    const toCell = Cell.rehydrate(cellProps({ id: 'c2', code: 'bd-east-1', countryCode: 'BD', residencyLocked: true }));
    const repo = repoWith({
      getPlacementForUpdate: jest.fn().mockResolvedValue({ tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false }),
      getCellForUpdate: jest.fn().mockImplementation((_c: any, id: string) => Promise.resolve(id === 'c1' ? fromCell : toCell)),
      getShardForUpdate: jest.fn().mockResolvedValue(Shard.rehydrate(shardProps({ id: 's2', cellId: 'c2' }))),
    });
    const brokenLog = residencyLogStub({ recordViolation: jest.fn().mockRejectedValue(new Error('log is down')) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, brokenLog);
    await expect(svc.move(actor, U(2), { cellId: 'c2', shardId: 's2', reason: 'r' } as any))
      .rejects.toBeInstanceOf(ResidencyViolationError);
  });
  it('move: same cell+shard is a no-op → 409', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getPlacementForUpdate: jest.fn().mockResolvedValue({ tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false }) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.move(actor, U(2), { cellId: 'c1', shardId: 's1', reason: 'r' } as any)).rejects.toBeInstanceOf(CellsAlreadyInStateError);
  });
  it('move / get: unknown placement → 404', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({ getPlacementForUpdate: jest.fn().mockResolvedValue(null), getPlacement: jest.fn().mockResolvedValue(null) });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.move(actor, U(9), { cellId: 'c1', shardId: 's1', reason: 'r' } as any)).rejects.toBeInstanceOf(PlacementNotFoundError);
    await expect(svc.getPlacement(U(9))).rejects.toBeInstanceOf(PlacementNotFoundError);
  });
  it('move: unknown target shard → 404', async () => {
    const pool = fakeTxPool();
    const repo = repoWith({
      getPlacementForUpdate: jest.fn().mockResolvedValue({ tenantId: U(2), cellId: 'c1', shardId: 's1', pinned: false }),
      getShardForUpdate: jest.fn().mockResolvedValue(null),
    });
    const svc = new TenantCellAssignmentService(pool, { write: jest.fn() } as any, repo, residencyLogStub());
    await expect(svc.move(actor, U(2), { cellId: 'c1', shardId: 'sX', reason: 'r' } as any)).rejects.toBeInstanceOf(ShardNotFoundError);
  });
});
