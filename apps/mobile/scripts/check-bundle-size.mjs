// apps/mobile/scripts/check-bundle-size.mjs · CI bundle-size gate (MOBILE_AI_AGENT_BUILD_GUIDE §5: keep the install
// small). Exports the production Hermes bundle with the Expo CLI and fails the build if it exceeds the budget.
// Run in CI after install; no secrets needed. Budget is the Hermes bytecode AS SHIPPED (not the whole APK/AAB) — a fast
// proxy that catches a runaway dependency before it bloats the install. Override with MOBILE_BUNDLE_BUDGET_KB.
// PC-56 BUNDLE-1a: release builds strip the debug tables out of the .hbc (gradle plugin default hermesFlags
// ["-O","-output-source-map"]), so the export runs with --source-maps and the .map is never summed. The pure parts
// (argv, which files count, the verdict) live in bundle-size-lib.cjs and are pinned by core spec bundle1a-size-and-fonts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { APP_DIR, exportArgs, sumCounted, budgetKb, verdict } = require('./bundle-size-lib.cjs');

const BUDGET_KB = budgetKb(process.env.MOBILE_BUNDLE_BUDGET_KB);
const out = mkdtempSync(join(tmpdir(), 'kv-bundle-'));

try {
  // Export the production bundle for Android (Hermes), from the app dir. Expo writes it under <out>/_expo/static/js.
  execFileSync('npx', exportArgs(out), { cwd: APP_DIR, stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'production' } });

  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push({ name: e.name, size: statSync(p).size });
    }
  };
  walk(out);

  // exitCode, not process.exit(): exit() would skip the `finally` and leak the temp export on every failure.
  const v = verdict(sumCounted(files), BUDGET_KB);
  if (v.empty) { console.error('bundle-size: no JS/Hermes bundle found in export — failing.'); process.exitCode = 1; }
  else {
    console.log(`bundle-size: Hermes bytecode as shipped = ${v.kb} KB (budget ${BUDGET_KB} KB)`);
    if (v.over) { console.error(`bundle-size: OVER BUDGET by ${v.overBy} KB — trim a dependency or lazy-load it (§5).`); process.exitCode = 1; }
    else console.log('bundle-size: within budget ✓');
  }
} finally {
  try { rmSync(out, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
}
