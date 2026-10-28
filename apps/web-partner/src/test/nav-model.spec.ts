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
      expect(liveNavForPartner(PARTNER_READS, kind).map((i) => i.href)).toEqual(['/dashboard', '/notifications', '/settlements', '/consents', '/lender/queue', '/lender/products', '/lender/portfolio', ...ACCOUNT]);
      expect(liveNavForPartner(PARTNER_READS, kind).some((i) => i.href.startsWith('/insurer/'))).toBe(false);
    }
    expect(hasLending(set('partner.applications.read'))).toBe(true);
    expect(soonNavForPartner(PARTNER_READS, 'bank')).toEqual([]);
  });

  it('PC-56 PARTNER-2a/2b/3a · an INSURER sees the insurer group\'s SEVEN — Dashboard · Products · Policies · Issuance · Premiums · Claims · Reports — common + account; never the lending group', () => {
    expect(visibleGroups(PARTNER_READS, 'insurer')).toEqual(['common', 'insurer', 'account']);
    expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.href)).toEqual(['/insurer/dashboard', '/insurer/products', '/insurer/policies', '/insurer/issuance', '/insurer/premiums',
      '/insurer/claims', '/insurer/reports', '/notifications', '/settlements', '/consents', ...ACCOUNT]);
    expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.labelKey).slice(0, 7)).toEqual(['partner2.nav.dashboard', 'partner2.nav.products', 'partner2.nav.policies',
      'partner2.nav.issuance', 'partner2.nav.premiums', 'partner3.nav.claims', 'partner2.nav.reports']);
    expect(PARTNER_NAV.filter((i) => i.group === 'insurer').length).toBe(7);
    for (const lending of ['/dashboard', '/loan-queue', '/lender/queue', '/lender/products', '/products', '/portfolio', '/lender/portfolio', '/servicing']) expect(liveNavForPartner(PARTNER_READS, 'insurer').map((i) => i.href)).not.toContain(lending);
    // the insurer group opens on the PARTNER realm's read — the tenant permission a partner token never carries opens nothing
    expect(hasInsurer(set('partner.insurance.read'))).toBe(true);
    expect(hasInsurer(set('insurance.manage'))).toBe(false);
    expect(visibleGroups(set('insurance.manage'), 'insurer')).toEqual(['common', 'account']);
    expect(visibleGroups(set('partner.applications.read'), 'insurer')).toEqual(['common', 'account']);
  });

  it('PC-56 PARTNER-2b · founder 2b-4: /insurer/parametric is NOT in the nav — for any kind, any permissions (it is linked from the dashboard and products)', () => {
    expect(PARTNER_NAV.some((i) => i.href.startsWith('/insurer/parametric'))).toBe(false);
    for (const [perms, kind] of [[PARTNER_READS, 'insurer'], [set(WILDCARD_PERM), 'insurer'], [set(WILDCARD_PERM), null], [PARTNER_READS, 'bank']] as const) {
      expect([...liveNavForPartner(perms, kind), ...soonNavForPartner(perms, kind)].some((i) => /parametric/i.test(i.href) || /parametric/i.test(i.labelKey))).toBe(false);
    }
    // a lender never sees the three new insurer items
    for (const href of ['/insurer/issuance', '/insurer/premiums', '/insurer/reports']) expect(liveNavForPartner(PARTNER_READS, 'bank').map((i) => i.href)).not.toContain(href);
  });

  it('PC-56 PARTNER-3a · Claims sits between Premiums and Reports, ONE item (the claims pages carry their own sub-navigation); a lender, an asset manager and an unknown kind never see it', () => {
    const claims = PARTNER_NAV.filter((i) => i.href.startsWith('/insurer/claims') || /claim/i.test(i.labelKey));
    expect(claims).toEqual([{ href: '/insurer/claims', labelKey: 'partner3.nav.claims', group: 'insurer', live: true }]);
    const hrefs = PARTNER_NAV.map((i) => i.href);
    expect(hrefs.indexOf('/insurer/claims')).toBe(hrefs.indexOf('/insurer/premiums') + 1);
    expect(hrefs.indexOf('/insurer/reports')).toBe(hrefs.indexOf('/insurer/claims') + 1);
    for (const kind of ['bank', 'nbfc', 'mfi', 'gold_loan', 'amc', null]) {
      expect([kind, [...liveNavForPartner(PARTNER_READS, kind), ...soonNavForPartner(PARTNER_READS, kind)].some((i) => i.href.startsWith('/insurer/claims'))]).toEqual([kind, false]);
    }
    // the canon's other claims screens (3b's) are not nav items: evidence, surveyors, surveys, fraud, insights live in the claims sub-navigation
    for (const h of ['/insurer/claims/evidence', '/insurer/surveyors', '/insurer/surveys', '/insurer/claims/fraud', '/insurer/claims/insights']) expect(hrefs).not.toContain(h);
  });

  // PC-56 PARTNER-3b · the four new pages are reached from the claims SUB-NAVIGATION only. They are in NO nav group, for ANY kind and ANY
  // permission set — including the wildcard — and the insurer group still holds exactly SEVEN items. M5 (`/insurer/claims/fraud` added to the
  // insurer nav group) kills here.
  it('PC-56 PARTNER-3b · /insurer/claims/evidence, /insurer/surveyors, /insurer/surveys and /insurer/claims/fraud are in NO nav, for any kind or permission set; the insurer group is still seven', () => {
    const THREE_B = ['/insurer/claims/evidence', '/insurer/claims/evidence/', '/insurer/surveyors', '/insurer/surveys', '/insurer/surveys/', '/insurer/claims/fraud'];
    expect(PARTNER_NAV.filter((i) => THREE_B.includes(i.href))).toEqual([]);
    expect(PARTNER_NAV.filter((i) => /evidence|surveyor|survey|fraud/i.test(i.href) || /evidence|surveyor|survey|fraud/i.test(i.labelKey))).toEqual([]);
    expect(PARTNER_NAV.filter((i) => i.group === 'insurer').length).toBe(7);
    for (const [perms, kind] of [[PARTNER_READS, 'insurer'], [set(WILDCARD_PERM), 'insurer'], [set(WILDCARD_PERM), null], [set(WILDCARD_PERM), 'bank'],
      [PARTNER_READS, 'bank'], [PARTNER_READS, 'amc'], [PARTNER_READS, null], [set(), 'insurer']] as const) {
      const all = [...navForPartner(perms, kind), ...liveNavForPartner(perms, kind), ...soonNavForPartner(perms, kind)].map((i) => i.href);
      for (const h of THREE_B) expect([kind, h, all.includes(h)]).toEqual([kind, h, false]);
    }
  });

  it('PC-56 PARTNER-2c · the lending group\'s Products item is the lender\'s shelf at `/lender/products` (never the retired `/products`); an insurer never sees it', () => {
    const products = PARTNER_NAV.filter((i) => i.labelKey === 'partner2.nav.loanProducts');
    expect(products.map((i) => [i.href, i.group, i.live])).toEqual([['/lender/products', 'lending', true]]);
    expect(PARTNER_NAV.some((i) => i.href === '/products' || i.href.startsWith('/products/'))).toBe(false);
    for (const kind of ['bank', 'nbfc', 'mfi', 'gold_loan', null]) expect([kind, liveNavForPartner(PARTNER_READS, kind).map((i) => i.href)]).toEqual([kind, expect.arrayContaining(['/lender/products'])]);
    for (const kind of ['insurer', 'amc']) expect([kind, liveNavForPartner(PARTNER_READS, kind).some((i) => i.href.startsWith('/lender/'))]).toEqual([kind, false]);
  });

  it('PC-56 PARTNER-4a · the lending group is FOUR items — Dashboard · Loan queue · Products · Portfolio — all at the canon\'s addresses; `/profile` and `/servicing` are gone', () => {
    const lending = PARTNER_NAV.filter((i) => i.group === 'lending');
    expect(lending.map((i) => [i.href, i.live])).toEqual([['/dashboard', true], ['/lender/queue', true], ['/lender/products', true], ['/lender/portfolio', true]]);
    // the three routes the nav used to mark `live: true` while they rendered "not yet available" (survey C-18) are not in the map at all
    for (const gone of ['/profile', '/portfolio', '/servicing', '/loan-queue']) expect([gone, PARTNER_NAV.some((i) => i.href === gone)]).toEqual([gone, false]);
    // PARTNER-4b's two pages are NOT nav items: the lending sub-navigation carries them, dark, until that wave builds them
    for (const next of ['/lender/disbursements', '/lender/repayments']) expect([next, PARTNER_NAV.some((i) => i.href === next)]).toEqual([next, false]);
    // and no lending item is reachable by an insurer, whatever it holds
    for (const i of lending) expect([i.href, liveNavForPartner(PARTNER_READS, 'insurer').map((x) => x.href).includes(i.href)]).toEqual([i.href, false]);
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
      expect(i.labelKey).toMatch(/^(nav|partner1\.nav|partner2\.nav|partner3\.nav|partner4\.nav)\./);
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
