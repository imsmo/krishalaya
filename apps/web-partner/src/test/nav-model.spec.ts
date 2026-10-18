// apps/web-partner/src/test/nav-model.spec.ts · unit tests for the pure persona-aware (and, since PC-56 PARTNER-2a, KIND-aware) nav model +
// notice mapping. The persona permissions are written as the partner realm's LITERAL codes (never the module's constants), so a nav keyed on
// the wrong permission again (the DEV-24 `insurance.manage` — mutant M6) turns this red.
import {
  PARTNER_NAV, hasLending, hasFleet, hasInsurer, visibleGroups, navForPartner, liveNavForPartner, soonNavForPartner, homeHref, navKind,
  partnerNoticeKey, FLEET_PERM, WILDCARD_PERM,
} from '../features/nav/nav-model';

const set = (...p: string[]) => new Set(p);
const ACCOUNT = ['/account/settings', '/account/api', '/account/webhooks', '/onboarding/status', '/help'];
/** Every partner role holds both reads since 0228 (applications since 0225, insurance since 0228). */
const PARTNER_READS = set('partner.applications.read', 'partner.insurance.read', 'partner.keys.read', 'partner.webhooks.read');

describe('partner nav model (persona-aware)', () => {
  it('a lender (bank / nbfc / mfi / gold_loan) sees its dashboard, common + lending — never the insurer group', () => {
    for (const kind of ['bank', 'nbfc', 'mfi', 'gold_loan']) {
      expect([kind, visibleGroups(PARTNER_READS, kind)]).toEqual([kind, ['common', 'lending', 'account']]);
      expect(liveNavForPartner(PARTNER_READS, kind).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/loan-queue', '/products', '/profile', '/portfolio', '/servicing', ...ACCOUNT]);
      expect(liveNavForPartner(PARTNER_READS, kind).some((i) => i.href.startsWith('/insurer/'))).toBe(false);
    }
    expect(hasLending(set('partner.applications.read'))).toBe(true);
    expect(soonNavForPartner(PARTNER_READS, 'bank')).toEqual([]);
  });

  it('PC-56 PARTNER-2a · an INSURER sees Dashboard · Products · Policies of the insurer group, common + account — never the lending group', () => {
    expect(visibleGroups(PARTNER_READS, 'insurer')).toEqual(['common', 'insurer', 'account']);
    expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.href)).toEqual(['/insurer/dashboard', '/insurer/products', '/insurer/policies', '/notifications', '/settlements', '/consents', ...ACCOUNT]);
    expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.labelKey).slice(0, 3)).toEqual(['partner2.nav.dashboard', 'partner2.nav.products', 'partner2.nav.policies']);
    for (const lending of ['/dashboard', '/loan-queue', '/products', '/portfolio', '/servicing']) expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.href)).not.toContain(lending);
    // the insurer group opens on the PARTNER realm's read — the tenant permission a partner token never carries opens nothing
    expect(hasInsurer(set('partner.insurance.read'))).toBe(true);
    expect(hasInsurer(set('insurance.manage'))).toBe(false);
    expect(visibleGroups(set('insurance.manage'), 'insurer')).toEqual(['common', 'account']);
    expect(visibleGroups(set('partner.applications.read'), 'insurer')).toEqual(['common', 'account']);
  });

  it('PC-56 PARTNER-2a · an asset manager sees neither vertical; an unknown kind keeps the lending group and never opens the insurer group', () => {
    expect(visibleGroups(PARTNER_READS, 'amc')).toEqual(['common', 'account']);
    expect(visibleGroups(PARTNER_READS, null)).toEqual(['common', 'lending', 'account']);
    expect(visibleGroups(PARTNER_READS, undefined)).toEqual(['common', 'lending', 'account']);
    expect([navKind('insurer'), navKind('bank'), navKind('amc'), navKind(null), navKind('something_new')]).toEqual(['insurer', 'lender', 'other', 'unknown', 'other']);
    expect([homeHref('insurer'), homeHref('bank'), homeHref('amc'), homeHref(null)]).toEqual(['/insurer/dashboard', '/dashboard', '/dashboard', '/dashboard']);
  });

  it('logistics persona sees common + fleet only', () => {
    const perms = set(FLEET_PERM);
    expect(hasFleet(perms)).toBe(true);
    expect(hasLending(perms)).toBe(false);
    expect(visibleGroups(perms)).toEqual(['common', 'fleet', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/notifications', '/settlements', '/consents', '/shipments', '/fleet', '/zones', '/routes', '/cold-chain', ...ACCOUNT]);
    expect(soonNavForPartner(perms)).toEqual([]); // logistics vertical fully built
  });

  it('wildcard sees every group', () => {
    const perms = set(WILDCARD_PERM);
    expect(visibleGroups(perms)).toEqual(['common', 'lending', 'fleet', 'insurer', 'account']);
    expect(navForPartner(perms).length).toBe(PARTNER_NAV.length);
  });

  it('no partner perms → only the common and account groups', () => {
    const perms = set();
    expect(visibleGroups(perms)).toEqual(['common', 'account']);
    expect(liveNavForPartner(perms).map((i) => i.href)).toEqual(['/notifications', '/settlements', '/consents', ...ACCOUNT]);
    expect(soonNavForPartner(perms)).toEqual([]);
  });

  it('every nav item has an href + label key + valid group; the DEV-24 /insurance-* routes are gone from the nav', () => {
    for (const i of PARTNER_NAV) {
      expect(i.href).toMatch(/^\//);
      expect(i.labelKey).toMatch(/^(nav|partner1\.nav|partner2\.nav)\./);
      expect(['common', 'lending', 'fleet', 'insurer', 'account']).toContain(i.group);
    }
    expect(PARTNER_NAV.filter((i) => i.href.startsWith('/insurance-'))).toEqual([]);
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

describe('PC-56 PARTNER-1a / 1b · the Account group (founder D7)', () => {
  it('Settings · API keys · Webhooks · Readiness · Help — built routes only, last, for every persona — and with their own ×3 label keys', () => {
    const account = PARTNER_NAV.filter((i) => i.group === 'account');
    expect(account.map((i) => [i.href, i.labelKey, i.live])).toEqual([['/account/settings', 'partner1.nav.settings', true], ['/account/api', 'partner1.nav.keys', true],
      ['/account/webhooks', 'partner1.nav.webhooks', true], ['/onboarding/status', 'partner1.nav.readiness', true], ['/help', 'partner1.nav.help', true]]);
    for (const [perms, kind] of [[set(), null], [PARTNER_READS, 'bank'], [set(FLEET_PERM), null], [PARTNER_READS, 'insurer'], [PARTNER_READS, 'amc'], [set(WILDCARD_PERM), null]] as const) {
      expect(visibleGroups(perms, kind)[visibleGroups(perms, kind).length - 1]).toBe('account');
      expect(liveNavForPartner(perms, kind).slice(-5).map((i) => i.href)).toEqual(['/account/settings', '/account/api', '/account/webhooks', '/onboarding/status', '/help']);
    }
    // the settlement page is NOT in the nav (linked from the readiness page only)
    expect(PARTNER_NAV.some((i) => i.href === '/onboarding/settlement')).toBe(false);
  });
});
