// packages/sdk-js/src/test/gov4a-visits-closed.spec.ts · PC-56 GOV-4a (GOV-4 Q2-A) — the two closed tenant field-visit methods are @deprecated and
// surface the API's refusal by name (FIELD_VISITS_ARE_NOT_RECORDED_HERE) as an SdkError code; the applicant's own read (`fieldVisits`) is not
// deprecated.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '../client';
import { SdkError } from '../errors';

const CLOSED = ['scheduleFieldVisit', 'submitFieldVisit'];
const fakeFetch = (body: unknown, status: number) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('PC-56 GOV-4a · SDK — the tenant field-visit writes are closed by name', () => {
  it('both surface FIELD_VISITS_ARE_NOT_RECORDED_HERE (403) as an SdkError code', async () => {
    const fn = fakeFetch({ error: { code: 'FIELD_VISITS_ARE_NOT_RECORDED_HERE', message: 'Field visits are not scheduled or recorded on this platform.' } }, 403);
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 'tok' });
    for (const call of [() => c.schemes.scheduleFieldVisit('a1', '2026-11-12'), () => c.schemes.submitFieldVisit('v1', { geotag: [{ mediaId: '00000000-0000-7000-8000-000000000001', lat: 1, lng: 1, capturedAt: '2026-11-01T04:30:00Z' }] })]) {
      const e = await call().then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(SdkError);
      expect([(e as SdkError).code, (e as SdkError).status]).toEqual(['FIELD_VISITS_ARE_NOT_RECORDED_HERE', 403]);
    }
  });
  it('every closed method carries @deprecated naming the code; fieldVisits (the applicant\'s own read) does not', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'resources', 'schemes.ts'), 'utf8');
    for (const m of CLOSED) {
      const at = src.indexOf(`  async ${m}(`);
      const doc = src.slice(src.lastIndexOf('/**', at), at);
      expect([m, /@deprecated PC-56 GOV-4a/.test(doc) && /FIELD_VISITS_ARE_NOT_RECORDED_HERE/.test(doc)]).toEqual([m, true]);
    }
    const at = src.indexOf('  async fieldVisits(');
    expect(src.slice(src.lastIndexOf('}', at - 3), at)).not.toMatch(/@deprecated/);
  });
});
