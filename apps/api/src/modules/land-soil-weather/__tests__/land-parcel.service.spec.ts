// modules/land-soil-weather/__tests__/land-parcel.service.spec.ts · LandParcelService unit tests (fakes).
// Pins: register quota-checks + drains parcel_registered to the outbox in-tx (Law 4); update is owner-only (authz THROWS).
import { LandParcelService } from '../services/land-parcel.service';
import { LandParcel } from '../domain/land-parcel.entity';
import { InvalidBoundaryError, LandForbiddenError, ParcelReasonRequiredError } from '../domain/land-soil-weather.errors';

function harness(existing: LandParcel | null) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() }; const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() }; const metrics = { inc: jest.fn(), observe: jest.fn() };
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(async () => existing), update: jest.fn(), getById: jest.fn(), listFor: jest.fn(), resolveIrrigationTypeId: jest.fn(async () => 'i1') };
  const audit = { write: jest.fn() };
  const svc = new LandParcelService(uow as any, outbox as any, idem as any, quota as any, metrics as any, repo as any, audit as any);
  return { svc, outbox, quota, audit, repo };
}
const farmer = { userId: 'u1', canManage: true, isAdmin: false };

describe('LandParcelService.register', () => {
  it('quota-checks + persists + emits parcel_registered', async () => {
    const { svc, outbox, quota } = harness(null);
    const out = await svc.register('t1', farmer, 'idem-1', { areaValue: '2.5000', areaUnit: 'acre', isTenantFarmed: false } as any);
    expect(quota.assertWithinLimit).toHaveBeenCalledWith('t1', 'land_parcels');
    expect(out.area).toBe('2.5000');
    expect(outbox.write.mock.calls[0][1].eventType).toBe('land.parcel_registered');
  });
  it('PC-56 TENANT-12 (F-11): audits the registration with actor, ip and the after state', async () => {
    const { svc, audit } = harness(null);
    await svc.register('t1', { ...farmer, ip: '10.1.1.1' }, 'idem-3', { areaValue: '1.5', areaUnit: 'acre', isTenantFarmed: false } as any);
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'land.parcel.registered', actorUserId: 'u1', ip: '10.1.1.1', oldValue: null, newValue: { area: '1.5000', boundary: null } });
  });
  it('PC-56 TENANT-12 (F-2): refuses `{}` as a boundary, by name — and a valid polygon is stored', async () => {
    const { svc, repo } = harness(null);
    await expect(svc.register('t1', farmer, 'idem-4', { areaValue: '1', areaUnit: 'acre', isTenantFarmed: false, boundaryGeojson: {} } as any)).rejects.toBeInstanceOf(InvalidBoundaryError);
    expect(repo.insert).not.toHaveBeenCalled();
    const poly = { type: 'Polygon', coordinates: [[[72.1, 21.1], [72.2, 21.1], [72.2, 21.2], [72.1, 21.1]]] };
    const out = await svc.register('t1', farmer, 'idem-5', { areaValue: '1', areaUnit: 'acre', isTenantFarmed: false, boundaryGeojson: poly } as any);
    expect(out.boundaryGeojson).toEqual(poly);
  });
  it('requires land.manage', async () => {
    const { svc } = harness(null);
    await expect(svc.register('t1', { ...farmer, canManage: false }, 'idem-2', { areaValue: '1', areaUnit: 'acre', isTenantFarmed: false } as any)).rejects.toBeInstanceOf(LandForbiddenError);
  });
});

describe('LandParcelService.update authz', () => {
  it('forbids editing another owner\'s parcel', async () => {
    const other = LandParcel.register({ id: 'p1', tenantId: 't1', ownerUserId: 'someone', regionId: null, surveyNo: null, bhulekhRef: null, areaTenThousandth: 10000n, areaUnit: 'acre', irrigationTypeId: null, boundaryGeojson: null, isTenantFarmed: false });
    const { svc } = harness(other);
    await expect(svc.update('t1', farmer, 'p1', { surveyNo: 'X' } as any)).rejects.toBeInstanceOf(LandForbiddenError);
  });
  it('PC-56 TENANT-12 (F-11): the land desk corrects another member\'s parcel ONLY with a reason, and the audit carries it', async () => {
    const other = LandParcel.register({ id: 'p1', tenantId: 't1', ownerUserId: 'someone', regionId: null, surveyNo: null, bhulekhRef: null, areaTenThousandth: 10000n, areaUnit: 'acre', irrigationTypeId: null, boundaryGeojson: null, isTenantFarmed: false });
    const { svc, audit } = harness(other);
    const desk = { userId: 'd1', canManage: false, isAdmin: true, ip: '10.2.2.2' };
    await expect(svc.update('t1', desk, 'p1', { surveyNo: 'X' } as any)).rejects.toBeInstanceOf(ParcelReasonRequiredError);
    await svc.update('t1', desk, 'p1', { surveyNo: 'X-12', reason: 'survey number from the 7/12 extract' } as any);
    expect(audit.write.mock.calls[0][1]).toMatchObject({ action: 'land.parcel.corrected_by_desk', actorUserId: 'd1', reason: 'survey number from the 7/12 extract', ip: '10.2.2.2',
      oldValue: { surveyNo: null }, newValue: { surveyNo: 'X-12', ownerUserId: 'someone' } });
  });
});
