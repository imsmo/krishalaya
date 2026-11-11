// modules/schemes/__tests__/gov3a-dbt-closed.spec.ts · PC-56 GOV-3a (GOV-3 Q2-A / Q4-A, lead-applied; the founder may reopen) — every tenant
// DBT act and read but the applicant's own is refused BY NAME (DBT_IS_NOT_RECORDED_HERE, 403) for every caller — a scheme.process holder
// included — BEFORE anything is read or written: every collaborator below throws if touched. The kept read (GET :id/dbt) still answers.
import { DbtTransferService } from '../services/dbt-transfer.service';
import { DbtBounceService } from '../services/dbt-bounce.service';
import { GovExportService } from '../services/gov-export.service';
import * as fs from 'node:fs';
import * as path from 'node:path';

const touched: string[] = [];
const trap = (name: string) => new Proxy({}, { get: (_t, k) => (typeof k === 'string' && k !== 'then' ? (..._a: unknown[]) => { touched.push(`${name}.${k}`); throw new Error(`touched ${name}.${k}`); } : undefined) });
const officer = { userId: 'o1', canApply: false, canProcess: true };
const member = { userId: 'm1', canApply: true, canProcess: false };

describe('PC-56 GOV-3a · the tenant DBT acts and reads are closed by name', () => {
  beforeEach(() => { touched.length = 0; });
  const dbt = () => new DbtTransferService(trap('uow') as any, trap('outbox') as any, trap('metrics') as any, trap('audit') as any, trap('repo') as any, trap('applications') as any);
  const bounces = () => new DbtBounceService(trap('uow') as any, trap('repo') as any, trap('audit') as any, trap('pfms') as any);
  const exp = () => new GovExportService(trap('uow') as any, trap('audit') as any, trap('dbt') as any);

  it.each([['a scheme.process holder', officer], ['any other member', member]] as const)('%s hears DBT_IS_NOT_RECORDED_HERE on all nine; nothing touched', async (_who, a) => {
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['record_credit', () => dbt().record('t1', a, 'a1', { amountMinor: '600000', creditedOn: '2026-07-10' } as any, null)],
      ['monitor', () => exp().monitor('t1', a)],
      ['recent', () => exp().recent('t1', a, 's1', 50)],
      ['export', () => exp().export('t1', a, null, { report: 'dbt_recent' })],
      ['record_return', () => bounces().record('t1', a, 'tr1', 'k1', { reasonCode: 'account_closed', bouncedOn: '2026-08-05' }, null)],
      ['resolve_return', () => bounces().resolve('t1', a, 'b1', { resolution: 'abandoned', note: 'x' }, null)],
      ['list_returns', () => bounces().list('t1', a, { limit: 10 })],
      ['application_returns', () => bounces().forApplication('t1', a, 'a1')],
      ['returns_desk', () => bounces().desk('t1', a)],
    ];
    for (const [act, call] of calls) {
      const e: any = await call().then(() => null, (x) => x);
      expect([act, e?.code, e?.httpStatus, e?.details?.act]).toEqual([act, 'DBT_IS_NOT_RECORDED_HERE', 403, act]);
      expect(e?.message).toBe('Payments and returned payments are not recorded on this platform. Benefits are paid by PFMS and the banks, outside this platform.');
    }
    expect(touched).toEqual([]);
  });

  it('the applicant\'s own read stays: listForApplication reads her application and its records', async () => {
    const app = { applicantUserId: 'u1' };
    const svc = new DbtTransferService(trap('uow') as any, trap('outbox') as any, trap('metrics') as any, trap('audit') as any,
      { listForApplication: async () => [{ toJSON: () => ({ id: 'd1' }) }] } as any, { getById: async () => app } as any);
    expect(await svc.listForApplication('t1', { userId: 'u1', canApply: true, canProcess: false }, 'a1')).toEqual([{ id: 'd1' }]);
  });

  it('the controller asks no permission, no Idempotency-Key and no body shape on the closed routes (they would hide the name); the kept read is untouched', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'v1', 'applications.controller.ts'), 'utf8');
    for (const [verb, route] of [['Post', ':id/dbt'], ['Get', 'dbt/monitor'], ['Get', 'dbt/recent'], ['Post', 'dbt/:transferId/bounce'], ['Post', 'dbt/bounces/:id/resolve'],
      ['Get', 'dbt/bounces'], ['Get', 'dbt/bounce-desk'], ['Get', ':id/dbt-bounces'], ['Post', 'exports']] as const) {
      const at = src.indexOf(`@${verb}('${route}')`);
      expect([route, at > 0]).toEqual([route, true]);
      const block = src.slice(at, src.indexOf('\n  @', at + 3) > 0 ? src.indexOf('\n  @', at + 3) : undefined);
      expect([route, /RequirePermissions|ZodBody|Idempotency-Key header required/.test(block)]).toEqual([route, false]);
    }
    expect(src).toMatch(/@Get\(':id\/dbt'\)\n  listDbt\(/);
  });
});
