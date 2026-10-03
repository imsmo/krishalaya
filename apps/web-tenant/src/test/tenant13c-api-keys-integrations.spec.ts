// apps/web-tenant/src/test/tenant13c-api-keys-integrations.spec.ts · PC-56 TENANT-13c · the API key console (W190, W2488–W2494) and the
// integrations console (W187, W2643–W2649): their pure rules and their security / honesty properties.
//   SECRETS  no page or action reads, writes or redirects with a key or a credential in a URL; the create-key chain and the connect chain
//            are client components that hold the value in memory only; the pages are no-store + no-referrer (config + middleware);
//   TRUTH    no connection is ever badged "active": the status vocabulary is verified / verify failed / disconnected / unverified /
//            platform-managed / available, the consumers sentence says "not yet used by any platform path", direct settlement is
//            refused by name, Health is a count of checks — never a percentage;
//   MIRROR   every refusal code the API can answer has a sentence; every key the pages use exists.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  DEVELOPERS_HREF, NEW_KEY_HREF, REFUSAL_CODES as AK_CODES, failureCodesFrom as akFailures, formKeysWithRefusals as akKeys, pageState as akState, prefixMask,
  refusalKey as akRefusal, revokeHref, scopeChips, statusKey,
} from '../features/api-keys/api-keys';
import {
  INTEGRATIONS_HREF, REFUSAL_CODES as INT_CODES, connectHref, consumersKey, disconnectHref, formKeysWithRefusals as intKeys, healthLine, pageState as intState,
  providerStatusKey, refusalKey as intRefusal, rowActs,
} from '../features/integrations/integrations';
import { secretPageHeaders, SECRET_PAGE_HEADERS } from '../features/webhooks/headers';

const SRC = join(__dirname, '..');
const API = join(SRC, '..', '..', 'api', 'src', 'modules');
function walk(dir: string): string[] { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const read = (p: string) => readFileSync(p, 'utf8');
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, '');
const DEV = walk(join(SRC, 'app', 'settings', 'developers')).filter((f) => !f.includes(`${join('developers', 'webhooks')}`) && /\.(ts|tsx)$/.test(f));
const INT = walk(join(SRC, 'app', 'settings', 'integrations')).filter((f) => /\.(ts|tsx)$/.test(f));

describe('SECRETS · a key or a credential never travels in a URL', () => {
  it('no page or action reads, writes or redirects with a key / secret / credential query parameter, or touches storage or the console', () => {
    expect(DEV.length).toBeGreaterThanOrEqual(7); expect(INT.length).toBeGreaterThanOrEqual(7);
    for (const f of [...DEV, ...INT]) {
      const s = code(f);
      expect({ f, hit: /[?&](key|secret|credential|keySecret|apiKey|token)=/.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /searchParams\.(key|secret|credential)\b|searchParams\[['"](key|secret|credential)/.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /redirect\([^)]*(\.key\b|secret|credential)/i.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /(localStorage|sessionStorage|document\.cookie|console\.(log|info|warn|error))/.test(s) }).toEqual({ f, hit: false });
    }
  });
  it('the key is RETURNED by the server action to a client component that keeps it in memory, shows it once, and drops it on Hide', () => {
    const actions = read(join(SRC, 'app', 'settings', 'developers', 'actions.ts'));
    expect(actions).toContain("'use server'");
    expect(actions).toMatch(/return \{ ok: true, id: r\.id, keyPrefix: r\.keyPrefix, key: r\.key/);
    const chain = read(join(SRC, 'app', 'settings', 'developers', 'keys', 'new', 'CreateKeyChain.tsx'));
    expect(chain.startsWith("'use client'")).toBe(true);
    expect(chain).toMatch(/useState/);
    expect(chain).toContain('data-secret="once"');
    expect(chain).toMatch(/setResult\(\{ \.\.\.result, key: null \}\)/);
  });
  it('the credential travels once, in the server action arguments; secret fields are password inputs; the chain forgets them on success', () => {
    const chain = read(join(SRC, 'app', 'settings', 'integrations', 'connect', 'ConnectChain.tsx'));
    expect(chain.startsWith("'use client'")).toBe(true);
    expect(chain).toMatch(/type=\{f\.secret \? 'password' : 'text'\}/);
    expect(chain).toMatch(/if \(r\.ok\) \{ setFields\(\{\}\)/);
    expect(chain).toMatch(/f\.secret \? '••••••••'/);   // the review never echoes a secret field
    const actions = read(join(SRC, 'app', 'settings', 'integrations', 'actions.ts'));
    expect(actions).not.toMatch(/credential[^\n]*redirect|redirect\([^)]*credential/);
    // the old one-click connect / disconnect (no chain, no checker) is gone from the SDK surface the console uses
    expect(actions).not.toMatch(/integrations\.(connect|disconnect)\(/);
  });
  it('the whole developer area and the integrations pages are served no-store + no-referrer — next.config.js and the middleware', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(join(SRC, '..', 'next.config.js'));
    const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await cfg.headers();
    for (const source of ['/settings/developers', '/settings/developers/:path*', '/settings/integrations', '/settings/integrations/:path*']) {
      const r = rules.find((x) => x.source === source);
      expect(r).toBeDefined();
      const h = Object.fromEntries(r!.headers.map((x) => [x.key, x.value]));
      expect(h['Cache-Control']).toMatch(/no-store/); expect(h['Referrer-Policy']).toBe('no-referrer');
      expect(rules.indexOf(r!)).toBeGreaterThan(rules.findIndex((x) => x.source === '/:path*'));
    }
    for (const p of ['/settings/developers', '/settings/developers/keys/new', '/settings/integrations/connect']) expect(secretPageHeaders(p)).toEqual(SECRET_PAGE_HEADERS);
    expect(secretPageHeaders('/settings/integrationsX')).toEqual({});
  });
});

describe('TRUTH · no connection is ever "active"; nothing claims a reader, a settlement or a rate it does not have', () => {
  it('the status vocabulary has no "active"; the page never prints the old badge', () => {
    for (const s of ['verified', 'verify_failed', 'disconnected', 'unverified']) expect(en[`int.status.${s}` as keyof typeof en]).toBeTruthy();
    expect(Object.keys(en).filter((k) => k.startsWith('int.status.')).sort()).toEqual(
      ['int.status.available', 'int.status.disconnected', 'int.status.platform_managed', 'int.status.unverified', 'int.status.verified', 'int.status.verify_failed']);
    expect(Object.keys(en).filter((k) => k.startsWith('int.status.')).map((k) => en[k as keyof typeof en].toLowerCase())).not.toContain('active');
    const page = code(join(SRC, 'app', 'settings', 'integrations', 'page.tsx'));
    expect(page).not.toMatch(/integrations\.active|'active'/);
  });
  it('consumers, direct settlement, disconnect and the platform default say what is true', () => {
    expect(consumersKey([])).toBe('int.consumers.none');
    expect(en['int.consumers.none']).toBe('connected and verified · not yet used by any platform path — payments and SMS run on platform accounts');
    expect(en['int.note.directSettlement']).toMatch(/not available/);
    expect(en['int.note.disconnect']).toMatch(/no settlement runs through a tenant connection today/);
    expect(en['int.state.defaults.body']).toMatch(/direct settlement is not yet routed/);
    expect(en['int.note.rotation']).toMatch(/verified in shadow/);
  });
  it('Health (24 h) is a count of checks and the last good instant — never a percentage', () => {
    expect(healthLine(null)).toEqual({ key: 'int.health.none', vars: {}, at: null });
    expect(healthLine({ checks24h: 3, ok24h: 3, failed24h: 0, lastOkAt: '2026-10-03T10:00:00Z', lastCheckAt: '2026-10-03T10:00:00Z' })).toEqual({ key: 'int.health.ok', vars: { n: '3', failed: '0' }, at: '2026-10-03T10:00:00Z' });
    expect(healthLine({ checks24h: 2, ok24h: 0, failed24h: 2, lastOkAt: null, lastCheckAt: 'x' }).key).toBe('int.health.failing');
    for (const k of ['int.health.ok', 'int.health.mixed', 'int.health.failing', 'int.list.col.health']) expect(en[k as keyof typeof en]).not.toMatch(/%/);
  });
  it('a platform-managed provider offers no act; an ownable one offers connect, then rotate / disconnect; an unverifiable one cannot connect', () => {
    expect(rowActs(null, { ownable: false, verifiable: false })).toEqual([]);
    expect(rowActs(null, { ownable: true, verifiable: true })).toEqual(['connect']);
    expect(rowActs({ status: 'verified' }, { ownable: true, verifiable: true })).toEqual(['rotate', 'disconnect']);
    expect(rowActs(null, { ownable: true, verifiable: false })).toEqual([]);
    expect(providerStatusKey({ managed: true }, null)).toBe('int.status.platform_managed');
    expect(providerStatusKey({ managed: false }, { status: 'verify_failed' })).toBe('int.status.verify_failed');
    expect(connectHref('razorpay', 'rotate')).toBe('/settings/integrations/connect?provider=razorpay&kind=rotate');
    expect(disconnectHref('gupshup')).toBe('/settings/integrations/disconnect?provider=gupshup&step=confirm');
  });
  it('the key console prints only a prefix; the revoke panel prints the real bound; only live keys exist', () => {
    expect(prefixMask('kv_live_a1b2c3d4')).toBe('kv_live_a1b2c3d4…');
    expect(en['ak.revoke.panel.body']).toMatch(/takes effect on the next call — within \{seconds\} seconds at most/);
    expect(en['ak.list.lede']).toMatch(/no sandbox mode/);
    expect(en['ak.list.lede']).toMatch(/sha256/);
    expect(statusKey('waiting_checker')).toBe('ak.status.waiting_checker');
    expect(scopeChips({ scopes: ['members.read.pii', 'orders.status.write'] }, [
      { code: 'members.read.pii', kind: 'read', checker: true, description: '', routes: [] }, { code: 'orders.status.write', kind: 'write', checker: false, description: '', routes: [] },
    ])).toEqual([{ code: 'members.read.pii', write: false, checker: true }, { code: 'orders.status.write', write: true, checker: false }]);
    expect(revokeHref('x')).toBe(`${DEVELOPERS_HREF}/keys/x/revoke?step=confirm`);
    expect(NEW_KEY_HREF).toBe('/settings/developers/keys/new');
  });
});

describe('MIRROR · the console speaks every refusal the API can answer', () => {
  it('every API key refusal the API rules and the trigger map can produce has a sentence', () => {
    const rules = read(join(API, 'tenant-api-keys', 'domain', 'api-key.rules.ts'));
    const svc = read(join(API, 'tenant-api-keys', 'services', 'api-key.service.ts'));
    const fromRules = [...rules.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]);
    const fromRefusalFns = [...rules.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]).concat([...rules.matchAll(/\? '([a-z_]+)' :/g)].map((m) => m[1]));
    const fromTriggers = [...svc.matchAll(/\{ code: '([A-Z_]+)'/g)].map((m) => m[1]);
    const fromSvc = [...svc.matchAll(/ApiKeyActRefusedError\('([A-Z_]+)'/g)].map((m) => m[1]);
    for (const c of [...new Set([...fromRules, ...fromRefusalFns, ...fromTriggers, ...fromSvc, 'PLAN_FEATURE_REQUIRED'])]) {
      expect({ c, known: (AK_CODES as readonly string[]).includes(c) }).toEqual({ c, known: true });
      expect(en[akRefusal(c) as keyof typeof en]).toBeTruthy();
    }
    expect(akRefusal('NOPE')).toBe('ak.refusal.unknown');
  });
  it('every integration refusal the service / domain / triggers can produce has a sentence', () => {
    const svc = read(join(API, 'tenant-integrations', 'services', 'tenant-integration.service.ts'));
    const dom = read(join(API, 'tenant-integrations', 'domain', 'provider-rules.ts')) + read(join(API, 'tenant-integrations', 'domain', 'integration-proposal.state.ts'));
    const codes = new Set<string>([
      ...[...svc.matchAll(/code: '([A-Za-z_]+)'/g)].map((m) => m[1]), ...[...dom.matchAll(/code: '([A-Za-z_]+)'/g)].map((m) => m[1]),
      ...[...dom.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]).filter((c) => !['auth', 'network', 'unknown'].includes(c)),
      ...[...svc.matchAll(/IntegrationActRefusedError\('([A-Z_]+)'/g)].map((m) => m[1]),
      'INTEGRATION_VERIFY_FAILED', 'INTEGRATION_PROVIDER_NOT_FOUND',
    ]);
    for (const c of codes) {
      expect({ c, known: (INT_CODES as readonly string[]).includes(c) }).toEqual({ c, known: true });
      expect(en[intRefusal(c) as keyof typeof en]).toBeTruthy();
    }
  });
  it('every chain string handed to a client component exists in all three languages', () => {
    for (const k of [...akKeys(), ...intKeys()]) {
      expect({ k, en: Boolean(en[k as keyof typeof en]) }).toEqual({ k, en: true });
      expect({ k, hi: Boolean(hi[k as keyof typeof hi]) }).toEqual({ k, hi: true });
      expect({ k, gu: Boolean(gu[k as keyof typeof gu]) }).toEqual({ k, gu: true });
    }
  });
  it('a read failure maps to the canon states; a write failure to its codes', () => {
    expect(akState('API_KEYS_FORBIDDEN', 403)).toBe('restricted'); expect(akState(undefined, 404)).toBe('flaggedOff'); expect(akState(undefined, 500)).toBe('error');
    expect(intState('INTEGRATIONS_FORBIDDEN', 403)).toBe('restricted'); expect(intState(undefined, 404, true)).toBe('notFound');
    expect(akFailures('API_KEY_REFUSED', 422, { refusals: [{ code: 'name_length' }, { code: 'scope_unknown' }] })).toEqual(['name_length', 'scope_unknown']);
    expect(akFailures('CHECKER_IS_MAKER', 409)).toEqual(['CHECKER_IS_MAKER']);
    expect(INTEGRATIONS_HREF).toBe('/settings/integrations');
  });
});
