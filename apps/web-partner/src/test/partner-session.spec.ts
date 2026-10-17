// apps/web-partner/src/test/partner-session.spec.ts · PC-56 PARTNER-0 — the console's persona gate (E6 / F-11), decided from the token's
// claims WITHOUT verification (persona only — the API is the authority): the truth table, the masks, the dashboard's honest counting, and
// the i18n rule (every key this wave adds is in en, hi AND gu; hi / gu are partial catalogues over en).
import { decodeClaims, gateDecision, partnerPersona, NOT_A_PARTNER_PATH } from '../features/partner/persona';
import { maskPhone } from '../features/partner/mask';
import { pageCount, partnerListFilter, sumRequestedMinor } from '../features/partner/application';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenOf = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
const PID = '11111111-1111-7111-8111-111111111111';

describe('PC-56 PARTNER-0 · the persona gate (truth table)', () => {
  it('no token → login', () => {
    expect(gateDecision(undefined)).toBe('login');
    expect(gateDecision(null)).toBe('login');
    expect(gateDecision('')).toBe('login');
  });
  it('a partner token (realm partner + pid) → partner, with its persona', () => {
    const t = tokenOf({ sub: 'u1', pid: PID, realm: 'partner', typ: 'partner_access', roles: ['partner_checker'], perms: ['partner.applications.read', 'partner.applications.decide'] });
    expect(gateDecision(t)).toBe('partner');
    expect(partnerPersona(t)).toEqual({ sub: 'u1', pid: PID, realm: 'partner', roles: ['partner_checker'], perms: ['partner.applications.read', 'partner.applications.decide'] });
  });
  it('a token WITHOUT a pid → not_partner (M6 kills here)', () => {
    expect(gateDecision(tokenOf({ sub: 'u1', realm: 'partner', perms: ['partner.applications.read'] }))).toBe('not_partner');
    expect(gateDecision(tokenOf({ sub: 'u1', realm: 'partner', pid: '' }))).toBe('not_partner');
    expect(partnerPersona(tokenOf({ sub: 'u1', realm: 'partner' }))).toBeNull();
  });
  it('a TENANT token (tid, no realm) — even with loan.manage — → not_partner', () => {
    expect(gateDecision(tokenOf({ sub: 'u1', tid: 't1', typ: 'access', roles: ['tenant_admin'], perms: ['loan.manage', '*'] }))).toBe('not_partner');
  });
  it('a pid without the partner realm → not_partner; junk → not_partner', () => {
    expect(gateDecision(tokenOf({ sub: 'u1', pid: PID, realm: 'tenant' }))).toBe('not_partner');
    expect(gateDecision(tokenOf({ sub: 'u1', pid: PID }))).toBe('not_partner');
    expect(gateDecision('not-a-jwt')).toBe('not_partner');
    expect(gateDecision('a.!!!.c')).toBe('not_partner');
    expect(decodeClaims(tokenOf([1, 2] as never))).toBeNull();
  });
  it('not_partner goes through the route handler that clears the cookies, then /login?error=NOT_A_PARTNER', () => {
    expect(NOT_A_PARTNER_PATH).toBe('/api/session?clear=NOT_A_PARTNER');
  });
});

describe('PC-56 PARTNER-0 · masks and honest counting', () => {
  it('a phone shows six bullets and its last 3 digits; nothing for junk', () => {
    expect(maskPhone('+919812345318')).toBe('••••••318');
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('12')).toBeNull();
  });
  it('a full page counts as "N+", a partial page exactly; requested amounts sum as bigint minor strings', () => {
    expect(pageCount(100, 'cursor')).toEqual({ n: 100, atLeast: true });
    expect(pageCount(7, null)).toEqual({ n: 7, atLeast: false });
    expect(sumRequestedMinor([{ amountRequestedMinor: '900719925474099300' }, { amountRequestedMinor: '7' }, { amountRequestedMinor: 'x' }])).toBe('900719925474099307');
  });
  it('the queue boxes map to the partner read: review → reviewQueue; all → no filter', () => {
    expect(partnerListFilter('review')).toEqual({ reviewQueue: true });
    expect(partnerListFilter('all', 'approved')).toEqual({ status: 'approved' });
  });
});

describe('PC-56 PARTNER-0 · i18n: every new key × 3', () => {
  it('hi and gu carry exactly the same keys, all of them in en', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(gu).sort());
    for (const k of Object.keys(hi)) expect(Object.prototype.hasOwnProperty.call(en, k)).toBe(true);
  });
  it('every `partner.*` key of en (this wave\'s) — and the re-worded nav.brand — is in hi AND gu, non-empty, placeholders kept', () => {
    const fresh = Object.keys(en).filter((k) => k.startsWith('partner.')).concat('nav.brand');
    expect(fresh.length).toBeGreaterThanOrEqual(40);
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of fresh) {
      expect([k, typeof hi[k], typeof gu[k]]).toEqual([k, 'string', 'string']);
      expect(hi[k].length).toBeGreaterThan(0); expect(gu[k].length).toBeGreaterThan(0);
      expect([k, vars(hi[k])]).toEqual([k, vars(en[k])]); expect([k, vars(gu[k])]).toEqual([k, vars(en[k])]);
    }
  });
  it('no new key prints the platform\'s name, a mailbox or a domain (F-13: the mark comes from PLATFORM_BRAND)', () => {
    for (const cat of [en, hi, gu]) for (const [k, v] of Object.entries(cat)) {
      if (!(k.startsWith('partner.') || k === 'nav.brand')) continue;
      expect([k, /krishalaya|@|\.com\b|\.in\b/i.test(v)]).toEqual([k, false]);
    }
  });
});
