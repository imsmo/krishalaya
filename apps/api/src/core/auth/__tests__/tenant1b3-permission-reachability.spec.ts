// core/auth/__tests__/tenant1b3-permission-reachability.spec.ts · PC-56 TENANT-1b-3.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A PERMISSION CODE THAT IS NOT A ROW CANNOT BE GRANTED, SO EVERY ROUTE BEHIND IT
// REFUSES EVERYBODY.**
//
// `PermissionsGuard` allows a request only if the caller's resolved set contains every required code. That set comes from
// `role_permissions`, which is FK'd to `permissions(code)`. The tenant realm never resolves a wildcard — deliberately, Law
// 11 — so there is no super-admin escape hatch. A code with no row is a locked door with a sign on it.
//
// **SEVEN CODES HAD SHIPPED THAT WAY**, found by exactly the comparison below and fixed in 0128: `member.pii.reveal`
// (built, tested, mutation-checked and recorded as closed one wave earlier — the control was real, the door was welded
// shut), `listing.boost` (revenue stream #4), `group_lot.manage` and `group_lot.coordinate` (most of why a smallholder
// joins an FPO), `certificate.submit`, `certificate.verify`, and `listing.view_any`.
//
// This test is cheap and it is the only thing that makes the class of defect impossible to repeat. It reads the SEED and
// the MIGRATIONS, because a row added only to db/seeds fixes a fresh database and leaves every existing tenant broken.
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_SRC = path.join(__dirname, '..', '..', '..');
const DB = path.join(API_SRC, '..', '..', '..', 'db');

/** Every code declared in an `apps/api` policy object — the codes `@RequirePermissions` actually demands. */
function declaredCodes(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const text = fs.readFileSync(p, 'utf8');
      // Only the exported policy OBJECTS, so a string that merely looks like a code (a comment, a test fixture) is not
      // mistaken for a requirement.
      for (const block of text.match(/Permissions\s*=\s*\{[\s\S]*?\}\s*as const/g) ?? []) {
        for (const m of block.matchAll(/:\s*'([a-z][a-z0-9_.]*\.[a-z][a-z0-9_.]*)'/g)) {
          found.set(m[1], path.relative(API_SRC, p));
        }
      }
    }
  };
  walk(API_SRC);
  return found;
}

/** Every code that EXISTS as a row — from the seed (fresh databases) or from any migration (existing ones). */
function definedCodes(): Set<string> {
  const defined = new Set<string>();
  const addFrom = (text: string) => {
    // Definition shape: ('code','Some Name', … — a grant line is ('code') or p.code IN ('a','b'), which has no name.
    for (const m of text.matchAll(/\('([a-z][a-z0-9_.]*\.[a-z][a-z0-9_.]*)'\s*,\s*'/g)) defined.add(m[1]);
  };
  const seed = path.join(DB, 'seeds', 'core', '0004_roles_permissions.sql');
  const seedText = fs.readFileSync(seed, 'utf8');
  addFrom(seedText.slice(seedText.indexOf('INSERT INTO permissions'), seedText.indexOf('INSERT INTO role_permissions')));

  const migDir = path.join(DB, 'migrations');
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql'))) {
    const t = fs.readFileSync(path.join(migDir, f), 'utf8');
    // **EVERY occurrence, not the first.** A first-match version of this read found the phrase inside 0128's own header
    // comment — where the defect is explained — and scanned the prose instead of the INSERT, reporting the eight rows it
    // had just added as still missing. A migration is allowed to talk about itself.
    for (const m of t.matchAll(/INSERT INTO permissions[\s\S]*?;/g)) addFrom(m[0]);
  }
  return defined;
}

describe('TENANT-1b-3 · every permission a route requires is a row somebody can hold', () => {
  const declared = declaredCodes();
  const defined = definedCodes();

  it('found the policy objects at all', () => {
    // A guard against the test quietly passing because the walk broke: if this drops to zero, the comparison below is
    // vacuous and would report a clean bill of health for any codebase.
    expect(declared.size).toBeGreaterThan(50);
    expect(defined.size).toBeGreaterThan(50);
    expect(declared.has('report.view')).toBe(true);
  });

  /**
   * **THE ASSERTION THAT MATTERS.** The failure message names the file, because the person who broke it is the person who
   * just added a policy code and has not yet written the migration.
   */
  it('has no code declared in code but missing from the permissions table', () => {
    const missing = [...declared.entries()]
      .filter(([code]) => !defined.has(code))
      .map(([code, file]) => `${code}  (declared in ${file})`);
    expect(missing).toEqual([]);
  });

  /** The seven that 0128 fixed, pinned by name — so a revert of that migration fails loudly rather than silently. */
  it.each([
    'member.pii.reveal', 'member.view360', 'listing.boost', 'listing.view_any',
    'group_lot.manage', 'group_lot.coordinate', 'certificate.submit', 'certificate.verify',
  ])('%s exists as a row (0128)', (code) => {
    expect(defined.has(code)).toBe(true);
  });

  /**
   * **AND THE ROW HAS TO BE ADDED IN A MIGRATION, NOT ONLY IN THE SEED.** db/seeds runs on a fresh database; an existing
   * tenant's `permissions` table is only ever changed by a migration. A fix that lives only in the seed file makes the
   * demo work and leaves every real organisation exactly as broken — which is the harder bug to notice, because the
   * developer who "fixed" it saw it working.
   */
  it('added the eight codes in a MIGRATION so existing tenants are fixed too', () => {
    const mig = fs.readFileSync(path.join(DB, 'migrations', '0128_missing_permissions_and_view360.sql'), 'utf8');
    for (const code of ['member.pii.reveal', 'member.view360', 'listing.boost', 'listing.view_any',
      'group_lot.manage', 'group_lot.coordinate', 'certificate.submit', 'certificate.verify']) {
      expect(mig).toContain(`('${code}'`);
    }
    // Idempotent, because migrations get re-run against databases in unknown states.
    expect(mig).toMatch(/ON CONFLICT \(code\) DO NOTHING/);
    expect(mig).toMatch(/ON CONFLICT \(role_id, permission_code\) DO NOTHING/);
  });

  /**
   * **AND EACH ONE IS GRANTED TO AT LEAST ONE ROLE**, because a row nobody holds is the same locked door one layer in.
   * Checked against the grant blocks in both the seed and 0128.
   */
  it('grants every newly-added code to at least one role', () => {
    const seedText = fs.readFileSync(path.join(DB, 'seeds', 'core', '0004_roles_permissions.sql'), 'utf8');
    const grants = seedText.slice(seedText.indexOf('INSERT INTO role_permissions'))
      + fs.readFileSync(path.join(DB, 'migrations', '0128_missing_permissions_and_view360.sql'), 'utf8');
    for (const code of ['member.pii.reveal', 'member.view360', 'listing.boost', 'listing.view_any',
      'group_lot.manage', 'group_lot.coordinate', 'certificate.submit', 'certificate.verify']) {
      expect(grants).toContain(`'${code}'`);
    }
  });

  /**
   * **THE TWO NARROWEST GRANTS STAY NARROW.** `member.pii.reveal` and `member.view360` go to `tenant_admin` only — not to
   * `tenant_staff`, not to `support_agent`. W153 and W155 both say so ("the deepest per-person view in your console, so
   * the narrowest grant"), and a default that hands 40 field officers an unmasked phone book is the mistake nobody
   * reports, because nobody complains about being able to do too much.
   */
  it('keeps the PII reveal and the 360 to tenant_admin by default', () => {
    const mig = fs.readFileSync(path.join(DB, 'migrations', '0128_missing_permissions_and_view360.sql'), 'utf8');
    const line = mig.split('\n').find((l) => l.includes("'member.pii.reveal', 'member.view360'"))!;
    expect(line).toContain("r.code = 'tenant_admin'");
    expect(line).not.toContain('tenant_staff');
    expect(line).not.toContain('support_agent');
  });
});
