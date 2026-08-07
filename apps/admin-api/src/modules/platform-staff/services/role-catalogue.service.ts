// apps/admin-api/src/modules/platform-staff/services/role-catalogue.service.ts · W105 (PC-56 ADMIN-9).
//
// A READ over the compiled catalogue, joined to OBSERVED membership. No write path, by design and with the reason
// carried in the payload — see `NO_WRITE_PATH_REASON`.
import { Injectable } from '@nestjs/common';
import { OperatorRegistryRepository } from '../../../core/auth/operator-registry.repository';
import { ownerPermissionCodes } from '../../../core/rbac/owner-roles';
import {
  MATRIX_SOURCE, NO_WRITE_PATH_REASON, buildMatrix, godModeOnlyPermissions, holdersOf, matrixRoles, permissionGroups,
} from '../domain/role-matrix';

@Injectable()
export class RoleCatalogueService {
  constructor(private readonly repo: OperatorRegistryRepository) {}

  async matrix(q: { group?: string }) {
    const membership = await this.repo.roleMembership();
    const roles = matrixRoles();
    const rows = buildMatrix(q.group);
    return {
      data: rows,
      meta: {
        roles: roles.map((r) => ({
          ...r,
          // "Operators last seen carrying this role", never "members". W105's badge reads "18 members", which implies
          // an assignment list; this realm can only count the operators whose last token said so.
          observedMembers: membership[r.role] ?? 0,
        })),
        groups: permissionGroups(),
        group: q.group ?? null,
        permissionCount: ownerPermissionCodes().length,
        roleCount: roles.length,
        // **THE MATRIX IS THE ENFORCEMENT SOURCE, NOT A MIRROR OF IT.** Named so a reader can go and check.
        source: MATRIX_SOURCE,
        writable: false,
        noWritePathReason: NO_WRITE_PATH_REASON,
        // A permission no ordinary role holds can only be used by a god-mode account, which means every use of it is a
        // use of the most powerful credential on the platform. A least-privilege catalogue with unreachable entries has
        // a hole in it, and this is the list of holes.
        godModeOnly: godModeOnlyPermissions(),
        membershipBasis: 'observed',
        membershipCaveatOwner: 'ADMIN-9-Q1',
      },
    };
  }

  /** The reverse read: who can do this. One glance instead of a 53-row column scan, and the question an auditor
   *  actually arrives with. */
  holders(permission: string) {
    const known = ownerPermissionCodes().includes(permission);
    return {
      permission,
      known,
      ...holdersOf(permission),
      // An unknown code returns `known:false` rather than an empty holder list, because "no role holds this" and "this
      // is not a permission" are answers a reader must not confuse — the first is a gap, the second is a typo.
    };
  }
}
