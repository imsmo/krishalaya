// apps/admin-api/src/modules/platform-staff/domain/role-matrix.ts · W105 (PC-56 ADMIN-9).
//
// **W105 IS BUILDABLE AS A READ AND UNBUILDABLE AS A WRITE, AND THE SCREEN SAYS SO ITSELF.** Its error state reads:
// "Enforcement reads from the compiled policy, not this view." That is exactly true — `owner-roles.ts` IS the compiled
// policy — and it settles the wave's biggest design question in the canon's own words:
//
//   * THE MATRIX IS REAL. 33 platform roles × 53 permission codes, projected from the object every request is
//     authorised against. Not a mirror that could drift: the same function the guard calls.
//   * THE SUBMIT-DIFF CONTROL CANNOT EXIST. Granting a permission means editing a frozen TypeScript constant and
//     deploying. A console that appeared to submit a role diff would be writing to a table nothing reads, and W105's
//     own promise — "Grants take effect on next session; revokes take effect immediately" — would be false in both
//     halves. So the control is ABSENT, with the reason on the page, rather than present and inert.
//
// The canon's tenant-realm vocabulary does not fit either, and the difference is not cosmetic: W105's fine print says
// "permission codes are DB truth (permissions.code)". For a TENANT role that is true. For a PLATFORM role it is false
// by design — Law 11 puts these codes in the god-mode realm precisely so that no row in the tenant database can grant
// one. The matrix therefore states its source as the compiled catalogue.
import { ownerPermissionCodes, ownerRoleCatalogue } from '../../../core/rbac/owner-roles';

export interface MatrixCell {
  role: string;
  /** 'granted' | 'god_mode' | 'none'. A super_admin's `'*'` is drawn as its own state rather than as 53 ticks: it is
   *  not "holds every permission we happened to define", it is "holds whatever is defined", including codes added by a
   *  future deploy that nobody reviewed against this role. Flattening it to ticks would hide that. */
  state: 'granted' | 'god_mode' | 'none';
}

export interface MatrixRow {
  permission: string;
  /** The module prefix — `payouts.approve` → `payouts`. W105 groups by module code (M02/M05/M09…) which is the TENANT
   *  catalogue's numbering; the platform codes carry their grouping in the code itself, so the prefix is the honest
   *  grouping rather than a made-up module number. */
  group: string;
  cells: MatrixCell[];
}

export function permissionGroup(code: string): string {
  const i = code.indexOf('.');
  return i <= 0 ? code : code.slice(0, i);
}

export function permissionGroups(): string[] {
  return [...new Set(ownerPermissionCodes().map(permissionGroup))].sort();
}

/** Roles in the order the matrix renders them: god-mode last. W105 puts `super_admin` at the right-hand edge, which is
 *  the correct instinct — a column that ticks everything anchors the eye and makes the differences between the other
 *  roles harder to see, which are the only thing a reviewer is looking for. */
export function matrixRoles(): { role: string; isGodMode: boolean; permissionCount: number }[] {
  const cat = ownerRoleCatalogue();
  const rows = cat.map((r) => ({
    role: r.role,
    isGodMode: r.isGodMode,
    // A god-mode role's count is the whole catalogue, and it is reported as such rather than as 1 (the literal length
    // of `['*']`), because "super_admin holds 1 permission" is arithmetically true and a lie about what it can do.
    permissionCount: r.isGodMode ? ownerPermissionCodes().length : r.permissions.length,
  }));
  return [...rows.filter((r) => !r.isGodMode), ...rows.filter((r) => r.isGodMode)];
}

export function buildMatrix(group?: string): MatrixRow[] {
  const roles = matrixRoles();
  const cat = new Map(ownerRoleCatalogue().map((r) => [r.role, new Set(r.permissions)]));
  return ownerPermissionCodes()
    .filter((code) => !group || permissionGroup(code) === group)
    .map((permission) => ({
      permission,
      group: permissionGroup(permission),
      cells: roles.map(({ role, isGodMode }) => ({
        role,
        state: isGodMode ? ('god_mode' as const)
          : cat.get(role)?.has(permission) ? ('granted' as const) : ('none' as const),
      })),
    }));
}

/** Which roles hold a given code — the reverse read, and the one a reviewer actually needs: "who can approve a payout"
 *  is answerable in one glance and "what can this role do" takes a column-scan of 53 rows. */
export function holdersOf(permission: string): { direct: string[]; godMode: string[] } {
  const cat = ownerRoleCatalogue();
  return {
    direct: cat.filter((r) => !r.isGodMode && r.permissions.includes(permission)).map((r) => r.role),
    godMode: cat.filter((r) => r.isGodMode).map((r) => r.role),
  };
}

/**
 * **THE PERMISSIONS NO ROLE HOLDS AT ALL.** A permission defined in the catalogue and granted to no non-god role can
 * only be exercised by a super_admin — which means every use of it is a use of the most powerful account on the
 * platform, and a least-privilege catalogue with unreachable entries is a catalogue with a hole in it. Worth surfacing
 * rather than leaving to be discovered when somebody needs the permission at 3 a.m. and the only way to get it is to
 * hand out god mode.
 */
export function godModeOnlyPermissions(): string[] {
  const cat = ownerRoleCatalogue().filter((r) => !r.isGodMode);
  return ownerPermissionCodes().filter((code) => !cat.some((r) => r.permissions.includes(code)));
}

export const MATRIX_SOURCE = 'apps/admin-api/src/core/rbac/owner-roles.ts' as const;

/** Quoted by the console so the sentence exists once. The screen must say why there is no Submit control, because an
 *  absence with no explanation reads as an unbuilt feature rather than as a deliberate ceiling. */
export const NO_WRITE_PATH_REASON =
  'These are PLATFORM roles and they live in the god-mode realm\'s compiled catalogue, never in a database table — that '
  + 'is what stops any row, anywhere, from granting a platform permission (Law 11). Changing them is a code review and a '
  + 'deploy. A Submit-diff control here would write to a table nothing reads, and the screen\'s own promise that "grants '
  + 'take effect on next session" would be false.';
