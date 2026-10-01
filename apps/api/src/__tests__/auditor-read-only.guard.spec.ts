// apps/api/src/__tests__/auditor-read-only.guard.spec.ts · PC-56 TENANT-9c · THE AUDITOR IS READ-ONLY BY CONSTRUCTION — PROVEN
// OVER THE REAL ROUTER, NOT OVER A LIST SOMEBODY WROTE.
//
// Builds the real AppModule (the HOTFIX-1 boot gate's shape — `NestFactory.create`, no database dialled), walks EVERY
// controller method Nest registered (the same PATH / METHOD metadata Nest's RouterExplorer reads), and for every mutating
// route runs the GLOBAL AuditorReadOnlyGuard as an auditor session would reach it: refused, recorded, unless the route
// carries `@AuditorReadAct` — and the set that does is asserted to be EXACTLY the three named carve-outs. A new POST added
// tomorrow by somebody who never heard of this wave is refused for the auditor without them doing anything, and this spec
// prints it in the refused count.
import 'reflect-metadata';
import { NestFactory, Reflector, ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { runWithContext, type RequestContext } from '../core/tenancy-context/request-context';
import {
  AuditorReadOnlyGuard, AuditorReadOnlyError, AUDITOR_READ_ACT_KEY, AUDITOR_READ_ACTS, auditorVerdict,
} from '../core/auth/auditor-read-only.guard';

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH', [RequestMethod.ALL]: 'ALL', [RequestMethod.OPTIONS]: 'OPTIONS', [RequestMethod.HEAD]: 'HEAD',
};

type Handler = (...args: never[]) => unknown;
type Ctor = { name: string; prototype: object };
interface Route { controller: string; handler: string; method: string; path: string; fn: Handler; cls: Ctor; act: unknown }

const ctxOf = (roles: string[]): RequestContext => ({
  tenantId: '01a0c000-0000-7000-8000-000000000001', userId: '01a0c000-0000-7000-8000-0000000000aa', sessionId: 's', requestId: 'req-9c',
  lang: 'en', roles, permissions: new Set(['audit.read', 'ledger.read', 'kyc.read', 'governance.read', 'report.view']), shardId: 0,
});

const execCtx = (r: Route) => ({
  getType: () => 'http',
  getHandler: () => r.fn,
  getClass: () => r.cls,
  switchToHttp: () => ({ getRequest: () => ({ method: r.method, originalUrl: `/v1/${r.path}` }) }),
}) as never;

describe('PC-56 TENANT-9c · AuditorReadOnlyGuard — every mutating route in the real router', () => {
  const env = { ...process.env };
  let app: INestApplication | undefined;
  const routes: Route[] = [];

  beforeAll(async () => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'boot-gate-access-secret-boot-gate-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'boot-gate-hash-pepper-boot-gate-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/boot_gate_never_dialled';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- lazily, after the env is set (the boot gate's shape)
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    const seen = new Set<Ctor>();
    for (const mod of app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const cls = wrapper.metatype as unknown as Ctor;
        if (!cls || seen.has(cls)) continue;
        seen.add(cls);
        const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        for (const name of Object.getOwnPropertyNames(cls.prototype)) {
          if (name === 'constructor') continue;
          const fn = (cls.prototype as Record<string, unknown>)[name];
          if (typeof fn !== 'function') continue;
          const handler = fn as Handler;
          const m = Reflect.getMetadata(METHOD_METADATA, handler);
          if (m === undefined) continue;
          const sub = Reflect.getMetadata(PATH_METADATA, handler);
          const subs = Array.isArray(sub) ? sub : [sub ?? ''];
          for (const s of subs) {
            routes.push({ controller: cls.name, handler: name, method: METHOD_NAME[m as number], path: [base, String(s)].filter(Boolean).join('/').replace(/\/+/g, '/'), fn: handler, cls, act: Reflect.getMetadata(AUDITOR_READ_ACT_KEY, handler) });
          }
        }
      }
    }
  }, 120_000);
  afterAll(async () => { await app?.close(); process.env = env; });

  it('the guard is registered GLOBALLY (APP_GUARD in CoreModule), not per route', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- lazily, after the env is set
    const { CoreModule } = require('../core/core.module') as typeof import('../core/core.module');
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CoreModule) ?? []) as Array<{ provide?: unknown; useClass?: unknown }>;
    expect(providers.some((p) => p && p.provide === APP_GUARD && p.useClass === AuditorReadOnlyGuard)).toBe(true);
  });

  it('EVERY mutating route refuses an auditor session — except exactly the three named carve-outs', async () => {
    const recorded: Array<{ action: string; newValue: unknown }> = [];
    const guard = new AuditorReadOnlyGuard(new Reflector(), { log: async (e: { action: string; newValue: unknown }) => { recorded.push(e); } } as never);
    const mutating = routes.filter((r) => !['GET', 'HEAD', 'OPTIONS'].includes(r.method));
    const refused: string[] = []; const passed: string[] = [];
    for (const r of mutating) {
      const label = `${r.method} /v1/${r.path} (${r.controller}.${r.handler})`;
      const outcome = await runWithContext(ctxOf(['auditor']), async (): Promise<'refused' | 'passed'> => {
        try { await guard.canActivate(execCtx(r)); return 'passed'; } catch (e) { if (e instanceof AuditorReadOnlyError) return 'refused'; throw e; }
      });
      (outcome === 'refused' ? refused : passed).push(label);
    }
    const exempt = mutating.filter((r) => r.act !== undefined).map((r) => `${r.method} /v1/${r.path} [${String(r.act)}]`).sort();
    // The printed proof the report pastes.
    // eslint-disable-next-line no-console
    console.log(`[9c] routes walked: ${routes.length} · mutating: ${mutating.length} · REFUSED for auditor: ${refused.length} · passed: ${passed.length}\n[9c] passed (named): ${exempt.join(' · ')}`);
    expect(mutating.length).toBeGreaterThan(500);
    expect(exempt).toEqual([
      'POST /v1/auditor/exports [export.enqueue]',
      'POST /v1/auth/logout [session.logout]',
      'POST /v1/exports/:id/link [export.link]',
    ]);
    expect(passed.length).toBe(3);
    expect(refused.length).toBe(mutating.length - 3);
    // Every refusal was RECORDED before it was thrown.
    expect(recorded.length).toBe(refused.length);
    expect(new Set(recorded.map((x) => x.action))).toEqual(new Set(['auditor.write_refused']));
    // F-8's own route, by name: the GST credit note is refused for the auditor.
    expect(refused.some((l) => l.startsWith('POST /v1/invoices/:id/credit-notes'))).toBe(true);
  });

  it('the carve-out codes on routes are exactly the declared vocabulary (no typo can widen it)', () => {
    const used = [...new Set(routes.filter((r) => r.act !== undefined).map((r) => String(r.act)))].sort();
    expect(used).toEqual([...AUDITOR_READ_ACTS].sort());
  });

  it('holding a second role does not lift it; a non-auditor is not touched; reads pass', async () => {
    const guard = new AuditorReadOnlyGuard(new Reflector());
    const cn = routes.find((r) => r.path === 'invoices/:id/credit-notes' && r.method === 'POST')!;
    expect(cn).toBeDefined();
    const run = (roles: string[], r: Route) => runWithContext(ctxOf(roles), () => guard.canActivate(execCtx(r)).then(() => 'pass', (e) => (e as { code?: string }).code));
    expect(await run(['auditor', 'tenant_admin'], cn)).toBe('AUDITOR_READ_ONLY');
    expect(await run(['tenant_admin'], cn)).toBe('pass');
    const get = routes.find((r) => r.method === 'GET' && r.path === 'auditor/ledger')!;
    expect(await run(['auditor'], get)).toBe('pass');
  });

  it('the pure verdict', () => {
    expect(auditorVerdict(['auditor'], 'GET', undefined)).toBe('read');
    expect(auditorVerdict(['auditor'], 'head', undefined)).toBe('read');
    expect(auditorVerdict(['auditor'], 'OPTIONS', undefined)).toBe('read');
    expect(auditorVerdict(['auditor'], 'POST', undefined)).toBe('refused');
    expect(auditorVerdict(['auditor'], 'DELETE', 'export.enqueue')).toBe('named_exception');
    expect(auditorVerdict(['auditor'], 'POST', 'export.anything')).toBe('refused');
    expect(auditorVerdict(['farmer'], 'POST', undefined)).toBe('not_auditor');
    expect(auditorVerdict(undefined, 'POST', undefined)).toBe('not_auditor');
    expect(auditorVerdict([], 'PATCH', undefined)).toBe('not_auditor');
  });
});
