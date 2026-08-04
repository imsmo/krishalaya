// apps/web-partner/src/test/nav-model.spec.ts · unit tests for the pure persona-aware nav model + notice mapping.
import {
  PARTNER_NAV, hasLending, hasFleet, hasInsurance, visibleGroups, navForPartner, liveNavForPartner, soonNavForPartner,
  partnerNoticeKey, LENDING_PERM, FLEET_PERM, INSURANCE_PERM, WILDCARD_PERM,
} from '../features/nav/nav-model';

const set = (...p: string[]) => new Set(p);

describe('partner nav model (persona-aware)', () => {
  it('lending persona sees common + lending only', () => {
    const perms = set(LENDING_PERM);
    expect(hasLending(perms)).toBe(true);
    expect(hasFleet(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'lending']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/help', '/loan-queue', '/products', '/profile', '/portfolio']);
    expect(soonNavForPartner(perms)).toEqual([]); // lending vertical fully built
  });

  it('logistics persona sees common + fleet only', () => {
    const perms = set(FLEET_PERM);
    expect(hasFleet(perms)).toBe(true);
    expect(hasLending(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'fleet']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/help', '/shipments', '/fleet', '/zones', '/routes', '/cold-chain']);
    expect(soonNavForPartner(perms)).toEqual([]); // logistics vertical fully built
  });

  it('insurer persona (KV-BL-056/DEV-24) sees common + insurance only', () => {
    const perms = set(INSURANCE_PERM);
    expect(hasInsurance(perms)).toBe(true);
    expect(hasLending(perms)).toBe(false);
    expect(hasFleet(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'insurance']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/help', '/insurance-claims', '/insurance-policies', '/insurance-products']);
    expect(soonNavForPartner(perms)).toEqual([]); // insurer console fully built this batch
  });

  it('wildcard sees all three verticals', () => {
    const perms = set(WILDCARD_PERM);
    expect(visibleGroups(perms)).toEqual(['common', 'lending', 'fleet', 'insurance']);
    expect(navForPartner(perms).length).toBe(PARTNER_NAV.length);
  });

  it('no partner perms → only the common dashboard', () => {
    const perms = set();
    expect(visibleGroups(perms)).toEqual(['common']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/help']);
    expect(soonNavForPartner(perms)).toEqual([]);
  });

  it('every nav item has an href + label key + valid group', () => {
    for (const i of PARTNER_NAV) {
      expect(i.href).toMatch(/^\//);
      expect(i.labelKey).toMatch(/^nav\./);
      expect(['common', 'lending', 'fleet', 'insurance']).toContain(i.group);
    }
  });
});

describe('partnerNoticeKey', () => {
  it('maps SDK status → notice key', () => {
    expect(partnerNoticeKey(403)).toBe('forbidden');
    expect(partnerNoticeKey(401)).toBe('unauthorized');
    expect(partnerNoticeKey(404)).toBe('notFound');
    expect(partnerNoticeKey(500)).toBe('unavailable');
    expect(partnerNoticeKey(undefined)).toBe('unavailable');
  });
});
