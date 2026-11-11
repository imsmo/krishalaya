import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_STATUS_KEYS, planStatusLabel } from '../features/console/home';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';
// apps/web-tenant/src/test/rtl1g-plan-status.spec.ts · PC-56 RTL-1g (owed since RTL-1b-2/1b-3) — /dashboard printed the raw
// `planHealth.status` code ("past_due") in every language. The SDK types it `string | null`; the values are the
// `subscription_status` enum (db/migrations/0002_tenancy_billing.sql), which this spec READS so a value added to the enum
// without a label is caught here, not on a farmer's screen.
const T = (cat: Record<string, string>) => ({ t: (k: string) => cat[k] ?? k });
const ENUM = (() => {
  const sql = readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'migrations', '0002_tenancy_billing.sql'), 'utf8');
  const m = sql.match(/CREATE TYPE subscription_status AS ENUM \(([^)]*)\)/);
  if (!m) throw new Error('subscription_status enum not found in 0002');
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
})();

describe('the plan-status labels', () => {
  it('cover the subscription_status enum exactly (six values at 0002)', () => {
    expect(ENUM).toEqual(['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']);
    expect(Object.keys(PLAN_STATUS_KEYS).sort()).toEqual([...ENUM].sort());
  });
  it.each([['en', en], ['hi', hi], ['gu', gu], ['ar', ar]] as const)('every label exists and is distinct in %s', (_l, cat) => {
    const vals = Object.values(PLAN_STATUS_KEYS).map((k) => (cat as Record<string, string>)[k]);
    expect(vals.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(new Set(vals).size).toBe(vals.length);
  });
  it('hi / gu / ar are written in their own script (none of them is the English word or the code)', () => {
    for (const cat of [hi, gu, ar] as Array<Record<string, string>>) {
      for (const [code, k] of Object.entries(PLAN_STATUS_KEYS)) {
        expect(cat[k]).not.toBe(en[k as keyof typeof en]);
        expect(cat[k]).not.toBe(code);
        expect(cat[k]).not.toMatch(/[A-Za-z]/);
      }
    }
  });
  it('planStatusLabel: a known code → the label; null → null; an unknown code → the code, isolated only under ar', () => {
    expect(planStatusLabel('past_due', T(en), 'en')).toBe('payment overdue');
    expect(planStatusLabel('past_due', T(ar), 'ar')).toBe(ar['home.planStatus.pastDue']);
    expect(planStatusLabel('trialing', T(hi), 'hi')).toBe(hi['home.planStatus.trialing']);
    expect(planStatusLabel(null, T(en), 'en')).toBeNull();
    expect(planStatusLabel('', T(en), 'en')).toBeNull();
    for (const l of ['en', 'hi', 'gu']) expect(planStatusLabel('grace_hold', T(en), l)).toBe('grace_hold');
    expect(planStatusLabel('grace_hold', T(ar), 'ar')).toBe('⁦grace_hold⁩');
    // a prototype name is not a status (no "function Object()" on screen)
    expect(planStatusLabel('constructor', T(en), 'en')).toBe('constructor');
  });
});
