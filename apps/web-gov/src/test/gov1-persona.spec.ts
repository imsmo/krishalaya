// apps/web-gov/src/test/gov1-persona.spec.ts · PC-56 GOV-1a · E2 — the persona gate's truth table (features/gov1/persona.ts): no token → login;
// an organisation's (tenant) token, a partner's token, a token carrying a tid or a pid beside an aid, a token of another `typ`, junk → not_gov
// (the cookies are cleared, the NOT_A_GOVERNMENT_ACCOUNT door); only GOV-0's own shape (realm 'gov', typ 'gov_access', an aid, no tid, no
// pid) → gov. The claims are read WITHOUT verification — for the shell only; the API verifies on every call.
import { CLEAR_CODES, gateDecision, govPersona, NOT_A_GOV_PATH, refreshPath } from '../features/gov1/persona';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`;
const AID = '0192d2c4-a000-7000-8000-000000000001';
const GOV = { sub: 'u1', aid: AID, sid: 's1', roles: ['authority_head'], perms: ['authority.members.read'], realm: 'gov', typ: 'gov_access' };

describe('PC-56 GOV-1a · the persona gate (requireGov)', () => {
  it('no token → login', () => {
    for (const t of [undefined, null, '']) expect(gateDecision(t)).toBe('login');
  });
  it('an ORGANISATION\'s (tenant) token → not_gov', () => {
    expect(gateDecision(jwt({ sub: 'u1', tid: 't1', sid: 's1', roles: ['tenant_admin'], perms: ['report.view'], typ: 'access' }))).toBe('not_gov');
    expect(gateDecision(jwt({ sub: 'u1', tid: 't1', roles: ['gov_officer'], perms: ['scheme.process'], typ: 'access' }))).toBe('not_gov');   // the frozen tenant role (HOTFIX-15)
  });
  it('a PARTNER\'s token → not_gov', () => {
    expect(gateDecision(jwt({ sub: 'u1', pid: 'p1', realm: 'partner', typ: 'partner_access', roles: [], perms: [] }))).toBe('not_gov');
  });
  it('a gov-looking token that also carries a tid or a pid, lacks the aid, or has another typ → not_gov', () => {
    expect(gateDecision(jwt({ ...GOV, tid: 't1' }))).toBe('not_gov');
    expect(gateDecision(jwt({ ...GOV, pid: 'p1' }))).toBe('not_gov');
    expect(gateDecision(jwt({ ...GOV, aid: '' }))).toBe('not_gov');
    expect(gateDecision(jwt({ ...GOV, aid: undefined }))).toBe('not_gov');
    expect(gateDecision(jwt({ ...GOV, typ: 'access' }))).toBe('not_gov');
    expect(gateDecision(jwt({ ...GOV, realm: 'tenant' }))).toBe('not_gov');
  });
  it('junk → not_gov (never a crash)', () => {
    for (const t of ['abc', 'a.b.c', 'a.' + Buffer.from('[1]').toString('base64') + '.c']) expect(gateDecision(t)).toBe('not_gov');
  });
  it('GOV-0\'s own token → gov, with the authority and the claims for the shell', () => {
    expect(gateDecision(jwt(GOV))).toBe('gov');
    expect(govPersona(jwt(GOV))).toEqual({ sub: 'u1', aid: AID, realm: 'gov', roles: ['authority_head'], perms: ['authority.members.read'] });
  });
  it('the doors: not a gov session → the clearing route; a lapsed access cookie → the ONE refresh route; only two clear codes', () => {
    expect(NOT_A_GOV_PATH).toBe('/api/session?clear=NOT_A_GOVERNMENT_ACCOUNT');
    expect(refreshPath('/access')).toBe('/api/session?refresh=1&next=%2Faccess');
    expect([...CLEAR_CODES]).toEqual(['NOT_A_GOVERNMENT_ACCOUNT', 'SESSION_ENDED']);
  });
});
