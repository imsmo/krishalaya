// apps/admin-api/src/__tests__/admin-module-boot.spec.ts · DEV-56 Part 4 — THE MISSING REGRESSION CONTROL.
//
// `PayoutOpsModule` (PC-56 ADMIN-6b) was `import`ed at the top of `admin.module.ts` but never listed in its
// `@Module({ imports: [...] })` array — the only such case among every module wired into this realm (grep-verified).
// Nest does not error on this: an unused TypeScript import is legal TypeScript, and a class that is never added to
// `imports` is simply absent from the dependency graph — no exception, no log line, nothing at boot. The result was
// silent: `PayoutOpsController`'s 9 routes (`/v1/payouts/batches`, `/v1/payouts/settlement`, …) never existed on the
// running server, and every request to them 404'd as "route not found" — indistinguishable from a typo in the URL.
//
// ZERO TESTS IN EITHER admin-api OR web-admin BOOT THE REAL NEST GRAPH before this file (grep-verified: no existing
// spec imports `AdminModule` or calls `NestFactory.create`/`Test.createTestingModule` against it) — every module's
// own spec tests its controller/service/repository in isolation with mocked collaborators, which is correct for
// UNIT coverage and structurally blind to "is this module actually wired into the app". This file is that control.
//
// NO NEW DEPENDENCY: `@nestjs/testing` is not installed anywhere in this repo (grep-verified across every
// package.json) and adding it would violate the "no new deps" gate for a boat that `@nestjs/core`'s own
// `NestFactory` already does — `NestFactory.create()` boots the exact same module graph `main.ts` boots in
// production, minus the `.listen()` call.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AdminModule } from '../admin.module';

/** PascalCase a kebab-case directory name and append 'Module' — the naming convention every module in this realm
 *  already follows (grep-verified: `ai-models-ops/ai-models-ops.module.ts` exports `AiModelsOpsModule`,
 *  `payout-ops/payout-ops.module.ts` exports `PayoutOpsModule`, etc. — zero exceptions found). */
function expectedModuleClassName(dirName: string): string {
  return dirName.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('') + 'Module';
}

describe('AdminModule — the missing regression control (DEV-56 Part 4)', () => {
  const modulesDir = path.join(__dirname, '..', 'modules');
  const moduleDirs = fs.readdirSync(modulesDir).filter((f) => fs.statSync(path.join(modulesDir, f)).isDirectory());

  it('lists at least one module directory (sanity — a passing suite over an empty set proves nothing)', () => {
    expect(moduleDirs.length).toBeGreaterThan(20); // 35 at DEV-56 time; a generous floor so a future prune doesn't need editing this number
  });

  it('every directory under src/modules/ is present in AdminModule\'s own imports array', () => {
    // Read the DECORATOR METADATA directly — not a hand-maintained list, so this test cannot drift from the real
    // imports array the way a hardcoded expectation would. This is the exact static check that would have caught
    // PayoutOpsModule's omission: the file `import`ed it (so a naive "is it imported" grep would have missed the
    // bug too — see the file header) but never placed it in this array.
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AdminModule) ?? []) as Array<{ name: string }>;
    const importedNames = new Set(imports.map((m) => m.name));

    const missing: string[] = [];
    for (const dir of moduleDirs) {
      const expected = expectedModuleClassName(dir);
      if (!importedNames.has(expected)) missing.push(`${dir} (expected ${expected} in AdminModule's imports array)`);
    }
    expect(missing).toEqual([]);
  });

  it('boots the REAL AdminModule via NestFactory (the same call main.ts makes, minus .listen()) with zero DI errors', async () => {
    const app = await NestFactory.create<NestExpressApplication>(AdminModule, { logger: false });
    try {
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await app.init(); // throws if any provider/controller in the graph cannot be resolved
      expect(app).toBeDefined();
    } finally {
      await app.close();
    }
  }, 30_000);

  it('PayoutOpsController\'s routes are actually bound on the Express router — not merely "did not throw"', async () => {
    // `app.init()` succeeding proves the DI graph resolves; it does NOT by itself prove a specific module's ROUTES
    // registered (a module missing from `imports` also lets the rest of the app boot cleanly, which is exactly how
    // the original defect went unnoticed). This test walks the real Express router stack and looks for the payout
    // plane's own paths — the same 9 endpoints the binding brief named as dead before this batch.
    const app = await NestFactory.create<NestExpressApplication>(AdminModule, { logger: false });
    let paths: string[] = [];
    try {
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await app.init();
      paths = collectExpressPaths(app.getHttpAdapter().getInstance());
    } finally {
      await app.close();
    }
    // '/v1/payouts/batches' (GET, from PayoutOpsController's @Controller({ path: 'payouts', version: '1' }) +
    // @Get('batches')) and '/v1/payouts/settlement' (GET) are two of the nine; finding either is proof the
    // controller's routes are bound, not merely that the class was constructed.
    const hasPayoutBatches = paths.some((p) => p.includes('/v1/payouts/batches'));
    const hasPayoutSettlement = paths.some((p) => p.includes('/v1/payouts/settlement'));
    expect({ hasPayoutBatches, hasPayoutSettlement, sampleOfAllPaths: paths.slice(0, 5) }).toEqual(
      expect.objectContaining({ hasPayoutBatches: true, hasPayoutSettlement: true }),
    );
  }, 30_000);
});

/** Flatten Express 4's router stack (recursing into mounted sub-routers) into a list of registered path strings.
 *  Nest's ExpressAdapter registers most routes directly on the app's own router, but this recurses regardless so
 *  the test does not depend on that implementation detail. */
function collectExpressPaths(expressInstance: unknown): string[] {
  const out: string[] = [];
  const router = (expressInstance as { _router?: { stack?: unknown[] } })._router;
  const walk = (stack: unknown[] | undefined, prefix: string) => {
    if (!Array.isArray(stack)) return;
    for (const layer of stack as Array<Record<string, any>>) {
      if (layer.route?.path) {
        const p = typeof layer.route.path === 'string' ? layer.route.path : String(layer.route.path);
        out.push(prefix + p);
      } else if (layer.name === 'router' && layer.handle?.stack) {
        const mount = layer.regexp?.fast_slash ? '' : (layer.path ?? '');
        walk(layer.handle.stack, prefix + mount);
      }
    }
  };
  walk(router?.stack, '');
  return out;
}
