// apps/api/src/__tests__/app-module-boot.spec.ts · HOTFIX-1 — THE BOOT GATE THAT WAS NEVER WRITTEN.
//
// From PC-56 TENANT-4b (2026-08-14) until HOTFIX-1, `apps/api` could not start: `PayoutApprovalService` asked Nest for
// the `UnitOfWork` INTERFACE (erased to `Object` in decorator metadata) instead of the `UNIT_OF_WORK` token, and from
// TENANT-6d-1 (2026-08-21) `DairyBmcReadModel` also asked for `OpsAlertRepository`, which `LogisticsModule` never
// exported. Every wave in between passed its unit and live suites, because every one of those suites constructs its
// classes by hand with `new` — correct for unit coverage and structurally blind to "does the container resolve".
// The full-app harness (test/e2e/bootstrap.ts) DOES boot AppModule, but the `e2e` jest project is not run by
// .github/workflows/api-ci.yml, so nothing in CI ever asked Nest to build this graph.
//
// WHY THIS LIVES IN THE `unit` PROJECT (the one CI runs first, with no database): `NestFactory.create()` scans the
// module tree and constructs EVERY provider and controller — that is exactly where a DI break throws — but runs no
// lifecycle hook until `.init()`/`.listen()`. Provider construction must not need the network or a secret, only USE may
// (pg's `Pool` connects lazily, Redis/OpenSearch are Noop without a URL, the wallet is in-process), so the graph can be
// resolved honestly with no Postgres at all. A constructor that opens a socket would turn this spec red — and that is
// a finding, not a reason to move the spec. The env below is the same NODE_ENV=test shape e2e's bootstrap uses;
// `assertProductionSecurity` is untouched (NODE_ENV is not production).
//
// NO NEW DEPENDENCY: `@nestjs/testing` is not installed in this repo; `NestFactory.create` builds the identical graph
// main.ts builds (admin-api's DEV-56 `admin-module-boot.spec.ts` set this precedent).
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

const SRC = path.join(__dirname, '..');

/** Every `*.module.ts` that is deliberately NOT reachable from AppModule, with the reason. Empty at HOTFIX-1: all
 *  54 module files under src/modules + src/core are wired. A new entry needs a reason a reviewer can check. */
const NOT_WIRED: Record<string, string> = {};

function listModuleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...listModuleFiles(p)); }
    else if (entry.name.endsWith('.module.ts')) out.push(p);
  }
  return out;
}

/** Resolve one entry of an `imports` array (class, forwardRef, or dynamic module) to its module class. */
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
    const statics = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, m) ?? []) as unknown[];
    stack.push(...statics);
  }
  return seen;
}

describe('AppModule — the boot gate (HOTFIX-1)', () => {
  const env = { ...process.env };
  beforeAll(() => {
    // Same shape as test/e2e/bootstrap.ts. Only set what is unset, so CI's own env wins.
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'boot-gate-access-secret-boot-gate-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'boot-gate-hash-pepper-boot-gate-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    // Never touched: construction must not connect. A URL is required by config; nothing dials it in this spec.
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/boot_gate_never_dialled';
  });
  afterAll(() => { process.env = env; });

  it('the Nest container resolves EVERY provider and controller in the real AppModule (zero DI errors)', async () => {
    // Required lazily so the env above is in place before AppConfig is constructed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    let app: INestApplication | undefined;
    let failure: unknown;
    try {
      // abortOnError:false — throw the DI error into the test instead of process.exit(1).
      app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    } catch (e) { failure = e; }
    expect(failure === undefined ? 'resolved' : String((failure as Error).message ?? failure)).toBe('resolved');
    // Every module class in the graph is a real, constructed instance (sanity: the graph is not trivially empty).
    expect(app).toBeDefined();
    await app?.close();
  }, 120_000);

  it('every *.module.ts under src/modules and src/core is reachable from AppModule (or listed in NOT_WIRED with a reason)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    const reachable = reachableFrom(AppModule);
    const files = [...listModuleFiles(path.join(SRC, 'modules')), ...listModuleFiles(path.join(SRC, 'core'))];
    expect(files.length).toBeGreaterThan(40); // 54 at HOTFIX-1; a floor so an empty glob cannot pass

    const orphans: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const exported = require(file) as Record<string, unknown>;
      const moduleKeys: unknown[] = Object.values(MODULE_METADATA);
      const classes = Object.values(exported).filter(
        (v): v is Function => typeof v === 'function' && Reflect.getMetadataKeys(v).some((k) => moduleKeys.includes(k)),
      );
      if (classes.length === 0) { orphans.push(`${rel} (exports no @Module class)`); continue; }
      for (const c of classes) {
        if (!reachable.has(c) && !(rel in NOT_WIRED)) orphans.push(`${rel} → ${c.name} is imported by nothing reachable from AppModule`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('NOT_WIRED names only files that exist and gives each a reason', () => {
    for (const [rel, reason] of Object.entries(NOT_WIRED)) {
      expect(fs.existsSync(path.join(SRC, rel))).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });
});
