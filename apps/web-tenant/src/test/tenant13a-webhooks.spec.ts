// apps/web-tenant/src/test/tenant13a-webhooks.spec.ts · PC-56 TENANT-13a · the webhook console's pure rules and its two security
// properties, each failing on HEAD c0250c1:
//   F-5  THE SECRET NEVER TRAVELS IN A URL — no page reads a `secret` query parameter, no action redirects with one, register / rotate
//        RETURN it to a client component that keeps it in memory (never storage, cookie or console); the old route reads nothing and
//        redirects; the developer pages are served `Cache-Control: no-store` + `Referrer-Policy: no-referrer` (next.config.js AND the
//        middleware);
//   W188/W189  the console mirrors the API: every refusal / guard code the API can answer has a sentence; every key the pages use exists;
//        rates only over real attempts; the ladder step names the "Next retry" cell; the diagnosis is a sentence of facts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import {
  DELIVERIES_HREF, FORM_KEYS, GUARD_REASONS, REFUSAL_CODES, WEBHOOKS_HREF, actHref, diagnosisLine, failureCodesFrom, fill, formKeysWithRefusals, logHref,
  nextRetryCell, pageSizeOf, pageState, parseCodes, promiseVars, refusalKey, rowActs, secretMask, sinceOf, statusKey, successLine, windowOf,
} from '../features/webhooks/webhooks';
import { SECRET_PAGE_HEADERS, secretPageHeaders } from '../features/webhooks/headers';

const SRC = join(__dirname, '..');
const API = join(SRC, '..', '..', 'api', 'src', 'modules', 'tenant-webhooks');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
}
const PAGES = [...walk(join(SRC, 'app', 'settings', 'developers', 'webhooks')), ...walk(join(SRC, 'app', 'settings', 'webhooks'))].filter((f) => /\.(ts|tsx)$/.test(f));
const read = (p: string) => readFileSync(p, 'utf8');

describe('F-5 · the signing secret never travels in a URL', () => {
  it('no webhook page or action reads, writes or redirects with a `secret` query parameter', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(10);
    for (const f of PAGES) {
      const s = read(f).replace(/^\s*\/\/.*$/gm, '');                    // code, not commentary
      expect({ f, hit: /[?&]secret(For)?=/.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /searchParams\.secret|searchParams\[['"]secret/.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /redirect\([^)]*secret/i.test(s) }).toEqual({ f, hit: false });
      expect({ f, hit: /(localStorage|sessionStorage|document\.cookie|console\.(log|info|warn|error))/.test(s) }).toEqual({ f, hit: false });
    }
  });
  it('register and rotate RETURN the secret from the server action to a client component', () => {
    const actions = read(join(SRC, 'app', 'settings', 'developers', 'webhooks', 'actions.ts'));
    expect(actions).toContain("'use server'");
    expect(actions).toMatch(/return \{ ok: true, id: r\.id, secret: r\.secret/);
    expect(actions).toMatch(/return \{ ok: true, secret: r\.secret/);
    const chain = read(join(SRC, 'app', 'settings', 'developers', 'webhooks', 'new', 'AddEndpointChain.tsx'));
    const rotate = read(join(SRC, 'app', 'settings', 'developers', 'webhooks', '[id]', 'act', 'RotateSecretConfirm.tsx'));
    for (const c of [chain, rotate]) {
      expect(c.startsWith("'use client'")).toBe(true);
      expect(c).toMatch(/useState/);                                           // held in memory
      expect(c).toContain('data-secret="once"');
      expect(c).toMatch(/setResult\(\{ \.\.\.result, secret: null \}\)/);     // "Hide" drops it
    }
  });
  it('the old /settings/webhooks route reads nothing from the query string and redirects to the canon path; its old actions are gone', () => {
    const legacy = read(join(SRC, 'app', 'settings', 'webhooks', 'page.tsx')).replace(/^\s*\/\/.*$/gm, '');
    expect(legacy).toContain('redirect(WEBHOOKS_HREF)');
    expect(legacy).not.toMatch(/searchParams/);
    expect(read(join(SRC, 'app', 'settings', 'webhooks', 'actions.ts'))).not.toMatch(/export (async )?function/);
    expect(WEBHOOKS_HREF).toBe('/settings/developers/webhooks');
  });
  it('the developer pages are served no-store + no-referrer — next.config.js and the middleware', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cfg = require(join(SRC, '..', 'next.config.js'));
    const rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await cfg.headers();
    for (const source of ['/settings/developers/webhooks', '/settings/developers/webhooks/:path*']) {
      const r = rules.find((x) => x.source === source);
      expect(r).toBeDefined();
      const h = Object.fromEntries(r!.headers.map((x) => [x.key, x.value]));
      expect(h['Cache-Control']).toMatch(/no-store/);
      expect(h['Referrer-Policy']).toBe('no-referrer');
      // listed AFTER the catch-all, so these values win for these paths
      expect(rules.indexOf(r!)).toBeGreaterThan(rules.findIndex((x) => x.source === '/:path*'));
    }
    expect(secretPageHeaders('/settings/developers/webhooks')).toEqual(SECRET_PAGE_HEADERS);
    expect(secretPageHeaders('/settings/developers/webhooks/new')).toEqual(SECRET_PAGE_HEADERS);
    expect(secretPageHeaders('/settings/developersX')).toEqual({});   // 13c: the whole developer area is secret-bearing now
    expect(secretPageHeaders('/dashboard')).toEqual({});
    expect(read(join(SRC, 'middleware.ts'))).toContain('secretPageHeaders(req.nextUrl.pathname)');
  });
});

describe('W188 / W189 · the console mirrors the API', () => {
  const rules = read(join(API, 'domain', 'webhook-rules.ts'));
  const ssrf = read(join(API, 'domain', 'webhook-ssrf.ts'));
  it('every refusal code the API can answer has a sentence; every guard reason has one', () => {
    for (const m of rules.matchAll(/'((?:URL|EVENTS?|EMAIL|REASON|NOT|GUARD|ROTATION|ENDPOINT|NOTHING|STATE)_[A-Z_]+)'/g)) expect(REFUSAL_CODES).toContain(m[1]);
    for (const m of ssrf.matchAll(/\| '([a-z_]+)'/g)) expect(GUARD_REASONS).toContain(m[1]);
    for (const k of formKeysWithRefusals()) expect(en[k]).toBeDefined();
  });
  it('every t.t(\'wh.…\') literal in the pages exists in en (parity covers hi / gu)', () => {
    const keys = new Set<string>();
    for (const f of PAGES) for (const m of read(f).matchAll(/t\.t\('(wh\.[A-Za-z0-9_.-]+)'/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(60);
    for (const k of keys) expect({ k, ok: k in en }).toEqual({ k, ok: true });
    for (const a of ['pause', 'resume', 'rotate', 'delete', 'replay-failed']) for (const s of ['button', 'title', 'effect', 'proceed', 'done']) expect(en[`wh.act.${a}.${s}`]).toBeDefined();
    for (const st of ['pending', 'retrying', 'delivered', 'held', 'exhausted', 'cancelled']) { expect(en[`wh.delivery.state.${st}`]).toBeDefined(); expect(en[`wh.log.next.${st}`]).toBeDefined(); }
    for (const s of ['flaggedOff', 'restricted', 'notFound', 'error']) { expect(en[`wh.state.${s}.title`]).toBeDefined(); expect(en[`wh.state.log.${s}.title`]).toBeDefined(); }
    for (const k of FORM_KEYS) expect(en[k]).toBeDefined();
  });
  it('the corrected secret sentence: encrypted at rest, shown once — never "stored hashed"', () => {
    expect(en['wh.list.lede']).toMatch(/encrypted at rest and shown once/);
    for (const [k, v] of Object.entries(en)) if (k.startsWith('wh.')) expect({ k, v: /stored hashed|cannot read them back/i.test(v) }).toEqual({ k, v: false });
  });
});

describe('W188 · what a row says', () => {
  const stats = (o: Partial<{ attempts7d: number; okAttempts7d: number; successBp7d: number | null; delivered7d: number; failedToday: number; held: number; failedOpen: number }> = {}) =>
    ({ attempts7d: 0, okAttempts7d: 0, successBp7d: null, delivered7d: 0, failedToday: 0, held: 0, failedOpen: 0, ...o });
  it('a rate only over real attempts — never a fabricated 100%', () => {
    expect(successLine(stats())).toEqual({ key: 'wh.list.success.none', vars: { delivered: '0' } });
    expect(successLine(stats({ attempts7d: 1416, okAttempts7d: 1412, successBp7d: 9971, delivered7d: 1412 }))).toEqual({ key: 'wh.list.success.rate', vars: { pct: '99.7', delivered: '1412' } });
    expect(successLine(stats({ attempts7d: 108, okAttempts7d: 96, successBp7d: 8888, delivered7d: 96, failedToday: 12 }))).toEqual({ key: 'wh.list.success.withFailures', vars: { pct: '88.9', delivered: '96', failedToday: '12' } });
    expect(successLine(stats({ attempts7d: 4, okAttempts7d: 4, successBp7d: 10000, delivered7d: 4 })).vars.pct).toBe('100');
  });
  it('the mask, the status, the row acts', () => {
    expect(secretMask('8f2')).toBe('whsec_••••8f2'); expect(secretMask(null)).toBeNull();
    expect(statusKey({ status: 'paused', pausedReason: 'exhausted' })).toBe('wh.status.paused.exhausted');
    expect(statusKey({ status: 'disabled', pausedReason: 'unsafe_target' })).toBe('wh.status.disabled.unsafe_target');
    expect(rowActs({ status: 'active', previousSecretSignsUntil: null, stats: stats({ failedOpen: 2 }) })).toEqual(['pause', 'rotate', 'replay-failed', 'delete']);
    expect(rowActs({ status: 'paused', previousSecretSignsUntil: '2026-10-04T10:00:00.000Z', stats: stats() })).toEqual(['resume', 'delete']);
    expect(actHref('e 1', 'rotate')).toBe('/settings/developers/webhooks/e%201/act?act=rotate&step=confirm');
  });
  it('the promises are printed from the contract the API returned', () => {
    const v = promiseVars({ ladder: ['1m', '5m', '30m', '2h', '12h'], attemptsPerCycle: 6, pausesEndpointAfterExhaustion: true, holdsWhilePaused: true, rotationOverlapHours: 24, retentionDays: 90, timeoutSeconds: 10, responseCapKiB: 64, payloadVersion: 1, signatureHeader: 'Krishalaya-Signature', secretStorage: 'encrypted_at_rest_shown_once', redirects: 'refused', ports: [443] });
    expect(fill(en['wh.promise.backoff'], v)).toContain('1m · 5m · 30m · 2h · 12h');
    expect(fill(en['wh.rotate.body'], v)).toContain('24 hours');
    expect(fill(en['wh.promise.neverLost'], v)).toContain('90 days');
  });
});

describe('W189 · the log', () => {
  it('filters, window, page size, µs cursor in the URL — never a value that could carry a secret or a URL', () => {
    expect(logHref({ window: '24h', size: 25 })).toBe(DELIVERIES_HREF);
    expect(logHref({ endpointId: 'e1', failedOnly: true, window: '7d', size: 50, cursor: 'CUR' })).toBe(`${DELIVERIES_HREF}?endpoint=e1&failed=1&window=7d&size=50&cursor=CUR`);
    expect(windowOf('90d')).toBe('90d'); expect(windowOf('1y')).toBe('24h');
    expect(pageSizeOf('100')).toBe(100); expect(pageSizeOf('1000')).toBe(25);
    expect(sinceOf('24h', new Date('2026-10-03T10:00:00.000Z'))).toBe('2026-10-02T10:00:00.000Z');
  });
  it('"Next retry" names the ladder step; held / exhausted / cancelled say why nothing is due', () => {
    expect(nextRetryCell({ state: 'retrying', nextRetryAt: '2026-10-03T09:52:00.000Z', nextRetryStep: '30m' })).toEqual({ key: 'wh.log.next.backoff', at: '2026-10-03T09:52:00.000Z', step: '30m' });
    expect(fill(en['wh.log.next.backoff'], { at: '15:22', step: '30m' })).toBe('15:22 (30m backoff)');
    expect(nextRetryCell({ state: 'held', nextRetryAt: null, nextRetryStep: null }).key).toBe('wh.log.next.held');
    expect(nextRetryCell({ state: 'delivered', nextRetryAt: null, nextRetryStep: null }).key).toBe('wh.log.next.delivered');
  });
  it('the diagnosis is a sentence of facts', () => {
    expect(diagnosisLine(null)).toBeNull();
    const d = diagnosisLine({ failures: 12, codes: [{ code: '504', count: 12 }], endpoints: [{ id: 'e1', host: 'sheets-bridge.anandfpo.in', count: 12 }], since: '2026-10-03T09:02:00.000000Z', singleCause: true })!;
    expect(fill(en[d.key], { ...d.vars, since: '14:32' })).toBe('Diagnosis (computed from the attempts): 12 failed attempts, all 504, all on sheets-bridge.anandfpo.in, since 14:32 — that server looks down, not our delivery.');
    const m = diagnosisLine({ failures: 5, codes: [{ code: '504', count: 3 }, { code: 'timeout', count: 2 }], endpoints: [{ id: 'e1', host: 'a.in', count: 3 }, { id: 'e2', host: 'b.in', count: 2 }], since: 'x', singleCause: false })!;
    expect(m.key).toBe('wh.log.diagnosis.mixed');
    expect(m.vars.codes).toBe('504 ×3, timeout ×2');
  });
  it('states and refusals', () => {
    expect(pageState('WEBHOOKS_FORBIDDEN', 403)).toBe('restricted');
    expect(pageState(undefined, 404)).toBe('flaggedOff');
    expect(pageState(undefined, 404, true)).toBe('notFound');
    expect(pageState('X', 500)).toBe('error');
    expect(failureCodesFrom('WEBHOOK_REFUSED', 422, { refusals: [{ code: 'URL_PRIVATE_ADDRESS' }, { code: 'EMAIL_INVALID' }] })).toEqual(['URL_PRIVATE_ADDRESS', 'EMAIL_INVALID']);
    expect(refusalKey('URL_PRIVATE_ADDRESS')).toBe('wh.refusal.URL_PRIVATE_ADDRESS');
    expect(refusalKey('SOMETHING_NEW')).toBe('wh.refusal.unknown');
    expect(parseCodes('A_B,<script>,C_D')).toEqual(['A_B', 'C_D']);
  });
});
