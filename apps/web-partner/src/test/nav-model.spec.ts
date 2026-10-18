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
    expect(visibleGroups(perms)).toEqual(['common', 'lending', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/loan-queue', '/products', '/profile', '/portfolio', '/servicing', '/account/settings', '/help']);
    expect(soonNavForPartner(perms)).toEqual([]); // lending vertical fully built
  });

  it('logistics persona sees common + fleet only', () => {
    const perms = set(FLEET_PERM);
    expect(hasFleet(perms)).toBe(true);
    expect(hasLending(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'fleet', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/shipments', '/fleet', '/zones', '/routes', '/cold-chain', '/account/settings', '/help']);
    expect(soonNavForPartner(perms)).toEqual([]); // logistics vertical fully built
  });

  it('insurer persona (KV-BL-056/DEV-24) sees common + insurance only', () => {
    const perms = set(INSURANCE_PERM);
    expect(hasInsurance(perms)).toBe(true);
    expect(hasLending(perms)).toBe(false);
    expect(hasFleet(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'insurance', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/insurance-claims', '/insurance-policies', '/insurance-products', '/insurance-book', '/account/settings', '/help']);
    expect(soonNavForPartner(perms)).toEqual([]); // insurer console fully built this batch
  });

  it('wildcard sees all three verticals', () => {
    const perms = set(WILDCARD_PERM);
    expect(visibleGroups(perms)).toEqual(['common', 'lending', 'fleet', 'insurance', 'account']);
    expect(navForPartner(perms).length).toBe(PARTNER_NAV.length);
  });

  it('no partner perms → only the common dashboard', () => {
    const perms = set();
    expect(visibleGroups(perms)).toEqual(['common', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/account/settings', '/help']);
    expect(soonNavForPartner(perms)).toEqual([]);
  });

  it('every nav item has an href + label key + valid group', () => {
    for (const i of PARTNER_NAV) {
      expect(i.href).toMatch(/^\//);
      expect(i.labelKey).toMatch(/^(nav|partner1\.nav)\./);
      expect(['common', 'lending', 'fleet', 'insurance', 'account']).toContain(i.group);
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

describe('PC-56 PARTNER-1a · the Account group (founder D7)', () => {
  it('Settings and Help, built routes only, last, for every persona — and with their own ×3 label keys', () => {
    const account = PARTNER_NAV.filter((i) => i.group === 'account');
    expect(account.map((i) => [i.href, i.labelKey, i.live])).toEqual([['/account/settings', 'partner1.nav.settings', true], ['/help', 'partner1.nav.help', true]]);
    for (const perms of [set(), set(LENDING_PERM), set(FLEET_PERM), set(INSURANCE_PERM), set(WILDCARD_PERM)]) {
      expect(visibleGroups(perms)[visibleGroups(perms).length - 1]).toBe('account');
      expect(liveNavForPartner(perms).slice(-2).map((i) => i.href)).toEqual(['/account/settings', '/help']);
    }
  });
});
