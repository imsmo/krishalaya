// modules/schemes/__tests__/hotfix15-field-visits.spec.ts · PC-56 HOTFIX-15 (survey GOV-1 F-3 / C-11). A field visit carries the farm's
// GPS points, measurements and walk trace: read ONLY by the application's applicant or a `scheme.process` holder; anyone else — and an
// unknown id — the SAME 404 (`ApplicationNotFoundError`, as getById), and the refusal comes BEFORE any visit is read (spy-pinned).
import { FieldVerificationService } from '../services/field-verification.service';
import { ApplicationNotFoundError } from '../domain/schemes.errors';

function build(app: { applicantUserId: string } | null) {
  const order: string[] = [];
  const applications: any = { getById: jest.fn(async () => { order.push('applications.getById'); return app; }) };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const repo: any = { listForApplication: jest.fn(async () => { order.push('visits.listForApplication'); return [{ id: 'v1', geotag: [{ lat: 21.4, lng: 70.3 }] }]; }) };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const svc = new FieldVerificationService({} as never, repo, applications);
  return { svc, repo, applications, order };
}

describe('PC-56 HOTFIX-15 · field visits are the applicant\'s or a scheme.process holder\'s', () => {
  it('the applicant reads her own application\'s visits', async () => {
    const { svc, order } = build({ applicantUserId: 'farmer-a' });
    expect(await svc.list('t1', { userId: 'farmer-a', canProcess: false }, 'app-1')).toHaveLength(1);
    expect(order).toEqual(['applications.getById', 'visits.listForApplication']);
  });
  it('a scheme.process holder reads them', async () => {
    const { svc } = build({ applicantUserId: 'farmer-a' });
    expect(await svc.list('t1', { userId: 'officer', canProcess: true }, 'app-1')).toHaveLength(1);
  });
  it('another member → ApplicationNotFoundError (404), and NO visit is read', async () => {
    const { svc, repo } = build({ applicantUserId: 'farmer-a' });
    const e = await svc.list('t1', { userId: 'farmer-b', canProcess: false }, 'app-1').catch((x) => x);
    expect(e).toBeInstanceOf(ApplicationNotFoundError);
    expect(e).toMatchObject({ httpStatus: 404, code: 'SCHEME_APPLICATION_NOT_FOUND' });
    expect(repo.listForApplication).not.toHaveBeenCalled();
  });
  it('an unknown id → the same 404 (no existence oracle), for anyone', async () => {
    for (const canProcess of [false, true]) {
      const { svc, repo } = build(null);
      const e = await svc.list('t1', { userId: 'x', canProcess }, 'nope').catch((x) => x);
      expect(e).toBeInstanceOf(ApplicationNotFoundError);
      expect(repo.listForApplication).not.toHaveBeenCalled();
    }
  });
});
