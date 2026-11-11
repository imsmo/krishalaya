// modules/schemes/__tests__/gov4a-visits-closed.spec.ts · PC-56 GOV-4a (GOV-4 Q2-A, lead-applied; the founder may reopen) — the organisation's
// field-visit schedule and submit are refused BY NAME (FIELD_VISITS_ARE_NOT_RECORDED_HERE, 403) for every caller — a scheme.process holder
// included — BEFORE anything is read or written: every collaborator below throws if touched. The kept read (the applicant's own) still answers.
import { FieldVerificationService } from '../services/field-verification.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

const touched: string[] = [];
const trap = (name: string) => new Proxy({}, { get: (_t, k) => (typeof k === 'string' && k !== 'then' ? (..._a: unknown[]) => { touched.push(`${name}.${k}`); throw new Error(`touched ${name}.${k}`); } : undefined) });
const officer = { userId: 'o1', canProcess: true };
const member = { userId: 'm1', canProcess: false };
const MESSAGE = 'Field visits are not scheduled or recorded on this platform.';

describe('PC-56 GOV-4a · the organisation\'s field-visit writes are closed by name', () => {
  beforeEach(() => { touched.length = 0; });
  const svc = () => new FieldVerificationService(trap('uow') as any, trap('repo') as any, trap('applications') as any);

  it.each([['a scheme.process holder', officer], ['any other member', member]] as const)('%s hears FIELD_VISITS_ARE_NOT_RECORDED_HERE on schedule and submit; nothing touched', async (_who, a) => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['schedule_visit', () => svc().schedule('t1', a, 'a1', '2026-11-12')],
      ['schedule_visit', () => svc().schedule('t1', a, 'a1')],
      ['submit_visit', () => svc().submit('t1', a, 'v1', { geotag: [{ mediaId: 'x', lat: 21.4, lng: 70.3, capturedAt: '2026-11-01T04:30:00Z' }], measuredValues: {} })],
      ['submit_visit', () => svc().submit('t1', a, 'v1', undefined)],
    ];
    for (const [act, call] of calls) {
      const e: any = await call().then(() => null, (x) => x);
      expect([act, e?.code, e?.httpStatus, e?.details?.act, e?.message]).toEqual([act, 'FIELD_VISITS_ARE_NOT_RECORDED_HERE', 403, act, MESSAGE]);
    }
    expect(touched).toEqual([]);
  });

  it('KEPT: the applicant\'s own read reads her application and its visits', async () => {
    const s = new FieldVerificationService(trap('uow') as any, { listForApplication: async () => [{ id: 'v1' }] } as any, { getById: async () => ({ applicantUserId: 'u1' }) } as any);
    expect(await s.list('t1', { userId: 'u1', canProcess: false }, 'a1')).toEqual([{ id: 'v1' }]);
    expect(touched).toEqual([]);
  });

  it('the controller asks no permission and no body shape on the two closed routes (they would hide the name); the kept read is untouched', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'v1', 'applications.controller.ts'), 'utf8');
    for (const route of [':id/field-visits', 'field-visits/:visitId/submit']) {
      const at = src.indexOf(`@Post('${route}')`);
      expect([route, at > 0]).toEqual([route, true]);
      const block = src.slice(at, src.indexOf('\n  @', at + 3));
      expect([route, /RequirePermissions|ZodBody|Idempotency-Key header required/.test(block)]).toEqual([route, false]);
    }
    expect(src).toMatch(/@Get\(':id\/field-visits'\)\n  listVisits\(/);
    expect(src).not.toMatch(/SubmitVisitSchema|ScheduleVisitSchema/);
  });

  it('the service holds no write path any more: no transaction, no repository write, no permission check', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'field-verification.service.ts'), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(src).not.toMatch(/uow\.run|repo\.(schedule|submit|getForUpdate)|canProcess\) throw new ForbiddenError/);
  });
});
