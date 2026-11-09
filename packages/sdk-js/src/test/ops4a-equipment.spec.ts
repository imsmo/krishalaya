// @krishalaya/sdk-js · PC-56 OPS-4a · OPS4-B5 / E1 — THE SDK EQUIPMENT CONTRACT (survey C-13). Pinned against the API's own sources:
//   • `EquipmentAsset`, `EquipmentRate`, `EquipmentRental` carry EXACTLY the field names of the entities' `toJSON` (read from
//     apps/api/src/modules/equipment/domain/*.entity.ts) — no `defaultName`, no `quantity` / `unitCode` / `assetName`; HOTFIX-13's
//     `usageConfirmedAt` included;
//   • `rates(assetId)` sends `?assetId=` (the strict `QueryRatesSchema` requires it);
//   • `rentals({ box })` sends `box` and REFUSES a call without one (the API's default is `renter`); no `assetId` (no such filter);
//   • `cancelRental` is Idempotency-Keyed (OPS-4a E10).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => { calls.push({ url: String(url), init: init ?? {} }); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any; }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (body: unknown = { data: [], meta: { nextCursor: null } }) => { const f = fakeFetch(body); return { c: createClient({ baseUrl: 'https://api.test', fetchImpl: f.fn, getToken: () => 'tok', retries: 0 }), calls: f.calls }; };

const API = path.join(__dirname, '..', '..', '..', '..', 'apps', 'api', 'src', 'modules', 'equipment', 'domain');
const SDK = fs.readFileSync(path.join(__dirname, '..', 'resources', 'equipment.ts'), 'utf8');
/** The keys of an entity's `toJSON() { … return { a: …, b: …, … }; }` — every `name:` at the top level of the returned object literal. */
function toJsonKeys(file: string): string[] {
  const src = fs.readFileSync(path.join(API, file), 'utf8');
  const body = src.slice(src.indexOf('toJSON()'));
  const obj = body.slice(body.indexOf('return {') + 'return {'.length);
  const keys: string[] = []; let depth = 0; let token = '';
  for (let i = 0; i < obj.length; i++) {
    const ch = obj[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === '/' && obj[i + 1] === '/') { while (i < obj.length && obj[i] !== '\n') i++; token = ''; continue; }
    if (depth === 0 && ch === ':' ) { const m = /([A-Za-z_]\w*)\s*$/.exec(token); if (m) keys.push(m[1]); token = ''; continue; }
    if (depth === 0 && ch === ',') { token = ''; continue; }
    token += ch;
  }
  return keys.sort();
}
/** The field names of an SDK interface. */
function sdkKeys(name: string): string[] {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(SDK);
  if (!m) throw new Error(`no interface ${name}`);
  const body = m[1].replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return Array.from(body.matchAll(/([A-Za-z_]\w*)\??\s*:/g)).map((x) => x[1]).sort();
}

describe('PC-56 OPS-4a · E1 · the SDK equipment types ARE the API entities\' toJSON', () => {
  it.each([['EquipmentAsset', 'equipment-asset.entity.ts'], ['EquipmentRate', 'equipment-rate.entity.ts'], ['EquipmentRental', 'equipment-booking.entity.ts']])(
    '%s = %s toJSON, field for field', (iface, file) => {
      const api = toJsonKeys(file);
      expect(api.length).toBeGreaterThan(5);
      expect(sdkKeys(iface)).toEqual(api);
    });
  it('the drifted fields are gone and HOTFIX-13\'s confirmation is there', () => {
    expect(sdkKeys('EquipmentAsset')).not.toContain('defaultName');
    for (const k of ['quantity', 'unitCode', 'assetName']) expect(sdkKeys('EquipmentRental')).not.toContain(k);
    expect(sdkKeys('EquipmentRental')).toContain('usageConfirmedAt');
    expect(sdkKeys('EquipmentRate')).not.toContain('unitCode');
  });
});

describe('PC-56 OPS-4a · E1 · the calls speak the API', () => {
  it('rates(assetId) sends ?assetId= (the strict query requires it)', async () => {
    const { c, calls } = client({ data: [] });
    await c.equipment.rates('a1');
    const u = new URL(calls[0].url);
    expect([u.pathname, u.searchParams.get('assetId')]).toEqual(['/v1/equipment/assets/a1/rates', 'a1']);
  });
  it('rentals({ box }) sends box; never an assetId; refused WITHOUT a box (the API would answer her renter list)', async () => {
    const { c, calls } = client();
    await c.equipment.rentals({ box: 'owner', status: 'completed' });
    const u = new URL(calls[0].url);
    expect([u.searchParams.get('box'), u.searchParams.get('status'), u.searchParams.has('assetId')]).toEqual(['owner', 'completed', false]);
    await expect(c.equipment.rentals({} as never)).rejects.toThrow(/box is required/);
    await expect((c.equipment.rentals as unknown as () => Promise<unknown>)()).rejects.toThrow(/box is required/);
    expect(calls.length).toBe(1);
  });
  it('cancelRental is Idempotency-Keyed and sends only a reason', async () => {
    const { c, calls } = client({ data: { id: 'r1', status: 'cancelled' } });
    await c.equipment.cancelRental('r1', 'idem-x', 'weather');
    expect(calls[0].url).toBe('https://api.test/v1/equipment/rentals/r1/cancel');
    expect((calls[0].init.headers as Record<string, string>)['idempotency-key']).toBe('idem-x');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ reason: 'weather' });
    await c.equipment.cancelRental('r1', 'idem-y');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({});
  });
});
