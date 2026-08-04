#!/usr/bin/env node
// scripts/pilot-e2e/relay-tick.mjs
// One-shot outbox relay tick for the Krishalaya pilot E2E proof.
//
// WHY THIS FILE EXISTS: apps/api/src/core/outbox/relay.poller.ts exports runRelay(), but nothing in
// this repo invokes it at runtime today — apps/worker's outbox-gauge job only MEASURES the pending
// backlog (see apps/worker/src/jobs/outbox-gauge.job.ts and apps/worker/WORKER-RUNTIME.md, section
// "⛔ Deferred: domain-handler jobs"). Until S1 wires a permanent timer, pilot transitions
// (payment_succeeded -> order confirmed, orders.order_completed -> escrow release + notifications)
// never fire on their own — see the loud warning run.sh prints before the flow starts.
//
//     >>> This script is the manual stand-in. It is NOT what S1 should ship. <<<
//
// MECHANISM CHOSEN (documented per the task brief — three options were considered):
//   1. Import the dispatcher directly into a plain .mjs — REJECTED. The dispatcher + its handlers
//      are TypeScript with decorator metadata (reflect-metadata) and are never compiled to a
//      standalone JS bundle outside the api's own `tsc` build; there is no stable compiled-JS import
//      target for a script living outside apps/api.
//   2. `node --conditions ...` against the compiled dist — REJECTED. `pnpm --filter api build`
//      compiles ONLY main.ts/app.module.ts/core/shared/listings per apps/api/tsconfig.json's
//      "include" (payments/orders/communication are pulled in transitively by the compiler, but the
//      dist layout/entry points are not a published, stable module surface to import from a script).
//   3. `pnpm --filter @krishalaya/api exec ts-node <file>.ts` — CHOSEN. ts-node is already a
//      devDependency of @krishalaya/api (no new package added anywhere). It transpiles the target
//      file on demand from apps/api's own tsconfig (decorators + paths just work) and needs no build
//      step. The implementation lives in a NEW file (no existing source touched):
//        apps/api/src/modules/payments/pilot-e2e/relay-tick.ts
//      which copies the exact dependency-wiring pattern already proven in
//      apps/api/src/modules/payments/__tests__/orders-payments-e2e.integration.spec.ts (that spec
//      constructs OutboxDispatcher + OutboxHandlerRegistry + handlers by hand, with a raw pg Pool —
//      no Nest DI bootstrap needed). This file is only a thin child-process launcher for it.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// The relay tick needs a DB URL (ideally a BYPASSRLS role so it can see outbox_events across the
// tenant). When invoked from the demo-seed / pilot-e2e scripts the caller's shell often has NO DB
// vars exported — but apps/api/.env always has them (the API reads the same file). So we load that
// file here and fill in only the keys the tick understands, WITHOUT overriding anything already set
// in the environment. This makes `node scripts/demo-seed/run.mjs` work with zero prefixing.
function loadApiEnv() {
  const out = {};
  try {
    const raw = readFileSync(path.join(repoRoot, 'apps', 'api', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;                                   // skip comments / blanks
      let [, k, v] = m;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[k] = v;
    }
  } catch { /* no .env — fall back to whatever the shell provides */ }
  return out;
}

const apiEnv = loadApiEnv();
const DB_KEYS = ['DATABASE_ADMIN_URL', 'MIGRATION_DATABASE_URL', 'DATABASE_URL'];
const injected = {};
for (const k of DB_KEYS) {
  if (!process.env[k] && apiEnv[k]) injected[k] = apiEnv[k];   // never override the shell
}

const env = {
  ...process.env,
  ...injected,
  // Skip full type-checking (fast; the tick file isn't inside tsconfig.json's narrow "include" list
  // used for root-file seeding — ts-node would otherwise try to typecheck the whole reachable graph).
  TS_NODE_TRANSPILE_ONLY: '1',
};

const result = spawnSync(
  'pnpm',
  ['--filter', '@krishalaya/api', 'exec', 'ts-node', 'src/modules/payments/pilot-e2e/relay-tick.ts'],
  { cwd: repoRoot, env, encoding: 'utf8' },
);

if (result.error) {
  console.error('[relay-tick] failed to spawn pnpm — is pnpm installed and on PATH?', result.error.message);
  process.exit(1);
}

// relay-tick.ts logs progress to stderr and prints exactly ONE JSON summary line to stdout.
if (result.stderr) process.stderr.write(result.stderr);
const out = (result.stdout || '').trim();

if (result.status !== 0) {
  console.error(`[relay-tick] ts-node exited with code ${result.status}`);
  if (out) console.error(out);
  process.exit(result.status ?? 1);
}

const lastLine = out.split('\n').filter(Boolean).pop() || '{}';
try {
  const summary = JSON.parse(lastLine);
  console.error(`[relay-tick] processed ${summary.processed} outbox event(s)`);
  // Re-emit the JSON as the last line of OUR stdout too, so a parent script (flow.mjs) can read it.
  process.stdout.write(lastLine + '\n');
} catch {
  console.error('[relay-tick] could not parse summary line:', lastLine);
  process.stdout.write('{"ok":false,"processed":0}\n');
}
