// modules/traceability/__tests__/trace-meta.spec.ts · PC-56 HOTFIX-7 · B10 / B15 — THE ALLOW-LIST LIVES ONCE, AND THE DATABASE AGREES WITH IT.
//   (1) PARITY: migration 0217's `trace_scan_v2` CASE (one `WHEN '<step>' THEN ARRAY[…]` per step) equals `TRACE_META_ALLOW` — a key added on
//       one side only fails here; every step of TRACE_STEPS has a line;
//   (2) no step allow-lists a person / phone / coordinate / address / note / uuid key;
//   (3) the author's door: a key outside the step's list → refused; a phone-shaped value → refused; a well-formed meta → accepted;
//   (4) the public answer: `publicMeta` keeps the step's keys whose VALUE passes, drops the rest; `toPublic` strips the tenant id.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TRACE_META_ALLOW, TRACE_META_NEVER, publicMeta } from '../domain/trace-meta';
import { TRACE_STEPS } from '../domain/traceability.events';
import { AppendEventSchema } from '../dto/create-trace-event.dto';
import { toPublic } from '../services/public-scan.service';

const SQL = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0217_hotfix7_trust_money_doors.sql'), 'utf8');

describe('PC-56 HOTFIX-7 · trace-meta', () => {
  it('(1) PARITY — the SQL arrays in 0217 equal the TypeScript allow-list, step by step', () => {
    const sql: Record<string, string[]> = {};
    for (const m of SQL.matchAll(/WHEN '([a-z_]+)'\s+THEN ARRAY\[([^\]]*)\]::text\[\]/g)) sql[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(Object.keys(sql).sort()).toEqual([...TRACE_STEPS].sort());
    for (const step of TRACE_STEPS) expect([step, sql[step]]).toEqual([step, [...TRACE_META_ALLOW[step]]]);
  });
  it('(2) no step allow-lists a person, a phone, a coordinate, an address, a note or a uuid', () => {
    for (const step of TRACE_STEPS) for (const k of TRACE_META_ALLOW[step]) expect([step, k, TRACE_META_NEVER.includes(k)]).toEqual([step, k, false]);
  });
  it('(3) the author\'s door: unknown key → refused; a phone in a variety → refused; a well-formed meta → accepted', () => {
    expect(AppendEventSchema.safeParse({ eventCode: 'harvested', meta: { phone: '9898012742' } }).success).toBe(false);
    expect(AppendEventSchema.safeParse({ eventCode: 'harvested', meta: { lat: 21.5 } }).success).toBe(false);
    expect(AppendEventSchema.safeParse({ eventCode: 'harvested', meta: { variety: 'GG-20 call 9898012742' } }).success).toBe(false);
    expect(AppendEventSchema.safeParse({ eventCode: 'in_transit', meta: { quantity: 25 } }).success).toBe(false);   // not this step's key
    expect(AppendEventSchema.safeParse({ eventCode: 'nonsense', meta: {} }).success).toBe(false);
    const ok = AppendEventSchema.safeParse({ eventCode: 'harvested', meta: { variety: 'GG-20', season: 'Summer 2026', quantity: 25, unit: 'quintal' } });
    expect(ok.success).toBe(true);
    expect(AppendEventSchema.safeParse({ eventCode: 'packed' }).success).toBe(true);   // meta defaults to {}
  });
  it('(4) the public answer re-judges values per key and never carries the tenant id', () => {
    expect(publicMeta('harvested', { variety: 'GG-20', phone: '9898012742', gps: '21.5,70.1', quantity: 25, unit: 'Quintal!!' })).toEqual({ variety: 'GG-20', quantity: 25 });
    expect(publicMeta('harvested', { variety: 'call 9898012742' })).toEqual({});
    expect(publicMeta('unknown_step', { variety: 'x' })).toEqual({});
    expect(publicMeta('sold', ['not', 'an', 'object'])).toEqual({});
    const p = toPublic({ qrToken: 'QR', tenantId: '0217f000-0000-7000-8000-000000000001', organisation: { displayName: 'Anand FPO' }, createdAt: '2026-10-17T00:00:00Z', anchored: false,
      events: [{ eventCode: 'harvested', at: '2026-10-17T00:00:00Z', meta: { variety: 'GG-20', farmerName: 'Ramesh' } }] });
    expect(p).not.toHaveProperty('tenantId');
    expect(p.organisation.displayName).toBe('Anand FPO');
    expect(p.events[0].meta).toEqual({ variety: 'GG-20' });
    expect(JSON.stringify(p)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
