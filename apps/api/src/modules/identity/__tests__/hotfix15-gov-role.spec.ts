// modules/identity/__tests__/hotfix15-gov-role.spec.ts · PC-56 HOTFIX-15 · the tenant gov_officer is FROZEN (GOV-1 Q2-A, lead-applied
// 2026-11-10). Spy-pinned ORDER (survey GOV-1 E14): the refusal comes after the permission and key checks and BEFORE `idem.remember`
// (assign) and BEFORE the unit of work (assign and approve) — a refused act writes no idempotency record and opens no transaction.
// The database wall (0238 trg_utr_no_gov_role) is proved live in src/__tests__/hotfix15-gov-reader.integration.spec.ts.
import 'reflect-metadata';
import { UserTenantRoleService } from '../services/user-tenant-role.service';
import { RolesController } from '../controllers/v1/roles.controller';
import { Role } from '../domain/role.entity';
import { SWC_CODES, SwcRefusedError, namedSwcRefusal } from '../domain/swc.errors';
import { FROZEN_GOV_ROLE_CODE, GOV_ROLE_REFUSAL, isFrozenGovRole, refuseFrozenGovRole } from '../domain/gov-role';
import type { RequestContext } from '../../../core/tenancy-context/request-context';

const govRole = new Role({ id: 'r-gov', code: 'gov_officer', defaultName: 'Government Officer / Scheme Operator', scope: 'tenant', requiresKyc: true, requiresApproval: true, moduleCode: 'M17', isActive: true });

function build(roleCodeOfRow: string | null = 'gov_officer') {
  const order: string[] = [];
  const uow: any = { run: jest.fn(async () => { order.push('uow.run'); return 'x'; }) };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const roles: any = { findByCode: jest.fn(async () => { order.push('roles.findByCode'); return govRole; }) };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const noop: any = { write: jest.fn(), invalidate: jest.fn() };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const utr: any = { roleCodeOf: jest.fn(async () => { order.push('utr.roleCodeOf'); return roleCodeOfRow; }), getForUpdate: jest.fn() };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const planUsage = { assertMemberSeatAvailable: jest.fn() } as any;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const svc = new UserTenantRoleService(uow, noop, noop, noop, utr, roles, {} as never, planUsage);
  const idem: any = { remember: jest.fn(async (_k: string, _u: string, _s: string, fn: () => Promise<unknown>) => { order.push('idem.remember'); return fn(); }) };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const ctrl = new RolesController({} as never, {} as never, svc, idem);
  return { svc, ctrl, idem, uow, roles, utr, order };
}
const ctx = { tenantId: 't1', userId: 'admin-1', permissions: new Set(['user.approve']) } as unknown as RequestContext;
const req = { ip: '127.0.0.1', headers: {} } as never;
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e as { code?: string }).code ?? String(e));

describe('PC-56 HOTFIX-15 · the tenant gov_officer is frozen (service + controller order)', () => {
  it('the refusal is a named SWC code (409, a sentence of facts) and the trigger text maps onto it', () => {
    expect(SWC_CODES[GOV_ROLE_REFUSAL]).toEqual({ status: 409, message: 'The government officer role cannot be given or approved inside an organisation. Nothing was changed.' });
    expect(FROZEN_GOV_ROLE_CODE).toBe('gov_officer');
    expect([isFrozenGovRole('gov_officer'), isFrozenGovRole('farmer'), isFrozenGovRole(null)]).toEqual([true, false, false]);
    expect(() => refuseFrozenGovRole('farmer')).not.toThrow();
    const e = namedSwcRefusal(Object.assign(new Error('[GOV_ROLE_LIVES_IN_AN_AUTHORITY] the government officer role is not given or approved inside an organisation — PC-56 HOTFIX-15 (0238)'), { code: '23514' }));
    expect(e).toBeInstanceOf(SwcRefusedError);
    expect(e).toMatchObject({ code: GOV_ROLE_REFUSAL, httpStatus: 409 });
  });

  it('POST /v1/rbac/assignments {gov_officer}: refused BEFORE idem.remember — no idempotency record, no role read, no unit of work', async () => {
    const { ctrl, idem, uow, roles, order } = build();
    expect(await codeOf(ctrl.assign(ctx, req, 'key-1', { userId: 'u-1', roleCode: 'gov_officer' } as never))).toBe(GOV_ROLE_REFUSAL);
    expect(idem.remember).not.toHaveBeenCalled();
    expect(roles.findByCode).not.toHaveBeenCalled();
    expect(uow.run).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('…and the key check still comes first: no key → 400, not the gov refusal (permission and key, then the refusal)', async () => {
    const { ctrl, idem } = build();
    await expect(ctrl.assign(ctx, req, '', { userId: 'u-1', roleCode: 'gov_officer' } as never)).rejects.toMatchObject({ httpStatus: 400 });
    expect(idem.remember).not.toHaveBeenCalled();
  });

  it('another role still goes through idem.remember → the service (the refusal is narrow)', async () => {
    const { ctrl, order, roles } = build();
    roles.findByCode.mockImplementation(async () => { order.push('roles.findByCode'); return new Role({ id: 'r-f', code: 'farmer', defaultName: 'Farmer', scope: 'tenant', requiresKyc: true, requiresApproval: false, moduleCode: null, isActive: true }); });
    await ctrl.assign(ctx, req, 'key-2', { userId: 'u-1', roleCode: 'farmer' } as never).catch(() => undefined);
    expect(order.slice(0, 3)).toEqual(['idem.remember', 'roles.findByCode', 'uow.run']);
  });

  it('the service alone (any other caller): assign {gov_officer} refused before any read or the unit of work', async () => {
    const { svc, uow, roles } = build();
    expect(await codeOf(svc.assign('t1', 'admin-1', { userId: 'u-1', roleCode: 'gov_officer' } as never, null))).toBe(GOV_ROLE_REFUSAL);
    expect(roles.findByCode).not.toHaveBeenCalled();
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('POST /v1/rbac/assignments/:id/approve on a gov_officer row: refused after reading its role, BEFORE the unit of work', async () => {
    const { ctrl, uow, order } = build('gov_officer');
    expect(await codeOf(ctrl.approve(ctx, req, 'utr-1'))).toBe(GOV_ROLE_REFUSAL);
    expect(order).toEqual(['utr.roleCodeOf']);
    expect(uow.run).not.toHaveBeenCalled();
  });

  it('approving any other row reaches the unit of work (the read first, then the transaction)', async () => {
    const { svc, order } = build('farmer');
    await svc.approve('t1', 'admin-1', 'utr-2', null).catch(() => undefined);
    expect(order).toEqual(['utr.roleCodeOf', 'uow.run']);
  });
});
