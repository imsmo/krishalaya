// core/rbac/__tests__/owner-permission-reachability.spec.ts · PC-56 ADMIN-SWEEP-b1.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A PERMISSION A ROUTE DEMANDS THAT NO ROLE GRANTS IS A LOCKED DOOR FOR
// EVERYONE EXCEPT GOD MODE.**
//
// This is the platform-realm twin of `tenant1b3-permission-reachability.spec.ts`. That guard walks the tenant
// realm's `permissions` table because tenant grants are DATA; this realm's grants are CODE — `OWNER_ROLE_GRANTS` in
// owner-roles.ts, deliberately (Law 11: granting a platform permission is a code review and a deploy). Same defect
// class, different substrate: `moderation.appeals` was named by W097's restricted state and by 0067/0110's own
// rationale comments, and existed in neither the catalog nor any role — the EIGHTH occurrence of the shape
// TENANT-1b-3 fixed seven of. A route behind it would have 403'd every operator below super_admin, forever, quietly.
//
// TWO DELIBERATE READINGS:
//   • Comments are STRIPPED before scanning. The tenant guard's own history (0128's header) is the warning: a
//     migration — or a controller — is allowed to TALK about a permission it does not demand, and prose scanned as
//     code has produced false findings five times in this program.
//   • '*' does not count as a grant. super_admin holds everything by construction; "only god mode can reach this
//     route" IS the defect, not a mitigation of it.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { OwnerPermissions, ownerRoleCatalogue } from '../owner-roles';

const ADMIN_SRC = path.join(__dirname, '..', '..', '..');

/** Strip block and line comments without eating string contents (a reason string may contain `//`). */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  while (i < src.length) {
    const c = src[i]; const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'single';
      else if (c === '"') mode = 'double';
      else if (c === '`') mode = 'template';
      out += c; i += 1; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i += 1; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; } else i += 1; continue; }
    // inside a string: copy verbatim, honour escapes, close on the right quote
    if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
    if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) mode = 'code';
    out += c; i += 1;
  }
  return out;
}

/** Every permission CODE a route in this app actually demands — `@RequireOwnerPermission(OwnerPermissions.Key)` or,
 *  should anyone write one, a raw string form. Resolved against the RUNTIME catalog object, not the import line. */
function demandedCodes(): Map<string, string[]> {
  const demanded = new Map<string, string[]>();
  const note = (code: string, file: string) => {
    demanded.set(code, [...(demanded.get(code) ?? []), file]);
  };
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules' && e.name !== 'dist') walk(p); continue; }
      if (!e.name.endsWith('.ts') || e.name.endsWith('.spec.ts')) continue;
      const text = stripComments(fs.readFileSync(p, 'utf8'));
      const rel = path.relative(ADMIN_SRC, p);
      for (const m of text.matchAll(/RequireOwnerPermission\(\s*OwnerPermissions\.([A-Za-z0-9_]+)\s*\)/g)) {
        const code = (OwnerPermissions as Record<string, string>)[m[1]];
        // An unknown KEY cannot compile, but the guard must not silently drop it if it ever appears via a cast.
        note(code ?? `<unknown key ${m[1]}>`, rel);
      }
      for (const m of text.matchAll(/RequireOwnerPermission\(\s*'([a-z][a-z0-9_.]*)'\s*\)/g)) note(m[1], rel);
    }
  };
  walk(ADMIN_SRC);
  return demanded;
}

/** Every code at least one NON-WILDCARD role grants — read through the same projection W105's matrix reads. */
function grantableCodes(): Set<string> {
  const grantable = new Set<string>();
  for (const role of ownerRoleCatalogue()) {
    if (role.isGodMode) continue;
    for (const p of role.permissions) grantable.add(p);
  }
  return grantable;
}

describe('ADMIN-SWEEP-b1 · every owner permission a route demands is one somebody below god mode can hold', () => {
  const demanded = demandedCodes();
  const grantable = grantableCodes();
  const catalog = new Set(Object.values(OwnerPermissions) as string[]);

  it('found the decorators at all (vacuity guard)', () => {
    // If the walk or the regex breaks, the comparison below passes for any codebase. This app has had dozens of
    // guarded routes since ADMIN-5; a collapse to single digits means the scan is reading the wrong tree.
    expect(demanded.size).toBeGreaterThan(30);
    expect(grantable.size).toBeGreaterThan(30);
    expect(demanded.has('moderation.read')).toBe(true);
  });

  it('demands only codes that exist in the catalog', () => {
    const unknown = [...demanded.entries()]
      .filter(([code]) => !catalog.has(code))
      .map(([code, files]) => `${code}  (demanded in ${files.join(', ')})`);
    expect(unknown).toEqual([]);
  });

  /** THE ASSERTION THAT MATTERS. The failure names the files, because the person who broke it has just added a
   *  guarded route and not yet added the grant line — the same person 0128's twin message is written for. */
  it('has no code demanded by a route that no non-wildcard role grants', () => {
    const unholdable = [...demanded.entries()]
      .filter(([code]) => !grantable.has(code))
      .map(([code, files]) => `${code}  (demanded in ${files.join(', ')})`);
    expect(unholdable).toEqual([]);
  });

  /** The eighth occurrence, pinned by name — a revert of the ADMIN-SWEEP-b1 grant lines fails loudly. */
  it('moderation.appeals is in the catalog and held by a desk below god mode', () => {
    expect(catalog.has('moderation.appeals')).toBe(true);
    expect(grantable.has('moderation.appeals')).toBe(true);
    // And by the desks the wave granted it to — membership in the resolved ARRAY, not a source-text scan.
    const byRole = new Map(ownerRoleCatalogue().map((r) => [r.role, r.permissions]));
    expect(byRole.get('platform_moderation_desk')).toContain('moderation.appeals');
    expect(byRole.get('platform_safety_desk')).toContain('moderation.appeals');
  });

  /** THE NINTH AND TENTH, pinned the same way — found by this guard's FIRST run. ADMIN-4b split these two out of
   *  the registry grants (cross-tenant reads over farmers deserve their own key) and granted them to nobody, so
   *  W074/W076's oversight routes refused every operator below god mode from the day they shipped. */
  it('schemes.applications.read / schemes.dbt.read are held by the oversight role below god mode', () => {
    const byRole = new Map(ownerRoleCatalogue().map((r) => [r.role, r.permissions]));
    expect(byRole.get('platform_schemes_oversight')).toContain('schemes.applications.read');
    expect(byRole.get('platform_schemes_oversight')).toContain('schemes.dbt.read');
    // and NOT by the registry roles — ADMIN-4b's reason for the split, kept true
    expect(byRole.get('platform_schemes_ops')).not.toContain('schemes.applications.read');
    expect(byRole.get('platform_schemes_viewer')).not.toContain('schemes.applications.read');
  });

  /** The stripper itself is load-bearing (a prose mention must not count as a demand), so its two failure modes are
   *  pinned: prose is dropped, strings survive. */
  it('stripComments drops prose and keeps string contents', () => {
    const src = "// RequireOwnerPermission(OwnerPermissions.LedgerCorrect)\n" +
      "/* RequireOwnerPermission('ledger.correct') */\n" +
      "const s = 'https://example.test//path';\nRequireOwnerPermission(OwnerPermissions.AuditRead)";
    const stripped = stripComments(src);
    expect(stripped).not.toContain('LedgerCorrect');
    expect(stripped).toContain("'https://example.test//path'");
    expect(stripped).toContain('OwnerPermissions.AuditRead');
  });
});
