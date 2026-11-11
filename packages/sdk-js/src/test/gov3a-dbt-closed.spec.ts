// packages/sdk-js/src/test/gov3a-dbt-closed.spec.ts · PC-56 GOV-3a (GOV-3 Q2-A) — the nine closed tenant DBT methods are @deprecated and surface
// the API's refusal by name (DBT_IS_NOT_RECORDED_HERE) as an SdkError code; the applicant's own read (`dbtTransfers`) is not deprecated.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '../client';
import { SdkError } from '../errors';

const CLOSED = ['recordDbt', 'dbtMonitor', 'dbtRecent', 'exportReport', 'recordDbtBounce', 'resolveDbtBounce', 'dbtBounces', 'dbtBounceDesk', 'applicationDbtBounces'];
function fakeFetch(body: unknown, status = 200) {
  const fn = (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  return { fn };
}

describe('PC-56 GOV-3a · SDK — the tenant DBT methods are closed by name', () => {
  it('each of the nine surfaces DBT_IS_NOT_RECORDED_HERE (403) as an SdkError code', async () => {
    const { fn } = fakeFetch({ error: { code: 'DBT_IS_NOT_RECORDED_HERE', message: 'Payments and returned payments are not recorded on this platform. Benefits are paid by PFMS and the banks, outside this platform.' } }, 403);
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 'tok' });
    const calls: Array<() => Promise<unknown>> = [
      () => c.schemes.recordDbt('a1', { amountMinor: '1', creditedOn: '2026-07-10' }), () => c.schemes.dbtMonitor(), () => c.schemes.dbtRecent(),
      () => c.schemes.exportReport({ report: 'dbt_monitor' }), () => c.schemes.recordDbtBounce('t1', { reasonCode: 'other', bouncedOn: '2026-08-05' }, 'k1'),
      () => c.schemes.resolveDbtBounce('b1', { resolution: 'abandoned', note: 'n' }), () => c.schemes.dbtBounces(), () => c.schemes.dbtBounceDesk(),
      () => c.schemes.applicationDbtBounces('a1'),
    ];
    for (const call of calls) {
      const e = await call().then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(SdkError);
      expect([(e as SdkError).code, (e as SdkError).status]).toEqual(['DBT_IS_NOT_RECORDED_HERE', 403]);
    }
  });
  it('every closed method carries @deprecated naming the code; dbtTransfers (the applicant\'s own read) does not', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'resources', 'schemes.ts'), 'utf8');
    for (const m of CLOSED) {
      const at = src.indexOf(`  async ${m}(`);
      const doc = src.slice(src.lastIndexOf('/**', at), at);
      expect([m, /@deprecated PC-56 GOV-3a/.test(doc) && /DBT_IS_NOT_RECORDED_HERE/.test(doc)]).toEqual([m, true]);
    }
    const at = src.indexOf('  async dbtTransfers(');
    expect(src.slice(at - 200, at)).not.toMatch(/@deprecated/);
  });
});
