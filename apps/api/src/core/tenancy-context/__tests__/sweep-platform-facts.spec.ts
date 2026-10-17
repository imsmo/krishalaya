// core/tenancy-context/__tests__/sweep-platform-facts.spec.ts · PC-56 STORE-SWEEP-a · B3 (founder D3 / D7, migration 0223) — the platform facts
// read, mocked half (the live half is src/__tests__/sweep-platform-facts.integration.spec.ts).
//   • AN EMPTY VALUE IS "NOT PUBLISHED YET": "" (the seeded default), a blank string, JSON null, a non-string where text belongs, and a figure
//     that is not a whole number ≥ 1 all answer null — never "" and never an invented value (mutant M5 answers "" for an empty value → red);
//   • a set value is answered trimmed; the shape is { legal, grievance, contact } with exactly the eleven facts;
//   • ONE query, the key list is this file's constant (eleven `platform.*` keys through kv_platform_setting) — never a parameter;
//   • the route is `@Public()` and rate-limited like `stats`.
import 'reflect-metadata';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator';
import { RATE_LIMIT_KEY } from '../../http/rate-limit.guard';
import { StorefrontPublicController } from '../storefront-public.controller';
import { PLATFORM_FACT_KEYS, StorefrontPublicReadModel, factCount, factText, platformFactsOf } from '../storefront-public.read-model';

function readModel(values: Record<string, unknown>) {
  const query = jest.fn(async (_sql: string, params?: unknown[]) => ({
    rows: ((params?.[0] as string[]) ?? []).filter((k) => k in values).map((k) => ({ key: k, value: values[k] })),
  }));
  return { rm: new StorefrontPublicReadModel({ replica: () => ({ query }) } as never), query };
}
const SEEDED: Record<string, unknown> = Object.fromEntries(Object.values(PLATFORM_FACT_KEYS).map((k) => [k, /ack_hours|resolve_days/.test(k) ? null : '']));

describe('STORE-SWEEP-a · B3 — the platform facts read', () => {
  it('the eleven keys, all platform.legal / platform.grievance / platform.contact', () => {
    const keys = Object.values(PLATFORM_FACT_KEYS);
    expect(keys).toHaveLength(11);
    expect(new Set(keys).size).toBe(11);
    for (const k of keys) expect(k).toMatch(/^platform\.(legal|grievance|contact)\.[a-z_]+$/);
  });

  it('the seeded defaults ("" and null) answer ALL null — not published yet, never an empty string', async () => {
    const { rm } = readModel(SEEDED);
    const f = await rm.platformFacts();
    expect(f).toEqual({
      legal: { entityName: null, registeredOffice: null },
      grievance: { officerName: null, address: null, email: null, ackHours: null, resolveDays: null },
      contact: { securityEmail: null, partnersEmail: null, pressEmail: null, generalEmail: null },
    });
    expect(JSON.stringify(f)).not.toContain('""');
  });

  it('a set value is answered (trimmed); figures only as whole numbers ≥ 1', async () => {
    const { rm } = readModel({ ...SEEDED, [PLATFORM_FACT_KEYS.grievanceEmail]: '  grievance@example.test ', [PLATFORM_FACT_KEYS.ackHours]: 48, [PLATFORM_FACT_KEYS.resolveDays]: 30 });
    const f = await rm.platformFacts();
    expect(f.grievance.email).toBe('grievance@example.test');
    expect(f.grievance.ackHours).toBe(48);
    expect(f.grievance.resolveDays).toBe(30);
    expect(f.contact.pressEmail).toBeNull();
  });

  it('every empty shape is null: blank, non-string, a missing key; figures 0, negative, fractional, text', () => {
    for (const raw of ['', '   ', null, undefined, 7, true, {}, []]) expect(factText(raw)).toBeNull();
    expect(factText('x'.repeat(4001))).toBeNull();
    expect(factText(' Office, one line ')).toBe('Office, one line');
    for (const raw of [0, -1, 1.5, '48', null, undefined, Number.NaN]) expect(factCount(raw)).toBeNull();
    expect(factCount(1)).toBe(1);
    expect(platformFactsOf(new Map()).contact.generalEmail).toBeNull();
  });

  it('ONE query, the constant key list through kv_platform_setting — no other setting can be asked for', async () => {
    const { rm, query } = readModel(SEEDED);
    await rm.platformFacts();
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('kv_platform_setting(k.key)');
    expect(query.mock.calls[0][1]).toEqual([Object.values(PLATFORM_FACT_KEYS)]);
  });

  it('the controller answers { data } and the route carries @Public + the stats family rate limit', async () => {
    const { rm } = readModel(SEEDED);
    const c = new StorefrontPublicController(rm, {} as never);
    const r = await c.platformFacts();
    expect(r.data.grievance.email).toBeNull();
    const fn = StorefrontPublicController.prototype.platformFacts;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, fn)).toEqual(Reflect.getMetadata(RATE_LIMIT_KEY, StorefrontPublicController.prototype.stats));
  });
});
