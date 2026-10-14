// core/tenancy-context/__tests__/store1c-storefront-plans.spec.ts · PC-56 STORE-1c · B2 — the public plan catalogue (founder D2) and the
// widened flags allow-list (founder D1), mocked half (the live half is src/__tests__/store1c-signup.integration.spec.ts).
//   • the plans SQL keeps EVERY exclusion — private (is_public), inactive (is_active), draft / archived (status = 'active'), deleted, and any
//     other country ($1) — and the newest version of a code wins; money leaves as bigint minor STRINGS with the currency's exponent;
//   • a missing / malformed ?country= is refused by name (COUNTRY_REQUIRED), never defaulted to a country;
//   • the trial length is the setting when it is a whole number of days in 1..365, else null — never a copied default;
//   • flags: `org_self_signup` is answered with NO tenant in context (a platform switch, evaluated with `{}` — the same context the signup
//     gate uses); `group_lots` only with one; a flag-store failure reads OFF.
import { StorefrontPublicController, STOREFRONT_PUBLIC_FLAGS, PLATFORM_SCOPED_FLAGS } from '../storefront-public.controller';
import { StorefrontPublicReadModel, countryParam, trialDaysOf } from '../storefront-public.read-model';
import type { RequestContext } from '../request-context';

const T = '01c1c000-0000-7000-8000-00000000000b';
const PLAN_ROWS = [
  { code: 'starter', default_name: 'Starter', monthly: '499900', annual: '4999900', setup_fee: '0', currency_code: 'INR', minor_units: 2 },
  { code: 'growth', default_name: 'Growth', monthly: '1499900', annual: '14999900', setup_fee: '2500000', currency_code: 'INR', minor_units: 2 },
];

function readModel(trial: unknown = 14) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => (/FROM plans p/.test(sql) ? { rows: PLAN_ROWS } : { rows: trial === undefined ? [] : [{ value: trial }] }));
  return { rm: new StorefrontPublicReadModel({ replica: () => ({ query }) } as never), query };
}

describe('STORE-1c · D2 — the public plans read', () => {
  it('the SQL keeps every exclusion: public, active, published (status), not deleted, this country only; newest version per code', async () => {
    const { rm, query } = readModel();
    await rm.plans('IN');
    const sql = String(query.mock.calls[0][0]).replace(/\s+/g, ' ');
    expect(sql).toContain('p.is_public');
    expect(sql).toContain('p.is_active');
    expect(sql).toContain("p.status = 'active'");
    expect(sql).toContain('p.deleted_at IS NULL');
    expect(sql).toContain('p.country_code = $1');
    expect(sql).toContain('DISTINCT ON (p.code)');
    expect(sql).toContain('ORDER BY p.code, p.version DESC');
    expect(sql).toMatch(/ORDER BY latest\.monthly::bigint, latest\.code$/);
    expect(query.mock.calls[0][1]).toEqual(['IN']);
    // read-only: no write verb anywhere in either statement
    for (const [s] of query.mock.calls) expect(String(s)).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('money leaves as bigint minor STRINGS with the currency and the DB exponent; the trial length rides along', async () => {
    const { rm } = readModel();
    expect(await rm.plans('IN')).toEqual({
      country: 'IN',
      plans: [
        { code: 'starter', name: 'Starter', monthlyMinor: '499900', annualMinor: '4999900', setupFeeMinor: '0', currency: 'INR', exponent: 2 },
        { code: 'growth', name: 'Growth', monthlyMinor: '1499900', annualMinor: '14999900', setupFeeMinor: '2500000', currency: 'INR', exponent: 2 },
      ],
      trialDays: 14,
    });
  });

  it('trial length: a whole number of days in 1..365 (number or numeric string), else null — never a default copied into core', () => {
    expect(trialDaysOf(14)).toBe(14); expect(trialDaysOf('30')).toBe(30); expect(trialDaysOf(365)).toBe(365);
    for (const bad of [0, -1, 366, 1.5, '', 'fourteen', null, undefined, {}]) expect(trialDaysOf(bad)).toBeNull();
  });

  it('?country= is two letters, upper-cased; anything else is refused by name (COUNTRY_REQUIRED), and nothing is read', async () => {
    expect(countryParam('in')).toBe('IN'); expect(countryParam(' BD ')).toBe('BD');
    for (const bad of [undefined, '', 'IND', 'I', '1N', ['IN']]) expect(countryParam(bad)).toBeNull();
    const plans = jest.fn();
    const ctl = new StorefrontPublicController({ plans } as never, {} as never);
    await expect(ctl.plans({})).rejects.toMatchObject({ code: 'COUNTRY_REQUIRED', httpStatus: 400 });
    await expect(ctl.plans({ country: 'IND' })).rejects.toMatchObject({ code: 'COUNTRY_REQUIRED' });
    expect(plans).not.toHaveBeenCalled();
    plans.mockResolvedValue({ country: 'IN', plans: [], trialDays: null });
    expect(await ctl.plans({ country: 'in' })).toEqual({ data: { country: 'IN', plans: [], trialDays: null } });
    expect(plans).toHaveBeenCalledWith('IN');
  });
});

describe('STORE-1c · D1 — the flags allow-list gains ONE platform switch', () => {
  it('the allow-list is exactly group_lots + org_self_signup (+ HOTFIX-4 A8: online_payments, buyer_charges, offers, auctions, reviews); only org_self_signup is platform-scoped', () => {
    expect(STOREFRONT_PUBLIC_FLAGS).toEqual(['group_lots', 'org_self_signup', 'online_payments', 'buyer_charges', 'offers', 'auctions', 'reviews']);
    expect([...PLATFORM_SCOPED_FLAGS]).toEqual(['org_self_signup']);
  });

  it('no tenant in context (the platform page) → ONLY org_self_signup, evaluated with `{}` (the signup gate\'s own context)', async () => {
    const isEnabled = jest.fn(async (k: string) => k === 'org_self_signup');
    const ctl = new StorefrontPublicController({} as never, { isEnabled } as never);
    expect(await ctl.publicFlags({ tenantId: '' } as RequestContext)).toEqual({ data: { org_self_signup: true } });
    expect(isEnabled).toHaveBeenCalledTimes(1);
    expect(isEnabled).toHaveBeenCalledWith('org_self_signup', {});
  });

  it('a tenant in context → both keys; the platform switch still ignores the tenant; a flag-store failure reads OFF', async () => {
    const isEnabled = jest.fn(async (k: string, c: { tenantId?: string }) => {
      if (k === 'org_self_signup') throw new Error('flag store down');
      return c.tenantId === T;
    });
    const ctl = new StorefrontPublicController({} as never, { isEnabled } as never);
    expect(await ctl.publicFlags({ tenantId: T } as RequestContext)).toMatchObject({ data: { group_lots: true, org_self_signup: false } });
    expect(isEnabled).toHaveBeenCalledWith('group_lots', { tenantId: T });
    expect(isEnabled).toHaveBeenCalledWith('org_self_signup', {});
  });
});
