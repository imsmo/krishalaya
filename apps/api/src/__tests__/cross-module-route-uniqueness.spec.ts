// apps/api/src/__tests__/cross-module-route-uniqueness.spec.ts · PC-56 TENANT-11c · F-3 — ONE ROUTE, ONE OWNER, ACROSS EVERY MODULE.
//
// THE FINDING. `POST /v1/group-lots` and `POST /v1/group-lots/:id/pledges` were declared by TWO controllers — the listings
// module's duplicate and the group-lots module's own. Nest registers both and answers from the FIRST module imported
// (ListingsModule is 5th in AppModule, GroupLotsModule 27th), so for the life of the feature every create and every pledge
// was served by a handler that INSERTed a `version` column `group_lots` never had. Each module's own route-order gate (the
// TENANT-10a shape, `ambassadors/__tests__/tenant10a-ambassadors.spec.ts`) walks ONE controller set and could not see it.
//
// THIS GATE walks EVERY controller of EVERY module reachable from the real AppModule (the HOTFIX-1 boot gate's walk), keys each
// handler on version + method + path with parameter NAMES erased (`:id` ≡ `:lotId` — Nest routes them identically), and fails
// on any key declared twice. It runs in the `unit` project: decorator metadata only, no database, no network.
import 'reflect-metadata';
import { MODULE_METADATA, METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { Controller, Get, Post, RequestMethod } from '@nestjs/common';

const NAME: Record<number, string> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH', [RequestMethod.ALL]: 'ALL', [RequestMethod.OPTIONS]: 'OPTIONS', [RequestMethod.HEAD]: 'HEAD',
};

function unwrap(entry: unknown): Function | undefined {
  if (!entry) return undefined;
  if (typeof entry === 'function') return entry as Function;
  const e = entry as { forwardRef?: () => unknown; module?: Function };
  if (typeof e.forwardRef === 'function') return unwrap(e.forwardRef());
  if (typeof e.module === 'function') return e.module;
  return undefined;
}
function reachableFrom(root: Function): Set<Function> {
  const seen = new Set<Function>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const m = unwrap(stack.pop());
    if (!m || seen.has(m)) continue;
    seen.add(m);
    stack.push(...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, m) ?? []) as unknown[]));
  }
  return seen;
}
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [v === undefined ? '' : String(v)]);
/** `/group-lots/:lotId/pledges/` → `group-lots/:/pledges` — Nest matches parameters by position, not by name. */
export function normalise(path: string): string {
  return path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? ':' : s)).join('/');
}

export interface RouteKey { key: string; label: string }
/** Every handler of every controller, keyed on version + method + normalised path. */
export function routeKeys(entries: Array<{ owner: string; controller: Function }>): RouteKey[] {
  const out: RouteKey[] = [];
  for (const { owner, controller } of entries) {
    const bases = asList(Reflect.getMetadata(PATH_METADATA, controller));
    const classVersions = asList(Reflect.getMetadata(VERSION_METADATA, controller) ?? 'neutral');
    for (const h of Object.getOwnPropertyNames(controller.prototype)) {
      const fn = controller.prototype[h];
      if (h === 'constructor' || typeof fn !== 'function') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn);
      if (m === undefined) continue;
      const subs = asList(Reflect.getMetadata(PATH_METADATA, fn));
      const versions = asList(Reflect.getMetadata(VERSION_METADATA, fn) ?? classVersions);
      for (const v of versions) for (const b of bases) for (const s of subs) {
        const p = normalise([b, s].filter((x) => x && x !== '/').join('/'));
        out.push({ key: `v${v} ${NAME[m] ?? m} /${p}`, label: `${owner}.${controller.name}.${h}` });
      }
    }
  }
  return out;
}
export function duplicates(keys: RouteKey[]): string[] {
  const by = new Map<string, string[]>();
  for (const k of keys) by.set(k.key, [...(by.get(k.key) ?? []), k.label]);
  return [...by.entries()].filter(([, owners]) => owners.length > 1).map(([key, owners]) => `${key} ← ${owners.join(' + ')}`);
}

describe('F-3 · cross-module route uniqueness (every controller reachable from AppModule)', () => {
  const env = { ...process.env };
  beforeAll(() => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'route-gate-access-secret-route-gate-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'route-gate-hash-pepper-route-gate-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/route_gate_never_dialled';
  });
  afterAll(() => { process.env = env; });

  it('the gate itself catches a duplicate declared by two modules (the F-3 shape, with renamed params)', () => {
    @Controller({ path: 'group-lots', version: '1' }) class A { @Post() c() { return 1; } @Post(':id/pledges') p() { return 1; } @Get(':id') g() { return 1; } }
    @Controller({ path: 'group-lots', version: '1' }) class B { @Post() c() { return 1; } @Post(':lotId/pledges') p() { return 1; } }
    @Controller({ path: 'group-lots', version: '2' }) class C { @Post() c() { return 1; } }
    const d = duplicates(routeKeys([{ owner: 'ListingsModule', controller: A }, { owner: 'GroupLotsModule', controller: B }, { owner: 'Other', controller: C }]));
    expect(d).toEqual([
      'v1 POST /group-lots ← ListingsModule.A.c + GroupLotsModule.B.c',
      'v1 POST /group-lots/:/pledges ← ListingsModule.A.p + GroupLotsModule.B.p',
    ]);
  });

  it('no version + method + path is declared by two handlers anywhere in the app', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    const entries: Array<{ owner: string; controller: Function }> = [];
    for (const mod of reachableFrom(AppModule)) {
      for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, mod) ?? []) as Function[]) entries.push({ owner: mod.name, controller: c });
    }
    const keys = routeKeys(entries);
    expect(keys.length).toBeGreaterThan(900);   // ~1,060 at 11b; a floor so an empty walk cannot pass
    expect(duplicates(keys)).toEqual([]);
    // and the two F-3 routes now have exactly one owner — the group-lots module
    for (const k of ['v1 POST /group-lots', 'v1 POST /group-lots/:/pledges']) {
      const owners = keys.filter((x) => x.key === k).map((x) => x.label);
      expect(owners).toEqual([expect.stringMatching(/^GroupLotsModule\.GroupLotsController\./)]);
    }
  });
});
